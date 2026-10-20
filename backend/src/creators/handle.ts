import { SocialNetwork } from '@prisma/client';

export interface ParsedHandle {
  // As the platform shows it, e.g. "Ama.Togo" or "UCx…" for a YouTube channel id.
  name: string;
  // Lowercased name, or the digits of a WhatsApp number: one account, one key.
  key: string;
}

// Path parts before the name in a profile link (linkedin.com/in/name…).
const PREFIX_SEGMENTS = new Set([
  'in',
  'add',
  'c',
  'user',
  'channel',
  'company',
  's',
]);
const NAME = /^[\p{L}\p{N}._-]{1,100}$/u;

/**
 * Reads the account name from what the creator typed: "@name", "name" or a
 * profile link. Null when no name can be found.
 */
export function parseHandle(
  network: SocialNetwork,
  raw: string,
): ParsedHandle | null {
  const input = raw.trim();
  if (network === SocialNetwork.WHATSAPP_STATUS) {
    const digits = input.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15
      ? { name: input, key: digits }
      : null;
  }
  let name = input;
  const link = /^(https?:\/\/)?([\w-]+\.)+[a-z]+\//i.test(input);
  if (link) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      return null;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'profile.php') {
      name = url.searchParams.get('id') ?? '';
    } else {
      if (parts.length > 1 && PREFIX_SEGMENTS.has(parts[0].toLowerCase())) {
        parts.shift();
      }
      name = parts[0] ?? '';
    }
  }
  name = name.replace(/^@/, '');
  if (!NAME.test(name)) return null;
  return { name, key: name.toLowerCase() };
}

/** Public profile link the team opens to check the account. */
export function profileUrl(network: SocialNetwork, name: string) {
  const n = encodeURIComponent(name);
  switch (network) {
    case SocialNetwork.TIKTOK:
      return `https://www.tiktok.com/@${n}`;
    case SocialNetwork.INSTAGRAM:
      return `https://www.instagram.com/${n}`;
    case SocialNetwork.FACEBOOK:
      return /^\d+$/.test(name)
        ? `https://www.facebook.com/profile.php?id=${n}`
        : `https://www.facebook.com/${n}`;
    case SocialNetwork.YOUTUBE:
      return /^UC[\w-]{22}$/.test(name)
        ? `https://www.youtube.com/channel/${n}`
        : `https://www.youtube.com/@${n}`;
    case SocialNetwork.SNAPCHAT:
      return `https://www.snapchat.com/add/${n}`;
    case SocialNetwork.X:
      return `https://x.com/${n}`;
    case SocialNetwork.LINKEDIN:
      return `https://www.linkedin.com/in/${n}`;
    case SocialNetwork.THREADS:
      return `https://www.threads.net/@${n}`;
    case SocialNetwork.TELEGRAM:
      return `https://t.me/${n}`;
    case SocialNetwork.WHATSAPP_STATUS:
      return null;
  }
}
