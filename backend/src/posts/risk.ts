import { ProofKind, SocialNetwork, ViewSource } from '@prisma/client';

export type SignalLevel = 'HIGH' | 'MEDIUM';

export interface RiskSignal {
  code: string;
  level: SignalLevel;
  message: string;
}

export interface RiskInput {
  network: SocialNetwork;
  acceptedAt: Date;
  postUrl: string | null;
  snapshots: { views: number; source: ViewSource; takenAt: Date }[];
  proofs: {
    kind: ProofKind;
    capturedAt: Date | null;
    uploadedAt: Date;
    declaredViews: number | null;
  }[];
  // The creator's account on this network, as checked by the team.
  audience: { followers: number | null; avgStatusViews: number | null } | null;
  // Screenshots of this post also sent for another post.
  duplicateImages: number;
  // Other creators who sent proofs from the same phone or connection.
  sharedDeviceCreators: number;
  history: { reviewed: number; rejected: number };
}

const WEIGHT: Record<SignalLevel, number> = { HIGH: 35, MEDIUM: 15 };
const HOUR = 3600 * 1000;

// Domains a post link may use, per network.
const HOSTS: Partial<Record<SocialNetwork, string[]>> = {
  TIKTOK: ['tiktok.com'],
  INSTAGRAM: ['instagram.com'],
  FACEBOOK: ['facebook.com', 'fb.watch', 'fb.com'],
  YOUTUBE: ['youtube.com', 'youtu.be'],
  SNAPCHAT: ['snapchat.com'],
  X: ['x.com', 'twitter.com'],
  LINKEDIN: ['linkedin.com'],
  THREADS: ['threads.net', 'threads.com'],
  TELEGRAM: ['t.me', 'telegram.me'],
};

export function linkMatchesNetwork(network: SocialNetwork, url: string) {
  const hosts = HOSTS[network];
  if (!hosts) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

const fmt = (n: number) => n.toLocaleString('fr-FR');

/**
 * Fraud signals of one post and a 0-100 risk score. Pure: everything it
 * needs is passed in, so the rules are easy to test and to explain.
 */
export function assessRisk(input: RiskInput) {
  const signals: RiskSignal[] = [];
  const add = (code: string, level: SignalLevel, message: string) =>
    signals.push({ code, level, message });

  const series = [...input.snapshots].sort(
    (a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
  );
  const latest = series.at(-1)?.views ?? 0;
  const isStatus = input.network === SocialNetwork.WHATSAPP_STATUS;
  const usual = isStatus ? input.audience?.avgStatusViews : null;

  // A jump: in one reading, more views per hour than the account usually
  // gets for a whole post, making up a large share of the total.
  let worst: { gain: number; hours: number } | null = null;
  for (let i = 1; i < series.length; i++) {
    const gain = series[i].views - series[i - 1].views;
    const hours = Math.max(
      1,
      (series[i].takenAt.getTime() - series[i - 1].takenAt.getTime()) / HOUR,
    );
    if (!worst || gain / hours > worst.gain / worst.hours) {
      worst = { gain, hours };
    }
  }
  if (worst && worst.gain > 0) {
    const perHour = worst.gain / worst.hours;
    const reference = usual ?? 1000;
    if (perHour > reference && worst.gain > latest * 0.4) {
      add(
        'SPIKE',
        'HIGH',
        `Saut de ${fmt(worst.gain)} vues en ${Math.round(worst.hours)} h` +
          (usual
            ? `, le compte fait ${fmt(usual)} vues par statut en moyenne`
            : ''),
      );
    }
  }

  for (let i = 1; i < series.length; i++) {
    if (series[i].views < series[i - 1].views) {
      add(
        'VIEWS_DECREASE',
        'MEDIUM',
        `Les vues baissent entre deux relevés (${fmt(series[i - 1].views)} puis ${fmt(series[i].views)})`,
      );
      break;
    }
  }

  if (isStatus && usual && latest > usual * 2) {
    add(
      'ABOVE_AUDIENCE',
      'HIGH',
      `${fmt(latest)} vues, plus du double de la moyenne du compte (${fmt(usual)})`,
    );
  } else if (isStatus && usual && latest > usual * 1.5) {
    add(
      'ABOVE_AUDIENCE',
      'MEDIUM',
      `${fmt(latest)} vues, nettement au-dessus de la moyenne du compte (${fmt(usual)})`,
    );
  } else if (
    !isStatus &&
    input.audience?.followers &&
    latest > input.audience.followers * 10
  ) {
    add(
      'ABOVE_AUDIENCE',
      'MEDIUM',
      `${fmt(latest)} vues pour ${fmt(input.audience.followers)} abonnés`,
    );
  }

  const screenshots = input.proofs.filter(
    (p) => p.kind === ProofKind.SCREENSHOT,
  );
  if (input.duplicateImages > 0) {
    add(
      'DUPLICATE_IMAGE',
      'HIGH',
      'Une capture identique a déjà été envoyée pour une autre publication',
    );
  }
  if (
    screenshots.some((p) => p.capturedAt && p.capturedAt < input.acceptedAt)
  ) {
    add(
      'CAPTURED_BEFORE_ACCEPT',
      'HIGH',
      'Une capture date d’avant l’acceptation de la tâche',
    );
  }
  const undated = screenshots.filter((p) => !p.capturedAt).length;
  if (undated) {
    add(
      'MISSING_CAPTURE_TIME',
      'MEDIUM',
      `${undated} capture${undated > 1 ? 's' : ''} sans date de prise`,
    );
  }
  if (isStatus && screenshots.length === 0) {
    add('NO_SCREENSHOT', 'MEDIUM', 'Statut WhatsApp sans aucune capture');
  }
  if (input.postUrl && !linkMatchesNetwork(input.network, input.postUrl)) {
    add(
      'LINK_MISMATCH',
      'HIGH',
      'Le lien ne correspond pas au réseau de la tâche',
    );
  }
  if (input.sharedDeviceCreators > 0) {
    add(
      'SHARED_DEVICE',
      'MEDIUM',
      `Même téléphone ou connexion que ${input.sharedDeviceCreators} autre${input.sharedDeviceCreators > 1 ? 's' : ''} créateur${input.sharedDeviceCreators > 1 ? 's' : ''}`,
    );
  }
  const { reviewed, rejected } = input.history;
  if (reviewed >= 3 && rejected / reviewed > 0.3) {
    add(
      'HISTORY',
      'MEDIUM',
      `${rejected} publication${rejected > 1 ? 's' : ''} refusée${rejected > 1 ? 's' : ''} sur ${reviewed}`,
    );
  }

  const score = Math.min(
    100,
    signals.reduce((s, x) => s + WEIGHT[x.level], 0),
  );
  return { score, signals };
}
