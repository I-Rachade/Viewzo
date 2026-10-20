"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  formatFcfa,
  LIVE_STATUS_LABELS,
  LIVE_STATUS_TONES,
  LiveProduct,
  LiveSale,
  liveApi,
} from "@/lib/api";
import { LoadingCard } from "../loading-card";
import { useRequireUser } from "../_shell/session";
import { isUnavailable, UNAVAILABLE } from "./unavailable";

const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

// "datetime-local" value for one hour from now, in the browser's time zone.
function inAnHour() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

type Sale = LiveSale & { _count: { leads: number } };

// Seller's side of "Vente en live TikTok": the catalogue and the lives.
export default function LivePage() {
  const user = useRequireUser();
  const [products, setProducts] = useState<LiveProduct[] | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      Promise.all([liveApi.products(), liveApi.sales()])
        .then(([p, s]) => {
          setProducts(p);
          setSales(s);
        })
        .catch((e) => {
          if (isUnavailable(e)) setOff(true);
          else setError((e as Error).message);
        }),
    [],
  );

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <LoadingCard />;
  if (off) {
    return (
      <div className="card">
        <h1>Ventes en live</h1>
        <p>{UNAVAILABLE}</p>
        <Link className="button secondary" href="/dashboard">
          Tableau de bord
        </Link>
      </div>
    );
  }
  if (!user.profiles.some((p) => p.type === "ADVERTISER")) {
    return (
      <div className="card">
        <h1>Ventes en live</h1>
        <p>Active le profil Annonceur pour vendre en live sur TikTok.</p>
        <Link className="button" href="/dashboard">
          Activer le profil
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="card wide">
        <h1>Ventes en live</h1>
        <p className="hint">
          Pendant ton live TikTok, Viewzo lit les commentaires, repère qui veut
          acheter et prépare le panier de chaque acheteur.
        </p>
        {error && <p className="error">{error}</p>}
        <NewLive products={products ?? []} busy={busy} act={act} />
        {sales === null && !error && <div className="skeleton" />}
        {sales?.length === 0 && <p>Aucun live pour l’instant.</p>}
        <div className="stagger" style={{ display: "grid", gap: 12 }}>
          {sales?.map((s) => (
            <article key={s.id} className="campaign">
              <header>
                <strong>{s.title}</strong>
                <span className={`pill ${LIVE_STATUS_TONES[s.status]}`}>
                  {LIVE_STATUS_LABELS[s.status]}
                </span>
              </header>
              <p>
                @{s.tiktokUsername} · {DATE.format(new Date(s.scheduledAt))}
                {s.demo ? " · démo" : ""} · {s._count.leads} intéressé
                {s._count.leads > 1 ? "s" : ""}
              </p>
              {s.cancelReason && <p className="error">{s.cancelReason}</p>}
              <Link className="button secondary" href={`/live/${s.id}`}>
                {s.status === "SCHEDULED"
                  ? "Ouvrir pour commencer"
                  : s.status === "RUNNING"
                    ? "Suivre le live"
                    : "Voir le bilan"}
              </Link>
            </article>
          ))}
        </div>
      </div>
      <Catalogue products={products} busy={busy} act={act} />
    </>
  );
}

interface Act {
  busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<boolean>;
}

function NewLive({ products, busy, act }: Act & { products: LiveProduct[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [when, setWhen] = useState(inAnHour);
  const [demo, setDemo] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const active = products.filter((p) => p.active);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await act(() =>
      liveApi.create({
        title,
        tiktokUsername: username,
        scheduledAt: new Date(when).toISOString(),
        demo,
        productIds: chosen,
      }),
    );
    if (ok) {
      setOpen(false);
      setTitle("");
      setChosen([]);
    }
  }

  if (!open) {
    return (
      <button className="coral" onClick={() => setOpen(true)}>
        Planifier un live
      </button>
    );
  }
  return (
    <form className="summary" onSubmit={submit}>
      <label>
        Titre
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Vente pagnes du samedi"
          minLength={3}
          maxLength={80}
          required
        />
      </label>
      <label>
        Compte TikTok qui fait le live
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="@maboutique"
          pattern="@?[A-Za-z0-9._]{2,24}"
          required
        />
      </label>
      <label>
        Date et heure
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          required
        />
      </label>
      {active.length > 0 && (
        <fieldset>
          <legend>Produits du live (aucun coché : tout le catalogue)</legend>
          <div className="chips">
            {active.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`chip${chosen.includes(p.id) ? " selected" : ""}`}
                aria-pressed={chosen.includes(p.id)}
                onClick={() =>
                  setChosen((c) =>
                    c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id],
                  )
                }
              >
                {p.name}
                <small>{formatFcfa(p.price)}</small>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={demo}
          onChange={(e) => setDemo(e.target.checked)}
        />
        Live de démonstration (commentaires d’exemple, pour essayer)
      </label>
      <div className="actions">
        <button disabled={busy}>Planifier</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function Catalogue({
  products,
  busy,
  act,
}: Act & { products: LiveProduct[] | null }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    const ok = await act(() =>
      liveApi.addProduct({
        name,
        price: Number(price),
        stock: stock === "" ? null : Number(stock),
      }),
    );
    if (ok) {
      setName("");
      setPrice("");
      setStock("");
    }
  }

  return (
    <div className="card wide">
      <h2>Mon catalogue</h2>
      <p className="hint">
        Les acheteurs citent ces produits dans les commentaires ; le stock
        baisse à chaque panier.
      </p>
      <form className="row" onSubmit={add}>
        <label>
          Produit
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pagne wax 6 yards"
            minLength={2}
            maxLength={120}
            required
          />
        </label>
        <label>
          Prix (FCFA)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </label>
        <label>
          Stock (vide : illimité)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
        </label>
        <button disabled={busy}>Ajouter</button>
      </form>
      {products === null && <div className="skeleton" />}
      {products?.length === 0 && <p>Aucun produit pour l’instant.</p>}
      {products?.map((p) => (
        <div className="line" key={p.id}>
          <span>
            {p.name}
            {!p.active && <span className="pill neutral">Masqué</span>}
            <br />
            <small>
              {formatFcfa(p.price)} ·{" "}
              {p.stock == null ? "stock illimité" : `${p.stock} en stock`}
            </small>
          </span>
          <span className="actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(() => liveApi.updateProduct(p.id, { active: !p.active }))
              }
            >
              {p.active ? "Masquer" : "Afficher"}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Supprimer « ${p.name} » ?`)) {
                  act(() => liveApi.deleteProduct(p.id));
                }
              }}
            >
              Supprimer
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
