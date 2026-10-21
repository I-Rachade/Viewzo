"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  formatFcfa,
  LIVE_STATUS_LABELS,
  LIVE_STATUS_TONES,
  LiveMode,
  LiveProduct,
  LiveSaleRow,
  liveApi,
} from "@/lib/api";
import { CountryMultiSelect } from "../country-select";
import { LoadingCard } from "../loading-card";
import { useRequireUser } from "../_shell/session";
import { isUnavailable, UNAVAILABLE } from "./unavailable";

const DATE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});
const DAY = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

// "datetime-local" value for a time from now, in the browser's time zone.
function local(hoursFromNow: number) {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

/** One line on who sells the offer and when. */
function sellers(s: LiveSaleRow) {
  if (s.mode === "SELF") {
    const own = s.sessions[0];
    return `Ton live @${own?.tiktokUsername ?? "?"} · ${DATE.format(new Date(s.startsAt))}`;
  }
  const taken = s.sessions.filter((x) =>
    ["INVITED", "ACCEPTED", "RUNNING", "ENDED"].includes(x.status),
  );
  const running = s.sessions.filter((x) => x.status === "RUNNING").length;
  return [
    `${DAY.format(new Date(s.startsAt))} → ${s.endsAt ? DAY.format(new Date(s.endsAt)) : "?"}`,
    `${taken.length}/${s.slots} créateur${s.slots > 1 ? "s" : ""}`,
    running ? `${running} en direct` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Seller's side of "Vente en live TikTok": the catalogue and the offers.
export default function LivePage() {
  const user = useRequireUser();
  const [products, setProducts] = useState<LiveProduct[] | null>(null);
  const [sales, setSales] = useState<LiveSaleRow[] | null>(null);
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
          Des créateurs TikTok vendent tes produits dans leurs lives. Viewzo lit
          les commentaires, repère les acheteurs et leur dit de t’écrire sur
          WhatsApp avec leur code. Tu livres et tu encaisses toi-même.
        </p>
        {error && <p className="error">{error}</p>}
        <NewLive
          products={products ?? []}
          country={user.country}
          busy={busy}
          act={act}
        />
        {sales === null && !error && <div className="skeleton" />}
        {sales?.length === 0 && <p>Aucune offre pour l’instant.</p>}
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
                {sellers(s)}
                {s.demo ? " · démo" : ""} · {s._count.leads} intéressé
                {s._count.leads > 1 ? "s" : ""}
              </p>
              {s.mode === "CREATORS" && (
                <p className="hint">
                  Budget {formatFcfa(s.budget)}
                  {s.spent > 0 ? ` · ${formatFcfa(s.spent)} payés` : ""}
                  {s.refunded > 0
                    ? ` · ${formatFcfa(s.refunded)} remboursés`
                    : ""}
                </p>
              )}
              {s.statusReason && <p className="error">{s.statusReason}</p>}
              <Link className="button secondary" href={`/live/${s.id}`}>
                {s.status === "PENDING_PAYMENT"
                  ? "Payer l’offre"
                  : s.sessions.some((x) => x.status === "RUNNING")
                    ? "Suivre le live"
                    : "Ouvrir"}
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

function NewLive({
  products,
  country,
  busy,
  act,
}: Act & { products: LiveProduct[]; country: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<LiveMode>("CREATORS");
  const [title, setTitle] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [from, setFrom] = useState(() => local(1));
  const [to, setTo] = useState(() => local(24 * 7));
  const [slots, setSlots] = useState("3");
  const [budget, setBudget] = useState("30000");
  const [countries, setCountries] = useState<string[]>([country]);
  const [username, setUsername] = useState("");
  const [demo, setDemo] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const active = products.filter((p) => p.active);
  const perPlace =
    Number(slots) > 0 ? Math.floor(Number(budget) / Number(slots)) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const base = {
      title,
      mode,
      whatsapp,
      startsAt: new Date(from).toISOString(),
      demo,
      productIds: chosen,
    };
    const ok = await act(() =>
      liveApi.create(
        mode === "SELF"
          ? { ...base, tiktokUsername: username }
          : {
              ...base,
              endsAt: new Date(to).toISOString(),
              slots: Number(slots),
              budget: Number(budget),
              countries,
            },
      ),
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
        Annoncer un live
      </button>
    );
  }
  return (
    <form className="summary" onSubmit={submit}>
      <div className="chips" role="radiogroup" aria-label="Qui fait le live">
        <button
          type="button"
          className={`chip${mode === "CREATORS" ? " selected" : ""}`}
          aria-pressed={mode === "CREATORS"}
          onClick={() => setMode("CREATORS")}
        >
          Des créateurs vendent pour moi
        </button>
        <button
          type="button"
          className={`chip${mode === "SELF" ? " selected" : ""}`}
          aria-pressed={mode === "SELF"}
          onClick={() => setMode("SELF")}
        >
          Je fais mon propre live
        </button>
      </div>
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
        Ton numéro WhatsApp
        <input
          type="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="+228 90 00 00 00"
          pattern="\+?[\d\s.\-]{8,20}"
          required
        />
        <small className="hint">
          Les acheteurs t’écrivent ici avec leur code. Tu livres et tu encaisses
          toi-même.
        </small>
      </label>
      {mode === "CREATORS" ? (
        <>
          <div className="row">
            <label>
              Du
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </label>
            <label>
              Au
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </label>
          </div>
          <p className="hint">
            Chaque créateur choisit son heure dans cette période.
          </p>
          <div className="row">
            <label>
              Nombre de créateurs
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={slots}
                onChange={(e) => setSlots(e.target.value)}
                required
              />
            </label>
            <label>
              Budget (FCFA)
              <input
                type="number"
                inputMode="numeric"
                min={1000}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                required
              />
            </label>
          </div>
          <label>
            Pays des créateurs
            <CountryMultiSelect
              value={countries}
              onChange={setCountries}
              required
            />
          </label>
          <p className="hint">
            Le budget est mis en séquestre. Chaque créateur est payé selon le
            nombre de spectateurs au plus fort de son live, au plus{" "}
            {formatFcfa(perPlace)}. Ce qui n’est pas dépensé revient sur ton
            solde.
          </p>
        </>
      ) : (
        <>
          <label>
            Ton compte TikTok
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
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </label>
          <p className="hint">
            Viewzo lit les commentaires de ton live pour un forfait, pris sur
            ton solde au début du live.
          </p>
        </>
      )}
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
                    c.includes(p.id)
                      ? c.filter((x) => x !== p.id)
                      : [...c, p.id],
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
        Live de démonstration (commentaires d’exemple, rien n’est payé)
      </label>
      <div className="actions">
        <button disabled={busy}>
          {mode === "CREATORS" ? "Créer l’offre" : "Planifier mon live"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setOpen(false)}
        >
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
