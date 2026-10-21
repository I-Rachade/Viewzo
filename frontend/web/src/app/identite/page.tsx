"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  api,
  IDENTITY_STATUS_LABELS,
  identityApi,
  IdentityStatusView,
} from "@/lib/api";
import { LoadingCard } from "../loading-card";
import { useRequireUser, useSession } from "../_shell/session";

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

export default function IdentityPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <Identity />
    </Suspense>
  );
}

// Level 2: an ID document and a selfie, checked by Didit on its own pages,
// then by the team when Didit can't decide alone.
function Identity() {
  const user = useRequireUser();
  const { updateUser } = useSession();
  const refreshUser = useCallback(
    async () => updateUser(await api.me()),
    [updateUser],
  );
  const params = useSearchParams();
  // Didit sends the person back here with ?check=…; ?demo=1 on a dev machine.
  const back = params.has("check") || params.has("demo");
  const [view, setView] = useState<IdentityStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const status = await identityApi.status();
    setView(status);
    return status;
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const status = await load();
        const open =
          status.check?.status === "STARTED" ||
          status.check?.status === "IN_REVIEW";
        if (back && open) {
          await identityApi.refresh();
          await load();
          await refreshUser();
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [user, back, load, refreshUser]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const check = await identityApi.start();
      if (check.url) window.location.assign(check.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await identityApi.refresh();
      await load();
      await refreshUser();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!view) return error ? <p className="error">{error}</p> : <LoadingCard />;
  const check = view.check;

  return (
    <div className="card">
      <h1>Vérifier mon identité</h1>

      {view.verified ? (
        <>
          <p>
            <span className="pill paid">Identité vérifiée</span>
          </p>
          <p>
            {check?.fullName && <>Au nom de {check.fullName}. </>}
            Tes profils créateur et annonceur sont au niveau 2 : toutes les
            tâches et les retraits sont ouverts.
          </p>
          <Link className="button" href="/wallet">
            Aller au portefeuille
          </Link>
        </>
      ) : (
        <>
          <p>
            Le niveau 2 ouvre toutes les tâches et les retraits. Il te faut ta
            pièce d’identité (carte, passeport ou permis) et ton téléphone pour
            un selfie. Compte 3 minutes.
          </p>
          <ul>
            <li>Une pièce valide, en entier, sans reflet.</li>
            <li>Un selfie dans un endroit bien éclairé, sans lunettes ni casquette.</li>
            <li>
              Pour tes retraits, le compte Mobile Money doit être à ton nom.
            </li>
          </ul>

          {check && (
            <p className="hint">
              Dernière demande : {IDENTITY_STATUS_LABELS[check.status]}
              {check.reason && ` · ${check.reason}`}
            </p>
          )}

          {!view.available ? (
            <p className="hint">La vérification d’identité ouvre bientôt.</p>
          ) : view.needsProfile ? (
            <p className="hint">
              Active d’abord ton profil créateur ou annonceur.
            </p>
          ) : check?.status === "IN_REVIEW" ? (
            <p>
              L’équipe Viewzo examine ton dossier, en général sous 48 h. Tu
              recevras une notification.
            </p>
          ) : view.retryAfter ? (
            <p className="error">
              Trop d’essais refusés : réessaie à partir du{" "}
              {DATE.format(new Date(view.retryAfter))}.
            </p>
          ) : (
            <div className="actions">
              <button className="coral" disabled={busy} onClick={start}>
                {check?.status === "STARTED"
                  ? "Reprendre la vérification"
                  : "Commencer la vérification"}
              </button>
              {check?.status === "STARTED" && (
                <button className="secondary" disabled={busy} onClick={refresh}>
                  J’ai terminé
                </button>
              )}
            </div>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
