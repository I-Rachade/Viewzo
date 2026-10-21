"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CAN_MODERATE, CAN_PAY, ModuleKey, StaffRole } from "@/lib/api";
import { AccountsSection } from "./_sections/accounts";
import { CampaignsSection } from "./_sections/campaigns";
import { CountriesSection } from "./_sections/countries";
import { DisputesSection } from "./_sections/disputes";
import { IdentitySection } from "./_sections/identity";
import { LivesSection } from "./_sections/lives";
import { ModulesSection } from "./_sections/modules";
import { TeamSection } from "./_sections/team";
import { useStaffOnly } from "./_sections/use-staff";
import { WithdrawalsSection } from "./_sections/withdrawals";
import { LoadingCard } from "../loading-card";
import { useSession } from "../_shell/session";

type Tab =
  | "accounts"
  | "identity"
  | "campaigns"
  | "disputes"
  | "withdrawals"
  | "lives"
  | "team"
  | "countries"
  | "modules";

// Tabs without a pending count next to their label.
const UNCOUNTED: Tab[] = ["lives", "team", "countries", "modules"];

const TABS: {
  key: Tab;
  label: string;
  roles?: StaffRole[];
  // Shown only while the team has switched this module on.
  module?: ModuleKey;
}[] = [
  { key: "accounts", label: "Comptes" },
  { key: "identity", label: "Identités" },
  { key: "campaigns", label: "Campagnes" },
  { key: "disputes", label: "Litiges" },
  { key: "withdrawals", label: "Retraits", roles: CAN_PAY },
  { key: "lives", label: "Lives TikTok", module: "LIVE_SALES" },
  { key: "team", label: "Équipe", roles: ["SUPER_ADMIN"] },
  { key: "countries", label: "Pays", roles: ["SUPER_ADMIN"] },
  { key: "modules", label: "Modules", roles: ["SUPER_ADMIN"] },
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
  const { user, staff, refreshStaff, modules, refreshModules } = useSession();
  const asked = params.get("tab");
  // Each member only sees the tabs their role can act on.
  const role = staff?.me.staffRole;
  const tabs = TABS.filter(
    (t) =>
      (!t.roles || (role && t.roles.includes(role))) &&
      (!t.module || modules.includes(t.module)),
  );
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
            {t.key === "disputes" && staff ? (
              <small className={staff.overdueDisputes ? "error" : undefined}>
                {staff.disputes} ouvert{staff.disputes > 1 ? "s" : ""}
                {staff.overdueDisputes ? ` · ${staff.overdueDisputes} en retard` : ""}
              </small>
            ) : (
              !UNCOUNTED.includes(t.key) &&
              staff && (
                <small>
                  {staff[t.key as "accounts" | "identity" | "campaigns" | "withdrawals"]} en
                  attente
                </small>
              )
            )}
          </button>
        ))}
      </div>

      {tab === "accounts" && <AccountsSection onChange={refreshStaff} />}
      {tab === "identity" && (
        <IdentitySection
          onChange={refreshStaff}
          canDecide={Boolean(role && CAN_MODERATE.includes(role))}
        />
      )}
      {tab === "campaigns" && <CampaignsSection onChange={refreshStaff} />}
      {tab === "disputes" && (
        <DisputesSection
          onChange={refreshStaff}
          canDecide={Boolean(role && CAN_MODERATE.includes(role))}
        />
      )}
      {tab === "withdrawals" && (
        <WithdrawalsSection selfId={user.id} onChange={refreshStaff} />
      )}
      {tab === "team" && <TeamSection selfId={user.id} />}
      {tab === "countries" && <CountriesSection />}
      {tab === "lives" && role && <LivesSection role={role} />}
      {tab === "modules" && <ModulesSection onChange={refreshModules} />}
    </div>
  );
}
