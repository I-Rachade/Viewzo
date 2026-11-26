import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { prismaFor } from "../src/db";
import { makeUser, tokenFor } from "./helpers";

function withdraw(token: string, amount: number) {
  return SELF.fetch("https://api.test/wallet/withdrawals", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ amount, beneficiaryName: "Ama Mensah" }),
  });
}

async function balanceOf(token: string) {
  const res = await SELF.fetch("https://api.test/wallet", { headers: { authorization: `Bearer ${token}` } });
  return ((await res.json()) as any).available as number;
}

describe("withdrawals without interactive transactions", () => {
  it("holds the amount and lowers the balance", async () => {
    const { email } = await makeUser({ level: 2, balance: 5000 });
    const token = await tokenFor(email);
    const res = await withdraw(token, 2000);
    expect(res.status).toBe(201);
    expect(await balanceOf(token)).toBe(3000);
  });

  it("refuses more than the balance and writes nothing", async () => {
    const { email, user } = await makeUser({ level: 2, balance: 1500 });
    const token = await tokenFor(email);
    const res = await withdraw(token, 2000);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toBe("Solde disponible insuffisant");
    // The batch is all or nothing: no payment row without its transaction.
    expect(await prismaFor(env).payment.count({ where: { userId: user.id } })).toBe(0);
  });

  it("20 withdrawals at the same moment never spend money twice", async () => {
    const { email, user } = await makeUser({ level: 2, balance: 5000 });
    const token = await tokenFor(email);
    const results = await Promise.all(Array.from({ length: 20 }, () => withdraw(token, 1000)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 400)).toHaveLength(15);
    expect(await balanceOf(token)).toBe(0);
    const db = prismaFor(env);
    expect(await db.payment.count({ where: { userId: user.id } })).toBe(5);
    expect(await db.transaction.count({ where: { userId: user.id, type: "WITHDRAWAL" } })).toBe(5);
  });

  it("money not yet available or frozen cannot be withdrawn", async () => {
    const { email, user } = await makeUser({ level: 2 });
    const db = prismaFor(env);
    await db.transaction.createMany({
      data: [
        { userId: user.id, type: "EARNING", amount: 3000, availableAt: new Date(Date.now() + 86_400_000) },
        { userId: user.id, type: "EARNING", amount: 3000, frozen: true },
      ],
    });
    expect((await withdraw(await tokenFor(email), 1000)).status).toBe(400);
  });

  it("is closed below level 2", async () => {
    const { email } = await makeUser({ level: 1, balance: 5000 });
    expect((await withdraw(await tokenFor(email), 1000)).status).toBe(403);
  });

  it("two finance clicks at the same moment approve once", async () => {
    const { email } = await makeUser({ level: 2, balance: 5000 });
    const payment = (await (await withdraw(await tokenFor(email), 1000)).json()) as any;
    const finance = await makeUser({ staffRole: "FINANCE" });
    const staffToken = await tokenFor(finance.email);
    const approve = () =>
      SELF.fetch(`https://api.test/staff/wallet/withdrawals/${payment.id}/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${staffToken}` },
      });
    const statuses = (await Promise.all([approve(), approve(), approve()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
  });

  it("a finished payment is never reopened, even by raw SQL", async () => {
    const { email } = await makeUser({ level: 2, balance: 5000 });
    const payment = (await (await withdraw(await tokenFor(email), 1000)).json()) as any;
    await env.DB.prepare(`UPDATE "Payment" SET "status" = 'SUCCEEDED' WHERE "id" = ?`).bind(payment.id).run();
    await expect(
      env.DB.prepare(`UPDATE "Payment" SET "status" = 'REQUESTED' WHERE "id" = ?`).bind(payment.id).run(),
    ).rejects.toThrow(/PAYMENT_FINAL/);
  });
});
