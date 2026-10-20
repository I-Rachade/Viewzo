import { proofPlan } from './proofs.service';

const t0 = new Date('2026-10-19T18:00:00Z');
const at = (h: number) => new Date(t0.getTime() + h * 3600 * 1000);

describe('proofPlan', () => {
  it('asks for the first screenshot right away', () => {
    const plan = proofPlan([], t0);
    expect(plan.nextDueAt).toEqual(t0);
    expect(plan.steps.every((s) => s.doneAt === null)).toBe(true);
  });

  it('then asks at 12 h and before 24 h', () => {
    expect(proofPlan([{ uploadedAt: t0 }], at(1)).nextDueAt).toEqual(at(12));
    const twoDone = proofPlan(
      [{ uploadedAt: t0 }, { uploadedAt: at(12.5) }],
      at(13),
    );
    expect(twoDone.steps.map((s) => !!s.doneAt)).toEqual([true, true, false]);
    expect(twoDone.nextDueAt).toEqual(at(23));
  });

  it('skips a missed step and stops after 25 h', () => {
    expect(proofPlan([{ uploadedAt: t0 }], at(21)).nextDueAt).toEqual(at(23));
    expect(proofPlan([{ uploadedAt: t0 }], at(26)).nextDueAt).toBeNull();
  });
});
