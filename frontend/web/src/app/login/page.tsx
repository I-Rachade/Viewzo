"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  function requestCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const res = await api.requestCode(phone);
      setSentTo(res.phone);
    });
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
      {sentTo === null ? (
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
          <button disabled={busy}>Recevoir un code</button>
        </form>
      ) : (
        <form className="card" onSubmit={verifyCode}>
          <p>Code envoyé au {sentTo}.</p>
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
            onClick={() => setSentTo(null)}
          >
            Changer de numéro
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
