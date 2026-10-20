import { SocialNetwork } from '@prisma/client';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  refreshExpiresAt?: Date;
  externalId?: string;
  handle?: string;
  // Facebook page tokens, kept with the connection.
  extra?: Record<string, string>;
}

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
}

/**
 * One platform's login ("Connecter mon compte") and token refresh. The
 * creator logs in on the platform, which sends back a code for tokens.
 */
export interface OAuthProvider {
  network: SocialNetwork;
  /** Name of the env vars holding the app's id and secret. */
  env: [string, string];
  authorizeUrl(app: OAuthApp, redirectUri: string, state: string): string;
  exchange(
    app: OAuthApp,
    code: string,
    redirectUri: string,
  ): Promise<OAuthTokens>;
  /** Null when this platform's tokens don't need refreshing. */
  refresh?(app: OAuthApp, tokens: OAuthTokens): Promise<OAuthTokens>;
}

const seconds = (s: unknown) =>
  typeof s === 'number' && s > 0 ? new Date(Date.now() + s * 1000) : undefined;

async function json<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: unknown;
    error_description?: string;
  };
  if (!res.ok || body.error) {
    const detail =
      body.error_description ??
      (body.error === undefined
        ? `HTTP ${res.status}`
        : JSON.stringify(body.error));
    throw new Error(`${what} : ${detail}`);
  }
  return body;
}

const form = (data: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data),
});

// TikTok Login Kit v2, scopes to read the creator's own videos.
export const tiktok: OAuthProvider = {
  network: SocialNetwork.TIKTOK,
  env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  authorizeUrl: (app, redirectUri, state) =>
    `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
      client_key: app.clientId,
      scope: 'user.info.basic,video.list',
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    })}`,
  async exchange(app, code, redirectUri) {
    return tiktokTokens(
      await fetch(
        'https://open.tiktokapis.com/v2/oauth/token/',
        form({
          client_key: app.clientId,
          client_secret: app.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      ),
    );
  },
  async refresh(app, tokens) {
    return tiktokTokens(
      await fetch(
        'https://open.tiktokapis.com/v2/oauth/token/',
        form({
          client_key: app.clientId,
          client_secret: app.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken ?? '',
        }),
      ),
    );
  },
};

async function tiktokTokens(res: Response): Promise<OAuthTokens> {
  const b = await json<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_expires_in: number;
    open_id: string;
  }>(res, 'TikTok');
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresAt: seconds(b.expires_in),
    refreshExpiresAt: seconds(b.refresh_expires_in),
    externalId: b.open_id,
  };
}

// Instagram API with Instagram Login: professional (creator or business) accounts.
export const instagram: OAuthProvider = {
  network: SocialNetwork.INSTAGRAM,
  env: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  authorizeUrl: (app, redirectUri, state) =>
    `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_insights',
      state,
    })}`,
  async exchange(app, code, redirectUri) {
    const short = await json<{ access_token: string; user_id: number }>(
      await fetch(
        'https://api.instagram.com/oauth/access_token',
        form({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }),
      ),
      'Instagram',
    );
    // Short-lived (1 h) token traded for a 60-day one.
    const long = await json<{ access_token: string; expires_in: number }>(
      await fetch(
        `https://graph.instagram.com/access_token?${new URLSearchParams({
          grant_type: 'ig_exchange_token',
          client_secret: app.clientSecret,
          access_token: short.access_token,
        })}`,
      ),
      'Instagram',
    );
    const me = await json<{ username?: string }>(
      await fetch(
        `https://graph.instagram.com/me?fields=username&access_token=${encodeURIComponent(long.access_token)}`,
      ),
      'Instagram',
    );
    return {
      accessToken: long.access_token,
      expiresAt: seconds(long.expires_in),
      externalId: String(short.user_id),
      handle: me.username,
    };
  },
  async refresh(_app, tokens) {
    const b = await json<{ access_token: string; expires_in: number }>(
      await fetch(
        `https://graph.instagram.com/refresh_access_token?${new URLSearchParams(
          {
            grant_type: 'ig_refresh_token',
            access_token: tokens.accessToken,
          },
        )}`,
      ),
      'Instagram',
    );
    return {
      ...tokens,
      accessToken: b.access_token,
      expiresAt: seconds(b.expires_in),
    };
  },
};

const GRAPH = 'https://graph.facebook.com/v21.0';

// Facebook Login for Pages: video views of the pages the creator manages.
export const facebook: OAuthProvider = {
  network: SocialNetwork.FACEBOOK,
  env: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  authorizeUrl: (app, redirectUri, state) =>
    `https://www.facebook.com/v21.0/dialog/oauth?${new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'pages_show_list,pages_read_engagement,read_insights',
    })}`,
  async exchange(app, code, redirectUri) {
    const short = await json<{ access_token: string }>(
      await fetch(
        `${GRAPH}/oauth/access_token?${new URLSearchParams({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          redirect_uri: redirectUri,
          code,
        })}`,
      ),
      'Facebook',
    );
    const long = await json<{ access_token: string; expires_in?: number }>(
      await fetch(
        `${GRAPH}/oauth/access_token?${new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: app.clientId,
          client_secret: app.clientSecret,
          fb_exchange_token: short.access_token,
        })}`,
      ),
      'Facebook',
    );
    // Page tokens made from a long-lived user token don't expire.
    const pages = await json<{
      data: { id: string; name: string; access_token: string }[];
    }>(
      await fetch(
        `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(long.access_token)}`,
      ),
      'Facebook',
    );
    return {
      accessToken: long.access_token,
      expiresAt: seconds(long.expires_in),
      handle: pages.data.map((p) => p.name).join(', ') || undefined,
      extra: Object.fromEntries(pages.data.map((p) => [p.id, p.access_token])),
    };
  },
};

// Threads API: views of the creator's own threads.
export const threads: OAuthProvider = {
  network: SocialNetwork.THREADS,
  env: ['THREADS_APP_ID', 'THREADS_APP_SECRET'],
  authorizeUrl: (app, redirectUri, state) =>
    `https://threads.net/oauth/authorize?${new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      scope: 'threads_basic,threads_manage_insights',
      response_type: 'code',
      state,
    })}`,
  async exchange(app, code, redirectUri) {
    const short = await json<{ access_token: string; user_id: number }>(
      await fetch(
        'https://graph.threads.net/oauth/access_token',
        form({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }),
      ),
      'Threads',
    );
    const long = await json<{ access_token: string; expires_in: number }>(
      await fetch(
        `https://graph.threads.net/access_token?${new URLSearchParams({
          grant_type: 'th_exchange_token',
          client_secret: app.clientSecret,
          access_token: short.access_token,
        })}`,
      ),
      'Threads',
    );
    const me = await json<{ username?: string }>(
      await fetch(
        `https://graph.threads.net/v1.0/me?fields=username&access_token=${encodeURIComponent(long.access_token)}`,
      ),
      'Threads',
    );
    return {
      accessToken: long.access_token,
      expiresAt: seconds(long.expires_in),
      externalId: String(short.user_id),
      handle: me.username,
    };
  },
  async refresh(_app, tokens) {
    const b = await json<{ access_token: string; expires_in: number }>(
      await fetch(
        `https://graph.threads.net/refresh_access_token?${new URLSearchParams({
          grant_type: 'th_refresh_token',
          access_token: tokens.accessToken,
        })}`,
      ),
      'Threads',
    );
    return {
      ...tokens,
      accessToken: b.access_token,
      expiresAt: seconds(b.expires_in),
    };
  },
};

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  tiktok,
  instagram,
  facebook,
  threads,
];
