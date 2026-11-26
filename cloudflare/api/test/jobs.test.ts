import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { prismaFor } from "../src/db";
import worker from "../src/index";
import { runJobs } from "../src/jobs";
import { makeUser } from "./helpers";

const DAY = 24 * 3600 * 1000;

async function sessionFor(userId: string, data: { expiresAt: Date; revokedAt?: Date }) {
  return prismaFor(env).session.create({
    data: { userId, tokenHash: crypto.randomUUID(), ...data },
  });
}

describe("jobs on a Cron Trigger instead of setInterval", () => {
  it("removes old sessions and lifts finished locks, and is safe to run twice", async () => {
    const db = prismaFor(env);
    const { user } = await makeUser();
    const live = await sessionFor(user.id, { expiresAt: new Date(Date.now() + DAY) });
    const recentlyEnded = await sessionFor(user.id, { expiresAt: new Date(Date.now() - DAY) });
    const old = await sessionFor(user.id, { expiresAt: new Date(Date.now() - 8 * DAY) });
    const oldRevoked = await sessionFor(user.id, {
      expiresAt: new Date(Date.now() + DAY),
      revokedAt: new Date(Date.now() - 10 * DAY),
    });
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: 5, lockedUntil: new Date(Date.now() - 60_000) },
    });

    const [first, second] = await Promise.all([runJobs(env), runJobs(env)]);
    expect(first.sessionsDeleted + second.sessionsDeleted).toBe(2);

    const left = await db.session.findMany({ where: { userId: user.id }, select: { id: true } });
    expect(left.map((s) => s.id).sort()).toEqual([live.id, recentlyEnded.id].sort());
    expect(left.map((s) => s.id)).not.toContain(old.id);
    expect(left.map((s) => s.id)).not.toContain(oldRevoked.id);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  it("runs through the Worker's scheduled() handler", async () => {
    const { user } = await makeUser();
    await sessionFor(user.id, { expiresAt: new Date(Date.now() - 30 * DAY) });
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/10 * * * *", scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await prismaFor(env).session.count({ where: { userId: user.id } })).toBe(0);
  });
});
