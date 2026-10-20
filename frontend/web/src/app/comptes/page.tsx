"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ACCOUNT_STATUS_LABELS,
  AccountStatus,
  accountsApi,
  MyAccount,
  NETWORK_LABELS,
  SocialNetwork,
} from "@/lib/api";
import { LoadingCard } from "../loading-card";
import { Toast } from "../toast";
import { useRequireUser } from "../_shell/session";

const DAY = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const NETWORKS = Object.keys(NETWORK_LABELS) as SocialNetwork[];

const TONES: Record<AccountStatus, string> = {
  PENDING: "",
  ELIGIBLE: "paid",
  NEEDS_FIX: "pending",
  NOT_ELIGIBLE: "refused",
  SUSPENDED: "refused",
};

const canResubmit = (a: MyAccount) =>
  a.status === "NEEDS_FIX" ||
  (a.status === "NOT_ELIGIBLE" &&
    (!a.retryAfter || new Date(a.retryAfter) <= new Date()));

const canRemove = (a: MyAccount) =>
  a.status !== "SUSPENDED" &&
  !(a.status === "NOT_ELIGIBLE" && a.retryAfter && new Date(a.retryAfter) > new Date());

// "Mes comptes": the creator adds an account by hand and the team checks it.
export default function AccountsPage() {
  const user = useRequireUser();
  const [items, setItems] = useState<MyAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(
    () => accountsApi.list().then(setItems, (e) => setError((e as Error).message)),
    [],
  );

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      if (done) setToast(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!items) return error ? <p className="error">{error}</p> : <LoadingCard />;

  const taken = new Set(items.map((a) => a.network));
  const free = NETWORKS.filter((n) => !taken.has(n));
  return (
    <div className="card wide">
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <h1>Mes comptes</h1>
      <p>
        Ajoute les comptes sur lesquels tu publies. L’équipe Viewzo les vérifie
        sous 48 h ; tu reçois les tâches d’un réseau dès que ton compte y est
        éligible.
      </p>
      {adding ? (
        <AddAccountForm
          networks={free}
          phone={user?.phone ?? ""}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            const ok = await run(
              () => accountsApi.add(input),
              "Compte ajouté : il part en vérification.",
            );
            if (ok) setAdding(false);
          }}
        />
      ) : (
        free.length > 0 && (
          <button onClick={() => setAdding(true)}>Ajouter un compte</button>
        )
      )}
      {error && <p className="error">{error}</p>}
      {items.length === 0 && !adding && (
        <p className="hint">
          Aucun compte pour l’instant. Un seul suffit pour commencer.
        </p>
      )}
      <div className="stack stagger">
        {items.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            busy={busy}
            onResubmit={() =>
              run(() => accountsApi.resubmit(a.id), "Vérification relancée.")
            }
            onRemove={() => {
              if (
                window.confirm(
                  `Retirer ${NETWORK_LABELS[a.network]} ? Tu ne recevras plus de tâches pour ce réseau.`,
                )
              ) {
                void run(() => accountsApi.remove(a.id), "Compte retiré.");
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function AddAccountForm({
  networks,
  phone,
  busy,
  onCancel,
  onSubmit,
}: {
  networks: SocialNetwork[];
  phone: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    network: SocialNetwork;
    handle: string;
    followers?: number;
    notAnonymous: boolean;
  }) => void;
}) {
  const [network, setNetwork] = useState<SocialNetwork>(networks[0]);
  const isStatus = network === "WHATSAPP_STATUS";
  const [handle, setHandle] = useState(isStatus ? phone : "");
  const [followers, setFollowers] = useState("");
  const [notAnonymous, setNotAnonymous] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      network,
      handle: handle.trim(),
      ...(followers ? { followers: Number(followers) } : {}),
      notAnonymous,
    });
  }

  return (
    <form className="summary" onSubmit={submit}>
      <h2>Ajouter un compte</h2>
      <div className="row">
        <label>
          Réseau
          <select
            value={network}
            onChange={(e) => {
              const next = e.target.value as SocialNetwork;
              setNetwork(next);
              setHandle(next === "WHATSAPP_STATUS" ? phone : "");
            }}
          >
            {networks.map((n) => (
              <option key={n} value={n}>
                {NETWORK_LABELS[n]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {isStatus ? "Numéro WhatsApp" : "Nom du compte ou lien du profil"}
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={isStatus ? "+228 90 00 00 00" : "@moncompte"}
            inputMode={isStatus ? "tel" : "url"}
            minLength={2}
            maxLength={200}
            required
          />
        </label>
      </div>
      <label>
        {isStatus
          ? "Vues moyennes par statut (facultatif)"
          : "Nombre d’abonnés (facultatif)"}
        <input
          type="number"
          min={0}
          value={followers}
          onChange={(e) => setFollowers(e.target.value)}
          placeholder="L’équipe le vérifie"
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={notAnonymous}
          onChange={(e) => setNotAnonymous(e.target.checked)}
          required
        />
        Ce compte est à moi et n’est pas anonyme (mon nom ou ma photo y sont
        visibles).
      </label>
      <p className="hint">
        Un compte par réseau. Les comptes anonymes sont refusés.
      </p>
      <div className="actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Annuler
        </button>
        <button disabled={busy || !notAnonymous || handle.trim().length < 2}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}

function AccountCard({
  account: a,
  busy,
  onResubmit,
  onRemove,
}: {
  account: MyAccount;
  busy: boolean;
  onResubmit: () => void;
  onRemove: () => void;
}) {
  const audience = a.network === "WHATSAPP_STATUS" ? a.avgStatusViews : a.followers;
  return (
    <article className="campaign">
      <header>
        <span>
          <strong>{NETWORK_LABELS[a.network]}</strong>
          <br />
          <small className="hint">
            {a.network === "WHATSAPP_STATUS" ? a.handle : `@${a.handle}`}
          </small>
        </span>
        <span className={`pill ${TONES[a.status]}`}>
          {ACCOUNT_STATUS_LABELS[a.status]}
        </span>
      </header>
      <StatusDetails account={a} />
      {audience !== null ? (
        <p className="hint">
          {audience.toLocaleString("fr-FR")}{" "}
          {a.network === "WHATSAPP_STATUS" ? "vues par statut" : "abonnés"}
        </p>
      ) : (
        a.declaredFollowers !== null && (
          <p className="hint">
            {a.declaredFollowers.toLocaleString("fr-FR")} déclarés, à confirmer
            par l’équipe
          </p>
        )
      )}
      {a.verification && <Verification verification={a.verification} />}
      {(canResubmit(a) || canRemove(a)) && (
        <div className="account-actions">
          {canRemove(a) && (
            <button className="secondary" disabled={busy} onClick={onRemove}>
              Retirer
            </button>
          )}
          {canResubmit(a) && (
            <button disabled={busy} onClick={onResubmit}>
              Relancer la vérification
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function StatusDetails({ account: a }: { account: MyAccount }) {
  switch (a.status) {
    case "PENDING":
      return a.reviewDueAt ? (
        <p>Réponse au plus tard le {DAY.format(new Date(a.reviewDueAt))}.</p>
      ) : null;
    case "ELIGIBLE":
      return <p>Tu reçois des tâches pour ce réseau.</p>;
    case "NEEDS_FIX":
      return <p>À faire : {a.statusReason ?? "voir le support"}</p>;
    case "NOT_ELIGIBLE":
      return (
        <>
          {a.statusReason && <p>Raison : {a.statusReason}</p>}
          {a.retryAfter && new Date(a.retryAfter) > new Date() && (
            <p>Nouvel essai possible le {DAY.format(new Date(a.retryAfter))}.</p>
          )}
        </>
      );
    case "SUSPENDED":
      return (
        <>
          {a.statusReason && <p>Motif : {a.statusReason}</p>}
          <p>Pour contester, contacte le support Viewzo.</p>
        </>
      );
  }
}

function Verification({
  verification: v,
}: {
  verification: NonNullable<MyAccount["verification"]>;
}) {
  const [copied, setCopied] = useState(false);
  const code = (
    <div className="line">
      <strong>{v.code}</strong>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          navigator.clipboard.writeText(v.code).then(() => setCopied(true))
        }
      >
        {copied ? "Copié" : "Copier"}
      </button>
    </div>
  );
  if (v.kind === "BIO_CODE") {
    return (
      <div className="summary">
        <p>Ajoute ce code dans la bio de ton compte pour prouver qu’il est à toi :</p>
        {code}
      </div>
    );
  }
  return (
    <div className="summary">
      <p>1. Enregistre le numéro Viewzo {v.contactNumber} dans tes contacts.</p>
      <p>2. Envoie-lui le message de vérification avec ton code :</p>
      {code}
      {v.whatsappLink && (
        <a className="button" href={v.whatsappLink} target="_blank" rel="noreferrer">
          Envoyer sur WhatsApp
        </a>
      )}
      <p>3. Un agent Viewzo t’enregistre à son tour pour voir tes statuts.</p>
    </div>
  );
}
