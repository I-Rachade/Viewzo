"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, getToken, StaffOverview, staffApi, UserView } from "@/lib/api";
import { AccountsSection } from "./_sections/accounts";
import { CampaignsSection } from "./_sections/campaigns";
import { TeamSection } from "./_sections/team";
import { ViewsSection } from "./_sections/views";
import { WithdrawalsSection } from "./_sections/withdrawals";
import { LoadingCard } from "../loading-card";

type Tab = keyof StaffOverview | "team";

const TABS: { key: Tab; label: string }[] = [
  { key: "accounts", label: "Comptes" },
  { key: "campaigns", label: "Campagnes" },
  { key: "withdrawals", label: "Retraits" },
  { key: "assignments", label: "Vues" },
  { key: "team", label: "Équipe" },
];

// Back-office for the Viewzo team: verification, moderation, payments.
export default function StaffPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserView | null>(null);
  const [overview, setOverview] = useState<StaffOverview | null>(null);
  const [tab, setTab] = useState<Tab>("accounts");

  const refresh = useCallback(() => {
    staffApi.overview().then(setOverview, () => {});
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api
      .me()
      .then((me) => {
        if (!me.isStaff) {
          router.replace("/dashboard");
          return;
        }
        setUser(me);
        refresh();
      })
      .catch(() => router.replace("/login"));
  }, [router, refresh]);

  if (!user) return <LoadingCard />;

  return (
    <div className="card wide">
      <h1>Back-office</h1>
      <div className="chips">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`chip${tab === t.key ? " selected" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key !== "team" && overview && (
              <small>
                {overview[t.key]}{" "}
                {t.key === "assignments" ? "publications" : "en attente"}
              </small>
            )}
          </button>
        ))}
      </div>

      {tab === "accounts" && <AccountsSection onChange={refresh} />}
      {tab === "campaigns" && <CampaignsSection onChange={refresh} />}
      {tab === "withdrawals" && <WithdrawalsSection onChange={refresh} />}
      {tab === "assignments" && <ViewsSection onChange={refresh} />}
      {tab === "team" && <TeamSection selfId={user.id} />}

      <Link className="button secondary" href="/dashboard">
        Tableau de bord
      </Link>
    </div>
  );
}
