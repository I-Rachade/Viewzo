import { PostReviewStatus, Prisma, SocialNetwork } from '@prisma/client';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Dated screenshots of a post, counted from when it was sent. Each step is
// done by a screenshot sent before it closes and after the previous one.
export const CAPTURE_STEPS = [
  { label: 'H+1', at: HOUR, until: 12 * HOUR },
  { label: 'J+1', at: DAY, until: 4 * DAY },
  { label: 'J+7', at: 7 * DAY, until: 18 * DAY },
  { label: 'J+30', at: 30 * DAY, until: 32 * DAY },
] as const;

// Screenshots for the dated readings can come until the last step closes.
export const CAPTURE_WINDOW = CAPTURE_STEPS[CAPTURE_STEPS.length - 1].until;

// The team checks a validated post is still online this long after posting.
export const ONLINE_CHECK_AFTER = 30 * DAY;

/** Where a post is in its dated screenshots, as the creator's app shows it. */
export function capturePlan(
  submittedAt: Date | null,
  screenshots: { uploadedAt: Date }[],
  now = new Date(),
) {
  if (!submittedAt) return null;
  const t0 = submittedAt.getTime();
  const times = screenshots.map((p) => p.uploadedAt.getTime());
  const steps = CAPTURE_STEPS.map((step, i) => {
    const from = t0 + (i === 0 ? 0 : CAPTURE_STEPS[i - 1].until);
    const done = times
      .filter((t) => t >= from && t < t0 + step.until)
      .sort((a, b) => a - b)[0];
    return {
      label: step.label,
      dueAt: new Date(t0 + step.at),
      closesAt: t0 + step.until,
      doneAt: done === undefined ? null : new Date(done),
    };
  });
  const next = steps.find((s) => !s.doneAt && now.getTime() < s.closesAt);
  return {
    steps: steps.map((s) => ({
      label: s.label,
      dueAt: s.dueAt,
      doneAt: s.doneAt,
    })),
    nextDueAt: next?.dueAt ?? null,
  };
}

/** The step a reminder is due for now, or -1. */
export function dueCaptureStep(submittedAt: Date, now = new Date()) {
  const elapsed = now.getTime() - submittedAt.getTime();
  return CAPTURE_STEPS.findIndex((s) => elapsed >= s.at && elapsed < s.until);
}

/** Validated posts waiting for their 30-day online check. */
export function onlineCheckDue(
  now = new Date(),
): Prisma.TaskAssignmentWhereInput {
  return {
    reviewStatus: PostReviewStatus.VALIDATED,
    onlineCheckedAt: null,
    submittedAt: { lte: new Date(now.getTime() - ONLINE_CHECK_AFTER) },
    // A statut disappears after 24 h by design.
    task: { network: { not: SocialNetwork.WHATSAPP_STATUS } },
  };
}
