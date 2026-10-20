"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Connection, connectionsApi, NETWORK_LABELS, SocialNetwork } from "@/lib/api";
import { LoadingCard } from "../loading-card";
import { Toast } from "../toast";
import { OAUTH_CONNECTIONS } from "../_shell/features";
import { useRequireUser } from "../_shell/session";

const RETURN_MESSAGES: Record<string, string> = {
  ok: "Compte connecté : tes vues seront relevées automatiquement.",
  error: "La connexion a échoué, réessaie.",
  cancelled: "Connexion annulée.",
};

// Why Viewzo refused the account; fixed texts, only the code is in the link.
const REFUSAL_MESSAGES: Record<string, string> = {
  NOT_DECLARED:
    "Ajoute d’abord ce compte dans « Mes comptes » et fais-le vérifier, puis connecte-le.",
  OTHER_ACCOUNT:
    "Ce compte n’est pas celui que tu as déclaré. Connecte-toi sur le réseau avec le compte vérifié, puis réessaie.",
  LINKED_ELSEWHERE: "Ce compte est déjà relié à un autre compte Viewzo.",
};

export default function ConnectionsPage() {
  const router = useRouter();
  useEffect(() => {
    if (!OAUTH_CONNECTIONS) router.replace("/comptes");
  }, [router]);
  if (!OAUTH_CONNECTIONS) return <LoadingCard />;
  return (
    <Suspense fallback={<LoadingCard />}>
      <Connections />
    </Suspense>
  );
}

// Connected platform accounts, so Viewzo reads the views itself.
function Connections() {
  const user = useRequireUser();
  const router = useRouter();
  const params = useSearchParams();
  const returned = params.get("status");
  // Why the API refused the account, e.g. another handle than the verified one.
  const returnedReason = params.get("reason");
  const [items, setItems] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(
    () => connectionsApi.list().then(setItems, (e) => setError((e as Error).message)),
    [],
  );

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function connect(network: SocialNetwork) {
    setBusy(true);
    setError(null);
    try {
      const { url } = await connectionsApi.start(network);
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function disconnect(network: SocialNetwork) {
    setBusy(true);
    setError(null);
    try {
      await connectionsApi.disconnect(network);
      setToast(`${NETWORK_LABELS[network]} déconnecté`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!items) return error ? <p className="error">{error}</p> : <LoadingCard />;

  return (
    <div className="card wide">
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {returned && RETURN_MESSAGES[returned] && (
        <Toast
          message={RETURN_MESSAGES[returned]}
          onDone={() => router.replace("/connexions")}
        />
      )}
      {returnedReason && REFUSAL_MESSAGES[returnedReason] && (
        <p className="error">{REFUSAL_MESSAGES[returnedReason]}</p>
      )}
      <h1>Comptes connectés</h1>
      <p>
        Connecte tes comptes : Viewzo relève lui-même les vues de tes
        publications, sans capture d’écran, et ta validation va plus vite.
      </p>
      {items.map((c) => (
        <div key={c.network} className="line">
          <span>
            <strong>{NETWORK_LABELS[c.network]}</strong>
            <br />
            <small>
              {c.connected
                ? `Connecté${c.handle ? ` : ${c.handle}` : ""}`
                : c.available
                  ? "Non connecté"
                  : "Bientôt disponible"}
            </small>
            {c.lastError && (
              <>
                <br />
                <small className="error">{c.lastError}</small>
              </>
            )}
          </span>
          {c.connected ? (
            <button className="secondary" disabled={busy} onClick={() => disconnect(c.network)}>
              Déconnecter
            </button>
          ) : (
            <button disabled={busy || !c.available} onClick={() => connect(c.network)}>
              Connecter
            </button>
          )}
        </div>
      ))}
      <p className="hint">
        YouTube, X et Telegram n’ont pas besoin de connexion : leurs vues sont
        publiques. Pour un statut WhatsApp, envoie tes captures dans tes
        résultats.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
