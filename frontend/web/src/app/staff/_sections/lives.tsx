"use client";

import { useCallback, useState } from "react";
import {
  CAN_MODERATE,
  contactOf,
  LIVE_STATUS_LABELS,
  LIVE_STATUS_TONES,
  LiveSaleStatus,
  StaffRole,
  staffLiveApi,
} from "@/lib/api";
import { countryName } from "../../country-select";
import { DATE, useQueue } from "./use-queue";

const FILTERS: { key: LiveSaleStatus | ""; label: string }[] = [
  { key: "", label: "Tous" },
  { key: "RUNNING", label: "En direct" },
  { key: "SCHEDULED", label: "Planifiés" },
  { key: "ENDED", label: "Terminés" },
  { key: "CANCELLED", label: "Annulés" },
];

// TikTok lives of the member's countries; moderation can stop one.
export function LivesSection({ role }: { role: StaffRole }) {
  const [status, setStatus] = useState<LiveSaleStatus | "">("");
  const load = useCallback(() => staffLiveApi.list(status || undefined), [status]);
  const queue = useQueue(load, () => {});
  const canCancel = CAN_MODERATE.includes(role);

  return (
    <>
      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip${status === f.key ? " selected" : ""}`}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && !queue.error && <div className="skeleton" />}
      {queue.items?.length === 0 && <p>Aucun live.</p>}
      {queue.items?.map((l) => (
        <div className="line" key={l.id}>
          <span>
            <b>{l.title}</b>{" "}
            <span className={`pill ${LIVE_STATUS_TONES[l.status]}`}>
              {LIVE_STATUS_LABELS[l.status]}
            </span>
            {l.demo && <span className="pill neutral">Démo</span>}
            <br />
            <small>
              @{l.tiktokUsername} · {contactOf(l.seller)} ·{" "}
              {countryName(l.seller.country)} ·{" "}
              {DATE.format(new Date(l.scheduledAt))}
            </small>
            <br />
            <small>
              {l._count.comments} commentaire{l._count.comments > 1 ? "s" : ""} ·{" "}
              {l._count.leads} intéressé{l._count.leads > 1 ? "s" : ""}
              {l.cancelReason ? ` · Raison : ${l.cancelReason}` : ""}
            </small>
          </span>
          {canCancel && (l.status === "SCHEDULED" || l.status === "RUNNING") && (
            <button
              className="secondary"
              disabled={queue.busy}
              onClick={() => {
                const reason = window.prompt(
                  "Pourquoi arrêter ce live ? Le vendeur verra la raison.",
                );
                if (reason?.trim()) {
                  queue.act(() => staffLiveApi.cancel(l.id, reason.trim()));
                }
              }}
            >
              Arrêter
            </button>
          )}
        </div>
      ))}
    </>
  );
}
