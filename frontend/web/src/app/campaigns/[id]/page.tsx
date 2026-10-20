"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CampaignReport,
  formatFcfa,
  NETWORK_LABELS,
  reportApi,
  STATUS_LABELS,
} from "@/lib/api";
import { LoadingCard } from "../../loading-card";
import { ViewsChart } from "../../views-chart";
import { useRequireUser } from "../../_shell/session";

const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const COUNTRY_NAMES = new Intl.DisplayNames(["fr"], { type: "region" });

function csvCell(v: string | number | null) {
  let s = v == null ? "" : String(v);
  // A cell starting like a formula would run in the spreadsheet: keep it text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Validated posts as a spreadsheet the advertiser can keep.
function downloadCsv(report: CampaignReport) {
  const rows = [
    ["Réseau", "Pays", "Compte", "Lien", "Vues validées", "Publié le"],
    ...report.gallery.map((p) => [
      NETWORK_LABELS[p.network],
      p.country,
      p.handle,
      p.postUrl,
      p.views,
      p.submittedAt?.slice(0, 10) ?? null,
    ]),
  ];
  const csv = rows.map((r) => r.map(csvCell).join(";")).join("\n");
  const url = URL.createObjectURL(
    new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `viewzo-${report.code}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// The advertiser's live report: verified views, cost and the posts behind them.
export default function CampaignReportPage() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    reportApi.campaign(id).then(setReport, (e) => setError((e as Error).message));
  }, [user, id]);

  if (!report) return error ? <p className="error">{error}</p> : <LoadingCard />;

  const maxNetwork = Math.max(1, ...report.byNetwork.map((n) => n.views));

  return (
    <div className="card full">
      <Link href="/campaigns" className="hint">
        ← Mes campagnes
      </Link>
      <h1>
        {report.title} <small className="hint">#{report.code}</small>
      </h1>
      <p className="hint">
        {STATUS_LABELS[report.status]} · du {DAY.format(new Date(report.startsAt))} au{" "}
        {DAY.format(new Date(report.endsAt))}
      </p>
      <div className="stats">
        <div>
          <small>Vues vérifiées</small>
          <strong>{report.verifiedViews.toLocaleString("fr-FR")}</strong>
        </div>
        <div>
          <small>Dépensé</small>
          <strong>
            {formatFcfa(report.spent)} / {formatFcfa(report.budget)}
          </strong>
        </div>
        <div>
          <small>Coût pour 1 000 vues</small>
          <strong>
            {report.costPer1000 == null ? "—" : formatFcfa(report.costPer1000)}
          </strong>
        </div>
        <div>
          <small>Publications validées</small>
          <strong>
            {report.posts.validated} / {report.posts.total}
          </strong>
        </div>
      </div>
      <p className="hint">
        Seules les vues vérifiées par l’équipe Viewzo sont facturées.{" "}
        {report.posts.toReview > 0 &&
          `${report.posts.toReview} publication${report.posts.toReview > 1 ? "s" : ""} en vérification. `}
        {report.unbilledViews > 0 &&
          `${report.unbilledViews.toLocaleString("fr-FR")} vues déclarées ne sont pas (encore) vérifiées, elles ne sont pas facturées.`}
      </p>

      <h2>Vues vérifiées, cumul par jour</h2>
      <ViewsChart
        label="Vues vérifiées cumulées"
        points={report.daily.map((d) => ({ at: new Date(d.date).getTime(), views: d.views }))}
        formatX={(t) => DAY.format(new Date(t))}
      />

      <div className="dossier">
        <section>
          <h2>Par réseau</h2>
          {report.byNetwork.length === 0 && <p className="hint">Pas encore de vues.</p>}
          {report.byNetwork.map((n) => (
            <div key={n.network}>
              <p>
                {NETWORK_LABELS[n.network]} : {n.views.toLocaleString("fr-FR")} vues ·{" "}
                {n.posts} publication{n.posts > 1 ? "s" : ""}
              </p>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${(n.views / maxNetwork) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>
        <section>
          <h2>Par pays</h2>
          {report.byCountry.length === 0 && <p className="hint">Pas encore de vues.</p>}
          {report.byCountry.map((c) => (
            <div key={c.country} className="line">
              <span>{COUNTRY_NAMES.of(c.country) ?? c.country}</span>
              <span>{c.views.toLocaleString("fr-FR")} vues</span>
            </div>
          ))}
        </section>
      </div>

      <h2>Publications validées</h2>
      {report.gallery.length === 0 ? (
        <p className="hint">Les publications apparaissent ici une fois validées.</p>
      ) : (
        <>
          <button className="secondary" onClick={() => downloadCsv(report)}>
            Exporter en CSV
          </button>
          <div className="shots">
            {report.gallery.map((p) => (
              <a
                key={p.id}
                className="shot"
                href={p.postUrl ?? p.imageUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                {p.imageUrl ? (
                  // Signed links from the API; next/image can't optimize them.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={`Publication ${NETWORK_LABELS[p.network]}`} />
                ) : (
                  <span className="shot-link">Voir la publication ↗</span>
                )}
                <span>
                  {NETWORK_LABELS[p.network]} · {p.handle ?? p.country}
                  <br />
                  {p.views.toLocaleString("fr-FR")} vues
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
