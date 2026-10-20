"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CampaignView,
  campaignsApi,
  CONTENT_TYPE_LABELS,
  formatFcfa,
  hasSession,
  NETWORK_LABELS,
  PACKAGE_LABELS,
  STATUS_LABELS,
  walletApi,
} from "@/lib/api";

const STATUS_TONES: Record<CampaignView["status"], string> = {
  PENDING_REVIEW: "pending",
  ACTIVE: "paid",
  REJECTED: "refused",
  COMPLETED: "neutral",
};

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null);
  const [available, setAvailable] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace("/login");
      return;
    }
    Promise.all([campaignsApi.list(), walletApi.summary()])
      .then(([list, wallet]) => {
        setCampaigns(list);
        setAvailable(wallet.available);
      })
      .catch((e) => setError((e as Error).message));
  }, [router]);

  async function pay(c: CampaignView, method: "WALLET" | "MOBILE_MONEY") {
    setBusy(true);
    setError(null);
    try {
      const result = await walletApi.payCampaign(c.id, method);
      if ("checkoutUrl" in result && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      const [list, wallet] = await Promise.all([
        campaignsApi.list(),
        walletApi.summary(),
      ]);
      setCampaigns(list);
      setAvailable(wallet.available);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card wide">
      <h1>Mes campagnes</h1>
      <Link className="button coral" href="/campaigns/new">
        Créer une campagne
      </Link>
      {error && <p className="error">{error}</p>}
      {campaigns === null && !error && (
        <>
          <div className="skeleton" />
          <div className="skeleton" style={{ width: "70%" }} />
        </>
      )}
      {campaigns?.length === 0 && <p>Aucune campagne pour l’instant.</p>}
      <div className="stagger" style={{ display: "grid", gap: 12 }}>
        {campaigns?.map((c) => (
          <article key={c.id} className="campaign">
            <header>
              <strong>{c.title}</strong>
              <span className={`pill ${STATUS_TONES[c.status]}`}>
                {STATUS_LABELS[c.status]}
              </span>
            </header>
            <p>
              #{c.code} · {PACKAGE_LABELS[c.package]} · {formatFcfa(c.budget)} ·{" "}
              {DATE.format(new Date(c.startsAt))} au{" "}
              {DATE.format(new Date(c.endsAt))}
            </p>
            {c.statusReason && <p className="error">{c.statusReason}</p>}
            {c.fundedAt && (
              <Link className="button secondary" href={`/campaigns/${c.id}`}>
                Voir le rapport
              </Link>
            )}
            {!c.fundedAt &&
              (c.status === "PENDING_REVIEW" || c.status === "ACTIVE") && (
                <div className="summary">
                  <strong>À payer : {formatFcfa(c.budget)}</strong>
                  <p className="hint">
                    Le budget est placé en séquestre ; les créateurs voient la
                    campagne une fois qu’elle est payée et validée.
                  </p>
                  {available >= c.budget && (
                    <button disabled={busy} onClick={() => pay(c, "WALLET")}>
                      Payer avec mon solde ({formatFcfa(available)})
                    </button>
                  )}
                  <button
                    className={available >= c.budget ? "secondary" : undefined}
                    disabled={busy}
                    onClick={() => pay(c, "MOBILE_MONEY")}
                  >
                    Payer par Mobile Money
                  </button>
                </div>
              )}
            {c.platforms.map((p) => (
              <div key={p.network}>
                <p>
                  {NETWORK_LABELS[p.network]} :{" "}
                  {CONTENT_TYPE_LABELS[p.contentType]}, {formatFcfa(p.budget)},
                  ≈ {p.estimatedViews.toLocaleString("fr-FR")} vues,{" "}
                  {p.creators} créateur{p.creators > 1 ? "s" : ""}
                </p>
                <div className="bar" aria-hidden="true">
                  <span
                    style={{
                      width: `${c.budget ? (p.budget / c.budget) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>
      <Link className="button secondary" href="/dashboard">
        Tableau de bord
      </Link>
    </div>
  );
}
