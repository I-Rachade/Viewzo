"use client";

import { FormEvent, useState } from "react";
import { authApi, UserView } from "@/lib/api";
import { CodeField } from "../_auth/code-field";
import { useAction } from "../_auth/use-action";
import { useResend } from "../_auth/use-resend";

// Shows both ways to sign in and confirms the missing one with a code.
export function ContactSection({
  user,
  onUpdated,
}: {
  user: UserView;
  onUpdated: (user: UserView) => void;
}) {
  const missing = !user.email ? "email" : !user.phone ? "phone" : null;
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, run } = useAction();
  const resend = useResend();

  function sendCode() {
    run(async () => {
      const res = await authApi.contactRequest(value);
      resend.markSent();
      setSentTo(res.sentTo);
      setCode("");
    });
  }

  function submitValue(e: FormEvent) {
    e.preventDefault();
    sendCode();
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      onUpdated(await authApi.contactVerify(value, code));
      setAdding(false);
      setSentTo(null);
      setValue("");
    });
  }

  return (
    <>
      <h2>E-mail et téléphone</h2>
      <p>E-mail : {user.email ?? "non renseigné"}</p>
      <p>Téléphone : {user.phone ?? "non renseigné"}</p>
      {missing && !adding && (
        <button className="secondary" onClick={() => setAdding(true)}>
          {missing === "email" ? "Ajouter un e-mail" : "Ajouter un numéro"}
        </button>
      )}
      {adding && sentTo === null && (
        <form className="card" onSubmit={submitValue}>
          <label>
            {missing === "email" ? "Adresse e-mail" : "Numéro de téléphone"}
            <input
              type={missing === "email" ? "email" : "tel"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </label>
          <button disabled={busy}>Recevoir un code</button>
        </form>
      )}
      {adding && sentTo !== null && (
        <form className="card" onSubmit={submitCode}>
          <CodeField
            sentTo={sentTo}
            value={code}
            onChange={setCode}
            waitMs={resend.waitMs}
            busy={busy}
            onResend={sendCode}
          />
          <button disabled={busy}>Valider</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
