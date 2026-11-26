import type { Env } from "./env";
import { dbDate } from "./wallet";

// Background work without a long-running process. The backend runs its jobs
// with setInterval (posts.scheduler.ts every 10 minutes, live-offers timers);
// on Workers a Cron Trigger (wrangler.jsonc, "triggers") calls scheduled()
// instead. Each run must be short and safe to repeat, since a run can be
// retried or overlap the next one.
//
// The probe job: sessions that ended more than 7 days ago are deleted, and
// account locks that are over are lifted. Plain UPDATE/DELETE with a WHERE,
// so two runs at once do the same work once.
const KEEP_ENDED_SESSIONS_MS = 7 * 24 * 3600 * 1000;

export async function runJobs(env: Pick<Env, "DB">, now = new Date()) {
  const cutoff = dbDate(new Date(now.getTime() - KEEP_ENDED_SESSIONS_MS));
  const [sessions, locks] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM "Session" WHERE "expiresAt" < ?1 OR ("revokedAt" IS NOT NULL AND "revokedAt" < ?1)`).bind(
      cutoff,
    ),
    env.DB.prepare(`UPDATE "User" SET "lockedUntil" = NULL, "failedLogins" = 0 WHERE "lockedUntil" < ?`).bind(
      dbDate(now),
    ),
  ]);
  return { sessionsDeleted: sessions.meta.changes, locksLifted: locks.meta.changes };
}

export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(
    runJobs(env, new Date(controller.scheduledTime)).then((r) => console.log(`jobs ${controller.cron}`, JSON.stringify(r))),
  );
}
