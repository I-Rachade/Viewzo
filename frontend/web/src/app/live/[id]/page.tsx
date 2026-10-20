"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  formatFcfa,
  INTENT_LABELS,
  LEAD_STATUS_LABELS,
  LIVE_STATUS_LABELS,
  LIVE_STATUS_TONES,
  LiveBoard,
  LiveLead,
  LiveLeadStatus,
  liveApi,
} from "@/lib/api";
import { LoadingCard } from "../../loading-card";
import { useRequireUser } from "../../_shell/session";
import { isUnavailable, UNAVAILABLE } from "../unavailable";

// How often the screen reads the live again while it runs.
const POLL_MS = 3000;

const TIME = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" });
const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const LEAD_TONES: Record<LiveLeadStatus, string> = {
  NEW: "pending",
  CONTACTED: "pending",
  PAID: "paid",
  DELIVERED: "paid",
  CANCELLED: "refused",
};

// The seller's live screen: start, follow the buyers, then the summary.
export default function LiveScreen() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const running = board?.live.status === "RUNNING";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  async function act(action: () => Promise<unknown>, ask?: string) {
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
  }

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

  const { live, stats } = board;
  const finished = live.status === "ENDED" || live.status === "CANCELLED";
  // A running live whose connection dropped (server restart, TikTok cut).
  const detached = running && !board.running;

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
          @{live.tiktokUsername} · {DATE.format(new Date(live.scheduledAt))}
          {live.demo ? " · démo" : ""}
          {live.viewers != null && running ? ` · ${live.viewers} spectateurs` : ""}
        </p>
        <p className="hint">
          Lecture des commentaires :{" "}
          {board.ai ? "IA (Claude)" : "mots-clés (IA non configurée)"}. Les
          numéros écrits dans les commentaires sont masqués et jamais gardés.
        </p>
        {live.sourceMessage && !finished && (
          <p className={live.sourceState === "error" ? "error" : "hint"}>
            {live.sourceMessage}
          </p>
        )}
        {live.cancelReason && <p className="error">{live.cancelReason}</p>}
        {error && <p className="error">{error}</p>}

        <div className="actions">
          {live.status === "SCHEDULED" && (
            <button
              className="coral"
              disabled={busy}
              onClick={() => act(() => liveApi.start(live.id))}
            >
              Commencer le live
            </button>
          )}
          {detached && (
            <button
              className="coral"
              disabled={busy}
              onClick={() => act(() => liveApi.start(live.id))}
            >
              Reprendre la lecture
            </button>
          )}
          {running && (
            <button
              disabled={busy}
              onClick={() =>
                act(
                  () => liveApi.stop(live.id),
                  "Terminer le live ? Viewzo arrête de lire les commentaires.",
                )
              }
            >
              Terminer le live
            </button>
          )}
          {!finished && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(() => liveApi.cancel(live.id), "Annuler ce live ?")
              }
            >
              Annuler
            </button>
          )}
        </div>

        <div className="stats">
          <div>
            <small>Commentaires</small>
            <strong>{stats.comments}</strong>
          </div>
          <div>
            <small>Intéressés</small>
            <strong>{stats.interested}</strong>
          </div>
          <div>
            <small>Avec panier</small>
            <strong>{stats.buyers}</strong>
          </div>
          <div>
            <small>Payés</small>
            <strong>{stats.paid}</strong>
          </div>
          <div>
            <small>Ventes prévues</small>
            <strong>{formatFcfa(stats.forecast)}</strong>
          </div>
        </div>
      </div>

      <div className="card wide">
        <h2>{finished ? "Bilan des acheteurs" : "Acheteurs"}</h2>
        <p className="hint">
          Chaque acheteur reçoit un code. Il l’envoie sur WhatsApp pour donner
          son numéro et payer.
        </p>
        {running && <ManualLead board={board} busy={busy} act={act} />}
        {board.leads.length === 0 && (
          <p>{running ? "En attente des premiers acheteurs…" : "Aucun acheteur."}</p>
        )}
        <div className="stagger" style={{ display: "grid", gap: 12 }}>
          {board.leads.map((l) => (
            <LeadCard
              key={l.id}
              lead={l}
              busy={busy}
              onStatus={(status) => act(() => liveApi.setLead(live.id, l.id, status))}
            />
          ))}
        </div>
      </div>

      <div className="card wide">
        <h2>Produits</h2>
        {board.products.length === 0 && (
          <p>
            Aucun produit actif. <Link href="/live">Ajoute ton catalogue</Link>.
          </p>
        )}
        {board.products.map((p) => (
          <div className="line" key={p.id}>
            <span>{p.name}</span>
            <span>
              <strong>{formatFcfa(p.price)}</strong>
              <br />
              <small>
                {p.left == null ? "stock illimité" : `${p.left} restant${p.left > 1 ? "s" : ""}`}
              </small>
            </span>
          </div>
        ))}
      </div>

      {board.comments.length > 0 && (
        <div className="card wide">
          <h2>Derniers commentaires</h2>
          {board.comments.map((c) => (
            <div className="line" key={c.id}>
              <span>
                <b>{c.nickname}</b> <small>@{c.tiktokUser}</small>
                <br />
                {c.text}
              </span>
              <span>
                {c.intent && c.intent !== "autre" && (
                  <span className="pill neutral">{INTENT_LABELS[c.intent]}</span>
                )}
                <br />
                <small>{TIME.format(new Date(c.at))}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function LeadCard({
  lead,
  busy,
  onStatus,
}: {
  lead: LiveLead;
  busy: boolean;
  onStatus: (status: LiveLeadStatus) => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!lead.reply) return;
    navigator.clipboard?.writeText(lead.reply).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <article className="campaign">
      <header>
        <strong>
          {lead.nickname} <small>@{lead.tiktokUser}</small>
        </strong>
        <span className={`pill ${LEAD_TONES[lead.status]}`}>
          {LEAD_STATUS_LABELS[lead.status]}
        </span>
      </header>
      <p>
        Code <b>{lead.code}</b> · {INTENT_LABELS[lead.intent]}
        {lead.phoneSeen && " · a écrit son numéro (masqué)"}
      </p>
      {lead.items.length > 0 ? (
        <>
          {lead.items.map((i, n) => (
            <div className="line" key={n}>
              <span>
                {i.quantity} × {i.name}
                {i.variant ? ` (${i.variant})` : ""}
              </span>
              <strong>
                {i.unitPrice != null ? formatFcfa(i.unitPrice * i.quantity) : "prix ?"}
              </strong>
            </div>
          ))}
          {lead.total != null && (
            <div className="line">
              <span>Total</span>
              <strong>{formatFcfa(lead.total)}</strong>
            </div>
          )}
        </>
      ) : (
        <p className="hint">Pas encore de panier.</p>
      )}
      {lead.reply && (
        <div className="summary">
          <small>Réponse proposée</small>
          <p>{lead.reply}</p>
          <button type="button" className="secondary" onClick={copy}>
            {copied ? "Copié" : "Copier la réponse"}
          </button>
        </div>
      )}
      <label>
        Statut
        <select
          value={lead.status}
          disabled={busy}
          onChange={(e) => onStatus(e.target.value as LiveLeadStatus)}
        >
          {(Object.keys(LEAD_STATUS_LABELS) as LiveLeadStatus[]).map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
    </article>
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
  act: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await act(() =>
      liveApi.addLead(board.live.id, {
        tiktokUser: user,
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
      <label>
        Produit
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
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
