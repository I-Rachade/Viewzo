import { dailyValidated } from './report.service';

describe('dailyValidated', () => {
  it('carries each post forward and sums per day', () => {
    const d = (s: string) => new Date(s);
    const days = dailyValidated(
      [
        { assignmentId: 'a', views: 100, takenAt: d('2026-10-01T10:00:00Z') },
        { assignmentId: 'a', views: 300, takenAt: d('2026-10-02T10:00:00Z') },
        { assignmentId: 'b', views: 50, takenAt: d('2026-10-02T12:00:00Z') },
      ],
      d('2026-10-01T08:00:00Z'),
      d('2026-10-03T08:00:00Z'),
    );
    expect(days).toEqual([
      { date: '2026-10-01', views: 100 },
      { date: '2026-10-02', views: 350 },
      { date: '2026-10-03', views: 350 },
    ]);
  });
});
