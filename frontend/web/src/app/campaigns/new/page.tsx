"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  api,
  CampaignObjective,
  CampaignPackage,
  campaignsApi,
  CONTENT_TYPE_LABELS,
  ContentType,
  formatFcfa,
  getToken,
  NETWORK_LABELS,
  NoAssetsChoice,
  OBJECTIVE_LABELS,
  PACKAGE_LABELS,
  Quote,
  SocialNetwork,
  Unavailable,
  UserView,
} from "@/lib/api";
import { LoadingCard } from "../../loading-card";

// Content types that post or reuse the advertiser's own elements.
const NEEDS_ASSETS: ContentType[] = ["PROVIDED_ASSETS", "VIDEO_WITH_POSTERS"];

function lines(value: string) {
  return value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function reasonText(u: Unavailable) {
  return u.reason === "PACKAGE"
    ? `Package ${PACKAGE_LABELS[u.requiredPackage]} requis`
    : `Il manque ${formatFcfa(u.missingAmount)}`;
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserView | null>(null);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState<CampaignObjective>("AWARENESS");
  const [countries, setCountries] = useState("");
  const [cities, setCities] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pkg, setPkg] = useState<CampaignPackage>("BASIC");
  const [budget, setBudget] = useState(25000);
  // In the order the advertiser added them: the last ones stop fitting first.
  const [platforms, setPlatforms] = useState<SocialNetwork[]>([]);
  const [contentTypes, setContentTypes] = useState<
    Partial<Record<SocialNetwork, ContentType>>
  >({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [hasAssets, setHasAssets] = useState(true);
  const [assetUrls, setAssetUrls] = useState("");
  const [noAssetsChoice, setNoAssetsChoice] =
    useState<NoAssetsChoice>("CREATOR_VIDEOS");
  const [shipsProduct, setShipsProduct] = useState(false);
  const [productPickup, setProductPickup] = useState("");
  const [faceRequired, setFaceRequired] = useState(false);
  const [language, setLanguage] = useState("Français");
  const [minDuration, setMinDuration] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [tone, setTone] = useState("");
  const [mandatory, setMandatory] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [examples, setExamples] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api
      .me()
      .then((u) => {
        setUser(u);
        setCountries(u.country);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  // Live greying: ask the API what fits the package and budget.
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => {
      campaignsApi
        .quote(pkg, budget || 0, platforms)
        .then(setQuote)
        .catch((e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(timer);
  }, [user, pkg, budget, platforms]);

  if (!user) return <LoadingCard />;

  const advertiser = user.profiles.find((p) => p.type === "ADVERTISER");
  if (!advertiser) {
    return (
      <div className="card">
        <h1>Nouvelle campagne</h1>
        <p>Active d’abord le profil Annonceur depuis ton tableau de bord.</p>
        <Link className="button" href="/dashboard">
          Tableau de bord
        </Link>
      </div>
    );
  }
  const basicOnly = advertiser.level < 2;

  function toggle(network: SocialNetwork) {
    setPlatforms((current) =>
      current.includes(network)
        ? current.filter((n) => n !== network)
        : [...current, network],
    );
  }

  function contentOptions(network: SocialNetwork) {
    return (Object.keys(CONTENT_TYPE_LABELS) as ContentType[]).filter(
      (type) => {
        if (!hasAssets && NEEDS_ASSETS.includes(type)) return false;
        // WhatsApp statuses need ready-made elements or the studio.
        if (
          network === "WHATSAPP_STATUS" &&
          !hasAssets &&
          noAssetsChoice !== "STUDIO"
        ) {
          return false;
        }
        return true;
      },
    );
  }

  function contentTypeFor(network: SocialNetwork) {
    const options = contentOptions(network);
    const chosen = contentTypes[network];
    return chosen && options.includes(chosen) ? chosen : options[0];
  }

  const allocation = new Map(
    quote?.allocation.map((a) => [a.network, a.budget]) ?? [],
  );
  const overLimit = quote?.overLimit ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!platforms.length) {
      setError("Choisis au moins une plateforme");
      return;
    }
    if (overLimit.length) {
      setError("Retire les plateformes en rouge ou augmente le budget");
      return;
    }
    const missing = platforms.find((n) => !contentTypeFor(n));
    if (missing) {
      setError(
        `${NETWORK_LABELS[missing]} demande des éléments fournis ou le studio`,
      );
      return;
    }
    setBusy(true);
    campaignsApi
      .create({
        title,
        objective,
        countries: lines(countries).map((c) => c.toUpperCase()),
        cities: lines(cities),
        startsAt: new Date(`${startsAt}T00:00:00`).toISOString(),
        endsAt: new Date(`${endsAt}T23:59:59`).toISOString(),
        package: pkg,
        budget,
        platforms: platforms.map((network) => ({
          network,
          contentType: contentTypeFor(network)!,
        })),
        hasAssets,
        ...(hasAssets ? { assetUrls: lines(assetUrls) } : { noAssetsChoice }),
        shipsProduct,
        ...(shipsProduct && productPickup ? { productPickup } : {}),
        faceRequired,
        language,
        ...(minDuration ? { minDurationSec: Number(minDuration) } : {}),
        ...(maxDuration ? { maxDurationSec: Number(maxDuration) } : {}),
        ...(tone ? { tone } : {}),
        mandatoryElements: lines(mandatory),
        forbiddenElements: lines(forbidden),
        examples: lines(examples),
      })
      .then(() => router.push("/campaigns"))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }

  return (
    <form className="card wide" onSubmit={submit}>
      <h1>Nouvelle campagne</h1>

      <h2>La campagne</h2>
      <label>
        Nom de la campagne
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          minLength={3}
          maxLength={80}
          required
        />
      </label>
      <label>
        Objectif
        <select
          value={objective}
          onChange={(e) => setObjective(e.target.value as CampaignObjective)}
        >
          {(Object.keys(OBJECTIVE_LABELS) as CampaignObjective[]).map((o) => (
            <option key={o} value={o}>
              {OBJECTIVE_LABELS[o]}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label>
          Pays (codes, ex. TG, BJ)
          <input
            value={countries}
            onChange={(e) => setCountries(e.target.value)}
            required
          />
        </label>
        <label>
          Villes (facultatif)
          <input value={cities} onChange={(e) => setCities(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label>
          Début
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </label>
        <label>
          Fin
          <input
            type="date"
            value={endsAt}
            min={startsAt || undefined}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </label>
      </div>

      <h2>Package et budget</h2>
      <div className="row">
        <label>
          Package
          <select
            value={pkg}
            onChange={(e) => setPkg(e.target.value as CampaignPackage)}
          >
            {(Object.keys(PACKAGE_LABELS) as CampaignPackage[]).map((p) => (
              <option key={p} value={p} disabled={basicOnly && p !== "BASIC"}>
                {PACKAGE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Budget (FCFA)
          <input
            type="number"
            min={1}
            value={budget || ""}
            onChange={(e) => setBudget(Number(e.target.value))}
            required
          />
        </label>
      </div>
      {basicOnly && (
        <p className="hint">
          Au niveau 1, seul le package Basique est disponible, jusqu’à{" "}
          {formatFcfa(100000)} par mois.
        </p>
      )}

      <h2>Plateformes</h2>
      <div className="chips">
        {quote?.options.map((o) => {
          const over = overLimit.includes(o.network);
          return (
            <button
              type="button"
              key={o.network}
              className={`chip${o.selected ? " selected" : ""}${over ? " over" : ""}`}
              disabled={!o.selected && o.unavailable !== null}
              onClick={() => toggle(o.network)}
              title={o.unavailable ? reasonText(o.unavailable) : undefined}
            >
              {o.selected ? "✓ " : ""}
              {NETWORK_LABELS[o.network]}
              <small>
                {o.unavailable && (!o.selected || over)
                  ? reasonText(o.unavailable)
                  : `dès ${formatFcfa(o.minBudget)}`}
              </small>
            </button>
          );
        })}
      </div>
      {overLimit.length > 0 && (
        <p className="error">
          {overLimit.map((n) => NETWORK_LABELS[n]).join(", ")} ne rentre plus
          dans le package ou le budget.
        </p>
      )}

      <h2>Éléments fournis</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={hasAssets}
          onChange={(e) => setHasAssets(e.target.checked)}
        />
        J’ai des éléments à mettre à disposition (vidéos, affiches)
      </label>
      {hasAssets ? (
        <label>
          Liens vers les éléments (un par ligne)
          <textarea
            value={assetUrls}
            onChange={(e) => setAssetUrls(e.target.value)}
            placeholder="https://drive.google.com/…"
            required
          />
        </label>
      ) : (
        <label>
          Sans éléments, qui crée les vidéos ?
          <select
            value={noAssetsChoice}
            onChange={(e) =>
              setNoAssetsChoice(e.target.value as NoAssetsChoice)
            }
          >
            <option value="CREATOR_VIDEOS">Les créateurs</option>
            <option value="STUDIO">Le studio Viewzo</option>
          </select>
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={shipsProduct}
          onChange={(e) => setShipsProduct(e.target.checked)}
        />
        J’envoie un produit aux créateurs
      </label>
      {shipsProduct && (
        <label>
          Où récupérer le produit
          <input
            value={productPickup}
            onChange={(e) => setProductPickup(e.target.value)}
            maxLength={300}
          />
        </label>
      )}

      {platforms.length > 0 && (
        <>
          <h2>Contenu par plateforme</h2>
          {platforms.map((network) => (
            <label key={network}>
              {NETWORK_LABELS[network]}
              {allocation.has(network) &&
                ` (${formatFcfa(allocation.get(network)!)})`}
              <select
                value={contentTypeFor(network) ?? ""}
                onChange={(e) =>
                  setContentTypes((c) => ({
                    ...c,
                    [network]: e.target.value as ContentType,
                  }))
                }
              >
                {contentOptions(network).map((type) => (
                  <option key={type} value={type}>
                    {CONTENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </>
      )}

      <h2>Consignes</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={faceRequired}
          onChange={(e) => setFaceRequired(e.target.checked)}
        />
        Le créateur doit montrer son visage
      </label>
      <div className="row">
        <label>
          Langue
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            minLength={2}
            maxLength={40}
            required
          />
        </label>
        <label>
          Ton (facultatif)
          <input
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            maxLength={100}
          />
        </label>
      </div>
      <div className="row">
        <label>
          Durée min. (secondes)
          <input
            type="number"
            min={1}
            max={3600}
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
          />
        </label>
        <label>
          Durée max. (secondes)
          <input
            type="number"
            min={1}
            max={3600}
            value={maxDuration}
            onChange={(e) => setMaxDuration(e.target.value)}
          />
        </label>
      </div>
      <label>
        Éléments obligatoires (un par ligne)
        <textarea
          value={mandatory}
          onChange={(e) => setMandatory(e.target.value)}
        />
      </label>
      <label>
        Éléments interdits (un par ligne)
        <textarea
          value={forbidden}
          onChange={(e) => setForbidden(e.target.value)}
        />
      </label>
      <label>
        Exemples de vidéos (liens, un par ligne)
        <textarea
          value={examples}
          onChange={(e) => setExamples(e.target.value)}
        />
      </label>

      <div className="summary">
        <strong>Récapitulatif</strong>
        <p>Budget : {formatFcfa(budget || 0)}</p>
        <p>
          Minimum pour ces plateformes : {formatFcfa(quote?.minBudget ?? 0)}
        </p>
        {quote && quote.estimatedViews > 0 && (
          <p>
            Environ {quote.estimatedViews.toLocaleString("fr-FR")} vues
            (éléments fournis, moins avec une création)
          </p>
        )}
        <p className="hint">
          La campagne est vérifiée par l’équipe Viewzo avant d’être visible par
          les créateurs.
        </p>
      </div>

      {error && <p className="error">{error}</p>}
      <button disabled={busy}>Envoyer pour vérification</button>
      <Link className="button secondary" href="/campaigns">
        Annuler
      </Link>
    </form>
  );
}
