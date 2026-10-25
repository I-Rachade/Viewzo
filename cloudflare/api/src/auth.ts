import { Hono, type MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import { parsePhoneNumberWithError, type CountryCode } from "libphonenumber-js";
import { createHash, randomBytes } from "node:crypto";
import { prismaFor, type Db } from "./db";
import type { Env } from "./env";
import { fail } from "./errors";
import { hashPassword, verifyPassword } from "./password";

// Same rules as backend/src/auth: 5 wrong passwords lock the account for
// 15 minutes, access tokens live 15 minutes, sessions 30 days (staff 12 h).
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_SECONDS = 15 * 60;
const USER_SESSION_MS = 30 * 24 * 3600 * 1000;
const STAFF_SESSION_MS = 12 * 3600 * 1000;
const WRONG_CREDENTIALS = "Identifiants incorrects";

export interface AuthVars {
  userId: string;
  sessionId: string;
}

type Contact = { kind: "email"; value: string } | { kind: "phone"; value: string };

function parseContact(raw: string, defaultRegion: string): Contact {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) {
    const value = trimmed.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(400, "Adresse e-mail invalide");
    return { kind: "email", value };
  }
  try {
    const phone = parsePhoneNumberWithError(trimmed, defaultRegion as CountryCode);
    if (!phone.isValid()) throw new Error();
    return { kind: "phone", value: phone.number };
  } catch {
    fail(400, "Numéro de téléphone invalide");
  }
}

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

// Compared against when the account does not exist, so a wrong identifier
// takes as long as a wrong password.
let decoyHash: Promise<string> | undefined;

async function issueSession(
  db: Db,
  env: Env,
  user: { id: string; role: string; tokenVersion: number },
  client: { userAgent?: string; ip?: string },
) {
  const id = randomBytes(16).toString("hex");
  const refreshToken = `${id}.${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + (user.role === "STAFF" ? STAFF_SESSION_MS : USER_SESSION_MS));
  await db.session.create({
    data: {
      id,
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt,
      userAgent: client.userAgent?.slice(0, 200),
      ip: client.ip,
    },
  });
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await sign(
    { sub: user.id, ver: user.tokenVersion, sid: id, iat: now, exp: now + ACCESS_TOKEN_SECONDS },
    env.JWT_SECRET,
    "HS256",
  );
  return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
}

export function userView(
  env: Env,
  user: {
    id: string;
    phone: string | null;
    email: string | null;
    firstName: string | null;
    passwordHash: string | null;
    country: string;
    priorityRank: number;
    locale: string;
    role: string;
    staffRole: string | null;
    createdAt: Date;
    profiles: { type: string; level: number }[];
  },
) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    firstName: user.firstName,
    hasPassword: user.passwordHash !== null,
    country: user.country,
    priorityRank: user.priorityRank,
    isFounder: user.priorityRank <= Number(env.FOUNDER_BADGE_LIMIT),
    locale: user.locale,
    isStaff: user.role === "STAFF" && user.staffRole !== null,
    staffRole: user.role === "STAFF" ? user.staffRole : null,
    createdAt: user.createdAt,
    profiles: user.profiles.map((p) => ({ type: p.type, level: p.level })),
  };
}

/** Bearer access token, checked against the session row on every request. */
export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let payload: { sub?: string; sid?: string; ver?: number; purpose?: string };
  try {
    payload = (await verify(token, c.env.JWT_SECRET, "HS256")) as typeof payload;
  } catch {
    fail(401, "Unauthorized");
  }
  if (payload.purpose || !payload.sub || !payload.sid) fail(401, "Unauthorized");
  const session = await prismaFor(c.env).session.findUnique({
    where: { id: payload.sid },
    select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { tokenVersion: true } } },
  });
  const active =
    !!session &&
    session.userId === payload.sub &&
    !session.revokedAt &&
    session.expiresAt > new Date() &&
    session.user.tokenVersion === (payload.ver ?? 0);
  if (!active) fail(401, "Unauthorized");
  c.set("userId", payload.sub);
  c.set("sessionId", payload.sid);
  await next();
};

export const auth = new Hono<{ Bindings: Env; Variables: AuthVars }>();

auth.post("/login", async (c) => {
  const body = await c.req.json<{ identifier?: string; password?: string }>().catch(() => ({}) as never);
  if (typeof body.identifier !== "string" || typeof body.password !== "string") {
    fail(400, "Identifiant et mot de passe requis");
  }
  const db = prismaFor(c.env);
  const contact = parseContact(body.identifier, c.env.DEFAULT_REGION);
  const user = await db.user.findUnique({
    where: contact.kind === "email" ? { email: contact.value } : { phone: contact.value },
    include: { profiles: true },
  });
  if (!user) {
    decoyHash ??= hashPassword("decoy-password-1");
    await verifyPassword(body.password, await decoyHash);
    fail(401, WRONG_CREDENTIALS);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    fail(429, `Trop de tentatives, réessaie dans ${minutes} min ou réinitialise ton mot de passe`);
  }
  if (!user.passwordHash) {
    fail(403, "Définis ton mot de passe pour te connecter", "PASSWORD_NOT_SET");
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    // One UPDATE ... RETURNING: parallel attempts all count.
    const { failedLogins } = await db.user.update({
      where: { id: user.id },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    if (failedLogins >= MAX_FAILED_LOGINS) {
      await db.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
      });
    }
    fail(401, WRONG_CREDENTIALS);
  }
  if (user.failedLogins > 0 || user.lockedUntil) {
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  }
  const session = await issueSession(db, c.env, user, {
    userAgent: c.req.header("user-agent"),
    ip: c.req.header("cf-connecting-ip"),
  });
  return c.json({ ...session, user: userView(c.env, user) });
});
