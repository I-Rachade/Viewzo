"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  IDENTITY_STATUS_LABELS,
  identityApi,
  IdentityStatusView,
} from "@/lib/api";
import { LoadingCard } from "../loading-card";
import { useRequireUser, useSession } from "../_shell/session";

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

// Photos are shrunk before sending so they go through on a mobile connection.
const MAX_SIDE = 1600;

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

type Slot = "front" | "back" | "selfie";

const SLOTS: { key: Slot; title: string; hint: string; selfie?: boolean }[] = [
  {
    key: "front",
    title: "1. Recto de la pièce",
    hint: "La pièce en entier, à plat, sans reflet.",
  },
  {
    key: "back",
    title: "2. Verso de la pièce",
    hint: "Facultatif pour un passeport.",
  },
  {
    key: "selfie",
    title: "3. Selfie",
    hint: "Ton visage de face, bien éclairé, sans lunettes ni casquette.",
    selfie: true,
  },
];

// Level 2: photos of the ID and a selfie, sent to the identity check right
// away; the team decides when the check can't decide alone.
export default function IdentityPage() {
  const user = useRequireUser();
  const { updateUser } = useSession();
  const [view, setView] = useState<IdentityStatusView | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<Slot, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<Slot, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setView(await identityApi.status()), []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [user, load]);

  // Free the preview images when they change or the page closes.
  useEffect(
    () => () =>
      Object.values(previews).forEach((url) => URL.revokeObjectURL(url)),
    [previews],
  );

  function pick(slot: Slot, file: File | undefined) {
    setError(null);
    setPhotos((p) => ({ ...p, [slot]: file }));
    setPreviews((p) => ({
      ...p,
      [slot]: file ? URL.createObjectURL(file) : undefined,
    }));
  }

  async function submit() {
    if (!photos.front || !photos.selfie) return;
    setBusy(true);
    setError(null);
    try {
      const [front, back, selfie] = await Promise.all([
        shrink(photos.front),
        photos.back ? shrink(photos.back) : undefined,
        shrink(photos.selfie),
      ]);
      await identityApi.submit({ front, back, selfie });
      setPhotos({});
      setPreviews({});
      await load();
      updateUser(await api.me());
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
            Le niveau 2 ouvre toutes les tâches et les retraits. Prends en photo
            ta pièce d’identité (carte, passeport ou permis), puis fais un
            selfie. La réponse arrive en quelques secondes.
          </p>
          <p className="hint">
            Pour tes retraits, le compte Mobile Money doit être à ton nom. Tes
            photos servent seulement à la vérification : Viewzo ne les garde
            pas.
          </p>

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
            <>
              {SLOTS.map((slot) => (
                <label key={slot.key}>
                  <strong>{slot.title}</strong>
                  <span className="hint" style={{ fontWeight: 400 }}>
                    {slot.hint}
                  </span>
                  {previews[slot.key] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previews[slot.key]}
                      alt=""
                      style={{
                        maxWidth: 240,
                        maxHeight: 160,
                        objectFit: "contain",
                        borderRadius: 8,
                      }}
                    />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture={slot.selfie ? "user" : "environment"}
                    disabled={busy}
                    onChange={(e) => pick(slot.key, e.target.files?.[0])}
                  />
                </label>
              ))}
              <div className="actions">
                <button
                  className="coral"
                  disabled={busy || !photos.front || !photos.selfie}
                  onClick={submit}
                >
                  {busy
                    ? "Vérification en cours…"
                    : "Envoyer pour vérification"}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
