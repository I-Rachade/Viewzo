"use client";

import { FormEvent, useState } from "react";
import { countriesApi } from "@/lib/api";
import {
  countryName,
  CountrySelect,
  flagOf,
  reloadAllowedCountries,
  WORLD_COUNTRIES,
} from "../../country-select";
import { useQueue } from "./use-queue";

// Countries offered by every country picker on the web and in the app.
export function CountriesSection() {
  const queue = useQueue(countriesApi.all, reloadAllowedCountries);
  const [code, setCode] = useState("");
  const listed = queue.items?.map((c) => c.code) ?? [];

  function add(e: FormEvent) {
    e.preventDefault();
    queue.act(async () => {
      await countriesApi.add(code);
      setCode("");
    });
  }

  return (
    <>
      <form className="row" onSubmit={add}>
        <label>
          Pays à ouvrir
          <CountrySelect
            value={code}
            onChange={setCode}
            options={WORLD_COUNTRIES.filter((c) => !listed.includes(c))}
            emptyLabel="Choisir un pays"
            required
          />
        </label>
        <button disabled={queue.busy || !code}>Ajouter</button>
      </form>
      <p className="hint">
        Seuls les pays actifs sont proposés à l’inscription, dans les campagnes,
        les compétences et les filtres du back-office.
      </p>
      {queue.error && <p className="error">{queue.error}</p>}
      {queue.items?.map((c) => (
        <div className="line" key={c.code}>
          <span>
            <span className="country-option-flag">{flagOf(c.code)}</span>{" "}
            {countryName(c.code)}
            <br />
            <small>
              {c.code} · {c.enabled ? "actif" : "désactivé"}
            </small>
          </span>
          <button
            className="secondary"
            disabled={queue.busy}
            onClick={() => queue.act(() => countriesApi.set(c.code, !c.enabled))}
          >
            {c.enabled ? "Désactiver" : "Réactiver"}
          </button>
        </div>
      ))}
    </>
  );
}
