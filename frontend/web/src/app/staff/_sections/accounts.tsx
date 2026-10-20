"use client";

import { FormEvent, useState } from "react";
import {
  ACCOUNT_STATUS_LABELS,
  AccountStatus,
  AUTO_REJECTION_LABELS,
  contactOf,
  FOLLOWERS_SOURCE_LABELS,
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
// Reasons the team gives most; a click fills the field, still editable.
const REASONS = [
  "Compte anonyme",
  "Compte introuvable",
  "Abonnés insuffisants",
  "Code absent de la bio",
];

type View = "queue" | "auto";
const LOADERS: Record<View, () => Promise<StaffAccount[]>> = {
  queue: staffApi.accounts,
  auto: staffApi.autoRejectedAccounts,
};

export function AccountsSection({ onChange }: { onChange: () => void }) {
  const [view, setView] = useState<View>("queue");
  const queue = useQueue(LOADERS[view], onChange);
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
      <div className="tabs">
        <button
          className={view === "queue" ? "selected" : ""}
          onClick={() => setView("queue")}
        >
          À vérifier
        </button>
        <button
          className={view === "auto" ? "selected" : ""}
          onClick={() => setView("auto")}
        >
          Refus automatiques
        </button>
      </div>
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
      {items?.length === 0 && (
        <p>
          {view === "auto"
            ? "Aucun compte refusé automatiquement."
            : "Aucun compte en attente."}
        </p>
      )}
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
  const saved = isStatus ? a.avgStatusViews : a.followers;
  // The count read or confirmed so far, else what the creator declared.
  const [audience, setAudience] = useState(
    String(saved ?? a.declaredFollowers ?? ""),
  );
  const [reason, setReason] = useState("");

  function review(status: Decision) {
    const count = audience === "" ? undefined : Number(audience);
    onReview({
      status,
      ...(reason.trim() ? { reason } : {}),
      ...(count === undefined
        ? {}
        : isStatus
          ? { avgStatusViews: count }
          : { followers: count }),
    });
  }

  const unit = isStatus ? "vues par statut" : "abonnés";
  return (
    <article className="campaign">
      <header>
        <strong>
          {NETWORK_LABELS[a.network]} ·{" "}
          {a.profileUrl ? (
            <a href={a.profileUrl} target="_blank" rel="noreferrer">
              {a.handle}
            </a>
          ) : (
            a.handle
          )}
        </strong>
        <span className="status">{ACCOUNT_STATUS_LABELS[a.status]}</span>
      </header>
      <p>
        {a.verificationCode} · {contactOf(a.user)} ({a.user.country}) · envoyé
        le {DATE.format(new Date(a.submittedAt))}
      </p>
      {a.autoRejection && (
        <p>
          <span className="pill refused">
            Refus automatique : {AUTO_REJECTION_LABELS[a.autoRejection]}
          </span>
        </p>
      )}
      {a.statusReason && <p className="hint">{a.statusReason}</p>}
      <p className="hint">
        {saved !== null
          ? `${saved.toLocaleString("fr-FR")} ${unit}${
              a.followersSource
                ? ` (${FOLLOWERS_SOURCE_LABELS[a.followersSource]})`
                : ""
            }`
          : "Nombre non vérifié"}
        {a.declaredFollowers !== null &&
          ` · déclaré par le créateur : ${a.declaredFollowers.toLocaleString("fr-FR")}`}
        {a.notAnonymousConfirmed &&
          " · le créateur confirme que le compte n’est pas anonyme"}
      </p>
      {a.otherAccounts.length > 0 && (
        <p className="hint">
          Autres comptes :{" "}
          {a.otherAccounts
            .map(
              (o) =>
                `${NETWORK_LABELS[o.network]} ${o.handle} (${ACCOUNT_STATUS_LABELS[o.status]})`,
            )
            .join(" · ")}
        </p>
      )}
      <div className="row">
        <label>
          {isStatus ? "Vues moyennes par statut" : "Abonnés"}
          <input
            type="number"
            min={0}
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          />
        </label>
        <label>
          Motif (obligatoire sauf Éligible)
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="tabs">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            className={reason === r ? "selected" : ""}
            onClick={() => setReason(r)}
          >
            {r}
          </button>
        ))}
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
