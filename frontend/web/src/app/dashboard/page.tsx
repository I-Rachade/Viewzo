"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "../logo";
import {
  api,
  getToken,
  PROFILE_LABELS,
  ProfileType,
  setToken,
  UserView,
} from "@/lib/api";
import { ContactSection } from "./contact-section";

const COUNTRY_NAMES = new Intl.DisplayNames(["fr"], { type: "region" });

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => {
        setToken(null);
        router.replace("/login");
      });
  }, [router]);

  async function activate(type: ProfileType) {
    try {
      setUser(await api.activateProfile(type));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function logout() {
    setToken(null);
    router.replace("/login");
  }

  if (!user) {
    return (
      <div className="card">
        <div className="skeleton" style={{ width: "60%" }} />
        <div className="skeleton" />
        <div className="skeleton" style={{ width: "40%" }} />
      </div>
    );
  }

  const active = new Set(user.profiles.map((p) => p.type));

  return (
    <div className="card stagger">
      <h1 className="brand">
        <Logo size={36} />
        Bienvenue
      </h1>
      <p>
        Tu es inscrit n° {user.priorityRank} au{" "}
        {COUNTRY_NAMES.of(user.country) ?? user.country}.
      </p>
      {user.isFounder && <span className="badge">Badge Fondateur</span>}

      <h2>Mes profils</h2>
      {(Object.keys(PROFILE_LABELS) as ProfileType[]).map((type) =>
        active.has(type) ? (
          <div key={type} className="line">
            <span>{PROFILE_LABELS[type]}</span>
            <span className="pill paid">
              Niveau {user.profiles.find((p) => p.type === type)?.level}
            </span>
          </div>
        ) : (
          <button
            key={type}
            className="secondary"
            onClick={() => activate(type)}
          >
            Activer le profil {PROFILE_LABELS[type]}
          </button>
        ),
      )}
      {error && <p className="error">{error}</p>}

      <ContactSection user={user} onUpdated={setUser} />

      <nav className="nav">
        <Link className="button" href="/wallet">
          Mon portefeuille
        </Link>
        {active.has("ADVERTISER") && (
          <Link className="button coral" href="/campaigns">
            Mes campagnes
          </Link>
        )}
        {user.isStaff && (
          <Link className="button secondary" href="/staff">
            Back-office
          </Link>
        )}
      </nav>

      <button className="secondary" onClick={logout}>
        Se déconnecter
      </button>
    </div>
  );
}
