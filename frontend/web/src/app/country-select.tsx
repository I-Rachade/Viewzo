"use client";

import { useEffect, useId, useRef, useState } from "react";
import { countriesApi } from "@/lib/api";

const NAMES = new Intl.DisplayNames(["fr"], { type: "region" });

// Every country the API accepts (libphonenumber-js), for the back-office to
// pick new ones from.
export const WORLD_COUNTRIES = [
  "AC", "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AS", "AT", "AU",
  "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL",
  "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BW", "BY", "BZ", "CA", "CC", "CD",
  "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW",
  "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH",
  "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE",
  "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GT", "GU", "GW",
  "GY", "HK", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ",
  "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT",
  "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM",
  "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PR", "PS", "PT", "PW", "PY",
  "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH",
  "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY",
  "SZ", "TA", "TC", "TD", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR",
  "TT", "TV", "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VA", "VC", "VE", "VG",
  "VI", "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
];

/** "TG" → 🇹🇬 (two regional indicator letters). */
export function flagOf(code: string) {
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)),
  );
}

export function countryName(code: string) {
  try {
    return NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

let allowed: Promise<string[]> | null = null;

/** Countries enabled in the back-office, loaded once per page load. */
export function useAllowedCountries() {
  const [codes, setCodes] = useState<string[] | null>(null);
  useEffect(() => {
    allowed ??= countriesApi.enabled().catch((e) => {
      allowed = null;
      throw e;
    });
    let live = true;
    allowed.then((c) => live && setCodes(c)).catch(() => live && setCodes([]));
    return () => {
      live = false;
    };
  }, []);
  return codes;
}

/** Forgets the cached list after the back-office changed it. */
export function reloadAllowedCountries() {
  allowed = null;
}

type Props = {
  id?: string;
  // Defaults to the countries enabled in the back-office.
  options?: string[];
  // Shown closed when nothing is chosen, and as the first option in single mode.
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
};

/** One country: closed it shows only the flag, open the flag and the name. */
export function CountrySelect({
  value,
  onChange,
  ...props
}: Props & { value: string; onChange: (code: string) => void }) {
  return (
    <CountryPicker
      {...props}
      value={value ? [value] : []}
      onChange={(codes) => onChange(codes[codes.length - 1] ?? "")}
    />
  );
}

/** Several countries: closed it shows the chosen flags side by side. */
export function CountryMultiSelect({
  value,
  onChange,
  ...props
}: Props & { value: string[]; onChange: (codes: string[]) => void }) {
  return <CountryPicker {...props} multiple value={value} onChange={onChange} />;
}

function CountryPicker({
  id,
  value,
  onChange,
  multiple = false,
  options,
  emptyLabel = "Choisir",
  required,
  disabled,
}: Props & {
  value: string[];
  onChange: (codes: string[]) => void;
  multiple?: boolean;
}) {
  const enabled = useAllowedCountries();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Opens leftwards when the trigger sits near the right edge of the screen.
  const [alignRight, setAlignRight] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Chosen countries stay listed even if switched off since, so they can be removed.
  const base = options ?? enabled ?? [];
  const codes = [...base, ...value.filter((c) => !base.includes(c))];
  const searchable = codes.length > 12;
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? codes.filter(
        (c) =>
          c.toLowerCase() === needle ||
          countryName(c).toLowerCase().includes(needle),
      )
    : codes;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function pick(code: string) {
    if (!multiple) {
      onChange(code ? [code] : []);
      setOpen(false);
      return;
    }
    onChange(
      value.includes(code) ? value.filter((c) => c !== code) : [...value, code],
    );
  }

  const title = value.map(countryName).join(", ") || emptyLabel;

  return (
    <div className="country-select" ref={root}>
      <button
        id={id}
        type="button"
        className="country-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        title={title}
        aria-label={title}
        disabled={disabled}
        onClick={() => {
          const box = root.current?.getBoundingClientRect();
          setAlignRight(!!box && box.left + 260 > window.innerWidth);
          setOpen((o) => !o);
        }}
      >
        <span className="country-flags">
          {value.length ? (
            value.map((c) => <span key={c}>{flagOf(c)}</span>)
          ) : (
            <span className="country-empty">{emptyLabel}</span>
          )}
        </span>
        <span aria-hidden className="country-chevron">
          ▾
        </span>
      </button>
      {required && (
        // Lets the browser refuse the form while nothing is chosen.
        <input
          className="country-required"
          tabIndex={-1}
          aria-hidden
          required
          value={value.join(",")}
          onChange={() => {}}
          onFocus={() => setOpen(true)}
        />
      )}
      {open && (
        <div
          className={`country-menu${alignRight ? " right" : ""}`}
          // Inside a <label>, a click would otherwise also toggle the trigger.
          onClick={(e) => e.preventDefault()}
        >
          {searchable && (
            <input
              autoFocus
              type="search"
              placeholder="Rechercher un pays"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <ul id={listId} role="listbox" aria-multiselectable={multiple}>
            {!multiple && !required && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value.length}
                  onClick={() => pick("")}
                >
                  <span className="country-option-flag">🌍</span>
                  {emptyLabel}
                </button>
              </li>
            )}
            {shown.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value.includes(c)}
                  onClick={() => pick(c)}
                >
                  <span className="country-option-flag">{flagOf(c)}</span>
                  {countryName(c)}
                  {value.includes(c) && <span className="country-check">✓</span>}
                </button>
              </li>
            ))}
            {enabled === null && !options && <li className="hint">Chargement…</li>}
            {(options || enabled !== null) && !shown.length && (
              <li className="hint">Aucun pays</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
