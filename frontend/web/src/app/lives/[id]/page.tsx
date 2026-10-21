"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CreatorLiveBoard,
  creatorLiveApi,
  formatFcfa,
  PAYOUT_LABELS,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_TONES,
} from "@/lib/api";
import { LoadingCard } from "../../loading-card";
import { useRequireUser } from "../../_shell/session";
import {
  Comments,
  DATE,
  LeadCard,
  POLL_MS,
  Products,
  Stats,
} from "../../live/board-parts";
import { isUnavailable, UNAVAILABLE } from "../../live/unavailable";

// A creator's own live: start it, read out the answers, end it.
export default function CreatorLiveScreen() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [board, setBoard] = useState<CreatorLiveBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  // When the board was last read, to know if the live may start yet.
  const [readAt, setReadAt] = useState(0);

  const reload = useCallback(
    () =>
      creatorLiveApi.board(id).then(
        (b) => {
          setBoard(b);
          setReadAt(Date.now());
        },
        (e) => {
          if (isUnavailable(e)) setOff(true);
          else setError((e as Error).message);
        },
      ),
    [id],
  );

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  const running = board?.session.status === "RUNNING";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  async function act(action: () => Promise<unknown>, ask?: string) {
    if (ask && !window.confirm(ask)) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (off) {
    return (
      <div className="card">
        <h1>Lives de vente</h1>
        <p>{UNAVAILABLE}</p>
      </div>
    );
  }
  if (!user || (!board && !error)) return <LoadingCard />;
  if (!board) {
    return (
      <div className="card">
        <p className="error">{error}</p>
        <Link className="button secondary" href="/lives">
          Mes lives
        </Link>
      </div>
    );
  }

  const { live, session } = board;
  const detached = running && !board.running;
  const opensAt = new Date(new Date(live.startsAt).getTime() - 30 * 60_000);

  return (
    <>
      <div className="card wide">
        <Link href="/lives" className="hint">
          ← Mes lives
        </Link>
        <h1>{live.title}</h1>
        <p>
          <span className={`pill ${SESSION_STATUS_TONES[session.status]}`}>
            {SESSION_STATUS_LABELS[session.status]}
          </span>{" "}
          @{session.tiktokUsername}
          {live.shop ? ` · pour ${live.shop}` : ""}
          {session.scheduledAt && session.status === "ACCEPTED"
            ? ` · prévu ${DATE.format(new Date(session.scheduledAt))}`
            : ""}
          {running && session.viewers != null
            ? ` · ${session.viewers} spectateurs (max ${session.peakViewers})`
            : ""}
        </p>
        <p className="hint">
          Lance ton live sur TikTok, puis appuie sur « Commencer ». Viewzo lit
          les commentaires et te propose la réponse à donner à chaque acheteur,
          avec le code à envoyer à la boutique sur WhatsApp.
        </p>
        {session.sourceMessage && session.status !== "ENDED" && (
          <p className={session.sourceState === "error" ? "error" : "hint"}>
            {session.sourceMessage}
          </p>
        )}
        {session.status === "ENDED" && (
          <p>
            {session.peakViewers.toLocaleString("fr-FR")} spectateurs au plus
            fort · {PAYOUT_LABELS[session.payout]}
            {session.earned > 0 ? ` · ${formatFcfa(session.earned)}` : ""}
            {session.payoutReason ? ` · ${session.payoutReason}` : ""}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          {session.status === "ACCEPTED" &&
            (readAt < opensAt.getTime() ? (
              <p className="hint">
                Tu pourras commencer à partir du {DATE.format(opensAt)}.
              </p>
            ) : (
              <button
                className="coral"
                disabled={busy}
                onClick={() => act(() => creatorLiveApi.start(session.id))}
              >
                Commencer
              </button>
            ))}
          {detached && (
            <button
              className="coral"
              disabled={busy}
              onClick={() => act(() => creatorLiveApi.start(session.id))}
            >
              Reprendre la lecture
            </button>
          )}
          {running && (
            <button
              disabled={busy}
              onClick={() =>
                act(
                  () => creatorLiveApi.stop(session.id),
                  "Terminer ton live ? Ton gain est calculé maintenant.",
                )
              }
            >
              Terminer le live
            </button>
          )}
        </div>
        <Stats stats={board.stats} />
      </div>

      <div className="card wide">
        <h2>Acheteurs</h2>
        {board.leads.length === 0 && (
          <p>
            {running ? "En attente des premiers acheteurs…" : "Aucun acheteur."}
          </p>
        )}
        <div className="stagger" style={{ display: "grid", gap: 12 }}>
          {board.leads.map((l) => (
            <LeadCard key={l.id} lead={l} />
          ))}
        </div>
      </div>
      <Products products={board.products} />
      <Comments comments={board.comments} />
    </>
  );
}
