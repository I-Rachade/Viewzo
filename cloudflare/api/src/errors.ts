import { HTTPException } from "hono/http-exception";

// Same shape as NestJS errors, so the web and the app read them unchanged:
// { statusCode, message, code? }.
export function fail(status: 400 | 401 | 403 | 404 | 409 | 429, message: string, code?: string): never {
  throw new HTTPException(status, {
    res: Response.json({ statusCode: status, message, ...(code ? { code } : {}) }, { status }),
  });
}
