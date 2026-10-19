"use client";

import { useState } from "react";
import {
  CONTENT_TYPE_LABELS,
  formatFcfa,
  NETWORK_LABELS,
  PACKAGE_LABELS,
  StaffCampaign,
  staffApi,
} from "@/lib/api";
import { DATE, useQueue } from "./use-queue";

export function CampaignsSection({ onChange }: { onChange: () => void }) {
  const queue = useQueue(staffApi.campaigns, onChange);
  return (
    <>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && <p>Chargement…</p>}
      {queue.items?.length === 0 && <p>Aucune campagne à modérer.</p>}
      {queue.items?.map((c) => (
        <CampaignCard
          key={c.id}
          campaign={c}
          busy={queue.busy}
          onReview={(status, reason) =>
            queue.act(() =>
              staffApi.reviewCampaign(c.id, {
                status,
                ...(reason ? { reason } : {}),
              }),
            )
          }
        />
      ))}
    </>
  );
}

function CampaignCard({
  campaign: c,
  busy,
  onReview,
}: {
  campaign: StaffCampaign;
  busy: boolean;
  onReview: (status: "ACTIVE" | "REJECTED", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <article className="campaign">
      <header>
        <strong>
          {c.title} · #{c.code}
        </strong>
        <span className="status">{c.fundedAt ? "Payée" : "Non payée"}</span>
      </header>
      <p>
        {c.advertiser.phone} ({c.advertiser.country}) ·{" "}
        {PACKAGE_LABELS[c.package]} · {formatFcfa(c.budget)} ·{" "}
        {c.countries.join(", ")}
      </p>
      <p className="hint">
        Du {DATE.format(new Date(c.startsAt))} au{" "}
        {DATE.format(new Date(c.endsAt))}
      </p>
      {c.platforms.map((p) => (
        <p key={p.network}>
          {NETWORK_LABELS[p.network]} : {CONTENT_TYPE_LABELS[p.contentType]},{" "}
          {formatFcfa(p.budget)}
        </p>
      ))}
      {c.assetUrls.length > 0 && (
        <p>
          Éléments fournis :{" "}
          {c.assetUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {i > 0 && ", "}
              fichier {i + 1}
            </a>
          ))}
        </p>
      )}
      <label>
        Motif du refus
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="actions">
        <button disabled={busy} onClick={() => onReview("ACTIVE", "")}>
          Valider
        </button>
        <button
          className="secondary"
          disabled={busy || !reason.trim()}
          onClick={() => onReview("REJECTED", reason)}
        >
          Refuser
        </button>
      </div>
      {!c.fundedAt && (
        <p className="hint">
          Les créateurs ne la verront qu’une fois payée par l’annonceur.
        </p>
      )}
    </article>
  );
}
