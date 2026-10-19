"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api, setToken } from "@/lib/api";

// SMS can take a few minutes to arrive, and every new code cancels the
// previous one, so asking again too early locks people out.
const RESEND_DELAY_MS = 2 * 60 * 1000;

interface SentCode {
  input: string;
  to: string;
  at: number;
}

function formatWait(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<SentCode | null>(null);
  const [enteringCode, setEnteringCode] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const waitMs = sent ? Math.max(0, sent.at + RESEND_DELAY_MS - now) : 0;
  const waiting = waitMs > 0;
  // Only the number that just got a code has to wait; a corrected number can
  // ask right away.
  const phoneLocked = waiting && sent?.input === phone.trim();

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function sendCode() {
    run(async () => {
      const res = await api.requestCode(phone);
      const at = Date.now();
      setSent({ input: phone.trim(), to: res.phone, at });
      setNow(at);
      setCode("");
      setEnteringCode(true);
    });
  }

  function requestCode(e: FormEvent) {
    e.preventDefault();
    sendCode();
  }

  function verifyCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const res = await api.verifyCode(phone, code);
      setToken(res.accessToken);
      router.push("/dashboard");
    });
  }

  return (
    <div className="card">
      <h1>Connexion</h1>
      {!enteringCode || !sent ? (
        <form className="card" onSubmit={requestCode}>
          <label>
            Numéro de téléphone
            <input
              type="tel"
              autoComplete="tel"
              placeholder="+228 90 12 34 56"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <button disabled={busy || phoneLocked}>
            {phoneLocked
              ? `Nouveau code dans ${formatWait(waitMs)}`
              : "Recevoir un code"}
          </button>
          {phoneLocked && (
            <button
              type="button"
              className="secondary"
              onClick={() => setEnteringCode(true)}
            >
              J&apos;ai déjà un code
            </button>
          )}
        </form>
      ) : (
        <form className="card" onSubmit={verifyCode}>
          <p>Code envoyé au {sent.to}.</p>
          <p className="hint">
            Le SMS peut mettre quelques minutes à arriver. Chaque nouveau code
            annule le précédent.
          </p>
          <label>
            Code à 6 chiffres
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <button disabled={busy}>Valider</button>
          <button
            type="button"
            className="secondary"
            disabled={busy || waiting}
            onClick={sendCode}
          >
            {waiting
              ? `Renvoyer le code dans ${formatWait(waitMs)}`
              : "Renvoyer le code"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setEnteringCode(false)}
          >
            Changer de numéro
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
