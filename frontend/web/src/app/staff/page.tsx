"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CAN_PAY, StaffRole } from "@/lib/api";
import { AccountsSection } from "./_sections/accounts";
import { CampaignsSection } from "./_sections/campaigns";
import { TeamSection } from "./_sections/team";
import { useStaffOnly } from "./_sections/use-staff";
import { WithdrawalsSection } from "./_sections/withdrawals";
import { LoadingCard } from "../loading-card";
import { useSession } from "../_shell/session";

type Tab = "accounts" | "campaigns" | "withdrawals" | "team";

const TABS: { key: Tab; label: string; roles?: StaffRole[] }[] = [
  { key: "accounts", label: "Comptes" },
  { key: "campaigns", label: "Campagnes" },
  { key: "withdrawals", label: "Retraits", roles: CAN_PAY },
  { key: "team", label: "Équipe", roles: ["SUPER_ADMIN"] },
];

export default function StaffPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <Staff />
    </Suspense>
  );
}

// Back-office for the Viewzo team: verification, moderation, payments.
function Staff() {
  const router = useRouter();
  const params = useSearchParams();
  const allowed = useStaffOnly();
  const { user, staff, refreshStaff } = useSession();
  const asked = params.get("tab");
  // Each member only sees the tabs their role can act on.
  const role = staff?.me.staffRole;
  const tabs = TABS.filter((t) => !t.roles || (role && t.roles.includes(role)));
  const tab: Tab = tabs.some((t) => t.key === asked) ? (asked as Tab) : "accounts";

  if (!allowed || !user) return <LoadingCard />;

  return (
    <div className="card wide">
      <h1>Back-office</h1>
      <div className="chips">
        <Link className="chip" href="/staff/publications">
          Publications
          {staff && (
            <small>
              {staff.assignments} à vérifier
              {staff.alerts ? ` · ${staff.alerts} alerte${staff.alerts > 1 ? "s" : ""}` : ""}
            </small>
          )}
        </Link>
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`chip${tab === t.key ? " selected" : ""}`}
            onClick={() => router.replace(`/staff?tab=${t.key}`)}
          >
            {t.label}
            {t.key !== "team" && staff && <small>{staff[t.key]} en attente</small>}
          </button>
        ))}
      </div>

      {tab === "accounts" && <AccountsSection onChange={refreshStaff} />}
      {tab === "campaigns" && <CampaignsSection onChange={refreshStaff} />}
      {tab === "withdrawals" && (
        <WithdrawalsSection selfId={user.id} onChange={refreshStaff} />
      )}
      {tab === "team" && <TeamSection selfId={user.id} />}
    </div>
  );
}
