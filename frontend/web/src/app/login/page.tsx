"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authApi, setToken } from "@/lib/api";
import { AuthScreen } from "../_auth/auth-screen";
import { IdentifierField, IdentifierKind } from "../_auth/identifier-field";
import { PasswordInput } from "../_auth/password-input";
import { useAction } from "../_auth/use-action";

export default function LoginPage() {
  const router = useRouter();
  const [kind, setKind] = useState<IdentifierKind>("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  function login(e: FormEvent) {
    e.preventDefault();
    run(
      async () => {
        const res = await authApi.login(identifier, password);
        setToken(res.accessToken);
        router.push("/dashboard");
      },
      (err) => {
        // Accounts from the code-only login set their password first.
        if (err.code !== "PASSWORD_NOT_SET") return false;
        router.push(
          `/mot-de-passe-oublie?premier=1&identifiant=${encodeURIComponent(identifier)}`,
        );
        return true;
      },
    );
  }

  return (
    <AuthScreen title="Connexion">
      <form className="stack" onSubmit={login}>
        <IdentifierField
          kind={kind}
          onKindChange={setKind}
          value={identifier}
          onChange={setIdentifier}
        />
        <PasswordInput
          label="Mot de passe"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <Link className="auth-forgot" href="/mot-de-passe-oublie">
          Mot de passe oublié ?
        </Link>
        <button disabled={busy}>Se connecter</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="auth-foot">
        Pas encore de compte ? <Link href="/inscription">Créer un compte</Link>
      </p>
    </AuthScreen>
  );
}
