"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

  if (!user) return <p>Chargement…</p>;

  const active = new Set(user.profiles.map((p) => p.type));

  return (
    <div className="card">
      <h1>Bienvenue</h1>
      <p>
        Tu es inscrit n° {user.priorityRank} au{" "}
        {COUNTRY_NAMES.of(user.country) ?? user.country}.
      </p>
      {user.isFounder && <span className="badge">Badge Fondateur</span>}

      <h2>Mes profils</h2>
      {(Object.keys(PROFILE_LABELS) as ProfileType[]).map((type) =>
        active.has(type) ? (
          <p key={type}>
            ✓ {PROFILE_LABELS[type]} (niveau{" "}
            {user.profiles.find((p) => p.type === type)?.level})
          </p>
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

      <Link className="button" href="/wallet">
        Mon portefeuille
      </Link>
      {active.has("ADVERTISER") && (
        <Link className="button" href="/campaigns">
          Mes campagnes
        </Link>
      )}

      {user.isStaff && (
        <Link className="button" href="/staff">
          Back-office
        </Link>
      )}

      <button className="secondary" onClick={logout}>
        Se déconnecter
      </button>
    </div>
  );
}
