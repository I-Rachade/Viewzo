"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  contactOf,
  NETWORK_LABELS,
  PostReviewStatus,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TONES,
  SocialNetwork,
  StaffPostRow,
  staffPostsApi,
} from "@/lib/api";
import { CountrySelect } from "../../country-select";
import { LoadingCard } from "../../loading-card";
import { RiskBadge } from "../_sections/risk-badge";
import { useStaffOnly } from "../_sections/use-staff";
import { DATE } from "../_sections/use-queue";

const STATUSES: (PostReviewStatus | "ALL")[] = [
  "TO_REVIEW",
  "NEEDS_FIX",
  "VALIDATED",
  "REJECTED",
  "ALL",
];

export default function PublicationsPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <Publications />
    </Suspense>
  );
}

// Every published post, riskiest first, to open its file.
function Publications() {
  const router = useRouter();
  const params = useSearchParams();
  const allowed = useStaffOnly();
  const alertsOnly = params.get("alertes") === "1";
  const [status, setStatus] = useState<PostReviewStatus | "ALL">("TO_REVIEW");
  const [network, setNetwork] = useState<SocialNetwork | "">("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"risk" | "date">("risk");
  const [data, setData] = useState<{
    counts: Record<PostReviewStatus, number>;
    items: StaffPostRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      staffPostsApi
        .list({
          status,
          network: network || undefined,
          country: country || undefined,
          q: q.trim() || undefined,
          sort,
        })
        .then(setData, (e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, status, network, country, q, sort]);

  if (!allowed) return <LoadingCard />;
  const items = alertsOnly
    ? data?.items.filter((p) => p.riskScore >= 50)
    : data?.items;

  return (
    <div className="card full">
      <h1>{alertsOnly ? "Alertes fraude" : "Publications"}</h1>
      <p>
        {alertsOnly
          ? "Publications à vérifier avec un score de risque de 50 ou plus."
          : "Clique sur une ligne pour ouvrir le dossier complet de la publication."}
      </p>
      <div className="tabs" role="tablist">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            className={status === s ? "selected" : ""}
            onClick={() => setStatus(s)}
          >
            {s === "ALL" ? "Toutes" : REVIEW_STATUS_LABELS[s]}{" "}
            {s !== "ALL" && data && <small>{data.counts[s]}</small>}
          </button>
        ))}
      </div>
      <div className="filters">
        <label>
          Réseau
          <select
            id="filter-network"
            value={network}
            onChange={(e) => setNetwork(e.target.value as SocialNetwork | "")}
          >
            <option value="">Tous</option>
            {(Object.keys(NETWORK_LABELS) as SocialNetwork[]).map((n) => (
              <option key={n} value={n}>
                {NETWORK_LABELS[n]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pays
          <CountrySelect
            id="filter-country"
            value={country}
            emptyLabel="Tous"
            onChange={setCountry}
          />
        </label>
        <label style={{ flex: "1 1 200px" }}>
          Recherche
          <input
            id="filter-q"
            value={q}
            placeholder="Code campagne, numéro, e-mail"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          Tri
          <select
            id="filter-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as "risk" | "date")}
          >
            <option value="risk">Risque d’abord</option>
            <option value="date">Plus récentes</option>
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <div className="skeleton" />}
      {items?.length === 0 && <p>Aucune publication ici.</p>}
      {!!items?.length && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Créateur</th>
                <th>Campagne</th>
                <th>Réseau</th>
                <th>Envoyé</th>
                <th className="num">Vues déclarées</th>
                <th className="num">Validées</th>
                <th className="num">Preuves</th>
                <th>Risque</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  className="clickable"
                  onClick={() => router.push(`/staff/publications/${p.id}`)}
                >
                  <td>
                    <Link
                      href={`/staff/publications/${p.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {contactOf(p.creator)}
                    </Link>{" "}
                    <small className="hint">{p.creator.country}</small>
                  </td>
                  <td>
                    #{p.campaign.code} {p.campaign.title}
                  </td>
                  <td>{NETWORK_LABELS[p.network]}</td>
                  <td>{p.submittedAt ? DATE.format(new Date(p.submittedAt)) : "—"}</td>
                  <td className="num">
                    {p.latestViews?.toLocaleString("fr-FR") ?? "—"}
                  </td>
                  <td className="num">{p.validViews.toLocaleString("fr-FR")}</td>
                  <td className="num">{p.proofs}</td>
                  <td>
                    <RiskBadge score={p.riskScore} />
                  </td>
                  <td>
                    <span className={`pill ${REVIEW_STATUS_TONES[p.reviewStatus]}`}>
                      {REVIEW_STATUS_LABELS[p.reviewStatus]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
