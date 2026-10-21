import { capturePlan, dueCaptureStep } from './captures';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const t0 = new Date('2026-10-01T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

describe('dated screenshots', () => {
  it('asks for H+1, J+1, J+7 and J+30 in turn', () => {
    expect(dueCaptureStep(t0, at(30 * 60 * 1000))).toBe(-1);
    expect(dueCaptureStep(t0, at(2 * HOUR))).toBe(0);
    expect(dueCaptureStep(t0, at(DAY + HOUR))).toBe(1);
    expect(dueCaptureStep(t0, at(8 * DAY))).toBe(2);
    expect(dueCaptureStep(t0, at(30 * DAY + HOUR))).toBe(3);
    expect(dueCaptureStep(t0, at(33 * DAY))).toBe(-1);
  });

  it('counts each screenshot for the step it falls in', () => {
    const plan = capturePlan(
      t0,
      [{ uploadedAt: at(HOUR) }, { uploadedAt: at(DAY + 2 * HOUR) }],
      at(5 * DAY),
    )!;
    expect(plan.steps.map((s) => !!s.doneAt)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(plan.nextDueAt).toEqual(at(7 * DAY));
    expect(capturePlan(null, [])).toBeNull();
  });
});
