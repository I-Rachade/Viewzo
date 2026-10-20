import type { Request, Response } from 'express';
import type { IssuedSession } from './sessions.service';

export const REFRESH_COOKIE = 'vz_refresh';

/**
 * The web app sends `X-Viewzo-Client: web`: its refresh token goes into an
 * httpOnly cookie that page scripts can't read, so an injected script can't
 * steal a lasting session. The mobile app keeps it in secure storage and gets
 * it in the body.
 */
export function isWebClient(req: Request) {
  return req.headers['x-viewzo-client'] === 'web';
}

export function sendSession<T extends IssuedSession>(
  req: Request,
  res: Response,
  body: T,
) {
  if (!isWebClient(req)) return body;
  res.cookie(REFRESH_COOKIE, body.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth',
    expires: body.refreshExpiresAt,
  });
  const { refreshToken: _hidden, ...rest } = body;
  void _hidden;
  return rest;
}

export function clearSession(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
}

/** The refresh token from the body (app) or the cookie (web). */
export function refreshTokenFrom(req: Request, bodyToken?: string) {
  if (bodyToken) return bodyToken;
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
