const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "viewzo.token";

export type ProfileType = "CREATOR" | "ADVERTISER" | "PROVIDER";

export interface UserView {
  id: string;
  phone: string;
  country: string;
  priorityRank: number;
  isFounder: boolean;
  profiles: { type: ProfileType; level: number }[];
}

export const PROFILE_LABELS: Record<ProfileType, string> = {
  CREATOR: "Créateur",
  ADVERTISER: "Annonceur",
  PROVIDER: "Prestataire créatif",
};

export function getToken() {
  return typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new Error(message ?? "Une erreur est survenue");
  }
  return body as T;
}

export const api = {
  requestCode: (phone: string) =>
    call<{ phone: string }>("/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  verifyCode: (phone: string, code: string) =>
    call<{ accessToken: string; isNew: boolean; user: UserView }>(
      "/auth/otp/verify",
      { method: "POST", body: JSON.stringify({ phone, code }) },
    ),
  me: () => call<UserView>("/me"),
  activateProfile: (type: ProfileType) =>
    call<UserView>("/me/profiles", {
      method: "POST",
      body: JSON.stringify({ type }),
    }),
};
