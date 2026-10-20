"use client";

import { FormEvent, useState } from "react";
import {
  ACCOUNT_STATUS_LABELS,
  AccountStatus,
  contactOf,
  NETWORK_LABELS,
  StaffAccount,
  staffApi,
} from "@/lib/api";
import { DATE, useQueue } from "./use-queue";

type Decision = Exclude<AccountStatus, "PENDING">;
const DECISIONS: Decision[] = [
  "ELIGIBLE",
  "NEEDS_FIX",
  "NOT_ELIGIBLE",
  "SUSPENDED",
];

export function AccountsSection({ onChange }: { onChange: () => void }) {
  const queue = useQueue(staffApi.accounts, onChange);
  const [code, setCode] = useState("");
  const [found, setFound] = useState<StaffAccount | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    setSearchError(null);
    setFound(null);
    try {
      setFound(await staffApi.accountByCode(code));
    } catch (err) {
      setSearchError((err as Error).message);
    }
  }

  const items = found ? [found] : queue.items;
  return (
    <>
      <form className="row" onSubmit={search}>
        <label>
          Code reçu sur WhatsApp
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="VZ-123456"
            required
          />
        </label>
        <button className="secondary">Rechercher</button>
      </form>
      {found && (
        <button className="secondary" onClick={() => setFound(null)}>
          Revenir à la file
        </button>
      )}
      {searchError && <p className="error">{searchError}</p>}
      {queue.error && <p className="error">{queue.error}</p>}
      {items === null && <p>Chargement…</p>}
      {items?.length === 0 && <p>Aucun compte en attente.</p>}
      {items?.map((a) => (
        <AccountCard
          key={a.id}
          account={a}
          busy={queue.busy}
          onReview={(input) =>
            queue.act(async () => {
              const updated = await staffApi.reviewAccount(a.id, input);
              if (found) setFound(updated);
            })
          }
        />
      ))}
    </>
  );
}

function AccountCard({
  account: a,
  busy,
  onReview,
}: {
  account: StaffAccount;
  busy: boolean;
  onReview: (input: {
    status: Decision;
    reason?: string;
    followers?: number;
    avgStatusViews?: number;
  }) => void;
}) {
  const isStatus = a.network === "WHATSAPP_STATUS";
  const [audience, setAudience] = useState(
    (isStatus ? a.avgStatusViews : a.followers) ?? 0,
  );
  const [reason, setReason] = useState("");

  function review(status: Decision) {
    onReview({
      status,
      ...(reason.trim() ? { reason } : {}),
      ...(isStatus ? { avgStatusViews: audience } : { followers: audience }),
    });
  }

  return (
    <article className="campaign">
      <header>
        <strong>
          {NETWORK_LABELS[a.network]} · {a.handle}
        </strong>
        <span className="status">{ACCOUNT_STATUS_LABELS[a.status]}</span>
      </header>
      <p>
        {a.verificationCode} · {contactOf(a.user)} ({a.user.country}) · envoyé
        le {DATE.format(new Date(a.submittedAt))}
      </p>
      {a.statusReason && <p className="hint">{a.statusReason}</p>}
      <div className="row">
        <label>
          {isStatus ? "Vues moyennes par statut" : "Abonnés"}
          <input
            type="number"
            min={0}
            value={audience || ""}
            onChange={(e) => setAudience(Number(e.target.value))}
          />
        </label>
        <label>
          Motif (obligatoire sauf Éligible)
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <p className="hint">
        Éligible à partir de{" "}
        {isStatus ? "300 vues par statut" : "1 000 abonnés"}.
      </p>
      <div className="actions">
        {DECISIONS.map((d) => (
          <button
            key={d}
            className={d === "ELIGIBLE" ? undefined : "secondary"}
            disabled={busy || (d !== "ELIGIBLE" && !reason.trim())}
            onClick={() => review(d)}
          >
            {ACCOUNT_STATUS_LABELS[d]}
          </button>
        ))}
      </div>
    </article>
  );
}
