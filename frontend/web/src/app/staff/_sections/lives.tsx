"use client";

import { FormEvent, useCallback, useState } from "react";
import {
  CAN_MODERATE,
  contactOf,
  formatFcfa,
  LIVE_STATUS_LABELS,
  LIVE_STATUS_TONES,
  LiveRate,
  LiveSaleStatus,
  PAYOUT_LABELS,
  SESSION_STATUS_LABELS,
  StaffRole,
  staffLiveApi,
} from "@/lib/api";
import { countryName } from "../../country-select";
import { DATE, useQueue } from "./use-queue";

type Tab = "offers" | "audiences" | "rates";

// Live selling in the back-office: offers to review, unusual audiences to
// check before creators are paid, and the prices per country.
export function LivesSection({ role }: { role: StaffRole }) {
  const [tab, setTab] = useState<Tab>("offers");
  return (
    <>
      <div className="chips">
        {(
          [
            ["offers", "Offres"],
            ["audiences", "Audiences à vérifier"],
            ["rates", "Tarifs"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`chip${tab === key ? " selected" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "offers" && <Offers role={role} />}
      {tab === "audiences" && <Audiences role={role} />}
      {tab === "rates" && <Rates role={role} />}
    </>
  );
}

const FILTERS: { key: LiveSaleStatus | ""; label: string }[] = [
  { key: "PENDING_REVIEW", label: "À vérifier" },
  { key: "ACTIVE", label: "Ouvertes" },
  { key: "COMPLETED", label: "Terminées" },
  { key: "", label: "Toutes" },
];

function Offers({ role }: { role: StaffRole }) {
  const [status, setStatus] = useState<LiveSaleStatus | "">("PENDING_REVIEW");
  const load = useCallback(
    () => staffLiveApi.list(status || undefined),
    [status],
  );
  const queue = useQueue(load, () => {});
  const canModerate = CAN_MODERATE.includes(role);

  const ask = (question: string) => window.prompt(question)?.trim() || null;

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
      {queue.items?.length === 0 && <p>Aucune offre.</p>}
      {queue.items?.map((l) => (
        <article className="campaign" key={l.id}>
          <header>
            <strong>{l.title}</strong>
            <span>
              <span className={`pill ${LIVE_STATUS_TONES[l.status]}`}>
                {LIVE_STATUS_LABELS[l.status]}
              </span>{" "}
              {l.demo && <span className="pill neutral">Démo</span>}
            </span>
          </header>
          <p>
            {l.seller.firstName ? `${l.seller.firstName} · ` : ""}
            {contactOf(l.seller)} · {countryName(l.seller.country)}
            {l.whatsapp ? ` · WhatsApp ${l.whatsapp}` : ""}
          </p>
          <p>
            {l.mode === "SELF"
              ? `Live de l’annonceur · ${DATE.format(new Date(l.startsAt))} · forfait ${formatFcfa(l.serviceFee ?? 0)}`
              : `${DATE.format(new Date(l.startsAt))} → ${l.endsAt ? DATE.format(new Date(l.endsAt)) : "?"} · ${l.slots} créateur${l.slots > 1 ? "s" : ""} · ${l.countries.map(countryName).join(", ")} · budget ${formatFcfa(l.budget)} (${formatFcfa(l.spent)} payés)`}
          </p>
          <small>
            {l._count.comments} commentaire{l._count.comments > 1 ? "s" : ""} ·{" "}
            {l._count.leads} intéressé{l._count.leads > 1 ? "s" : ""}
            {l.statusReason ? ` · Raison : ${l.statusReason}` : ""}
          </small>
          {l.sessions.length > 0 && l.mode === "CREATORS" && (
            <ul>
              {l.sessions.map((s) => (
                <li key={s.id}>
                  @{s.tiktokUsername} · {SESSION_STATUS_LABELS[s.status]}
                  {s.status === "ENDED"
                    ? ` · ${s.peakViewers} spectateurs · ${PAYOUT_LABELS[s.payout]}`
                    : ""}
                </li>
              ))}
            </ul>
          )}
          {canModerate && (
            <div className="actions">
              {l.status === "PENDING_REVIEW" && (
                <>
                  <button
                    disabled={queue.busy}
                    onClick={() =>
                      queue.act(() => staffLiveApi.review(l.id, "ACTIVE"))
                    }
                  >
                    Valider
                  </button>
                  <button
                    className="secondary"
                    disabled={queue.busy}
                    onClick={() => {
                      const reason = ask(
                        "Pourquoi refuser cette offre ? L’annonceur verra la raison.",
                      );
                      if (reason) {
                        queue.act(() =>
                          staffLiveApi.review(l.id, "REJECTED", reason),
                        );
                      }
                    }}
                  >
                    Refuser
                  </button>
                </>
              )}
              {(l.status === "ACTIVE" || l.status === "PENDING_PAYMENT") && (
                <button
                  className="secondary"
                  disabled={queue.busy}
                  onClick={() => {
                    const reason = ask(
                      "Pourquoi arrêter cette offre ? L’annonceur verra la raison.",
                    );
                    if (reason) {
                      queue.act(() => staffLiveApi.cancel(l.id, reason));
                    }
                  }}
                >
                  Arrêter
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </>
  );
}

function Audiences({ role }: { role: StaffRole }) {
  const load = useCallback(() => staffLiveApi.sessions("TO_REVIEW"), []);
  const queue = useQueue(load, () => {});
  const canModerate = CAN_MODERATE.includes(role);

  return (
    <>
      <p className="hint">
        Lives de créateurs dont l’audience paraît anormale (hausse brutale, plus
        de spectateurs que d’abonnés). Paie avec l’audience que tu retiens, ou
        refuse le paiement.
      </p>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && !queue.error && <div className="skeleton" />}
      {queue.items?.length === 0 && <p>Rien à vérifier.</p>}
      {queue.items?.map((s) => (
        <article className="campaign" key={s.id}>
          <header>
            <strong>
              @{s.tiktokUsername}
              {s.creator?.firstName ? ` · ${s.creator.firstName}` : ""}
            </strong>
            <span className="pill pending">{PAYOUT_LABELS[s.payout]}</span>
          </header>
          <p>
            {s.live.title} · {s.creator ? countryName(s.creator.country) : ""} ·{" "}
            {s.startedAt ? DATE.format(new Date(s.startedAt)) : ""}
            {s.startedAt && s.endedAt
              ? ` · ${Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60_000)} min`
              : ""}
          </p>
          <p>
            <b>{s.peakViewers.toLocaleString("fr-FR")}</b> spectateurs au plus
            fort · {(s.followers ?? 0).toLocaleString("fr-FR")} abonnés
          </p>
          {s.flag && <p className="error">{s.flag}</p>}
          {canModerate && (
            <PayoutForm
              peak={s.peakViewers}
              busy={queue.busy}
              onPay={(peakViewers, reason) =>
                queue.act(() =>
                  staffLiveApi.payout(s.id, {
                    decision: "PAY",
                    peakViewers,
                    reason,
                  }),
                )
              }
              onRefuse={(reason) =>
                queue.act(() =>
                  staffLiveApi.payout(s.id, { decision: "REFUSE", reason }),
                )
              }
            />
          )}
        </article>
      ))}
    </>
  );
}

function PayoutForm({
  peak,
  busy,
  onPay,
  onRefuse,
}: {
  peak: number;
  busy: boolean;
  onPay: (peakViewers: number, reason?: string) => void;
  onRefuse: (reason: string) => void;
}) {
  const [viewers, setViewers] = useState(String(peak));
  const [reason, setReason] = useState("");

  function pay(e: FormEvent) {
    e.preventDefault();
    onPay(Number(viewers), reason.trim() || undefined);
  }

  return (
    <form className="row" onSubmit={pay}>
      <label>
        Audience retenue
        <input
          type="number"
          min={0}
          value={viewers}
          onChange={(e) => setViewers(e.target.value)}
          required
        />
      </label>
      <label>
        Raison
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Obligatoire pour refuser"
          maxLength={300}
        />
      </label>
      <button disabled={busy}>Payer</button>
      <button
        type="button"
        className="secondary"
        disabled={busy || !reason.trim()}
        onClick={() => onRefuse(reason.trim())}
      >
        Refuser
      </button>
    </form>
  );
}

function Rates({ role }: { role: StaffRole }) {
  const load = useCallback(() => staffLiveApi.rates().then((r) => r.rates), []);
  const queue = useQueue<LiveRate>(load, () => {});
  const canEdit = role === "SUPER_ADMIN";

  return (
    <>
      <p className="hint">
        Prix pour 100 spectateurs au plus fort d’un live de créateur, et forfait
        de lecture des commentaires quand l’annonceur fait son propre live. La
        différence entre le prix annonceur et le gain créateur revient à Viewzo.
      </p>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && !queue.error && <div className="skeleton" />}
      {queue.items?.map((r) => (
        <RateRow
          key={r.country}
          rate={r}
          canEdit={canEdit}
          busy={queue.busy}
          onSave={(input) =>
            queue.act(() => staffLiveApi.setRate(r.country, input))
          }
        />
      ))}
    </>
  );
}

function RateRow({
  rate,
  canEdit,
  busy,
  onSave,
}: {
  rate: LiveRate;
  canEdit: boolean;
  busy: boolean;
  onSave: (input: Omit<LiveRate, "country" | "custom">) => void;
}) {
  const [advertiser, setAdvertiser] = useState(String(rate.advertiserPer100));
  const [creator, setCreator] = useState(String(rate.creatorPer100));
  const [fee, setFee] = useState(String(rate.selfFee));

  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          advertiserPer100: Number(advertiser),
          creatorPer100: Number(creator),
          selfFee: Number(fee),
        });
      }}
    >
      <label>
        {countryName(rate.country)}
        {!rate.custom && <small> (par défaut)</small>}
      </label>
      <label>
        Annonceur / 100
        <input
          type="number"
          min={0}
          value={advertiser}
          disabled={!canEdit}
          onChange={(e) => setAdvertiser(e.target.value)}
        />
      </label>
      <label>
        Créateur / 100
        <input
          type="number"
          min={0}
          value={creator}
          disabled={!canEdit}
          onChange={(e) => setCreator(e.target.value)}
        />
      </label>
      <label>
        Forfait live annonceur
        <input
          type="number"
          min={0}
          value={fee}
          disabled={!canEdit}
          onChange={(e) => setFee(e.target.value)}
        />
      </label>
      {canEdit && <button disabled={busy}>Enregistrer</button>}
    </form>
  );
}
