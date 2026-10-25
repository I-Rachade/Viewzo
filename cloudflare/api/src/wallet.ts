import { Hono } from "hono";
import { randomBytes, randomUUID } from "node:crypto";
import { requireAuth, type AuthVars } from "./auth";
import { prismaFor, type Db } from "./db";
import type { Env } from "./env";
import { fail } from "./errors";

const CURRENCY = "XOF";

// How Prisma writes DateTime into D1, so raw SQL writes the same text.
export const dbDate = (d: Date) => d.toISOString().replace("Z", "+00:00");

async function sumWhere(db: Db, userId: string, where: object) {
  const r = await db.transaction.aggregate({ where: { ...where, userId }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

/** Available balance, same formula as the trigger Transaction_no_overdraft. */
export async function balance(db: Db, userId: string, now = new Date()) {
  const [available, pending] = await Promise.all([
    sumWhere(db, userId, { status: "COMPLETED", availableAt: { lte: now }, frozen: false }),
    sumWhere(db, userId, { status: "PENDING", amount: { lt: 0 } }),
  ]);
  return available + pending;
}

/**
 * Asks for a withdrawal. The payment and the held amount are written in one
 * D1 batch: both or neither. The balance check is done by the database
 * (trigger Transaction_no_overdraft) inside that batch, not by reading the
 * balance first, so parallel requests cannot spend the same money twice.
 */
export async function requestWithdrawal(
  env: Env,
  userId: string,
  input: { amount: number; phone: string; beneficiaryName: string; provider: string },
) {
  const paymentId = randomUUID();
  const now = dbDate(new Date());
  const reference = `R${Date.now().toString(36)}${randomBytes(4).toString("hex")}`.toUpperCase();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "Payment" ("id","userId","kind","provider","reference","amount","currency","phone","beneficiaryName","status","createdAt","updatedAt")
         VALUES (?,?,'PAYOUT',?,?,?,?,?,?,'REQUESTED',?,?)`,
      ).bind(paymentId, userId, input.provider, reference, input.amount, CURRENCY, input.phone, input.beneficiaryName, now, now),
      env.DB.prepare(
        `INSERT INTO "Transaction" ("id","userId","type","amount","currency","status","availableAt","frozen","paymentId","createdAt","updatedAt")
         VALUES (?,?,'WITHDRAWAL',?,?,'PENDING',?,0,?,?,?)`,
      ).bind(randomUUID(), userId, -input.amount, CURRENCY, now, paymentId, now, now),
    ]);
  } catch (err) {
    if (String(err).includes("INSUFFICIENT_BALANCE")) fail(400, "Solde disponible insuffisant");
    throw err;
  }
  return { id: paymentId, reference, amount: input.amount, status: "REQUESTED" };
}

/**
 * Moves a withdrawal from REQUESTED to PROCESSING. The status in the WHERE
 * clause makes it a compare-and-set: of two finance clicks at the same
 * moment, only one changes the row.
 */
export async function approveWithdrawal(env: Env, paymentId: string, staffId: string) {
  const r = await env.DB.prepare(
    `UPDATE "Payment" SET "status" = 'PROCESSING', "reviewedById" = ?, "updatedAt" = ?
     WHERE "id" = ? AND "kind" = 'PAYOUT' AND "status" = 'REQUESTED'`,
  )
    .bind(staffId, dbDate(new Date()), paymentId)
    .run();
  if (r.meta.changes !== 1) fail(409, "Ce retrait a déjà été traité");
  return { id: paymentId, status: "PROCESSING" };
}

export const wallet = new Hono<{ Bindings: Env; Variables: AuthVars }>();
wallet.use("*", requireAuth);

wallet.get("/", async (c) => {
  const db = prismaFor(c.env);
  return c.json({ available: await balance(db, c.var.userId), currency: CURRENCY });
});

wallet.post("/withdrawals", async (c) => {
  const body = await c.req
    .json<{ amount?: number; phone?: string; beneficiaryName?: string }>()
    .catch(() => ({}) as never);
  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) fail(400, "Montant invalide");
  if (amount < Number(c.env.MIN_WITHDRAWAL)) fail(400, `Retrait minimum : ${c.env.MIN_WITHDRAWAL} FCFA`);
  const db = prismaFor(c.env);
  const user = await db.user.findUniqueOrThrow({ where: { id: c.var.userId }, include: { profiles: true } });
  if (Math.max(0, ...user.profiles.map((p) => p.level)) < 2) {
    fail(403, "Les retraits s’ouvrent au niveau 2, après vérification de ton identité");
  }
  const phone = body.phone ?? user.phone;
  if (!phone || !body.beneficiaryName?.trim()) fail(400, "Numéro et nom du bénéficiaire requis");
  // The probe pays out through the local test provider only.
  return c.json(
    await requestWithdrawal(c.env, user.id, {
      amount,
      phone,
      beneficiaryName: body.beneficiaryName.trim(),
      provider: "local",
    }),
    201,
  );
});

export const staffWallet = new Hono<{ Bindings: Env; Variables: AuthVars }>();
staffWallet.use("*", requireAuth);

staffWallet.post("/withdrawals/:id/approve", async (c) => {
  const staff = await prismaFor(c.env).user.findUniqueOrThrow({ where: { id: c.var.userId } });
  if (staff.role !== "STAFF" || !["FINANCE", "SUPER_ADMIN"].includes(staff.staffRole ?? "")) {
    fail(403, "Forbidden");
  }
  return c.json(await approveWithdrawal(c.env, c.req.param("id"), staff.id));
});
