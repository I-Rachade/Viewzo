"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { authApi } from "@/lib/api";
import { countryName, flagOf } from "../country-select";
import { useRequireUser, useSession } from "../_shell/session";
import { AuthScreen } from "../_auth/auth-screen";
import { CodeField } from "../_auth/code-field";
import { useAction } from "../_auth/use-action";
import { useResend } from "../_auth/use-resend";

// A creator signed up with an e-mail confirms a phone number here before
// doing anything else as a creator.
export default function PhonePage() {
  const router = useRouter();
  const user = useRequireUser();
  const { updateUser, setMode, logout } = useSession();
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, run } = useAction();
  const resend = useResend();

  useEffect(() => {
    if (user && !user.phoneRequired) router.replace("/dashboard");
  }, [user, router]);

  if (!user) return null;

  function sendCode() {
    run(async () => {
      const res = await authApi.contactRequest(phone);
      resend.markSent();
      setSentTo(res.sentTo);
      setCode("");
    });
  }

  function submitPhone(e: FormEvent) {
    e.preventDefault();
    sendCode();
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      updateUser(await authApi.contactVerify(phone, code));
      router.replace("/dashboard");
    });
  }

  const isAdvertiser = user.profiles.some((p) => p.type === "ADVERTISER");

  return (
    <AuthScreen title="Ajoute ton numéro">
      <p>
        Pour accepter des campagnes et être payé, confirme ton numéro de
        téléphone. Tu recevras un code par SMS.
      </p>

      {sentTo === null ? (
        <form className="stack" onSubmit={submitPhone}>
          <p className="hint">
            Pays de ton compte : {flagOf(user.country)}{" "}
            {countryName(user.country)}. Le numéro doit être de ce pays.
          </p>
          <label>
            Numéro de téléphone
            <input
              type="tel"
              autoComplete="tel"
              placeholder={user.country === "TG" ? "+228 90 12 34 56" : "Ton numéro"}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <button disabled={busy}>Recevoir un code</button>
        </form>
      ) : (
        <form className="stack" onSubmit={submitCode}>
          <CodeField
            sentTo={sentTo}
            value={code}
            onChange={setCode}
            waitMs={resend.waitMs}
            busy={busy}
            onResend={sendCode}
          />
          <button disabled={busy}>Valider</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setSentTo(null)}
          >
            Modifier le numéro
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <div className="stack">
        {isAdvertiser && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setMode("ADVERTISER");
              router.replace("/dashboard");
            }}
          >
            Continuer en annonceur
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
        >
          Se déconnecter
        </button>
      </div>
    </AuthScreen>
  );
}
