const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
// Only a marker that a session may exist; the lasting token is an httpOnly
// cookie the page can't read, and the short access token stays in memory.
const SESSION_KEY = "viewzo.session";
const LEGACY_TOKEN_KEY = "viewzo.token";
// Tells the API to put the refresh token in a cookie, not in the body.
const CLIENT_HEADER = { "X-Viewzo-Client": "web" };

export type ProfileType = "CREATOR" | "ADVERTISER" | "PROVIDER";

export interface UserView {
  id: string;
  // At least one of phone and email is set.
  phone: string | null;
  email: string | null;
  hasPassword: boolean;
  // A creator without a verified phone; only /telephone is open to them.
  phoneRequired: boolean;
  country: string;
  priorityRank: number;
  isFounder: boolean;
  // Team members see the back-office.
  isStaff: boolean;
  profiles: { type: ProfileType; level: number }[];
}

export const PROFILE_LABELS: Record<ProfileType, string> = {
  CREATOR: "Créateur",
  ADVERTISER: "Annonceur",
  PROVIDER: "Prestataire créatif",
};

let accessToken: string | null = null;
let version = 0;

function storage(action: (store: Storage) => void) {
  try {
    action(localStorage);
  } catch {
    // Storage blocked: the session lasts until the tab closes.
  }
}

/** Whether this browser has signed in (the session may still have expired). */
export function hasSession() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return accessToken !== null;
  }
}

/** Changes on every sign-in and sign-out, so the menu knows to reload. */
export function sessionVersion() {
  return hasSession() ? version : -1;
}

/** Keeps the access token from a sign-in, or forgets the session. */
export function setToken(token: string | null) {
  accessToken = token;
  version += 1;
  storage((s) => {
    s.removeItem(LEGACY_TOKEN_KEY);
    if (token) s.setItem(SESSION_KEY, "1");
    else s.removeItem(SESSION_KEY);
  });
}

/** Ends the session on the server too, then forgets it here. */
export async function logout() {
  // Forget it here first; the cookie is enough to end it on the server.
  setToken(null);
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: CLIENT_HEADER,
    });
  } catch {
    // Offline: the server session expires on its own.
  }
}

let refreshing: Promise<boolean> | null = null;

// One refresh at a time: parallel calls wait for the same new token.
function refresh() {
  refreshing ??= (async () => {
    try {
      const renew = () =>
        fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: CLIENT_HEADER,
        });
      let res = await renew();
      // Another tab renewed it a moment ago; its new cookie is being set.
      if (res.status === 409) {
        await new Promise((r) => setTimeout(r, 800));
        res = await renew();
      }
      if (res.status === 401) {
        setToken(null);
        return false;
      }
      if (!res.ok) return false;
      accessToken = ((await res.json()) as { accessToken: string }).accessToken;
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Sends a request with the access token, renewing it once when it expired.
async function send(path: string, init: RequestInit): Promise<Response> {
  const auth = path.startsWith("/auth/");
  if (!accessToken && hasSession() && !auth) await refresh();
  const attempt = () =>
    fetch(`${API_URL}${path}`, {
      ...init,
      // The refresh cookie only travels to /auth.
      credentials: auth ? "include" : "same-origin",
      headers: {
        ...CLIENT_HEADER,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  const res = await attempt();
  if (res.status !== 401 || auth || !hasSession()) return res;
  return (await refresh()) ? attempt() : res;
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Safety net: the menu already sends these creators to /telephone.
    if (body.code === "PHONE_REQUIRED" && typeof window !== "undefined") {
      if (window.location.pathname !== "/telephone") {
        window.location.replace("/telephone");
      }
    }
    const message = Array.isArray(body.message)
      ? body.message[0]
      : body.message;
    throw new ApiError(
      message ?? "Une erreur est survenue",
      body.code,
      res.status,
    );
  }
  return body as T;
}

// Carries the API's optional error code, e.g. PASSWORD_NOT_SET.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  return parse<T>(
    await send(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    }),
  );
}

interface Session {
  accessToken: string;
  user: UserView;
}

// identifier = an email address or a phone number.
export const authApi = {
  registerStart: (identifier: string) =>
    call<{ sentTo: string }>("/auth/register/start", post({ identifier })),
  registerVerify: (identifier: string, code: string) =>
    call<{ ticket: string }>(
      "/auth/register/verify",
      post({ identifier, code }),
    ),
  registerComplete: (body: {
    ticket: string;
    password: string;
    role: "CREATOR" | "ADVERTISER";
    country?: string;
  }) => call<Session>("/auth/register/complete", post(body)),
  login: (identifier: string, password: string) =>
    call<Session>("/auth/login", post({ identifier, password })),
  forgotPassword: (identifier: string) =>
    call<{ sentTo: string }>("/auth/password/forgot", post({ identifier })),
  resetPassword: (identifier: string, code: string, password: string) =>
    call<Session>("/auth/password/reset", post({ identifier, code, password })),
  contactRequest: (identifier: string) =>
    call<{ sentTo: string }>("/auth/contact/request", post({ identifier })),
  contactVerify: (identifier: string, code: string) =>
    call<UserView>("/auth/contact/verify", post({ identifier, code })),
};

export const api = {
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

export type AccountStatus =
  | "PENDING"
  | "ELIGIBLE"
  | "NEEDS_FIX"
  | "NOT_ELIGIBLE"
  | "SUSPENDED";

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING: "En vérification",
  ELIGIBLE: "Éligible",
  NEEDS_FIX: "À corriger",
  NOT_ELIGIBLE: "Non éligible",
  SUSPENDED: "Suspendu",
};

export type AutoRejection = "NOT_FOUND" | "ANONYMOUS";
export type FollowersSource = "CREATOR" | "ADMIN" | "SYSTEM";

export const AUTO_REJECTION_LABELS: Record<AutoRejection, string> = {
  NOT_FOUND: "Compte introuvable",
  ANONYMOUS: "Compte anonyme",
};

export const FOLLOWERS_SOURCE_LABELS: Record<FollowersSource, string> = {
  CREATOR: "déclaré par le créateur",
  ADMIN: "saisi par l’équipe",
  SYSTEM: "lu sur le réseau",
};

// A creator's account in "Mes comptes".
export interface MyAccount {
  id: string;
  network: SocialNetwork;
  handle: string;
  status: AccountStatus;
  statusReason: string | null;
  retryAfter: string | null;
  reviewDueAt: string | null;
  followers: number | null;
  avgStatusViews: number | null;
  declaredFollowers: number | null;
  autoRejection: AutoRejection | null;
  // How to prove the account is theirs, while it is being checked.
  verification: {
    kind: "BIO_CODE" | "WHATSAPP";
    code: string;
    contactNumber?: string;
    whatsappLink?: string;
  } | null;
  createdAt: string;
}

export const accountsApi = {
  list: () => call<MyAccount[]>("/me/accounts"),
  add: (input: {
    network: SocialNetwork;
    handle: string;
    followers?: number;
    notAnonymous: boolean;
  }) =>
    call<MyAccount>("/me/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resubmit: (id: string) =>
    call<MyAccount>(`/me/accounts/${id}/resubmit`, { method: "POST" }),
  remove: (id: string) =>
    call<void>(`/me/accounts/${id}`, { method: "DELETE" }),
};

interface StaffUser {
  phone: string | null;
  email?: string | null;
  country: string;
}

// How the team recognises an account: its number, else its email.
export function contactOf(user: {
  phone: string | null;
  email?: string | null;
}) {
  return user.phone ?? user.email ?? "—";
}

export type StaffRole =
  | "SUPER_ADMIN"
  | "COUNTRY_MANAGER"
  | "MODERATOR"
  | "FINANCE"
  | "SUPPORT";

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: "Super-admin",
  COUNTRY_MANAGER: "Responsable pays",
  MODERATOR: "Modérateur",
  FINANCE: "Finance",
  SUPPORT: "Support",
};

// What each role may decide on; the API checks it again.
export const CAN_MODERATE: StaffRole[] = [
  "SUPER_ADMIN",
  "COUNTRY_MANAGER",
  "MODERATOR",
];
export const CAN_PAY: StaffRole[] = ["SUPER_ADMIN", "FINANCE"];

export interface StaffOverview {
  // The member's own role and countries (empty: all countries).
  me: { staffRole: StaffRole; countries: string[] };
  accounts: number;
  campaigns: number;
  withdrawals: number;
  // Posts waiting for review, and those the fraud rules flag.
  assignments: number;
  alerts: number;
}

export interface StaffAccount {
  id: string;
  network: SocialNetwork;
  handle: string;
  profileUrl: string | null;
  verificationCode: string;
  status: AccountStatus;
  statusReason: string | null;
  followers: number | null;
  avgStatusViews: number | null;
  declaredFollowers: number | null;
  followersSource: FollowersSource | null;
  notAnonymousConfirmed: boolean;
  autoRejection: AutoRejection | null;
  autoCheckedAt: string | null;
  submittedAt: string;
  user: StaffUser & { id: string };
  otherAccounts: {
    network: SocialNetwork;
    handle: string;
    status: AccountStatus;
  }[];
}

export interface StaffCampaign extends CampaignView {
  assetUrls: string[];
  advertiser: StaffUser;
}

export interface StaffWithdrawal extends PaymentView {
  beneficiaryName: string | null;
  phone: string | null;
  operator: string | null;
  // Large withdrawals need two different finance members.
  needsSecondApproval: boolean;
  firstApprovedById: string | null;
  user: StaffUser & { profiles: { type: ProfileType; level: number }[] };
}

export interface StaffMember {
  id: string;
  phone: string | null;
  email: string | null;
  country: string;
  staffRole: StaffRole;
  staffCountries: string[];
  createdAt: string;
}

export interface MemberRights {
  staffRole: StaffRole;
  countries?: string[];
}

const post = (body: object) => ({
  method: "POST",
  body: JSON.stringify(body),
});

export const staffApi = {
  overview: () => call<StaffOverview>("/staff/overview"),
  accounts: () => call<StaffAccount[]>("/staff/accounts"),
  // Accounts the system refused on its own, so the team can catch mistakes.
  autoRejectedAccounts: () =>
    call<StaffAccount[]>("/staff/accounts?auto=1"),
  accountByCode: (code: string) =>
    call<StaffAccount>(`/staff/accounts/by-code/${encodeURIComponent(code)}`),
  reviewAccount: (
    id: string,
    input: {
      status: Exclude<AccountStatus, "PENDING">;
      reason?: string;
      followers?: number;
      avgStatusViews?: number;
    },
  ) => call<StaffAccount>(`/staff/accounts/${id}/review`, post(input)),
  campaigns: () => call<StaffCampaign[]>("/staff/campaigns"),
  reviewCampaign: (
    id: string,
    input: { status: "ACTIVE" | "REJECTED"; reason?: string },
  ) => call<CampaignView>(`/staff/campaigns/${id}/review`, post(input)),
  withdrawals: (status: "REQUESTED" | "PROCESSING" = "REQUESTED") =>
    call<StaffWithdrawal[]>(`/staff/withdrawals?status=${status}`),
  reviewWithdrawal: (
    id: string,
    input: { decision: "APPROVE" | "REJECT"; reason?: string },
  ) =>
    call<PaymentView & { awaitingSecondApproval?: boolean }>(
      `/staff/withdrawals/${id}/review`,
      post(input),
    ),
  // Closes a payout whose provider result never came, after checking it there.
  resolveWithdrawal: (
    id: string,
    input: { outcome: "SUCCEEDED" | "FAILED"; reason: string },
  ) => call<PaymentView>(`/staff/withdrawals/${id}/resolve`, post(input)),
  members: () => call<StaffMember[]>("/staff/members"),
  addMember: (phone: string, rights: MemberRights) =>
    call<StaffMember>("/staff/members", post({ phone, ...rights })),
  updateMember: (id: string, rights: MemberRights) =>
    call<StaffMember>(`/staff/members/${id}`, {
      method: "PATCH",
      body: JSON.stringify(rights),
    }),
  removeMember: (id: string) =>
    call<void>(`/staff/members/${id}`, { method: "DELETE" }),
};

export interface AllowedCountry {
  code: string;
  enabled: boolean;
}

// Countries Viewzo works in; the list is public, changes are super admin only.
export const countriesApi = {
  enabled: () => call<string[]>("/countries"),
  all: () => call<AllowedCountry[]>("/staff/countries"),
  add: (code: string) => call<AllowedCountry>("/staff/countries", post({ code })),
  set: (code: string, enabled: boolean) =>
    call<AllowedCountry>(`/staff/countries/${code}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};

// ---- Posts, proofs and reviews -------------------------------------------

export type PostReviewStatus = "TO_REVIEW" | "VALIDATED" | "NEEDS_FIX" | "REJECTED";

export const REVIEW_STATUS_LABELS: Record<PostReviewStatus, string> = {
  TO_REVIEW: "À vérifier",
  VALIDATED: "Validé",
  NEEDS_FIX: "À corriger",
  REJECTED: "Refusé",
};

export const REVIEW_STATUS_TONES: Record<PostReviewStatus, string> = {
  TO_REVIEW: "pending",
  VALIDATED: "paid",
  NEEDS_FIX: "pending",
  REJECTED: "refused",
};

export interface ProofView {
  id: string;
  kind: "SCREENSHOT" | "LINK";
  url: string | null;
  fileUrl: string | null;
  capturedAt: string | null;
  declaredViews: number | null;
  uploadedAt: string;
}

export interface CreatorAssignment {
  id: string;
  status: "ACCEPTED" | "SUBMITTED";
  postUrl: string | null;
  acceptedAt: string;
  submittedAt: string | null;
  reviewStatus: PostReviewStatus;
  reviewReason: string | null;
  validViews: number;
  earned: number;
  declaredViews: number | null;
  proofs: ProofView[];
  proofPlan: {
    steps: { label: string; dueAt: string | null; doneAt: string | null }[];
    nextDueAt: string | null;
  } | null;
  task: {
    id: string;
    network: SocialNetwork;
    contentType: ContentType;
    creatorRatePer1000: number;
    campaign: { title: string; hashtag: string; endsAt: string };
  };
}

export interface CreatorResults {
  validViews: number;
  earned: number;
  earnedThisMonth: number;
  toReview: number;
  needsFix: number;
  validated: number;
  rejected: number;
  validationRate: number | null;
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  return parse<T>(await send(path, { method: "POST", body: form }));
}

export const creatorApi = {
  assignments: () => call<CreatorAssignment[]>("/me/assignments"),
  results: () => call<CreatorResults>("/me/results"),
  submitLink: (id: string, postUrl: string) =>
    call<CreatorAssignment>(`/me/assignments/${id}/submit`, {
      method: "POST",
      body: JSON.stringify({ postUrl }),
    }),
  addScreenshot: (id: string, file: File, declaredViews: number) => {
    const form = new FormData();
    form.append("file", file);
    form.append("declaredViews", String(declaredViews));
    // The file's date on the device stands for when the capture was taken.
    if (file.lastModified) {
      form.append("capturedAt", new Date(file.lastModified).toISOString());
    }
    return upload<{ ok: true }>(`/me/assignments/${id}/proofs`, form);
  },
};

// ---- Platform connections ------------------------------------------------

export interface Connection {
  network: SocialNetwork;
  available: boolean;
  connected: boolean;
  handle: string | null;
  lastError: string | null;
  connectedAt: string | null;
}

export const connectionsApi = {
  list: () => call<Connection[]>("/me/connections"),
  start: (network: SocialNetwork) =>
    call<{ url: string }>(`/me/connections/${network}/start`),
  disconnect: (network: SocialNetwork) =>
    call<void>(`/me/connections/${network}`, { method: "DELETE" }),
};

// ---- Notifications -------------------------------------------------------

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: () =>
    call<{ unread: number; items: NotificationView[] }>("/me/notifications"),
  unread: () => call<{ unread: number }>("/me/notifications/unread"),
  read: (ids?: string[]) =>
    call<{ unread: number }>("/me/notifications/read", {
      method: "POST",
      body: JSON.stringify(ids ? { ids } : {}),
    }),
};

// ---- Advertiser report ---------------------------------------------------

export interface CampaignReport {
  id: string;
  code: string;
  title: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  budget: number;
  spent: number;
  verifiedViews: number;
  unbilledViews: number;
  costPer1000: number | null;
  posts: { total: number; validated: number; toReview: number; rejected: number };
  byNetwork: { network: SocialNetwork; views: number; posts: number }[];
  byCountry: { country: string; views: number; posts: number }[];
  daily: { date: string; views: number }[];
  gallery: {
    id: string;
    network: SocialNetwork;
    country: string;
    handle: string | null;
    postUrl: string | null;
    views: number;
    imageUrl: string | null;
    submittedAt: string | null;
  }[];
}

export const reportApi = {
  campaign: (id: string) => call<CampaignReport>(`/me/campaigns/${id}/report`),
};

// ---- Back-office: posts and creators --------------------------------------

export interface StaffPostRow {
  id: string;
  network: SocialNetwork;
  contentType: ContentType;
  campaign: { id: string; code: string; title: string };
  creator: { id: string; phone: string | null; email: string | null; country: string };
  postUrl: string | null;
  submittedAt: string | null;
  latestViews: number | null;
  validViews: number;
  proofs: number;
  riskScore: number;
  reviewStatus: PostReviewStatus;
}

export interface RiskSignal {
  code: string;
  level: "HIGH" | "MEDIUM";
  message: string;
}

export interface PostDossier {
  id: string;
  reviewStatus: PostReviewStatus;
  reviewReason: string | null;
  reviewedAt: string | null;
  riskScore: number;
  signals: RiskSignal[];
  network: SocialNetwork;
  contentType: ContentType;
  postUrl: string | null;
  acceptedAt: string;
  submittedAt: string | null;
  validViews: number;
  earned: number;
  latestViews: number;
  expectedEarning: number;
  creatorRatePer1000: number;
  taskBudget: number;
  campaign: {
    id: string;
    code: string;
    title: string;
    endsAt: string;
    language: string;
    faceRequired: boolean;
    minDurationSec: number | null;
    maxDurationSec: number | null;
    mandatoryElements: string[];
    forbiddenElements: string[];
    assetUrls: string[];
  };
  creator: {
    id: string;
    phone: string | null;
    email: string | null;
    country: string;
    createdAt: string;
    level: number;
    account: {
      id: string;
      handle: string;
      status: AccountStatus;
      followers: number | null;
      avgStatusViews: number | null;
    } | null;
    history: { validated: number; rejected: number; toReview: number; needsFix: number };
    sharedDevice: { id: string; phone: string | null; email: string | null; country: string }[];
  };
  proofs: (ProofView & { sha256: string | null; deviceId: string | null; ip: string | null })[];
  snapshots: {
    views: number;
    source: "CREATOR" | "STAFF" | "API";
    takenAt: string;
    by: string | null;
  }[];
  timeline: { at: string; label: string; by?: string | null }[];
}

export interface CreatorFile {
  id: string;
  phone: string | null;
  email: string | null;
  country: string;
  createdAt: string;
  priorityRank: number;
  profiles: { type: ProfileType; level: number }[];
  skills: {
    specialties: string[];
    languages: string[];
    countries: string[];
    cities: string[];
    tasksPerWeek: number;
    showsFace: boolean;
  } | null;
  accounts: {
    id: string;
    network: SocialNetwork;
    handle: string;
    status: AccountStatus;
    statusReason: string | null;
    followers: number | null;
    avgStatusViews: number | null;
  }[];
  earned: number;
  devices: number;
  sharedDevice: { id: string; phone: string | null; email: string | null; country: string }[];
  posts: {
    id: string;
    network: SocialNetwork;
    campaign: { id: string; code: string; title: string };
    status: "ACCEPTED" | "SUBMITTED";
    reviewStatus: PostReviewStatus;
    reviewReason: string | null;
    riskScore: number;
    latestViews: number | null;
    validViews: number;
    earned: number;
    acceptedAt: string;
    submittedAt: string | null;
  }[];
  accountReviews: {
    id: string;
    network: SocialNetwork;
    status: AccountStatus;
    reason: string | null;
    createdAt: string;
    by: string | null;
  }[];
  payouts: {
    id: string;
    amount: number;
    status: PaymentStatus;
    operator: string | null;
    phone: string;
    failureReason: string | null;
    createdAt: string;
  }[];
}

export type PostDecision = "VALIDATE" | "NEEDS_FIX" | "REJECT" | "SUSPEND_ACCOUNT";

export const staffPostsApi = {
  list: (filters: {
    status?: PostReviewStatus | "ALL";
    network?: SocialNetwork;
    country?: string;
    q?: string;
    sort?: "risk" | "date";
  }) => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v) as [string, string][],
    );
    return call<{
      counts: Record<PostReviewStatus, number>;
      items: StaffPostRow[];
    }>(`/staff/posts?${params}`);
  },
  get: (id: string) => call<PostDossier>(`/staff/posts/${id}`),
  review: (
    id: string,
    input: { decision: PostDecision; views?: number; reason?: string },
  ) =>
    call<PostDossier>(`/staff/posts/${id}/review`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  creator: (id: string) => call<CreatorFile>(`/staff/creators/${id}`),
};

// ---- Modules switched on by the team ----------------------------------------

export type ModuleKey = "LIVE_SALES";

export interface PlatformModuleView {
  key: ModuleKey;
  name: string;
  description: string;
  enabled: boolean;
  updatedAt: string | null;
}

const patch = (body: object) => ({
  method: "PATCH",
  body: JSON.stringify(body),
});

// The list of switched-on modules is public; only super admins switch them.
export const modulesApi = {
  enabled: () => call<ModuleKey[]>("/modules"),
  all: () => call<PlatformModuleView[]>("/staff/modules"),
  set: (key: ModuleKey, enabled: boolean) =>
    call<{ key: ModuleKey; enabled: boolean }>(
      `/staff/modules/${key}`,
      patch({ enabled }),
    ),
};

// ---- Live selling on TikTok -----------------------------------------------

export type LiveSaleStatus = "SCHEDULED" | "RUNNING" | "ENDED" | "CANCELLED";
export type LiveLeadStatus =
  | "NEW"
  | "CONTACTED"
  | "PAID"
  | "DELIVERED"
  | "CANCELLED";
export type LiveIntent =
  | "achat"
  | "question_prix"
  | "question_produit"
  | "question_livraison"
  | "annulation"
  | "autre";

export const LIVE_STATUS_LABELS: Record<LiveSaleStatus, string> = {
  SCHEDULED: "Planifié",
  RUNNING: "En direct",
  ENDED: "Terminé",
  CANCELLED: "Annulé",
};

export const LIVE_STATUS_TONES: Record<LiveSaleStatus, string> = {
  SCHEDULED: "pending",
  RUNNING: "paid",
  ENDED: "neutral",
  CANCELLED: "refused",
};

export const LEAD_STATUS_LABELS: Record<LiveLeadStatus, string> = {
  NEW: "Nouveau",
  CONTACTED: "Contacté",
  PAID: "Payé",
  DELIVERED: "Livré",
  CANCELLED: "Annulé",
};

export const INTENT_LABELS: Record<LiveIntent, string> = {
  achat: "Achat",
  question_prix: "Prix",
  question_produit: "Question",
  question_livraison: "Livraison",
  annulation: "Annulation",
  autre: "Autre",
};

export interface LiveProduct {
  id: string;
  name: string;
  // FCFA.
  price: number;
  // null: no stock limit.
  stock: number | null;
  active: boolean;
}

export interface LiveSale {
  id: string;
  title: string;
  tiktokUsername: string;
  scheduledAt: string;
  demo: boolean;
  // Products of the day; empty means all active products.
  productIds: string[];
  status: LiveSaleStatus;
  startedAt: string | null;
  endedAt: string | null;
  viewers: number | null;
  sourceState: string | null;
  sourceMessage: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface LiveLeadItem {
  productId: string | null;
  name: string;
  quantity: number;
  variant: string | null;
  unitPrice: number | null;
}

export interface LiveLead {
  id: string;
  // The buyer sends it on WhatsApp to give their number.
  code: string;
  tiktokUser: string;
  nickname: string;
  intent: LiveIntent;
  items: LiveLeadItem[];
  total: number | null;
  reply: string | null;
  status: LiveLeadStatus;
  // The buyer wrote a number in a comment; it was masked, not kept.
  phoneSeen: boolean;
  firstAt: string;
  lastAt: string;
}

export interface LiveComment {
  id: string;
  tiktokUser: string;
  nickname: string;
  text: string;
  intent: LiveIntent | null;
  by: "IA" | "mots-clés" | null;
  at: string;
}

export interface LiveBoard {
  live: LiveSale;
  stats: {
    comments: number;
    interested: number;
    buyers: number;
    cancelled: number;
    paid: number;
    forecast: number;
  };
  leads: LiveLead[];
  comments: LiveComment[];
  products: (Omit<LiveProduct, "active"> & { left: number | null })[];
  running: boolean;
  ai: boolean;
}

export interface LiveInput {
  title: string;
  tiktokUsername: string;
  scheduledAt: string;
  demo?: boolean;
  productIds?: string[];
}

export interface StaffLiveRow extends LiveSale {
  seller: StaffUser & { country: string };
  _count: { leads: number; comments: number };
}

export const liveApi = {
  products: () => call<LiveProduct[]>("/me/live/products"),
  addProduct: (input: Omit<LiveProduct, "id" | "active">) =>
    call<LiveProduct>("/me/live/products", post(input)),
  updateProduct: (id: string, input: Partial<Omit<LiveProduct, "id">>) =>
    call<LiveProduct>(`/me/live/products/${id}`, patch(input)),
  deleteProduct: (id: string) =>
    call<void>(`/me/live/products/${id}`, { method: "DELETE" }),
  sales: () =>
    call<(LiveSale & { _count: { leads: number } })[]>("/me/live/sales"),
  create: (input: LiveInput) => call<LiveSale>("/me/live/sales", post(input)),
  update: (id: string, input: Partial<LiveInput>) =>
    call<LiveSale>(`/me/live/sales/${id}`, patch(input)),
  board: (id: string) => call<LiveBoard>(`/me/live/sales/${id}`),
  start: (id: string) =>
    call<LiveSale & { running: boolean }>(`/me/live/sales/${id}/start`, post({})),
  stop: (id: string) => call<LiveSale>(`/me/live/sales/${id}/stop`, post({})),
  cancel: (id: string) =>
    call<LiveSale>(`/me/live/sales/${id}/cancel`, post({})),
  addLead: (
    id: string,
    input: {
      tiktokUser: string;
      items?: { productId: string; quantity: number; variant?: string }[];
    },
  ) => call<LiveLead>(`/me/live/sales/${id}/leads`, post(input)),
  setLead: (id: string, leadId: string, status: LiveLeadStatus) =>
    call<LiveLead>(`/me/live/sales/${id}/leads/${leadId}`, patch({ status })),
};

export const staffLiveApi = {
  list: (status?: LiveSaleStatus) =>
    call<StaffLiveRow[]>(`/staff/live/sales${status ? `?status=${status}` : ""}`),
  cancel: (id: string, reason: string) =>
    call<LiveSale>(`/staff/live/sales/${id}/cancel`, post({ reason })),
};
