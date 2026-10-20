"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { authApi, setToken } from "@/lib/api";
import { CountrySelect } from "../country-select";
import { LoadingCard } from "../loading-card";
import { AuthScreen } from "../_auth/auth-screen";
import { CodeField } from "../_auth/code-field";
import { IdentifierField, IdentifierKind } from "../_auth/identifier-field";
import { NewPasswordFields, passwordsReady } from "../_auth/password-input";
import { useAction } from "../_auth/use-action";
import { useResend } from "../_auth/use-resend";

type Role = "CREATOR" | "ADVERTISER";

const ROLES: { role: Role; title: string; subtitle: string }[] = [
  {
    role: "CREATOR",
    title: "Je veux gagner de l'argent avec mes réseaux",
    subtitle: "Créateur",
  },
  {
    role: "ADVERTISER",
    title: "Je veux faire connaître ma marque",
    subtitle: "Annonceur",
  },
];

export default function RegisterPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <Register />
    </Suspense>
  );
}

function Register() {
  const router = useRouter();
  // The home page's cards already say which profile to start with.
  const asked = useSearchParams().get("profil");
  const chosen = ROLES.find((r) => r.role === asked);
  const [step, setStep] = useState(chosen ? 2 : 1);
  const [role, setRole] = useState<Role | null>(chosen?.role ?? null);
  const [firstName, setFirstName] = useState("");
  const [kind, setKind] = useState<IdentifierKind>("email");
  const [identifier, setIdentifier] = useState("");
  const [country, setCountry] = useState("TG");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const { busy, error, run } = useAction();
  const resend = useResend();

  function sendCode() {
    setAlreadyRegistered(false);
    run(
      async () => {
        const res = await authApi.registerStart(identifier);
        resend.markSent();
        setSentTo(res.sentTo);
        setCode("");
        setStep(3);
      },
      (err) => {
        // 409 comes back as a plain message; offer the login next to it.
        if (err.message.includes("existe déjà")) setAlreadyRegistered(true);
        return false;
      },
    );
  }

  function submitIdentifier(e: FormEvent) {
    e.preventDefault();
    sendCode();
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const res = await authApi.registerVerify(identifier, code);
      setTicket(res.ticket);
      setStep(4);
    });
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const res = await authApi.registerComplete({
        ticket,
        password,
        role: role!,
        firstName,
        ...(kind === "email" ? { country } : {}),
      });
      setToken(res.accessToken);
      router.push(res.user.phoneRequired ? "/telephone" : "/dashboard");
    });
  }

  return (
    <AuthScreen title="Créer un compte">
      <p className="hint">Étape {step} sur 4</p>

      {step === 1 && (
        <div className="stack">
          {ROLES.map((r) => (
            <button
              key={r.role}
              type="button"
              className="chip"
              onClick={() => {
                setRole(r.role);
                setStep(2);
              }}
            >
              <strong>{r.title}</strong>
              <small>{r.subtitle}</small>
            </button>
          ))}
          <p className="hint">
            Tu pourras ajouter l&apos;autre profil plus tard.
          </p>
        </div>
      )}

      {step === 2 && (
        <form className="stack" onSubmit={submitIdentifier}>
          <IdentifierField
            kind={kind}
            onKindChange={setKind}
            value={identifier}
            onChange={setIdentifier}
          />
          {kind === "email" && (
            <label>
              Pays
              <CountrySelect value={country} onChange={setCountry} required />
            </label>
          )}
          <button disabled={busy}>Recevoir un code</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setStep(1)}
          >
            Retour
          </button>
        </form>
      )}

      {step === 3 && (
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
            onClick={() => setStep(2)}
          >
            Modifier {kind === "email" ? "l'adresse" : "le numéro"}
          </button>
        </form>
      )}

      {step === 4 && (
        <form className="stack" onSubmit={submitPassword}>
          <label>
            Ton prénom
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              maxLength={40}
              required
            />
          </label>
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
          />
          <button
            disabled={
              busy || !firstName.trim() || !passwordsReady(password, confirm)
            }
          >
            Créer mon compte
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      {alreadyRegistered && (
        <Link className="button" href="/login">
          Se connecter
        </Link>
      )}
      <p className="auth-foot">
        Déjà un compte ? <Link href="/login">Se connecter</Link>
      </p>
    </AuthScreen>
  );
}
