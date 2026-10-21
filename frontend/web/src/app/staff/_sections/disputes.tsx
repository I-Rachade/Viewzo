"use client";

import Link from "next/link";
import { useState } from "react";
import {
  contactOf,
  DisputeOutcome,
  formatFcfa,
  NETWORK_LABELS,
  REVIEW_STATUS_LABELS,
  StaffDispute,
  staffDisputesApi,
} from "@/lib/api";
import { confirmed } from "./confirm";
import { DATE, useQueue } from "./use-queue";

const openDisputes = () => staffDisputesApi.list().then((r) => r.items);

const OUTCOMES: { key: DisputeOutcome; label: string; question: string }[] = [
  {
    key: "KEEP",
    label: "Maintenir la décision",
    question: "Maintenir la décision ? Les gains gelés sont débloqués.",
  },
  {
    key: "SET_VIEWS",
    label: "Corriger les vues",
    question: "Valider ce nouveau total de vues ? Le créateur est payé pour ces vues.",
  },
  {
    key: "REJECT_POST",
    label: "Refuser la publication",
    question:
      "Refuser la publication ? Ses gains gelés sont repris et son coût rendu à l’annonceur.",
  },
];

// Open disputes, oldest first; past 72 h they are flagged in red.
export function DisputesSection({
  canDecide,
  onChange,
}: {
  canDecide: boolean;
  onChange: () => void;
}) {
  const queue = useQueue(openDisputes, onChange);
  return (
    <>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && <p>Chargement…</p>}
      {queue.items?.length === 0 && <p>Aucun litige ouvert.</p>}
      {queue.items?.map((d) => (
        <DisputeCard
          key={d.id}
          dispute={d}
          busy={queue.busy}
          canDecide={canDecide}
          onDecide={(outcome, reason, views) => {
            if (!confirmed(OUTCOMES.find((o) => o.key === outcome)!.question)) return;
            queue.act(() => staffDisputesApi.decide(d.id, { outcome, reason, views }));
          }}
        />
      ))}
    </>
  );
}

function DisputeCard({
  dispute: d,
  busy,
  canDecide,
  onDecide,
}: {
  dispute: StaffDispute;
  busy: boolean;
  canDecide: boolean;
  onDecide: (outcome: DisputeOutcome, reason: string, views?: number) => void;
}) {
  const [reason, setReason] = useState("");
  const [views, setViews] = useState(d.post.validViews);
  const p = d.post;
  return (
    <article className="campaign">
      <header>
        <strong>
          #{p.campaign.code} · {NETWORK_LABELS[p.network]} · {contactOf(p.creator)}
        </strong>
        {d.overdue ? (
          <span className="pill refused">Ouvert depuis plus de 72 h</span>
        ) : (
          <span className="pill pending">Ouvert</span>
        )}
      </header>
      <p>
        Contesté par {d.side === "CREATOR" ? "le créateur" : "l’annonceur"} le{" "}
        {DATE.format(new Date(d.createdAt))} : « {d.reason} »
      </p>
      <p className="hint">
        {REVIEW_STATUS_LABELS[p.reviewStatus]} · {p.validViews.toLocaleString("fr-FR")} vues
        validées · {formatFcfa(p.earned)} gelés ·{" "}
        <Link href={`/staff/publications/${p.id}`}>Ouvrir le dossier</Link>
        {p.postUrl && (
          <>
            {" · "}
            <a href={p.postUrl} target="_blank" rel="noreferrer">
              Voir la publication ↗
            </a>
          </>
        )}
      </p>
      {canDecide && (
        <>
          <label>
            Décision motivée (visible par les deux parties)
            <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            Nouveau total de vues (pour « Corriger les vues »)
            <input
              type="number"
              min={p.validViews}
              value={views || ""}
              onChange={(e) => setViews(Number(e.target.value))}
            />
          </label>
          <div className="actions">
            {OUTCOMES.map((o) => (
              <button
                key={o.key}
                className={
                  o.key === "REJECT_POST" ? "coral" : o.key === "KEEP" ? "secondary" : undefined
                }
                disabled={
                  busy ||
                  reason.trim().length < 3 ||
                  (o.key === "SET_VIEWS" && views <= p.validViews)
                }
                onClick={() =>
                  onDecide(o.key, reason.trim(), o.key === "SET_VIEWS" ? views : undefined)
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
