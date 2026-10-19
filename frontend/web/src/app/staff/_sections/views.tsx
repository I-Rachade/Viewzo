"use client";

import { useState } from "react";
import {
  CONTENT_TYPE_LABELS,
  formatFcfa,
  NETWORK_LABELS,
  StaffAssignment,
  staffApi,
} from "@/lib/api";
import { DATE, useQueue } from "./use-queue";

export function ViewsSection({ onChange }: { onChange: () => void }) {
  const queue = useQueue(staffApi.assignments, onChange);
  const [result, setResult] = useState<string | null>(null);
  return (
    <>
      <p className="hint">
        Indique le total des vues vérifiées. Le gain du créateur est recalculé
        et les vues au-delà du budget ne sont pas payées.
      </p>
      {result && <p>{result}</p>}
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && <p>Chargement…</p>}
      {queue.items?.length === 0 && <p>Aucune publication envoyée.</p>}
      {queue.items?.map((a) => (
        <ViewsCard
          key={a.id}
          assignment={a}
          busy={queue.busy}
          onSave={(total) =>
            queue.act(async () => {
              const r = await staffApi.recordViews(a.id, total);
              setResult(
                `#${a.campaign.code} : ${r.validViews.toLocaleString("fr-FR")} vues validées, ${formatFcfa(r.earned)} pour le créateur` +
                  (r.unpaidViews > 0
                    ? `, ${r.unpaidViews.toLocaleString("fr-FR")} vues hors budget`
                    : ""),
              );
            })
          }
        />
      ))}
    </>
  );
}

function ViewsCard({
  assignment: a,
  busy,
  onSave,
}: {
  assignment: StaffAssignment;
  busy: boolean;
  onSave: (total: number) => void;
}) {
  const [total, setTotal] = useState(a.validViews);
  return (
    <article className="campaign">
      <header>
        <strong>
          {a.campaign.title} · #{a.campaign.code}
        </strong>
        <span className="status">{NETWORK_LABELS[a.network]}</span>
      </header>
      {a.postUrl && (
        <a href={a.postUrl} target="_blank" rel="noreferrer">
          {a.postUrl}
        </a>
      )}
      <p className="hint">
        {a.creator.phone} ({a.creator.country}) ·{" "}
        {CONTENT_TYPE_LABELS[a.contentType]} · budget {formatFcfa(a.taskBudget)}
        {a.submittedAt &&
          ` · envoyé le ${DATE.format(new Date(a.submittedAt))}`}
      </p>
      <p>
        Déjà validé : {a.validViews.toLocaleString("fr-FR")} vues,{" "}
        {formatFcfa(a.earned)}
      </p>
      <div className="row">
        <label>
          Total des vues
          <input
            type="number"
            min={a.validViews}
            value={total || ""}
            onChange={(e) => setTotal(Number(e.target.value))}
          />
        </label>
        <button
          disabled={busy || total <= a.validViews}
          onClick={() => onSave(total)}
        >
          Enregistrer
        </button>
      </div>
    </article>
  );
}
