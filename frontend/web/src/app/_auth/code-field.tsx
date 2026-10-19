"use client";

import { formatWait } from "./use-resend";

// Six-digit code with the delay hint and a locked resend button.
export function CodeField({
  sentTo,
  value,
  onChange,
  waitMs,
  busy,
  onResend,
}: {
  sentTo: string;
  value: string;
  onChange: (value: string) => void;
  waitMs: number;
  busy: boolean;
  onResend: () => void;
}) {
  return (
    <>
      <p>Code envoyé à {sentTo}.</p>
      <p className="hint">
        Le code peut mettre quelques minutes à arriver. Chaque nouveau code
        annule le précédent.
      </p>
      <label>
        Code à 6 chiffres
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
      </label>
      <button
        type="button"
        className="secondary"
        disabled={busy || waitMs > 0}
        onClick={onResend}
      >
        {waitMs > 0
          ? `Renvoyer le code dans ${formatWait(waitMs)}`
          : "Renvoyer le code"}
      </button>
    </>
  );
}
