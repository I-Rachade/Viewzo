"use client";

import { useState } from "react";
import {
  contactOf,
  PROFILE_LABELS,
  staffApi,
  StaffIdentityCheck,
} from "@/lib/api";
import { confirmed } from "./confirm";
import { DATE, useQueue } from "./use-queue";

// Identity checks the provider could not decide alone: the team approves
// (level 2) or declines with a reason the person reads.
export function IdentitySection({
  onChange,
  canDecide,
}: {
  onChange: () => void;
  canDecide: boolean;
}) {
  const queue = useQueue(staffApi.identityChecks, onChange);
  return (
    <>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && <p>Chargement…</p>}
      {queue.items?.length === 0 && <p>Aucune vérification d’identité à examiner.</p>}
      {queue.items?.map((c) => (
        <IdentityCard
          key={c.id}
          check={c}
          busy={queue.busy}
          canDecide={canDecide}
          onReview={(decision, reason) => {
            const question =
              decision === "APPROVE"
                ? `Valider l’identité de ${c.fullName ?? contactOf(c.user)} ? Ses profils passent au niveau 2.`
                : `Refuser cette vérification ? La personne pourra réessayer.`;
            if (!confirmed(question)) return;
            queue.act(() =>
              staffApi.reviewIdentity(c.id, {
                decision,
                ...(reason ? { reason } : {}),
              }),
            );
          }}
        />
      ))}
    </>
  );
}

const score = (v: number | null) => (v === null ? "—" : `${Math.round(v)} / 100`);

function IdentityCard({
  check: c,
  busy,
  canDecide,
  onReview,
}: {
  check: StaffIdentityCheck;
  busy: boolean;
  canDecide: boolean;
  onReview: (decision: "APPROVE" | "DECLINE", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <article className="campaign">
      <header>
        <strong>{c.fullName ?? "Nom non lu"}</strong>
        <span className="status">{c.providerStatus ?? "—"}</span>
      </header>
      <p>
        Compte {contactOf(c.user)} ({c.user.country}) ·{" "}
        {c.user.profiles
          .map((p) => `${PROFILE_LABELS[p.type]} niveau ${p.level}`)
          .join(", ")}
      </p>
      <p>
        {c.documentType ?? "Pièce"}
        {c.documentCountry && ` · ${c.documentCountry}`}
        {c.documentNumberLast4 && ` · n° …${c.documentNumberLast4}`}
        {c.dateOfBirth && ` · né(e) le ${c.dateOfBirth}`}
      </p>
      <p className="hint">
        Vivant {score(c.livenessScore)} · Ressemblance {score(c.faceMatchScore)} ·
        envoyée le {DATE.format(new Date(c.createdAt))}
      </p>
      {c.reason && <p className="error">{c.reason}</p>}
      {c.sameDocumentUsers.length > 0 && (
        <p className="error">
          Même pièce sur {c.sameDocumentUsers.length} autre(s) compte(s)
        </p>
      )}
      {canDecide ? (
        <>
          <label>
            Motif du refus (lu par la personne)
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="actions">
            <button disabled={busy} onClick={() => onReview("APPROVE", "")}>
              Valider l’identité
            </button>
            <button
              className="secondary"
              disabled={busy || !reason.trim()}
              onClick={() => onReview("DECLINE", reason)}
            >
              Refuser
            </button>
          </div>
        </>
      ) : (
        <p className="hint">Lecture seule pour ton rôle.</p>
      )}
    </article>
  );
}
