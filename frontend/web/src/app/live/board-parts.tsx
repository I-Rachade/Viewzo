"use client";

import { useState } from "react";
import {
  formatFcfa,
  INTENT_LABELS,
  LEAD_STATUS_LABELS,
  LiveBoardProduct,
  LiveComment,
  LiveLead,
  LiveLeadStatus,
  LiveStats,
} from "@/lib/api";

// Pieces of the live screen shared by the advertiser and the creators.

export const TIME = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" });
export const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

// How often the screen reads the live again while it runs.
export const POLL_MS = 3000;

const LEAD_TONES: Record<LiveLeadStatus, string> = {
  NEW: "pending",
  CONTACTED: "pending",
  PAID: "paid",
  DELIVERED: "paid",
  CANCELLED: "refused",
};

export function Stats({ stats }: { stats: LiveStats }) {
  return (
    <div className="stats">
      <div>
        <small>Commentaires</small>
        <strong>{stats.comments}</strong>
      </div>
      <div>
        <small>Intéressés</small>
        <strong>{stats.interested}</strong>
      </div>
      <div>
        <small>Avec panier</small>
        <strong>{stats.buyers}</strong>
      </div>
      <div>
        <small>Payés</small>
        <strong>{stats.paid}</strong>
      </div>
      <div>
        <small>Ventes prévues</small>
        <strong>{formatFcfa(stats.forecast)}</strong>
      </div>
    </div>
  );
}

/**
 * A buyer and their cart. The advertiser sets the order's status; the creator
 * only reads the answer to give in the live.
 */
export function LeadCard({
  lead,
  busy,
  via,
  onStatus,
}: {
  lead: LiveLead;
  busy?: boolean;
  // TikTok account of the live the buyer came from, when there are several.
  via?: string;
  onStatus?: (status: LiveLeadStatus) => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!lead.reply) return;
    navigator.clipboard?.writeText(lead.reply).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <article className="campaign">
      <header>
        <strong>
          {lead.nickname} <small>@{lead.tiktokUser}</small>
        </strong>
        <span className={`pill ${LEAD_TONES[lead.status]}`}>
          {LEAD_STATUS_LABELS[lead.status]}
        </span>
      </header>
      <p>
        Code <b>{lead.code}</b> · {INTENT_LABELS[lead.intent]}
        {via && ` · live de @${via}`}
        {lead.phoneSeen && " · a écrit son numéro (masqué)"}
      </p>
      {lead.items.length > 0 ? (
        <>
          {lead.items.map((i, n) => (
            <div className="line" key={n}>
              <span>
                {i.quantity} × {i.name}
                {i.variant ? ` (${i.variant})` : ""}
              </span>
              <strong>
                {i.unitPrice != null
                  ? formatFcfa(i.unitPrice * i.quantity)
                  : "prix ?"}
              </strong>
            </div>
          ))}
          {lead.total != null && (
            <div className="line">
              <span>Total</span>
              <strong>{formatFcfa(lead.total)}</strong>
            </div>
          )}
        </>
      ) : (
        <p className="hint">Pas encore de panier.</p>
      )}
      {lead.reply && (
        <div className="summary">
          <small>Réponse à donner dans le live</small>
          <p>{lead.reply}</p>
          <button type="button" className="secondary" onClick={copy}>
            {copied ? "Copié" : "Copier la réponse"}
          </button>
        </div>
      )}
      {onStatus && (
        <label>
          Statut
          <select
            value={lead.status}
            disabled={busy}
            onChange={(e) => onStatus(e.target.value as LiveLeadStatus)}
          >
            {(Object.keys(LEAD_STATUS_LABELS) as LiveLeadStatus[]).map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}

export function Products({ products }: { products: LiveBoardProduct[] }) {
  return (
    <div className="card wide">
      <h2>Produits</h2>
      {products.length === 0 && <p>Aucun produit actif.</p>}
      {products.map((p) => (
        <div className="line" key={p.id}>
          <span>{p.name}</span>
          <span>
            <strong>{formatFcfa(p.price)}</strong>
            <br />
            <small>
              {p.left == null
                ? "stock illimité"
                : `${p.left} restant${p.left > 1 ? "s" : ""}`}
            </small>
          </span>
        </div>
      ))}
    </div>
  );
}

export function Comments({ comments }: { comments: LiveComment[] }) {
  if (comments.length === 0) return null;
  return (
    <div className="card wide">
      <h2>Derniers commentaires</h2>
      {comments.map((c) => (
        <div className="line" key={c.id}>
          <span>
            <b>{c.nickname}</b> <small>@{c.tiktokUser}</small>
            <br />
            {c.text}
          </span>
          <span>
            {c.intent && c.intent !== "autre" && (
              <span className="pill neutral">{INTENT_LABELS[c.intent]}</span>
            )}
            <br />
            <small>{TIME.format(new Date(c.at))}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
