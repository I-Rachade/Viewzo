"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ACCOUNT_STATUS_LABELS,
  CONTENT_TYPE_LABELS,
  contactOf,
  formatFcfa,
  NETWORK_LABELS,
  PostDecision,
  PostDossier,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TONES,
  staffPostsApi,
} from "@/lib/api";
import { LoadingCard } from "../../../loading-card";
import { Toast } from "../../../toast";
import { ViewsChart } from "../../../views-chart";
import { RiskBadge } from "../../_sections/risk-badge";
import { DATE } from "../../_sections/use-queue";
import { useSession } from "../../../_shell/session";
import { useStaffOnly } from "../../_sections/use-staff";

const SOURCE_LABELS = {
  CREATOR: "déclaré avec une capture",
  STAFF: "validé par l’équipe",
  API: "relevé sur la plateforme",
} as const;

// Everything about one post, and the decisions the team can take on it.
export default function PostDossierPage() {
  const { id } = useParams<{ id: string }>();
  const allowed = useStaffOnly();
  const { refreshStaff } = useSession();
  const [post, setPost] = useState<PostDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [views, setViews] = useState(0);
  const [reason, setReason] = useState("");

  const load = useCallback(
    () =>
      staffPostsApi.get(id).then(
        (p) => {
          setPost(p);
          // Default to the most trustworthy count: the platform's, else the latest.
          const api = p.snapshots.filter((s) => s.source === "API").at(-1);
          setViews(Math.max(p.validViews, api?.views ?? p.latestViews));
        },
        (e) => setError((e as Error).message),
      ),
    [id],
  );

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function decide(decision: PostDecision, done: string) {
    if (decision !== "VALIDATE" && !reason.trim()) {
      setError("Écris la raison, le créateur la verra.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPost(
        await staffPostsApi.review(id, {
          decision,
          views: decision === "VALIDATE" ? views : undefined,
          reason: decision === "VALIDATE" ? undefined : reason.trim(),
        }),
      );
      setReason("");
      setToast(done);
      refreshStaff();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!allowed || (!post && !error)) return <LoadingCard />;
  if (!post) return <p className="error">{error}</p>;

  const c = post.creator;
  const statusAccount = post.network === "WHATSAPP_STATUS";
  const duration =
    post.campaign.minDurationSec || post.campaign.maxDurationSec
      ? `${post.campaign.minDurationSec ?? 0} à ${post.campaign.maxDurationSec ?? "…"} s`
      : null;

  return (
    <div className="full" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <Link href="/staff/publications" className="hint">
        ← Publications
      </Link>
      <div className="panel">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <h1 style={{ marginRight: "auto" }}>
            {contactOf(c)} · #{post.campaign.code} · {NETWORK_LABELS[post.network]}
          </h1>
          <RiskBadge score={post.riskScore} />
          <span className={`pill ${REVIEW_STATUS_TONES[post.reviewStatus]}`}>
            {REVIEW_STATUS_LABELS[post.reviewStatus]}
          </span>
        </div>
        {post.reviewReason && <p className="error">{post.reviewReason}</p>}
      </div>

      <div className="dossier">
        <div>
          <section className="panel">
            <h2>Évolution des vues</h2>
            <ViewsChart
              label="Vues de la publication dans le temps"
              points={post.snapshots.map((s) => ({
                at: new Date(s.takenAt).getTime(),
                views: s.views,
                kind: s.source,
              }))}
              formatX={(t) => DATE.format(new Date(t))}
            />
            <div className="legend">
              <span>
                <i style={{ background: "var(--accent)" }} />
                Capture du créateur
              </span>
              <span>
                <i style={{ background: "var(--paid)" }} />
                Relevé automatique
              </span>
              <span>
                <i style={{ background: "var(--ink)" }} />
                Validé par l’équipe
              </span>
            </div>
            {post.snapshots.length > 0 && (
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {[...post.snapshots].reverse().map((s, i) => (
                      <tr key={i}>
                        <td>{DATE.format(new Date(s.takenAt))}</td>
                        <td className="num">{s.views.toLocaleString("fr-FR")}</td>
                        <td>
                          {SOURCE_LABELS[s.source]}
                          {s.by ? ` (${s.by})` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Preuves</h2>
            {post.postUrl && (
              <a href={post.postUrl} target="_blank" rel="noreferrer">
                {post.postUrl}
              </a>
            )}
            {post.proofs.some((p) => p.fileUrl) ? (
              <div className="shots">
                {post.proofs
                  .filter((p) => p.fileUrl)
                  .map((p) => (
                    <a
                      key={p.id}
                      className="shot"
                      href={p.fileUrl!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {/* Signed links from the API; next/image can't optimize them. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.fileUrl!} alt={`Capture du ${DATE.format(new Date(p.uploadedAt))}`} />
                      <span>
                        {DATE.format(new Date(p.uploadedAt))}
                        <br />
                        {p.declaredViews?.toLocaleString("fr-FR") ?? "?"} vues
                      </span>
                    </a>
                  ))}
              </div>
            ) : (
              <p className="hint">Aucune capture envoyée.</p>
            )}
            {post.proofs.length > 0 && (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Envoi</th>
                      <th>Prise</th>
                      <th>Appareil</th>
                      <th>Adresse IP</th>
                      <th>Empreinte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {post.proofs.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.kind === "LINK" ? "Lien" : "Capture"} ·{" "}
                          {DATE.format(new Date(p.uploadedAt))}
                        </td>
                        <td>{p.capturedAt ? DATE.format(new Date(p.capturedAt)) : "—"}</td>
                        <td>{p.deviceId?.slice(0, 8) ?? "—"}</td>
                        <td>{p.ip ?? "—"}</td>
                        <td>{p.sha256?.slice(0, 10) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Brief à respecter</h2>
            <dl className="kv">
              <dt>Campagne</dt>
              <dd>
                #{post.campaign.code} {post.campaign.title}
              </dd>
              <dt>Format</dt>
              <dd>{CONTENT_TYPE_LABELS[post.contentType]}</dd>
              <dt>Langue</dt>
              <dd>
                {post.campaign.language}
                {post.campaign.faceRequired ? " · visage visible" : ""}
                {duration ? ` · ${duration}` : ""}
              </dd>
              {post.campaign.mandatoryElements.length > 0 && (
                <>
                  <dt>À inclure</dt>
                  <dd>{post.campaign.mandatoryElements.join(", ")}</dd>
                </>
              )}
              {post.campaign.forbiddenElements.length > 0 && (
                <>
                  <dt>Interdit</dt>
                  <dd>{post.campaign.forbiddenElements.join(", ")}</dd>
                </>
              )}
              <dt>Hashtag</dt>
              <dd>#{post.campaign.code}</dd>
              <dt>Éléments fournis</dt>
              <dd>
                {post.campaign.assetUrls.length
                  ? post.campaign.assetUrls.map((u, i) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer">
                        Élément {i + 1}{" "}
                      </a>
                    ))
                  : "—"}
              </dd>
            </dl>
          </section>
        </div>

        <div>
          <section className="panel">
            <h2>Décision</h2>
            <label>
              Total des vues à valider
              <input
                id="views"
                type="number"
                min={post.validViews}
                value={views || ""}
                onChange={(e) => setViews(Number(e.target.value))}
              />
            </label>
            <p className="hint">
              Gain prévu pour {post.latestViews.toLocaleString("fr-FR")} vues
              déclarées : {formatFcfa(post.expectedEarning)} ({post.creatorRatePer1000}{" "}
              FCFA / 1 000). Déjà validé : {post.validViews.toLocaleString("fr-FR")} vues,{" "}
              {formatFcfa(post.earned)}.
            </p>
            <button
              disabled={busy || views < post.validViews}
              onClick={() => decide("VALIDATE", "Publication validée")}
            >
              Valider {views.toLocaleString("fr-FR")} vues
            </button>
            <label>
              Raison (visible par le créateur)
              <textarea
                id="reason"
                value={reason}
                maxLength={500}
                placeholder="Ex. : le hashtag manque sur la capture"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => decide("NEEDS_FIX", "Correction demandée")}
              >
                Demander une correction
              </button>
              <button
                className="coral"
                disabled={busy}
                onClick={() => decide("REJECT", "Publication refusée")}
              >
                Refuser
              </button>
              <button
                className="secondary"
                disabled={busy || !c.account || c.account.status === "SUSPENDED"}
                onClick={() => decide("SUSPEND_ACCOUNT", "Compte suspendu")}
              >
                Suspendre le compte
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </section>

          <section className="panel">
            <h2>Signaux de fraude</h2>
            {post.signals.length === 0 && (
              <div className="signal">
                <span className="pill paid">OK</span>
                <p>Aucun signal pour cette publication.</p>
              </div>
            )}
            {post.signals.map((s) => (
              <div key={s.code} className="signal">
                <span className={`pill ${s.level === "HIGH" ? "refused" : "pending"}`}>
                  {s.level === "HIGH" ? "Haut" : "Moyen"}
                </span>
                <p>{s.message}</p>
              </div>
            ))}
          </section>

          <section className="panel">
            <h2>Créateur</h2>
            <dl className="kv">
              <dt>Contact</dt>
              <dd>
                <Link href={`/staff/createurs/${c.id}`}>{contactOf(c)}</Link> · {c.country}
              </dd>
              <dt>Niveau</dt>
              <dd>
                {c.level} · inscrit le {DATE.format(new Date(c.createdAt))}
              </dd>
              <dt>Compte</dt>
              <dd>
                {c.account
                  ? `${c.account.handle} · ${ACCOUNT_STATUS_LABELS[c.account.status]}`
                  : "—"}
              </dd>
              <dt>Audience</dt>
              <dd>
                {statusAccount
                  ? `${c.account?.avgStatusViews?.toLocaleString("fr-FR") ?? "?"} vues / statut en moyenne`
                  : `${c.account?.followers?.toLocaleString("fr-FR") ?? "?"} abonnés`}
              </dd>
              <dt>Historique</dt>
              <dd>
                {c.history.validated} validée{c.history.validated > 1 ? "s" : ""},{" "}
                {c.history.rejected} refusée{c.history.rejected > 1 ? "s" : ""},{" "}
                {c.history.toReview + c.history.needsFix} en cours
              </dd>
              {c.sharedDevice.length > 0 && (
                <>
                  <dt>Même appareil</dt>
                  <dd>
                    {c.sharedDevice.map((u) => (
                      <Link key={u.id} href={`/staff/createurs/${u.id}`}>
                        {contactOf(u)}{" "}
                      </Link>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section className="panel">
            <h2>Chronologie</h2>
            <div className="timeline">
              {post.timeline.map((t, i) => (
                <div key={i}>
                  <time>{DATE.format(new Date(t.at))}</time>
                  <span>
                    {t.label}
                    {t.by ? ` · ${t.by}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
