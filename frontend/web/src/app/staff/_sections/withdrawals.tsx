"use client";

import { useState } from "react";
import {
  contactOf,
  formatFcfa,
  PROFILE_LABELS,
  staffApi,
  StaffWithdrawal,
} from "@/lib/api";
import { DATE, useQueue } from "./use-queue";

export function WithdrawalsSection({ onChange }: { onChange: () => void }) {
  const queue = useQueue(staffApi.withdrawals, onChange);
  return (
    <>
      <p className="hint">
        L’argent part dès la validation, vérifie le nom et le numéro.
      </p>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && <p>Chargement…</p>}
      {queue.items?.length === 0 && <p>Aucun retrait à valider.</p>}
      {queue.items?.map((w) => (
        <WithdrawalCard
          key={w.id}
          withdrawal={w}
          busy={queue.busy}
          onReview={(decision, reason) =>
            queue.act(() =>
              staffApi.reviewWithdrawal(w.id, {
                decision,
                ...(reason ? { reason } : {}),
              }),
            )
          }
        />
      ))}
    </>
  );
}

function WithdrawalCard({
  withdrawal: w,
  busy,
  onReview,
}: {
  withdrawal: StaffWithdrawal;
  busy: boolean;
  onReview: (decision: "APPROVE" | "REJECT", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <article className="campaign">
      <header>
        <strong>{formatFcfa(w.amount)}</strong>
        <span className="status">{w.reference}</span>
      </header>
      <p>
        {w.beneficiaryName} · {w.phone}
        {w.operator && ` · ${w.operator}`}
      </p>
      <p className="hint">
        Compte {contactOf(w.user)} ({w.user.country}) ·{" "}
        {w.user.profiles
          .map((p) => `${PROFILE_LABELS[p.type]} niveau ${p.level}`)
          .join(", ")}{" "}
        · demandé le {DATE.format(new Date(w.createdAt))}
      </p>
      <label>
        Motif du refus
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="actions">
        <button disabled={busy} onClick={() => onReview("APPROVE", "")}>
          Envoyer l’argent
        </button>
        <button
          className="secondary"
          disabled={busy || !reason.trim()}
          onClick={() => onReview("REJECT", reason)}
        >
          Refuser
        </button>
      </div>
    </article>
  );
}
