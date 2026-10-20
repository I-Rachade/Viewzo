"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { Logo } from "../logo";
import { OAUTH_CONNECTIONS } from "./features";
import { Icon, IconName } from "./icons";
import { Mode, useSession } from "./session";

// Pages shown without the menu: the landing page and the sign-in flow.
const PUBLIC = ["/", "/login", "/inscription", "/mot-de-passe-oublie"];
// Logged in, but in the sign-in look: the phone a creator must add.
const PHONE_PAGE = "/telephone";

interface Item {
  href: string;
  label: string;
  // Label in the phone tab bar, where space is short.
  short?: string;
  icon: IconName;
  count?: number;
  // Also active on these path prefixes.
  match?: string[];
}

const CONNECTIONS: Item = {
  href: "/connexions",
  label: "Comptes connectés",
  short: "Connexions",
  icon: "link",
};

function itemsFor(mode: Mode, live: boolean): Item[] {
  return mode === "ADVERTISER"
    ? [
        { href: "/dashboard", label: "Tableau de bord", short: "Accueil", icon: "home" },
        {
          href: "/campaigns",
          label: "Mes campagnes",
          short: "Campagnes",
          icon: "megaphone",
          match: ["/campaigns/"],
        },
        { href: "/campaigns/new", label: "Créer une campagne", short: "Créer", icon: "plus" },
        { href: "/wallet", label: "Portefeuille", short: "Wallet", icon: "wallet" },
        // Only while the team has switched the module on.
        ...(live
          ? [
              {
                href: "/live",
                label: "Ventes en live",
                short: "Live",
                icon: "live",
                match: ["/live/"],
              } satisfies Item,
            ]
          : []),
      ]
    : [
        { href: "/dashboard", label: "Tableau de bord", short: "Accueil", icon: "home" },
        { href: "/resultats", label: "Mes publications", short: "Résultats", icon: "chart" },
        { href: "/comptes", label: "Mes comptes", short: "Comptes", icon: "at" },
        ...(OAUTH_CONNECTIONS ? [CONNECTIONS] : []),
        { href: "/wallet", label: "Portefeuille", short: "Wallet", icon: "wallet" },
      ];
}

/**
 * The frame around every logged-in page: a side menu on wide screens, a
 * drawer and a bottom tab bar on phones.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, mode, setMode, unread, staff, modules, logout } = useSession();
  const [open, setOpen] = useState(false);
  // Creators signed up by e-mail add a phone before anything else.
  const blocked = !!user?.phoneRequired && mode === "CREATOR";

  useEffect(() => {
    if (blocked && !PUBLIC.includes(pathname) && pathname !== PHONE_PAGE) {
      router.replace(PHONE_PAGE);
    }
  }, [blocked, pathname, router]);

  if (PUBLIC.includes(pathname) || pathname === PHONE_PAGE || !user) {
    return <main className="container">{children}</main>;
  }
  // On the way to the phone page.
  if (blocked) return null;

  const types = new Set(user.profiles.map((p) => p.type));
  const liveOn = modules.includes("LIVE_SALES");
  const main = itemsFor(mode, liveOn);
  const notifications: Item = {
    href: "/notifications",
    label: "Notifications",
    short: "Notifs",
    icon: "bell",
    count: unread,
  };
  const backOffice: Item[] = user.isStaff
    ? [
        { href: "/staff", label: "Vue d’ensemble", icon: "shield" },
        {
          href: "/staff/publications",
          label: "Publications",
          icon: "list",
          count: staff?.assignments,
          match: ["/staff/publications/", "/staff/createurs/"],
        },
        {
          href: "/staff/publications?alertes=1",
          label: "Alertes fraude",
          icon: "alert",
          count: staff?.alerts,
        },
        {
          href: "/staff?tab=accounts",
          label: "Comptes réseaux",
          icon: "check",
          count: staff?.accounts,
        },
        {
          href: "/staff?tab=campaigns",
          label: "Campagnes à valider",
          icon: "megaphone",
          count: staff?.campaigns,
        },
        {
          href: "/staff?tab=withdrawals",
          label: "Retraits",
          icon: "card",
          count: staff?.withdrawals,
        },
        ...(liveOn
          ? [{ href: "/staff?tab=lives", label: "Lives TikTok", icon: "live" } satisfies Item]
          : []),
        { href: "/staff?tab=team", label: "Équipe", icon: "users" },
        ...(staff?.me.staffRole === "SUPER_ADMIN"
          ? [{ href: "/staff?tab=modules", label: "Modules", icon: "toggle" } satisfies Item]
          : []),
      ]
    : [];

  const isActive = (item: Item) => {
    const [path, query] = item.href.split("?");
    if (query) return false;
    return (
      pathname === path || !!item.match?.some((m) => pathname.startsWith(m))
    );
  };

  const link = (item: Item) => (
    <Link
      key={item.href}
      href={item.href}
      className={`nav-item${isActive(item) ? " active" : ""}`}
      aria-current={isActive(item) ? "page" : undefined}
      onClick={() => setOpen(false)}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {!!item.count && <span className="count">{item.count}</span>}
    </Link>
  );

  function signOut() {
    logout();
    router.replace("/login");
  }

  const initials = (user.email ?? user.phone ?? "V").replace(/^\+/, "").slice(0, 2).toUpperCase();

  return (
    <div className="shell">
      <aside className={`sidebar${open ? " open" : ""}`}>
        <Link href="/dashboard" className="sidebar-brand" onClick={() => setOpen(false)}>
          <Logo size={30} />
          Viewzo
        </Link>
        {types.has("CREATOR") && types.has("ADVERTISER") && (
          <div className="mode-switch" role="group" aria-label="Profil affiché">
            {(["CREATOR", "ADVERTISER"] as Mode[]).map((m) => (
              <button
                key={m}
                className={mode === m ? "on" : ""}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "CREATOR" ? "Créateur" : "Annonceur"}
              </button>
            ))}
          </div>
        )}
        <nav className="nav-group" aria-label="Menu">
          {main.map(link)}
          {link(notifications)}
        </nav>
        {backOffice.length > 0 && (
          <nav className="nav-group" aria-label="Back-office">
            <p className="nav-title">Back-office</p>
            {backOffice.map(link)}
          </nav>
        )}
        <button className="nav-item logout" onClick={signOut}>
          <Icon name="logout" />
          <span>Se déconnecter</span>
        </button>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="shell-main">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            aria-label="Ouvrir le menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <Link href="/dashboard" className="topbar-brand">
            <Logo size={26} />
            Viewzo
          </Link>
          <span className="spacer" />
          <Link
            href="/notifications"
            className="icon-button bell"
            aria-label={`Notifications${unread ? ` (${unread} non lues)` : ""}`}
          >
            <Icon name="bell" />
            {unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
          </Link>
          <span className="avatar" title={user.email ?? user.phone ?? ""}>
            {initials}
          </span>
        </header>
        <main className="container">{children}</main>
      </div>

      <nav className="tabbar" aria-label="Menu principal">
        {[...main.slice(0, 3), notifications, main[3]].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(item) ? "active" : ""}
          >
            <Icon name={item.icon} size={22} />
            <span>{item.short ?? item.label}</span>
            {!!item.count && <span className="dot">{item.count > 9 ? "9+" : item.count}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
