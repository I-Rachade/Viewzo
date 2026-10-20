"use client";

import { useCallback, useState } from "react";
import {
  contactOf,
  formatFcfa,
  PROFILE_LABELS,
  staffApi,
  StaffWithdrawal,
} from "@/lib/api";
import { confirmed } from "./confirm";
import { DATE, useQueue } from "./use-queue";

export function WithdrawalsSection({
  selfId,
  onChange,
}: {
  selfId: string;
  onChange: () => void;
}) {
  const queue = useQueue(staffApi.withdrawals, onChange);
  const stuck = useQueue(
    useCallback(() => staffApi.withdrawals("PROCESSING"), []),
    onChange,
  );
  const [notice, setNotice] = useState<string | null>(null);

  function review(w: StaffWithdrawal, decision: "APPROVE" | "REJECT", reason: string) {
    const question =
      decision === "APPROVE"
        ? `Envoyer ${formatFcfa(w.amount)} à ${w.beneficiaryName} (${w.phone}) ?`
        : `Refuser ce retrait de ${formatFcfa(w.amount)} ? L’argent revient sur le solde du créateur.`;
    if (!confirmed(question)) return;
    setNotice(null);
    queue.act(async () => {
      const res = await staffApi.reviewWithdrawal(w.id, {
        decision,
        ...(reason ? { reason } : {}),
      });
      if (res.awaitingSecondApproval) {
        setNotice(
          "Première validation enregistrée. Un deuxième membre de la finance doit valider ce retrait.",
        );
      }
    });
  }

  function resolve(w: StaffWithdrawal, outcome: "SUCCEEDED" | "FAILED", reason: string) {
    const question =
      outcome === "SUCCEEDED"
        ? `Confirmer que ${formatFcfa(w.amount)} sont bien arrivés chez ${w.beneficiaryName} ?`
        : `Confirmer que le retrait a échoué chez le fournisseur ? L’argent revient sur le solde du créateur.`;
    if (!confirmed(question)) return;
    stuck.act(() => staffApi.resolveWithdrawal(w.id, { outcome, reason }));
  }

  return (
    <>
      <p className="hint">
        L’argent part dès la validation, vérifie le nom et le numéro.
      </p>
      {notice && <p className="hint">{notice}</p>}
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && <p>Chargement…</p>}
      {queue.items?.length === 0 && <p>Aucun retrait à valider.</p>}
      {queue.items?.map((w) => (
        <WithdrawalCard
          key={w.id}
          withdrawal={w}
          selfId={selfId}
          busy={queue.busy}
          onReview={(decision, reason) => review(w, decision, reason)}
        />
      ))}

      {!!stuck.items?.length && (
        <>
          <h2>À vérifier chez le fournisseur</h2>
          <p className="hint">
            Le fournisseur n’a pas encore confirmé ces envois. Vérifie dans son
            tableau de bord avant de clore, pour ne jamais payer deux fois.
          </p>
          {stuck.error && <p className="error">{stuck.error}</p>}
          {stuck.items.map((w) => (
            <StuckCard
              key={w.id}
              withdrawal={w}
              busy={stuck.busy}
              onResolve={(outcome, reason) => resolve(w, outcome, reason)}
            />
          ))}
        </>
      )}
    </>
  );
}

function Who({ w }: { w: StaffWithdrawal }) {
  return (
    <>
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
    </>
  );
}

function WithdrawalCard({
  withdrawal: w,
  selfId,
  busy,
  onReview,
}: {
  withdrawal: StaffWithdrawal;
  selfId: string;
  busy: boolean;
  onReview: (decision: "APPROVE" | "REJECT", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const approvedByMe = w.firstApprovedById === selfId;
  return (
    <article className="campaign">
      <header>
        <strong>{formatFcfa(w.amount)}</strong>
        <span className="status">{w.reference}</span>
      </header>
      <Who w={w} />
      {w.needsSecondApproval && (
        <p className="hint">
          {w.firstApprovedById
            ? approvedByMe
              ? "Tu as déjà validé : un autre membre de la finance doit confirmer."
              : "Déjà validé une fois : ta validation envoie l’argent."
            : "Gros montant : deux membres de la finance doivent valider."}
        </p>
      )}
      <label>
        Motif du refus
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="actions">
        <button
          disabled={busy || approvedByMe}
          onClick={() => onReview("APPROVE", "")}
        >
          {w.needsSecondApproval && !w.firstApprovedById
            ? "Valider (1/2)"
            : "Envoyer l’argent"}
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

function StuckCard({
  withdrawal: w,
  busy,
  onResolve,
}: {
  withdrawal: StaffWithdrawal;
  busy: boolean;
  onResolve: (outcome: "SUCCEEDED" | "FAILED", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <article className="campaign">
      <header>
        <strong>{formatFcfa(w.amount)}</strong>
        <span className="status">{w.reference}</span>
      </header>
      <Who w={w} />
      {w.failureReason && <p className="hint">{w.failureReason}</p>}
      <label>
        Ce que tu as vu chez le fournisseur
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="actions">
        <button
          disabled={busy || !reason.trim()}
          onClick={() => onResolve("SUCCEEDED", reason)}
        >
          Reçu par le créateur
        </button>
        <button
          className="secondary"
          disabled={busy || !reason.trim()}
          onClick={() => onResolve("FAILED", reason)}
        >
          Échec, rendre l’argent
        </button>
      </div>
    </article>
  );
}
