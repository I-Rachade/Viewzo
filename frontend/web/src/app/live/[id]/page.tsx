"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  formatFcfa,
  LIVE_STATUS_LABELS,
  LIVE_STATUS_TONES,
  LiveBoard,
  LiveCandidate,
  LiveSession,
  liveApi,
  PAYOUT_LABELS,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_TONES,
} from "@/lib/api";
import { countryName } from "../../country-select";
import { LoadingCard } from "../../loading-card";
import { useRequireUser } from "../../_shell/session";
import {
  Comments,
  DATE,
  LeadCard,
  POLL_MS,
  Products,
  Stats,
} from "../board-parts";
import { isUnavailable, UNAVAILABLE } from "../unavailable";

const DAY = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

type Act = (action: () => Promise<unknown>, ask?: string) => Promise<boolean>;

// The seller's offer: payment, the creators selling it, and the buyers.
export default function LiveScreen() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      liveApi.board(id).then(setBoard, (e) => {
        if (isUnavailable(e)) setOff(true);
        else setError((e as Error).message);
      }),
    [id],
  );

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  const running = !!board?.sessions.some((s) => s.status === "RUNNING");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  const act: Act = async (action, ask) => {
    if (ask && !window.confirm(ask)) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (off) {
    return (
      <div className="card">
        <h1>Ventes en live</h1>
        <p>{UNAVAILABLE}</p>
        <Link className="button secondary" href="/dashboard">
          Tableau de bord
        </Link>
      </div>
    );
  }
  if (!user || (!board && !error)) return <LoadingCard />;
  if (!board) {
    return (
      <div className="card">
        <p className="error">{error}</p>
        <Link className="button secondary" href="/live">
          Mes lives
        </Link>
      </div>
    );
  }

  const { live } = board;
  const self = live.mode === "SELF";
  const closed = ["COMPLETED", "REJECTED", "CANCELLED"].includes(live.status);
  const handles = new Map(board.sessions.map((s) => [s.id, s.tiktokUsername]));
  const several = board.sessions.filter((s) => s.startedAt).length > 1;
  const leads = only
    ? board.leads.filter((l) => l.sessionId === only)
    : board.leads;

  return (
    <>
      <div className="card wide">
        <Link href="/live" className="hint">
          ← Mes lives
        </Link>
        <h1>{live.title}</h1>
        <p>
          <span className={`pill ${LIVE_STATUS_TONES[live.status]}`}>
            {LIVE_STATUS_LABELS[live.status]}
          </span>{" "}
          {self
            ? `Ton live · ${DATE.format(new Date(live.startsAt))}`
            : `${DAY.format(new Date(live.startsAt))} → ${live.endsAt ? DAY.format(new Date(live.endsAt)) : "?"} · ${live.slots} créateur${live.slots > 1 ? "s" : ""} · ${live.countries.map(countryName).join(", ")}`}
          {live.demo ? " · démo" : ""}
        </p>
        {live.whatsapp && (
          <p className="hint">
            Les acheteurs t’écrivent sur WhatsApp au {live.whatsapp} avec leur
            code. Lecture des commentaires :{" "}
            {board.ai ? "IA (Claude)" : "mots-clés"}. Les numéros écrits dans
            les commentaires sont masqués et jamais gardés.
          </p>
        )}
        {live.statusReason && <p className="error">{live.statusReason}</p>}
        {error && <p className="error">{error}</p>}

        {!self && <Money board={board} busy={busy} act={act} />}
        {self && board.sessions[0] && (
          <OwnLive
            live={board}
            session={board.sessions[0]}
            busy={busy}
            act={act}
          />
        )}
        {!closed && !board.sessions.some((s) => s.status === "RUNNING") && (
          <div className="actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(
                  () => liveApi.cancel(live.id),
                  live.fundedAt
                    ? "Annuler cette offre ? Le budget non dépensé revient sur ton solde."
                    : "Annuler cette offre ?",
                )
              }
            >
              Annuler l’offre
            </button>
          </div>
        )}
        <Stats stats={board.stats} />
      </div>

      {!self && <Creators board={board} busy={busy} act={act} />}

      <div className="card wide">
        <h2>{closed ? "Bilan des acheteurs" : "Acheteurs"}</h2>
        <p className="hint">
          Chaque acheteur reçoit un code et t’écrit sur WhatsApp. C’est toi qui
          livres et encaisses.
        </p>
        {several && (
          <div className="chips">
            <button
              className={`chip${only === null ? " selected" : ""}`}
              onClick={() => setOnly(null)}
            >
              Tous les lives
            </button>
            {board.sessions
              .filter((s) => s.startedAt)
              .map((s) => (
                <button
                  key={s.id}
                  className={`chip${only === s.id ? " selected" : ""}`}
                  onClick={() => setOnly(s.id)}
                >
                  @{s.tiktokUsername}
                </button>
              ))}
          </div>
        )}
        {running && <ManualLead board={board} busy={busy} act={act} />}
        {leads.length === 0 && (
          <p>
            {running ? "En attente des premiers acheteurs…" : "Aucun acheteur."}
          </p>
        )}
        <div className="stagger" style={{ display: "grid", gap: 12 }}>
          {leads.map((l) => (
            <LeadCard
              key={l.id}
              lead={l}
              busy={busy}
              via={self ? undefined : handles.get(l.sessionId)}
              onStatus={(status) =>
                act(() => liveApi.setLead(live.id, l.id, status))
              }
            />
          ))}
        </div>
      </div>

      <Products products={board.products} />
      <Comments comments={board.comments} />
    </>
  );
}

// Escrow of an offer sold by creators: pay it, then follow what was spent.
function Money({
  board,
  busy,
  act,
}: {
  board: LiveBoard;
  busy: boolean;
  act: Act;
}) {
  const { live } = board;
  if (live.status === "PENDING_PAYMENT") {
    return (
      <div className="summary">
        <p>
          Mets <b>{formatFcfa(live.budget)}</b> en séquestre pour envoyer
          l’offre à l’équipe. Chaque créateur est payé au plus{" "}
          {formatFcfa(Math.floor(live.budget / live.slots))} selon son audience
          ; le reste revient sur ton solde.
        </p>
        <div className="actions">
          <button
            className="coral"
            disabled={busy}
            onClick={() => act(() => liveApi.pay(live.id))}
          >
            Payer depuis mon solde
          </button>
          <Link className="button secondary" href="/wallet">
            Recharger mon solde
          </Link>
        </div>
      </div>
    );
  }
  return (
    <p className="hint">
      {live.status === "PENDING_REVIEW" &&
        "L’équipe Viewzo vérifie ton offre avant de l’ouvrir aux créateurs. "}
      Budget {formatFcfa(live.budget)} · {formatFcfa(live.spent)} payés aux
      créateurs
      {live.refunded > 0 ? ` · ${formatFcfa(live.refunded)} remboursés` : ""}
    </p>
  );
}

// The advertiser's own live: start it, resume after a cut, end it.
function OwnLive({
  live,
  session,
  busy,
  act,
}: {
  live: LiveBoard;
  session: LiveSession;
  busy: boolean;
  act: Act;
}) {
  const id = live.live.id;
  const runningHere = session.status === "RUNNING";
  const detached = runningHere && !session.running;
  return (
    <>
      <p>
        <span className={`pill ${SESSION_STATUS_TONES[session.status]}`}>
          {SESSION_STATUS_LABELS[session.status]}
        </span>{" "}
        @{session.tiktokUsername}
        {session.viewers != null && runningHere
          ? ` · ${session.viewers} spectateurs`
          : ""}
      </p>
      {!!live.live.serviceFee && session.status === "ACCEPTED" && (
        <p className="hint">
          La lecture des commentaires coûte {formatFcfa(live.live.serviceFee)},
          pris sur ton solde quand tu commences.
        </p>
      )}
      {session.sourceMessage && session.status !== "ENDED" && (
        <p className={session.sourceState === "error" ? "error" : "hint"}>
          {session.sourceMessage}
        </p>
      )}
      <div className="actions">
        {(session.status === "ACCEPTED" || detached) && (
          <button
            className="coral"
            disabled={busy}
            onClick={() => act(() => liveApi.start(id))}
          >
            {detached ? "Reprendre la lecture" : "Commencer le live"}
          </button>
        )}
        {runningHere && (
          <button
            disabled={busy}
            onClick={() =>
              act(
                () => liveApi.stop(id),
                "Terminer le live ? Viewzo arrête de lire les commentaires.",
              )
            }
          >
            Terminer le live
          </button>
        )}
      </div>
    </>
  );
}

// The creators who accepted or were invited, and who else to invite.
function Creators({
  board,
  busy,
  act,
}: {
  board: LiveBoard;
  busy: boolean;
  act: Act;
}) {
  const { live, sessions } = board;
  const [candidates, setCandidates] = useState<LiveCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taken = sessions.filter((s) =>
    ["INVITED", "ACCEPTED", "RUNNING", "ENDED"].includes(s.status),
  ).length;
  const canInvite = live.status === "ACTIVE" && taken < live.slots;

  function loadCandidates() {
    setError(null);
    liveApi
      .candidates(live.id)
      .then(setCandidates, (e) => setError((e as Error).message));
  }

  return (
    <div className="card wide">
      <h2>
        Créateurs · {taken}/{live.slots}
      </h2>
      <p className="hint">
        Les créateurs vérifiés (compétence live, au moins 1 000 abonnés TikTok)
        acceptent ton offre et choisissent leur heure. Tu peux aussi en inviter
        : les places restantes vont aux premiers qui acceptent.
      </p>
      {sessions.length === 0 && <p>Aucun créateur pour l’instant.</p>}
      {sessions.map((s) => (
        <div className="line" key={s.id}>
          <span>
            <b>@{s.tiktokUsername}</b>
            {s.creator?.firstName ? ` · ${s.creator.firstName}` : ""}{" "}
            <span className={`pill ${SESSION_STATUS_TONES[s.status]}`}>
              {SESSION_STATUS_LABELS[s.status]}
            </span>
            <br />
            <small>
              {s.followers != null
                ? `${s.followers.toLocaleString("fr-FR")} abonnés`
                : ""}
              {s.scheduledAt
                ? ` · prévu ${DATE.format(new Date(s.scheduledAt))}`
                : ""}
              {s.status === "RUNNING" && s.viewers != null
                ? ` · ${s.viewers} spectateurs`
                : ""}
              {s.status === "RUNNING" && !s.running ? " · lecture coupée" : ""}
            </small>
            {s.status === "ENDED" && (
              <>
                <br />
                <small>
                  {s.peakViewers.toLocaleString("fr-FR")} spectateurs au plus
                  fort · {PAYOUT_LABELS[s.payout]}
                  {s.cost > 0 ? ` · ${formatFcfa(s.cost)}` : ""}
                </small>
              </>
            )}
          </span>
        </div>
      ))}
      {canInvite && (
        <>
          {candidates === null ? (
            <button className="secondary" onClick={loadCandidates}>
              Inviter des créateurs
            </button>
          ) : (
            <>
              <h3>Inviter</h3>
              {candidates.length === 0 && <p>Aucun créateur disponible.</p>}
              {candidates.map((c) => (
                <div className="line" key={c.id}>
                  <span>
                    <b>@{c.tiktokUsername}</b>
                    {c.firstName ? ` · ${c.firstName}` : ""}
                    <br />
                    <small>
                      {c.followers.toLocaleString("fr-FR")} abonnés ·{" "}
                      {countryName(c.country)}
                    </small>
                  </span>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      if (await act(() => liveApi.invite(live.id, c.id))) {
                        setCandidates((list) =>
                          (list ?? []).filter((x) => x.id !== c.id),
                        );
                      }
                    }}
                  >
                    Inviter
                  </button>
                </div>
              ))}
            </>
          )}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}

// For a buyer the reading missed, e.g. one who asked in a private message.
function ManualLead({
  board,
  busy,
  act,
}: {
  board: LiveBoard;
  busy: boolean;
  act: Act;
}) {
  const live = board.sessions.filter((s) => s.status === "RUNNING");
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await act(() =>
      liveApi.addLead(board.live.id, {
        tiktokUser: user,
        sessionId: sessionId || live[0]?.id,
        items: productId
          ? [{ productId, quantity: Number(quantity) || 1 }]
          : undefined,
      }),
    );
    if (ok) {
      setOpen(false);
      setUser("");
      setProductId("");
      setQuantity("1");
    }
  }

  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        Ajouter un acheteur à la main
      </button>
    );
  }
  return (
    <form className="row" onSubmit={submit}>
      <label>
        Compte TikTok
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="@acheteur"
          pattern="@?[A-Za-z0-9._]{2,24}"
          required
        />
      </label>
      {live.length > 1 && (
        <label>
          Live
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            required
          >
            <option value="">Choisir</option>
            {live.map((s) => (
              <option key={s.id} value={s.id}>
                @{s.tiktokUsername}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Produit
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        >
          <option value="">Aucun pour l’instant</option>
          {board.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {formatFcfa(p.price)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantité
        <input
          type="number"
          min={1}
          max={999}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>
      <button disabled={busy}>Ajouter</button>
    </form>
  );
}
