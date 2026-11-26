import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { prismaFor } from "../src/db";
import { dbDate } from "../src/wallet";
import { makeUser } from "./helpers";

// Prisma features the backend uses that work differently on SQLite/D1.
// Each test shows the replacement the port will use.
describe("Prisma queries of the backend on D1", () => {
  it("stores DateTime as the text the data import writes (scripts/pg-to-d1.mjs)", async () => {
    const { user } = await makeUser();
    const row = await env.DB.prepare(`SELECT "createdAt" FROM "User" WHERE "id" = ?`).bind(user.id).first<{
      createdAt: string;
    }>();
    expect(row!.createdAt).toBe(dbDate(user.createdAt));
    expect(row!.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$/);
  });

  it("finds rows by a list value without `has` (lists are JSON text)", async () => {
    const db = prismaFor(env);
    const { user } = await makeUser({ staffRole: "MODERATOR" });
    await db.user.update({ where: { id: user.id }, data: { staffCountries: JSON.stringify(["TG", "BJ"]) } });

    // backend: where: { staffCountries: { has: 'BJ' } }
    const viaJson = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE EXISTS (SELECT 1 FROM json_each("staffCountries") WHERE value = ${"BJ"})`;
    expect(viaJson.map((r) => r.id)).toContain(user.id);
    // Same result with Prisma alone, since codes never contain quotes.
    const viaPrisma = await db.user.findMany({ where: { staffCountries: { contains: '"BJ"' } } });
    expect(viaPrisma.map((u) => u.id)).toContain(user.id);
    expect(await db.user.count({ where: { id: user.id, staffCountries: { contains: '"GH"' } } })).toBe(0);
  });

  it("searches without mode: 'insensitive': ASCII case is ignored, accents are not", async () => {
    const db = prismaFor(env);
    const { user } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { firstName: "Éloïse Kossiwa" } });
    const find = (q: string) => db.user.count({ where: { id: user.id, firstName: { contains: q } } });
    expect(await find("KOSSIWA")).toBe(1);
    // SQLite LIKE only folds A-Z: the port needs a normalised search column
    // for names with accents.
    expect(await find("éloïse")).toBe(0);
    expect(await find("Éloïse")).toBe(1);
  });

  it("supports createMany and distinct, used by notifications and reviews", async () => {
    const db = prismaFor(env);
    const { user } = await makeUser();
    const created = await db.userProfile.createMany({
      data: [
        { userId: user.id, type: "ADVERTISER" },
        { userId: user.id, type: "PROVIDER" },
      ],
    });
    expect(created.count).toBe(2);
    const types = await db.userProfile.findMany({ where: { userId: user.id }, distinct: ["userId"] });
    expect(types).toHaveLength(1);
  });
});
