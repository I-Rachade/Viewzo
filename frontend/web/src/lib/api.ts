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
    const message = Array.isArray(body.message)
      ? body.message[0]
      : body.message;
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

export type SocialNetwork =
  | "TIKTOK"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "YOUTUBE"
  | "SNAPCHAT"
  | "X"
  | "LINKEDIN"
  | "THREADS"
  | "TELEGRAM"
  | "WHATSAPP_STATUS";
export type CampaignPackage = "BASIC" | "PRO" | "PREMIUM" | "ELITE";
export type CampaignObjective = "AWARENESS" | "SALES" | "DOWNLOADS" | "TRAFFIC";
export type ContentType =
  | "PROVIDED_ASSETS"
  | "VIDEO_WITH_POSTERS"
  | "FACECAM"
  | "VLOG_DEMO_UNBOXING"
  | "FULL_EDITING"
  | "MOTION_DESIGN"
  | "FREE_BRIEF";
export type NoAssetsChoice = "CREATOR_VIDEOS" | "STUDIO";
export type CampaignStatus =
  | "PENDING_REVIEW"
  | "ACTIVE"
  | "REJECTED"
  | "COMPLETED";

export const NETWORK_LABELS: Record<SocialNetwork, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  YOUTUBE: "YouTube",
  SNAPCHAT: "Snapchat",
  X: "X",
  LINKEDIN: "LinkedIn",
  THREADS: "Threads",
  TELEGRAM: "Telegram",
  WHATSAPP_STATUS: "Statut WhatsApp",
};

export const PACKAGE_LABELS: Record<CampaignPackage, string> = {
  BASIC: "Basique",
  PRO: "Pro",
  PREMIUM: "Premium",
  ELITE: "Élite",
};

export const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  AWARENESS: "Notoriété",
  SALES: "Ventes",
  DOWNLOADS: "Téléchargements",
  TRAFFIC: "Trafic",
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  PROVIDED_ASSETS: "Publier mes éléments tels quels",
  VIDEO_WITH_POSTERS: "Vidéo avec mes affiches",
  FACECAM: "Face caméra",
  VLOG_DEMO_UNBOXING: "Vlog, démo ou unboxing",
  FULL_EDITING: "Montage complet",
  MOTION_DESIGN: "Motion design",
  FREE_BRIEF: "Brief libre",
};

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  PENDING_REVIEW: "En vérification",
  ACTIVE: "Active",
  REJECTED: "Refusée",
  COMPLETED: "Terminée",
};

export type Unavailable =
  | { reason: "PACKAGE"; requiredPackage: CampaignPackage }
  | { reason: "BUDGET"; missingAmount: number };

export interface Quote {
  options: {
    network: SocialNetwork;
    minBudget: number;
    selected: boolean;
    unavailable: Unavailable | null;
  }[];
  minBudget: number;
  overLimit: SocialNetwork[];
  allocation: { network: SocialNetwork; budget: number }[];
  estimatedViews: number;
}

export interface CampaignInput {
  title: string;
  objective: CampaignObjective;
  countries: string[];
  cities?: string[];
  startsAt: string;
  endsAt: string;
  package: CampaignPackage;
  budget: number;
  platforms: { network: SocialNetwork; contentType: ContentType }[];
  hasAssets: boolean;
  assetUrls?: string[];
  noAssetsChoice?: NoAssetsChoice;
  shipsProduct?: boolean;
  productPickup?: string;
  faceRequired?: boolean;
  language: string;
  minDurationSec?: number;
  maxDurationSec?: number;
  tone?: string;
  mandatoryElements?: string[];
  forbiddenElements?: string[];
  examples?: string[];
}

export interface CampaignView {
  id: string;
  code: string;
  title: string;
  objective: CampaignObjective;
  countries: string[];
  startsAt: string;
  endsAt: string;
  package: CampaignPackage;
  budget: number;
  status: CampaignStatus;
  statusReason: string | null;
  // Null until the budget is in escrow.
  fundedAt: string | null;
  spent: number;
  platforms: {
    network: SocialNetwork;
    contentType: ContentType;
    budget: number;
    estimatedViews: number;
    creators: number;
  }[];
  estimatedViews: number;
  createdAt: string;
}

export const campaignsApi = {
  quote: (pkg: CampaignPackage, budget: number, platforms: SocialNetwork[]) =>
    call<Quote>(
      `/campaigns/quote?${new URLSearchParams({
        package: pkg,
        budget: String(budget),
        platforms: platforms.join(","),
      })}`,
    ),
  create: (input: CampaignInput) =>
    call<CampaignView>("/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  list: () => call<CampaignView[]>("/me/campaigns"),
};

export function formatFcfa(amount: number) {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}

export type TransactionType =
  | "DEPOSIT"
  | "ESCROW"
  | "EARNING"
  | "COMMISSION"
  | "WITHDRAWAL"
  | "REFUND";
export type PaymentStatus =
  | "REQUESTED"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED";

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  DEPOSIT: "Recharge",
  ESCROW: "Séquestre campagne",
  EARNING: "Gain",
  COMMISSION: "Commission",
  WITHDRAWAL: "Retrait",
  REFUND: "Remboursement",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  REQUESTED: "En attente de validation",
  PROCESSING: "En cours",
  SUCCEEDED: "Réussi",
  FAILED: "Échoué",
  REJECTED: "Refusé",
};

export interface WalletSummary {
  currency: string;
  available: number;
  held: number;
  pendingWithdrawals: number;
  escrow: number;
  minWithdrawal: number;
  withdrawalsOpen: boolean;
  provider: string;
  operators: string[];
}

export interface WalletTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  availableAt: string;
  note: string | null;
  createdAt: string;
}

export interface PaymentView {
  id: string;
  kind: "PAYIN" | "PAYOUT";
  reference: string;
  amount: number;
  status: PaymentStatus;
  failureReason: string | null;
  campaignId: string | null;
  checkoutUrl: string | null;
  createdAt: string;
}

export const walletApi = {
  summary: () => call<WalletSummary>("/me/wallet"),
  transactions: () => call<WalletTransaction[]>("/me/wallet/transactions"),
  withdrawals: () => call<PaymentView[]>("/me/wallet/withdrawals"),
  deposit: (amount: number) =>
    call<PaymentView>("/me/wallet/deposits", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  withdraw: (input: {
    amount: number;
    beneficiaryName: string;
    phone?: string;
    operator?: string;
  }) =>
    call<PaymentView>("/me/wallet/withdrawals", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  payCampaign: (campaignId: string, method: "WALLET" | "MOBILE_MONEY") =>
    call<PaymentView | { funded: true }>(`/campaigns/${campaignId}/pay`, {
      method: "POST",
      body: JSON.stringify({ method }),
    }),
  payment: (reference: string) => call<PaymentView>(`/payments/${reference}`),
};
