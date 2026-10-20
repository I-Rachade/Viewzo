"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { authApi, setToken } from "@/lib/api";
import { AuthScreen } from "../_auth/auth-screen";
import { CodeField } from "../_auth/code-field";
import { IdentifierField, IdentifierKind } from "../_auth/identifier-field";
import { NewPasswordFields, passwordsReady } from "../_auth/password-input";
import { useAction } from "../_auth/use-action";
import { useResend } from "../_auth/use-resend";

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPassword />
    </Suspense>
  );
}

function ForgotPassword() {
  const router = useRouter();
  const params = useSearchParams();
  // Sent here from the login when an old account has no password yet.
  const first = params.get("premier") === "1";
  const initial = params.get("identifiant") ?? "";
  const [kind, setKind] = useState<IdentifierKind>(
    initial && !initial.includes("@") ? "phone" : "email",
  );
  const [identifier, setIdentifier] = useState(initial);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, run } = useAction();
  const resend = useResend();

  function sendCode() {
    run(async () => {
      const res = await authApi.forgotPassword(identifier);
      resend.markSent();
      setSentTo(res.sentTo);
      setCode("");
    });
  }

  function submitIdentifier(e: FormEvent) {
    e.preventDefault();
    sendCode();
  }

  function submitReset(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const res = await authApi.resetPassword(identifier, code, password);
      setToken(res.accessToken);
      router.push("/dashboard");
    });
  }

  return (
    <AuthScreen title={first ? "Définis ton mot de passe" : "Mot de passe oublié"}>
      {first && (
        <p>
          Ton compte n&apos;a pas encore de mot de passe. Reçois un code pour en
          créer un.
        </p>
      )}
      {sentTo === null ? (
        <form className="stack" onSubmit={submitIdentifier}>
          <IdentifierField
            kind={kind}
            onKindChange={setKind}
            value={identifier}
            onChange={setIdentifier}
          />
          <button disabled={busy}>Recevoir un code</button>
        </form>
      ) : (
        <form className="stack" onSubmit={submitReset}>
          <CodeField
            sentTo={sentTo}
            value={code}
            onChange={setCode}
            waitMs={resend.waitMs}
            busy={busy}
            onResend={sendCode}
          />
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
          />
          <button disabled={busy || !passwordsReady(password, confirm)}>
            Enregistrer le mot de passe
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <p className="auth-foot">
        <Link href="/login">Retour à la connexion</Link>
      </p>
    </AuthScreen>
  );
}
