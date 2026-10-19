"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CampaignView,
  campaignsApi,
  CONTENT_TYPE_LABELS,
  formatFcfa,
  getToken,
  NETWORK_LABELS,
  PACKAGE_LABELS,
  STATUS_LABELS,
} from "@/lib/api";

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    campaignsApi
      .list()
      .then(setCampaigns)
      .catch((e) => setError((e as Error).message));
  }, [router]);

  return (
    <div className="card wide">
      <h1>Mes campagnes</h1>
      <Link className="button" href="/campaigns/new">
        Créer une campagne
      </Link>
      {error && <p className="error">{error}</p>}
      {campaigns === null && !error && <p>Chargement…</p>}
      {campaigns?.length === 0 && <p>Aucune campagne pour l’instant.</p>}
      {campaigns?.map((c) => (
        <article key={c.id} className="campaign">
          <header>
            <strong>{c.title}</strong>
            <span className="status">{STATUS_LABELS[c.status]}</span>
          </header>
          <p>
            #{c.code} · {PACKAGE_LABELS[c.package]} · {formatFcfa(c.budget)} ·{" "}
            {DATE.format(new Date(c.startsAt))} au{" "}
            {DATE.format(new Date(c.endsAt))}
          </p>
          {c.statusReason && <p className="error">{c.statusReason}</p>}
          {c.platforms.map((p) => (
            <p key={p.network}>
              {NETWORK_LABELS[p.network]} : {CONTENT_TYPE_LABELS[p.contentType]}
              , {formatFcfa(p.budget)}, ≈{" "}
              {p.estimatedViews.toLocaleString("fr-FR")} vues, {p.creators}{" "}
              créateur{p.creators > 1 ? "s" : ""}
            </p>
          ))}
        </article>
      ))}
      <Link className="button secondary" href="/dashboard">
        Tableau de bord
      </Link>
    </div>
  );
}
