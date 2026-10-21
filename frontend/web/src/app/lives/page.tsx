"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CreatorLiveHome,
  CreatorLiveSession,
  creatorLiveApi,
  formatFcfa,
  LiveOfferForCreator,
  PAYOUT_LABELS,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_TONES,
} from "@/lib/api";
import { LoadingCard } from "../loading-card";
import { useRequireUser } from "../_shell/session";
import { isUnavailable, UNAVAILABLE } from "../live/unavailable";

const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});
const DAY = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

// "datetime-local" value of a date, in the browser's time zone.
function toLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** First full hour that is both in the period and to come. */
function firstHour(offer: LiveOfferForCreator) {
  const d = new Date(Math.max(Date.now(), new Date(offer.startsAt).getTime()));
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocal(d);
}

type Act = (action: () => Promise<unknown>, ask?: string) => Promise<boolean>;

// Creators' side of live selling: offers to accept and their own lives.
export default function CreatorLivesPage() {
  const user = useRequireUser();
  const [home, setHome] = useState<CreatorLiveHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      creatorLiveApi.home().then(setHome, (e) => {
        if (isUnavailable(e)) setOff(true);
        else setError((e as Error).message);
      }),
    [],
  );

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

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
        <h1>Lives de vente</h1>
        <p>{UNAVAILABLE}</p>
        <Link className="button secondary" href="/dashboard">
          Tableau de bord
        </Link>
      </div>
    );
  }
  if (!user || (!home && !error)) return <LoadingCard />;
  if (!home) {
    return (
      <div className="card">
        <h1>Lives de vente</h1>
        <p className="error">{error}</p>
      </div>
    );
  }

  const { eligibility, rules } = home;
  const invitations = home.sessions.filter((s) => s.status === "INVITED");
  const planned = home.sessions.filter(
    (s) => s.status === "ACCEPTED" || s.status === "RUNNING",
  );
  const past = home.sessions.filter(
    (s) => !["INVITED", "ACCEPTED", "RUNNING"].includes(s.status),
  );

  return (
    <>
      <div className="card wide">
        <h1>Lives de vente</h1>
        <p className="hint">
          Vends les produits d’une boutique pendant ton live TikTok. Tu es payé
          selon le nombre de spectateurs au plus fort de ton live (à partir de{" "}
          {rules.minMinutes} minutes). Les acheteurs écrivent à la boutique sur
          WhatsApp : tu n’as rien à livrer.
        </p>
        <p className="hint">
          Tu peux te retirer avant le début du live, mais tu ne pourras plus
          accepter de live pendant {rules.blockDays} jours. Après{" "}
          {rules.banAfter} retraits de suite, tu ne peux plus faire de lives. Un
          live accepté et pas fait compte comme un retrait.
        </p>
        {eligibility.tiktok && (
          <p>
            Ton compte : <b>@{eligibility.tiktok.username}</b> ·{" "}
            {eligibility.tiktok.followers.toLocaleString("fr-FR")} abonnés
          </p>
        )}
        {!eligibility.eligible && (
          <div className="summary">
            <p>{eligibility.reason}</p>
            <div className="actions">
              <Link className="button secondary" href="/comptes">
                Mes comptes
              </Link>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {invitations.length > 0 && (
        <div className="card wide">
          <h2>Invitations</h2>
          {invitations.map((s) => (
            <OfferCard
              key={s.id}
              offer={s.offer}
              busy={busy}
              canAccept={eligibility.eligible}
              acceptLabel="Accepter l’invitation"
              onAccept={(at) =>
                act(() => creatorLiveApi.respond(s.id, true, at))
              }
              onDecline={() =>
                act(
                  () => creatorLiveApi.respond(s.id, false),
                  "Refuser cette invitation ? Cela ne compte pas comme un retrait.",
                )
              }
            />
          ))}
        </div>
      )}

      {planned.length > 0 && (
        <div className="card wide">
          <h2>Mes lives prévus</h2>
          {planned.map((s) => (
            <PlannedCard key={s.id} session={s} busy={busy} act={act} />
          ))}
        </div>
      )}

      <div className="card wide">
        <h2>Offres ouvertes</h2>
        {home.offers.length === 0 && (
          <p>
            {eligibility.eligible
              ? "Aucune offre pour l’instant. Tu reçois une notification dès qu’une offre s’ouvre."
              : "Les offres s’affichent ici dès que ton profil remplit les conditions."}
          </p>
        )}
        {home.offers.map((o) => (
          <OfferCard
            key={o.id}
            offer={o}
            busy={busy}
            canAccept={eligibility.eligible}
            acceptLabel="Accepter"
            onAccept={(at) => act(() => creatorLiveApi.accept(o.id, at))}
          />
        ))}
      </div>

      {past.length > 0 && (
        <div className="card wide">
          <h2>Historique</h2>
          {past.map((s) => (
            <div className="line" key={s.id}>
              <span>
                <b>{s.offer.title}</b>{" "}
                <span className={`pill ${SESSION_STATUS_TONES[s.status]}`}>
                  {SESSION_STATUS_LABELS[s.status]}
                </span>
                <br />
                <small>
                  {s.startedAt ? DATE.format(new Date(s.startedAt)) : ""}
                  {s.status === "ENDED"
                    ? ` · ${s.peakViewers.toLocaleString("fr-FR")} spectateurs · ${PAYOUT_LABELS[s.payout]}`
                    : ""}
                  {s.payoutReason ? ` · ${s.payoutReason}` : ""}
                </small>
              </span>
              <span>
                {s.earned > 0 && <strong>{formatFcfa(s.earned)}</strong>}
                {s.startedAt && (
                  <>
                    <br />
                    <Link href={`/lives/${s.id}`}>Bilan</Link>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function OfferCard({
  offer,
  busy,
  canAccept,
  acceptLabel,
  onAccept,
  onDecline,
}: {
  offer: LiveOfferForCreator;
  busy: boolean;
  canAccept: boolean;
  acceptLabel: string;
  onAccept: (scheduledAt: string) => Promise<boolean>;
  onDecline?: () => void;
}) {
  const [when, setWhen] = useState(() => firstHour(offer));
  const [min] = useState(() =>
    toLocal(new Date(Math.max(Date.now(), new Date(offer.startsAt).getTime()))),
  );
  const max = offer.endsAt ? toLocal(new Date(offer.endsAt)) : undefined;
  return (
    <article className="campaign">
      <header>
        <strong>{offer.title}</strong>
        {offer.placesLeft != null && (
          <span className="pill pending">
            {offer.placesLeft} place{offer.placesLeft > 1 ? "s" : ""}
          </span>
        )}
      </header>
      <p>
        {offer.shop ? `${offer.shop} · ` : ""}
        {DAY.format(new Date(offer.startsAt))} →{" "}
        {offer.endsAt ? DAY.format(new Date(offer.endsAt)) : "?"}
        {offer.demo ? " · démo" : ""}
      </p>
      <p>
        {offer.demo ? (
          "Live de démonstration : pas de paiement."
        ) : (
          <>
            <b>{formatFcfa(offer.ratePer100)}</b> par 100 spectateurs au plus
            fort, jusqu’à <b>{formatFcfa(offer.maxEarning)}</b>
          </>
        )}
      </p>
      {offer.products.length > 0 && (
        <p className="hint">
          {offer.products
            .slice(0, 6)
            .map((p) => `${p.name} (${formatFcfa(p.price)})`)
            .join(" · ")}
          {offer.products.length > 6 ? " …" : ""}
        </p>
      )}
      {canAccept && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void onAccept(new Date(when).toISOString());
          }}
        >
          <label>
            Heure de mon live
            <input
              type="datetime-local"
              value={when}
              min={min}
              max={max}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </label>
          <button disabled={busy}>{acceptLabel}</button>
          {onDecline && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onDecline}
            >
              Refuser
            </button>
          )}
        </form>
      )}
    </article>
  );
}

function PlannedCard({
  session,
  busy,
  act,
}: {
  session: CreatorLiveSession;
  busy: boolean;
  act: Act;
}) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() =>
    session.scheduledAt ? toLocal(new Date(session.scheduledAt)) : "",
  );
  const running = session.status === "RUNNING";
  return (
    <article className="campaign">
      <header>
        <strong>{session.offer.title}</strong>
        <span className={`pill ${SESSION_STATUS_TONES[session.status]}`}>
          {SESSION_STATUS_LABELS[session.status]}
        </span>
      </header>
      <p>
        {session.scheduledAt
          ? `Prévu ${DATE.format(new Date(session.scheduledAt))}`
          : ""}
        {session.offer.endsAt
          ? ` · au plus tard le ${DATE.format(new Date(session.offer.endsAt))}`
          : ""}
      </p>
      {editing && (
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act(() =>
                creatorLiveApi.reschedule(
                  session.id,
                  new Date(when).toISOString(),
                ),
              )
            ) {
              setEditing(false);
            }
          }}
        >
          <label>
            Nouvelle heure
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </label>
          <button disabled={busy}>Enregistrer</button>
        </form>
      )}
      <div className="actions">
        <Link className="button coral" href={`/lives/${session.id}`}>
          {running ? "Suivre mon live" : "Ouvrir pour commencer"}
        </Link>
        {!running && !editing && (
          <button className="secondary" onClick={() => setEditing(true)}>
            Changer l’heure
          </button>
        )}
        {!running && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              act(
                () => creatorLiveApi.withdraw(session.id),
                "Te retirer de ce live ? Tu ne pourras plus accepter de live pendant 10 jours.",
              )
            }
          >
            Me retirer
          </button>
        )}
      </div>
    </article>
  );
}
