"use client";

import { FormEvent, useState } from "react";
import { DISPUTE_OUTCOME_LABELS, DisputeView, disputesApi } from "@/lib/api";

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

// Where a dispute on a post stands, or the form to open one.
export function DisputeBox({
  postId,
  dispute,
  canOpen,
  prompt,
  onOpened,
}: {
  postId: string;
  dispute: DisputeView | null;
  canOpen: boolean;
  prompt: string;
  onOpened: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await disputesApi.open(postId, reason.trim());
      setOpen(false);
      onOpened("Litige envoyé à l’équipe");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (dispute?.status === "OPEN") {
    return (
      <p className="hint">
        <span className="pill pending">Litige en cours</span> depuis le{" "}
        {DATE.format(new Date(dispute.createdAt))}. Les gains de cette publication
        sont gelés jusqu’à la décision de l’équipe.
      </p>
    );
  }
  return (
    <>
      {dispute?.outcome && (
        <p className="hint">
          Litige tranché le {DATE.format(new Date(dispute.decidedAt!))} :{" "}
          {DISPUTE_OUTCOME_LABELS[dispute.outcome]}. {dispute.decisionReason}
        </p>
      )}
      {canOpen &&
        (open ? (
          <form onSubmit={submit} className="summary">
            <label>
              {prompt}
              <textarea
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="inline-form">
              <button disabled={busy || reason.trim().length < 5}>Envoyer le litige</button>
              <button type="button" className="link" onClick={() => setOpen(false)}>
                Annuler
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        ) : (
          <button type="button" className="link" onClick={() => setOpen(true)}>
            Contester
          </button>
        ))}
    </>
  );
}
