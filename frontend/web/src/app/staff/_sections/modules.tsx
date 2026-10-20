"use client";

import { modulesApi } from "@/lib/api";
import { confirmed } from "./confirm";
import { DATE, useQueue } from "./use-queue";

// Features the super admin switches on for everyone. While a module is off,
// its menus are hidden and its pages answer "introuvable".
export function ModulesSection({ onChange }: { onChange: () => void }) {
  const queue = useQueue(modulesApi.all, onChange);

  return (
    <>
      <p className="hint">
        Un module désactivé n’apparaît nulle part, ni sur le web ni dans
        l’app. Chaque changement est inscrit au journal.
      </p>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items === null && !queue.error && <div className="skeleton" />}
      {queue.items?.map((m) => (
        <div className="line" key={m.key}>
          <span>
            <b>{m.name}</b>{" "}
            <span className={`pill ${m.enabled ? "paid" : "neutral"}`}>
              {m.enabled ? "Activé" : "Désactivé"}
            </span>
            <br />
            <small>{m.description}</small>
            {m.updatedAt && (
              <>
                <br />
                <small>Modifié le {DATE.format(new Date(m.updatedAt))}</small>
              </>
            )}
          </span>
          <button
            className={m.enabled ? "secondary" : undefined}
            disabled={queue.busy}
            onClick={() => {
              const ask = m.enabled
                ? `Désactiver « ${m.name} » ? Les lives en cours continuent, mais plus personne ne voit la fonctionnalité.`
                : `Activer « ${m.name} » pour tous les annonceurs ?`;
              if (confirmed(ask)) {
                queue.act(() => modulesApi.set(m.key, !m.enabled));
              }
            }}
          >
            {m.enabled ? "Désactiver" : "Activer"}
          </button>
        </div>
      ))}
    </>
  );
}
