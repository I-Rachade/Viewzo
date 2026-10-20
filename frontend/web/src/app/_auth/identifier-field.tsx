"use client";

export type IdentifierKind = "email" | "phone";

// E-mail | Téléphone switch with the matching input.
export function IdentifierField({
  kind,
  onKindChange,
  value,
  onChange,
}: {
  kind: IdentifierKind;
  onKindChange: (kind: IdentifierKind) => void;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <div className="segmented" role="tablist">
        {(["email", "phone"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? "selected" : ""}
            onClick={() => {
              onKindChange(k);
              onChange("");
            }}
          >
            {k === "email" ? "E-mail" : "Téléphone"}
          </button>
        ))}
      </div>
      {kind === "email" ? (
        <label>
          Adresse e-mail
          <input
            type="email"
            autoComplete="email"
            placeholder="toi@exemple.com"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required
          />
        </label>
      ) : (
        <label>
          Numéro de téléphone
          <input
            type="tel"
            autoComplete="tel"
            placeholder="+228 90 12 34 56"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required
          />
        </label>
      )}
    </>
  );
}
