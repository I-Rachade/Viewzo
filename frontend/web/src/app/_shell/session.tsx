"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  api,
  getToken,
  notificationsApi,
  setToken,
  StaffOverview,
  staffApi,
  UserView,
} from "@/lib/api";

export type Mode = "CREATOR" | "ADVERTISER";

const MODE_KEY = "viewzo.mode";
const MODE_EVENT = "viewzo:mode";

function subscribeMode(onChange: () => void) {
  window.addEventListener(MODE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MODE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

interface Session {
  // undefined while loading, null when logged out.
  user: UserView | null | undefined;
  mode: Mode;
  setMode: (mode: Mode) => void;
  unread: number;
  refreshUnread: () => void;
  // Back-office counters for the menu, staff only.
  staff: StaffOverview | null;
  refreshStaff: () => void;
  logout: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

function readMode(): Mode | null {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "CREATOR" || m === "ADVERTISER" ? m : null;
  } catch {
    return null;
  }
}

// Who is logged in, for the menu. Reloads when the token changes (login,
// logout) and refreshes the counters every minute.
export function SessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<UserView | null | undefined>(undefined);
  const [unread, setUnread] = useState(0);
  const [staff, setStaff] = useState<StaffOverview | null>(null);
  const chosenMode = useSyncExternalStore(
    subscribeMode,
    readMode,
    () => null,
  );
  const token = useRef<string | null | undefined>(undefined);

  const refreshUnread = useCallback(() => {
    notificationsApi.unread().then((r) => setUnread(r.unread), () => {});
  }, []);
  const refreshStaff = useCallback(() => {
    staffApi.overview().then(setStaff, () => {});
  }, []);

  useEffect(() => {
    const current = getToken();
    if (current === token.current) return;
    token.current = current;
    void (async () => {
      const me = current ? await api.me().catch(() => null) : null;
      if (token.current !== current) return;
      setUser(me);
      if (!me) return;
      refreshUnread();
      if (me.isStaff) refreshStaff();
    })();
  }, [pathname, refreshUnread, refreshStaff]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      refreshUnread();
      if (user.isStaff) refreshStaff();
    }, 60_000);
    return () => clearInterval(timer);
  }, [user, refreshUnread, refreshStaff]);

  const types = new Set(user?.profiles.map((p) => p.type));
  const mode: Mode =
    chosenMode && types.has(chosenMode)
      ? chosenMode
      : types.has("CREATOR") || !types.has("ADVERTISER")
        ? "CREATOR"
        : "ADVERTISER";

  function setMode(m: Mode) {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Storage blocked: the menu keeps the default profile.
    }
    window.dispatchEvent(new Event(MODE_EVENT));
  }

  function logout() {
    setToken(null);
    token.current = null;
    setUser(null);
  }

  return (
    <SessionContext.Provider
      value={{
        user,
        mode,
        setMode,
        unread,
        refreshUnread,
        staff,
        refreshStaff,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

// The logged-in user; sends visitors who aren't logged in to the login page.
export function useRequireUser() {
  const router = useRouter();
  const { user } = useSession();
  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);
  return user ?? null;
}
