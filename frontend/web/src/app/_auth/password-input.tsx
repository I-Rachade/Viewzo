"use client";

import { useState } from "react";

export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password">
      <label>
        {label}
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
      </label>
      <button
        type="button"
        className="link"
        onClick={() => setVisible(!visible)}
      >
        {visible ? "Masquer" : "Afficher"}
      </button>
    </div>
  );
}

// Same rule as the API: 8+ characters with a letter and a digit.
export function isStrongPassword(password: string) {
  return (
    password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
  );
}

// New password typed twice, with the rule shown while typing.
export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
}) {
  return (
    <>
      <PasswordInput
        label="Mot de passe"
        value={password}
        onChange={onPassword}
        autoComplete="new-password"
      />
      <p className={password && !isStrongPassword(password) ? "error" : "hint"}>
        8 caractères minimum, avec une lettre et un chiffre.
      </p>
      <PasswordInput
        label="Confirme le mot de passe"
        value={confirm}
        onChange={onConfirm}
        autoComplete="new-password"
      />
      {confirm && confirm !== password && (
        <p className="error">Les mots de passe ne correspondent pas.</p>
      )}
    </>
  );
}

export function passwordsReady(password: string, confirm: string) {
  return isStrongPassword(password) && password === confirm;
}
