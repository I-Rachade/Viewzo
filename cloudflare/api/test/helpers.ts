import { env, SELF } from "cloudflare:test";
import { prismaFor } from "../src/db";
import { hashPassword } from "../src/password";

let rank = 0;

/** A user with a password, optionally at profile level 2 and with money. */
export async function makeUser(opts: { level?: number; balance?: number; staffRole?: string } = {}) {
  const db = prismaFor(env);
  rank++;
  const email = `user${rank}-${crypto.randomUUID().slice(0, 6)}@viewzo.test`;
  const user = await db.user.create({
    data: {
      email,
      country: "TG",
      priorityRank: rank,
      passwordHash: await hashPassword("secret-password"),
      role: opts.staffRole ? "STAFF" : "USER",
      staffRole: (opts.staffRole as never) ?? null,
      phone: `+2289${String(rank).padStart(7, "0")}`,
      profiles: { create: { type: "CREATOR", level: opts.level ?? 1 } },
    },
  });
  if (opts.balance) {
    await db.transaction.create({
      data: {
        userId: user.id,
        type: "EARNING",
        amount: opts.balance,
        status: "COMPLETED",
        availableAt: new Date(Date.now() - 60_000),
      },
    });
  }
  return { user, email };
}

export async function login(email: string, password = "secret-password") {
  const res = await SELF.fetch("https://api.test/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  return { res, body: (await res.json()) as any };
}

export async function tokenFor(email: string) {
  const { body } = await login(email);
  return body.accessToken as string;
}
