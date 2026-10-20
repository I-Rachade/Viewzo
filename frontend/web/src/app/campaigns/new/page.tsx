"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, FormEvent, Suspense, useEffect, useState } from "react";
import {
  api,
  CampaignFile,
  CampaignInput,
  CampaignObjective,
  CampaignPackage,
  campaignsApi,
  CONTENT_CASE_LABELS,
  CONTENT_TYPE_LABELS,
  ContentCase,
  ContentType,
  CampaignStatus,
  formatFcfa,
  hasSession,
  NETWORK_LABELS,
  NoAssetsChoice,
  OBJECTIVE_LABELS,
  PACKAGE_LABELS,
  Quote,
  SocialNetwork,
  Unavailable,
  UserView,
} from "@/lib/api";
import { CountryMultiSelect } from "../../country-select";
import { LoadingCard } from "../../loading-card";

// Content types that post the advertiser's ready content, or reuse material.
const NEEDS_READY: ContentType[] = ["PROVIDED_ASSETS"];
const NEEDS_MATERIAL: ContentType[] = ["VIDEO_WITH_POSTERS"];

const KIND_LABELS: Record<CampaignFile["kind"], string> = {
  IMAGE: "Image",
  VIDEO: "Vidéo",
  AUDIO: "Audio",
  PDF: "PDF",
};

function sizeText(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

const day = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
  return (
    <Suspense fallback={<LoadingCard />}>
      <CampaignForm />
    </Suspense>
  );
}

// Creates a campaign, or changes one that is not paid yet (?id=…).
function CampaignForm() {
  const router = useRouter();
  const editId = useSearchParams().get("id");
  const [editStatus, setEditStatus] = useState<CampaignStatus | null>(null);
  const [user, setUser] = useState<UserView | null>(null);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState<CampaignObjective>("AWARENESS");
  const [countries, setCountries] = useState<string[]>([]);
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
  const [contentCase, setContentCase] = useState<ContentCase>("READY");
  const [files, setFiles] = useState<CampaignFile[]>([]);
  const [briefFiles, setBriefFiles] = useState<CampaignFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assetUrls, setAssetUrls] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [callToAction, setCallToAction] = useState("");
  const [caption, setCaption] = useState("");
  const [sound, setSound] = useState("");
  const [productDetails, setProductDetails] = useState("");
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

  function fill(c: Awaited<ReturnType<typeof campaignsApi.get>>) {
    setEditStatus(c.status);
    setTitle(c.title);
    setObjective(c.objective);
    setCountries(c.countries);
    setCities(c.cities.join(", "));
    setStartsAt(day(c.startsAt));
    setEndsAt(day(c.endsAt));
    setPkg(c.package);
    setBudget(c.budget);
    setPlatforms(c.platforms.map((p) => p.network));
    setContentTypes(
      Object.fromEntries(c.platforms.map((p) => [p.network, p.contentType])),
    );
    setContentCase(c.contentCase);
    setFiles(c.files.filter((f) => f.purpose === "ASSET"));
    setBriefFiles(c.files.filter((f) => f.purpose === "BRIEF"));
    setAssetUrls(c.assetUrls.join("\n"));
    if (c.noAssetsChoice) setNoAssetsChoice(c.noAssetsChoice);
    setKeyMessage(c.keyMessage ?? "");
    setCallToAction(c.callToAction ?? "");
    setCaption(c.caption ?? "");
    setSound(c.sound ?? "");
    setProductDetails(c.productDetails ?? "");
    setShipsProduct(c.shipsProduct);
    setProductPickup(c.productPickup ?? "");
    setFaceRequired(c.faceRequired);
    setLanguage(c.language);
    setMinDuration(c.minDurationSec ? String(c.minDurationSec) : "");
    setMaxDuration(c.maxDurationSec ? String(c.maxDurationSec) : "");
    setTone(c.tone ?? "");
    setMandatory(c.mandatoryElements.join("\n"));
    setForbidden(c.forbiddenElements.join("\n"));
    setExamples(c.examples.join("\n"));
  }

  useEffect(() => {
    if (!hasSession()) {
      router.replace("/login");
      return;
    }
    api
      .me()
      .then(async (u) => {
        if (editId) {
          fill(await campaignsApi.get(editId));
        } else {
          setCountries([u.country]);
        }
        setUser(u);
      })
      .catch((e) =>
        editId ? setError((e as Error).message) : router.replace("/login"),
      );
  }, [router, editId]);

  async function addFiles(
    e: ChangeEvent<HTMLInputElement>,
    purpose: CampaignFile["purpose"],
  ) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of picked) {
        const saved = await campaignsApi.uploadFile(file, purpose);
        (purpose === "BRIEF" ? setBriefFiles : setFiles)((list) => [
          ...list,
          saved,
        ]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

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
        if (contentCase !== "READY" && NEEDS_READY.includes(type)) {
          return false;
        }
        if (contentCase === "NONE" && NEEDS_MATERIAL.includes(type)) {
          return false;
        }
        // WhatsApp statuses need ready-made content or the studio.
        if (
          network === "WHATSAPP_STATUS" &&
          contentCase !== "READY" &&
          (contentCase !== "NONE" || noAssetsChoice !== "STUDIO")
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

  function input(draft: boolean): CampaignInput {
    const none = contentCase === "NONE";
    const text = (v: string) => (v.trim() ? v.trim() : undefined);
    return {
      title,
      objective,
      countries,
      cities: lines(cities),
      startsAt: new Date(`${startsAt}T00:00:00`).toISOString(),
      endsAt: new Date(`${endsAt}T23:59:59`).toISOString(),
      package: pkg,
      budget,
      platforms: platforms.map((network) => ({
        network,
        contentType: contentTypeFor(network)!,
      })),
      draft,
      contentCase,
      ...(none
        ? { noAssetsChoice }
        : { fileIds: files.map((f) => f.id), assetUrls: lines(assetUrls) }),
      briefFileIds: briefFiles.map((f) => f.id),
      keyMessage,
      callToAction: text(callToAction),
      caption: text(caption),
      sound: text(sound),
      productDetails: text(productDetails),
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
    };
  }

  // draft: keep it to come back later; otherwise it goes on to the payment.
  async function save(e: FormEvent, draft: boolean) {
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
        `${NETWORK_LABELS[missing]} demande un contenu prêt ou le studio`,
      );
      return;
    }
    if (contentCase !== "NONE" && !files.length && !lines(assetUrls).length) {
      setError(
        contentCase === "READY"
          ? "Ajoute les fichiers à publier"
          : "Ajoute la matière que tu fournis : logo, photos, rushes",
      );
      return;
    }
    setBusy(true);
    try {
      if (editId) {
        await campaignsApi.update(editId, input(draft));
        if (!draft && editStatus === "DRAFT") await campaignsApi.send(editId);
      } else {
        await campaignsApi.create(input(draft));
      }
      router.push("/campaigns");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card wide" onSubmit={(e) => save(e, false)}>
      <h1>{editId ? "Modifier la campagne" : "Nouvelle campagne"}</h1>

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
          Pays
          <CountryMultiSelect
            value={countries}
            onChange={setCountries}
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

      <h2>Ton contenu</h2>
      <div className="chips">
        {(Object.keys(CONTENT_CASE_LABELS) as ContentCase[]).map((c) => (
          <button
            type="button"
            key={c}
            className={`chip${contentCase === c ? " selected" : ""}`}
            onClick={() => setContentCase(c)}
          >
            {contentCase === c ? "✓ " : ""}
            {CONTENT_CASE_LABELS[c].title}
            <small>{CONTENT_CASE_LABELS[c].hint}</small>
          </button>
        ))}
      </div>
      {contentCase === "NONE" ? (
        <label>
          Qui crée les vidéos ?
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
      ) : (
        <>
          <label>
            {contentCase === "READY"
              ? "Fichiers à publier"
              : "Ta matière : logo, photos, rushes"}
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,audio/*,application/pdf"
              disabled={uploading}
              onChange={(e) => addFiles(e, "ASSET")}
            />
          </label>
          <p className="hint">
            Images et PDF jusqu’à 10 Mo, audio 20 Mo, vidéos 100 Mo. Plus
            lourd : mets un lien ci-dessous.
          </p>
          <FileList
            files={files}
            onRemove={(id) => setFiles((l) => l.filter((f) => f.id !== id))}
          />
          <label>
            Liens (facultatif, un par ligne)
            <textarea
              value={assetUrls}
              onChange={(e) => setAssetUrls(e.target.value)}
              placeholder="https://drive.google.com/…"
            />
          </label>
        </>
      )}
      {uploading && <p className="hint">Envoi en cours…</p>}

      <h2>Le brief</h2>
      <label>
        Message clé
        <textarea
          value={keyMessage}
          onChange={(e) => setKeyMessage(e.target.value)}
          placeholder="Ce que les gens doivent retenir, en une phrase"
          minLength={3}
          maxLength={300}
          required
        />
      </label>
      <label>
        Brief vocal ou vidéo (facultatif)
        <input
          type="file"
          accept="audio/*,video/mp4,video/quicktime,video/webm"
          disabled={uploading || briefFiles.length >= 2}
          onChange={(e) => addFiles(e, "BRIEF")}
        />
      </label>
      <FileList
        files={briefFiles}
        onRemove={(id) => setBriefFiles((l) => l.filter((f) => f.id !== id))}
      />
      <div className="row">
        <label>
          Appel à l’action (facultatif)
          <input
            value={callToAction}
            onChange={(e) => setCallToAction(e.target.value)}
            placeholder="Commande sur WhatsApp au…"
            maxLength={120}
          />
        </label>
        <label>
          Son ou musique (facultatif)
          <input
            value={sound}
            onChange={(e) => setSound(e.target.value)}
            placeholder="Nom ou lien du son"
            maxLength={200}
          />
        </label>
      </div>
      <label>
        Légende à mettre sous la publication (facultatif)
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={500}
        />
      </label>
      <label>
        Le produit (facultatif)
        <textarea
          value={productDetails}
          onChange={(e) => setProductDetails(e.target.value)}
          placeholder="Nom, prix, où l’acheter, ce qui le rend unique"
          maxLength={500}
        />
      </label>
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
          Une fois payée, la campagne est vérifiée par l’équipe Viewzo avant
          d’être visible par les créateurs.
        </p>
      </div>

      {error && <p className="error">{error}</p>}
      <button disabled={busy || uploading}>
        {editStatus === "PENDING_PAYMENT"
          ? "Enregistrer"
          : "Continuer vers le paiement"}
      </button>
      {editStatus !== "PENDING_PAYMENT" && (
        <button
          type="button"
          className="secondary"
          disabled={busy || uploading}
          onClick={(e) => save(e, true)}
        >
          Enregistrer en brouillon
        </button>
      )}
      <Link className="button secondary" href="/campaigns">
        Annuler
      </Link>
    </form>
  );
}

function FileList({
  files,
  onRemove,
}: {
  files: CampaignFile[];
  onRemove: (id: string) => void;
}) {
  if (!files.length) return null;
  return (
    <ul className="files">
      {files.map((f) => (
        <li key={f.id}>
          <a href={f.url} target="_blank" rel="noreferrer">
            {f.name}
          </a>{" "}
          <small>
            {KIND_LABELS[f.kind]} · {sizeText(f.sizeBytes)}
          </small>{" "}
          <button
            type="button"
            className="link"
            onClick={() => onRemove(f.id)}
          >
            Retirer
          </button>
        </li>
      ))}
    </ul>
  );
}
