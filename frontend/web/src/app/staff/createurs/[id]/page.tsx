"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ACCOUNT_STATUS_LABELS,
  contactOf,
  CreatorFile,
  formatFcfa,
  NETWORK_LABELS,
  PAYMENT_STATUS_LABELS,
  PROFILE_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TONES,
  staffPostsApi,
} from "@/lib/api";
import { LoadingCard } from "../../../loading-card";
import { RiskBadge } from "../../_sections/risk-badge";
import { DATE } from "../../_sections/use-queue";
import { useStaffOnly } from "../../_sections/use-staff";

// Everything the team knows about one creator, to judge them as a whole.
export default function CreatorFilePage() {
  const { id } = useParams<{ id: string }>();
  const allowed = useStaffOnly();
  const [file, setFile] = useState<CreatorFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    staffPostsApi.creator(id).then(setFile, (e) => setError((e as Error).message));
  }, [allowed, id]);

  if (!allowed || (!file && !error)) return <LoadingCard />;
  if (!file) return <p className="error">{error}</p>;

  const count = (s: CreatorFile["posts"][number]["reviewStatus"]) =>
    file.posts.filter((p) => p.status === "SUBMITTED" && p.reviewStatus === s).length;
  const validated = count("VALIDATED");
  const rejected = count("REJECTED");
  const views = file.posts.reduce((sum, p) => sum + p.validViews, 0);

  return (
    <div className="full" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Link href="/staff/publications" className="hint">
        ← Publications
      </Link>
      <div className="panel">
        <h1>{contactOf(file)}</h1>
        <p className="hint">
          {file.country} · inscrit n° {file.priorityRank} le{" "}
          {DATE.format(new Date(file.createdAt))} ·{" "}
          {file.profiles
            .map((p) => `${PROFILE_LABELS[p.type]} niveau ${p.level}`)
            .join(", ")}
        </p>
        <div className="stats">
          <div>
            <small>Publications</small>
            <strong>{file.posts.length}</strong>
          </div>
          <div>
            <small>Validées / refusées</small>
            <strong>
              {validated} / {rejected}
            </strong>
          </div>
          <div>
            <small>Vues validées</small>
            <strong>{views.toLocaleString("fr-FR")}</strong>
          </div>
          <div>
            <small>Gagné</small>
            <strong>{formatFcfa(file.earned)}</strong>
          </div>
          <div>
            <small>Appareils</small>
            <strong>{file.devices}</strong>
          </div>
        </div>
        {file.sharedDevice.length > 0 && (
          <div className="signal">
            <span className="pill refused">Haut</span>
            <p>
              Même appareil ou même adresse que :{" "}
              {file.sharedDevice.map((u) => (
                <Link key={u.id} href={`/staff/createurs/${u.id}`}>
                  {contactOf(u)}{" "}
                </Link>
              ))}
            </p>
          </div>
        )}
      </div>

      <div className="dossier">
        <div>
          <section className="panel">
            <h2>Publications</h2>
            {file.posts.length === 0 ? (
              <p className="hint">Aucune tâche acceptée.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Campagne</th>
                      <th>Réseau</th>
                      <th>État</th>
                      <th className="num">Vues</th>
                      <th className="num">Gain</th>
                      <th>Risque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {file.posts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/staff/publications/${p.id}`}>
                            #{p.campaign.code} {p.campaign.title}
                          </Link>
                        </td>
                        <td>{NETWORK_LABELS[p.network]}</td>
                        <td>
                          {p.status === "ACCEPTED" ? (
                            <span className="pill">Pas encore publié</span>
                          ) : (
                            <span className={`pill ${REVIEW_STATUS_TONES[p.reviewStatus]}`}>
                              {REVIEW_STATUS_LABELS[p.reviewStatus]}
                            </span>
                          )}
                          {p.reviewReason && <small className="hint"> {p.reviewReason}</small>}
                        </td>
                        <td className="num">
                          {p.validViews.toLocaleString("fr-FR")}
                          {p.latestViews != null && p.latestViews !== p.validViews && (
                            <small> ({p.latestViews.toLocaleString("fr-FR")} déclarées)</small>
                          )}
                        </td>
                        <td className="num">{formatFcfa(p.earned)}</td>
                        <td>
                          <RiskBadge score={p.riskScore} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Retraits</h2>
            {file.payouts.length === 0 ? (
              <p className="hint">Aucun retrait.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {file.payouts.map((p) => (
                      <tr key={p.id}>
                        <td>{DATE.format(new Date(p.createdAt))}</td>
                        <td className="num">{formatFcfa(p.amount)}</td>
                        <td>
                          {p.operator ?? ""} {p.phone}
                        </td>
                        <td>
                          {PAYMENT_STATUS_LABELS[p.status]}
                          {p.failureReason && <small className="hint"> {p.failureReason}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <h2>Comptes</h2>
            {file.accounts.length === 0 && <p className="hint">Aucun compte ajouté.</p>}
            <dl className="kv">
              {file.accounts.map((a) => (
                <div key={a.id} style={{ display: "contents" }}>
                  <dt>{NETWORK_LABELS[a.network]}</dt>
                  <dd>
                    {a.handle} · {ACCOUNT_STATUS_LABELS[a.status]}
                    {a.network === "WHATSAPP_STATUS"
                      ? a.avgStatusViews != null &&
                        ` · ${a.avgStatusViews.toLocaleString("fr-FR")} vues / statut`
                      : a.followers != null &&
                        ` · ${a.followers.toLocaleString("fr-FR")} abonnés`}
                    {a.statusReason && <small className="hint"> {a.statusReason}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {file.skills && (
            <section className="panel">
              <h2>Profil</h2>
              <dl className="kv">
                <dt>Spécialités</dt>
                <dd>{file.skills.specialties.join(", ") || "—"}</dd>
                <dt>Langues</dt>
                <dd>{file.skills.languages.join(", ") || "—"}</dd>
                <dt>Zones</dt>
                <dd>
                  {[...file.skills.countries, ...file.skills.cities].join(", ") || "—"}
                </dd>
                <dt>Rythme</dt>
                <dd>
                  {file.skills.tasksPerWeek} tâche{file.skills.tasksPerWeek > 1 ? "s" : ""} / semaine
                  {file.skills.showsFace ? " · montre son visage" : ""}
                </dd>
              </dl>
            </section>
          )}

          <section className="panel">
            <h2>Décisions sur les comptes</h2>
            {file.accountReviews.length === 0 ? (
              <p className="hint">Aucune.</p>
            ) : (
              <div className="timeline">
                {file.accountReviews.map((r) => (
                  <div key={r.id}>
                    <time>{DATE.format(new Date(r.createdAt))}</time>
                    <span>
                      {NETWORK_LABELS[r.network]} : {ACCOUNT_STATUS_LABELS[r.status]}
                      {r.reason ? ` (${r.reason})` : ""}
                      {r.by ? ` · ${r.by}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
