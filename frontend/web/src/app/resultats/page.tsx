"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  creatorApi,
  CreatorAssignment,
  CreatorResults,
  formatFcfa,
  NETWORK_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TONES,
} from "@/lib/api";
import { LoadingCard } from "../loading-card";
import { Toast } from "../toast";
import { useRequireUser } from "../_shell/session";

const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

// "Mes résultats": what the team validated, what it paid, and what to fix.
export default function ResultsPage() {
  const user = useRequireUser();
  const [results, setResults] = useState<CreatorResults | null>(null);
  const [tasks, setTasks] = useState<CreatorAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([creatorApi.results(), creatorApi.assignments()]).then(
        ([r, t]) => {
          setResults(r);
          setTasks(t);
        },
        (e) => setError((e as Error).message),
      ),
    [],
  );

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!results || !tasks) {
    return error ? <p className="error">{error}</p> : <LoadingCard />;
  }

  return (
    <div className="card wide">
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <h1>Mes résultats</h1>
      <div className="stats">
        <div>
          <small>Vues validées</small>
          <strong>{results.validViews.toLocaleString("fr-FR")}</strong>
        </div>
        <div>
          <small>Gagné ce mois</small>
          <strong>{formatFcfa(results.earnedThisMonth)}</strong>
        </div>
        <div>
          <small>Gagné au total</small>
          <strong>{formatFcfa(results.earned)}</strong>
        </div>
        <div>
          <small>Taux de validation</small>
          <strong>
            {results.validationRate == null ? "—" : `${results.validationRate} %`}
          </strong>
        </div>
      </div>
      <p className="hint">
        {results.toReview} en vérification · {results.needsFix} à corriger ·{" "}
        {results.validated} validée{results.validated > 1 ? "s" : ""} ·{" "}
        {results.rejected} refusée{results.rejected > 1 ? "s" : ""}
      </p>

      <h2>Mes publications</h2>
      {tasks.length === 0 && (
        <p>Aucune tâche acceptée pour l’instant. Les tâches s’acceptent dans l’application.</p>
      )}
      <div className="stagger" style={{ display: "grid", gap: 12 }}>
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onSent={(message) => {
              setToast(message);
              load();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onSent,
}: {
  task: CreatorAssignment;
  onSent: (message: string) => void;
}) {
  const statut = task.task.network === "WHATSAPP_STATUS";
  const refused = task.reviewStatus === "REJECTED";
  const [link, setLink] = useState(task.postUrl ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [views, setViews] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setFile(null);
      setViews("");
      onSent(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function sendLink(e: FormEvent) {
    e.preventDefault();
    run(() => creatorApi.submitLink(task.id, link.trim()), "Lien envoyé");
  }

  function sendScreenshot(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    run(
      () => creatorApi.addScreenshot(task.id, file, Number(views)),
      "Capture envoyée",
    );
  }

  return (
    <article className="campaign">
      <header>
        <strong>
          {task.task.campaign.title} · {NETWORK_LABELS[task.task.network]}
        </strong>
        {task.status === "ACCEPTED" ? (
          <span className="pill">À publier</span>
        ) : (
          <span className={`pill ${REVIEW_STATUS_TONES[task.reviewStatus]}`}>
            {REVIEW_STATUS_LABELS[task.reviewStatus]}
          </span>
        )}
      </header>
      <p>
        {task.task.campaign.hashtag} · jusqu’au{" "}
        {DATE.format(new Date(task.task.campaign.endsAt))} ·{" "}
        {task.task.creatorRatePer1000} FCFA / 1 000 vues
      </p>
      {task.reviewReason && <p className="error">{task.reviewReason}</p>}
      <p>
        {task.validViews.toLocaleString("fr-FR")} vues validées ·{" "}
        {formatFcfa(task.earned)} gagnés
        {task.declaredViews != null && task.declaredViews !== task.validViews && (
          <> · {task.declaredViews.toLocaleString("fr-FR")} déclarées</>
        )}
      </p>

      {task.proofPlan && (
        <div className="steps">
          {task.proofPlan.steps.map((s, i) => (
            <div key={s.label}>
              <i className={s.doneAt ? "done" : undefined}>{s.doneAt ? "✓" : i + 1}</i>
              <span>
                {s.label}
                <small className="hint">
                  {" "}
                  {s.doneAt
                    ? `envoyée le ${DATE.format(new Date(s.doneAt))}`
                    : s.dueAt
                      ? `à envoyer vers le ${DATE.format(new Date(s.dueAt))}`
                      : "dès que le statut est publié"}
                </small>
              </span>
            </div>
          ))}
        </div>
      )}

      {!refused && !statut && task.reviewStatus !== "VALIDATED" && (
        <form onSubmit={sendLink} className="inline-form">
          <input
            aria-label="Lien de la publication"
            type="url"
            required
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button disabled={busy || !link.trim() || link.trim() === task.postUrl}>
            {task.postUrl ? "Modifier le lien" : "J’ai publié"}
          </button>
        </form>
      )}

      {!refused && (statut || task.status === "SUBMITTED") && (
        <form onSubmit={sendScreenshot} className="summary">
          <strong>
            {statut ? "Envoyer une capture du statut" : "Ajouter une capture des vues"}
          </strong>
          <input
            aria-label="Capture d’écran"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <label>
            Vues visibles sur la capture
            <input
              type="number"
              min={0}
              required
              value={views}
              onChange={(e) => setViews(e.target.value)}
            />
          </label>
          <button disabled={busy || !file || views === ""}>Envoyer la capture</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
}
