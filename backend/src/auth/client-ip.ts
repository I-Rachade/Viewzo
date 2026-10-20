import type { Request } from 'express';

/**
 * The caller's address. In production Caddy overwrites X-Viewzo-Client-Ip
 * with the visitor's address (taken from Cloudflare only when the request
 * really comes from Cloudflare), and the API is reachable only through Caddy.
 * Other forwarding headers are client-controlled and ignored.
 */
export function clientIp(req: Request): string | undefined {
  const v = req.headers['x-viewzo-client-ip'];
  const fromProxy = (Array.isArray(v) ? v[0] : v)?.trim();
  return (fromProxy || req.ip || req.socket?.remoteAddress)?.slice(0, 64);
}
