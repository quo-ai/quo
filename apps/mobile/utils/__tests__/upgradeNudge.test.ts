import { recordAnswer, isEngaged, NUDGE_MIN_ANSWERS } from '../upgradeNudge';

const day = (d: number) => new Date(2026, 9, d, 12);

describe('upgrade nudge targeting', () => {
  it('needs both enough answers and several separate days', () => {
    let stats = { answers: 0, activeDays: [] as string[] };
    for (let i = 0; i < NUDGE_MIN_ANSWERS + 5; i++) stats = recordAnswer(stats, day(1));
    expect(isEngaged(stats)).toBe(false); // heavy single-day use is not habit
    stats = recordAnswer(stats, day(3));
    stats = recordAnswer(stats, day(6));
    expect(isEngaged(stats)).toBe(true);
  });

  it('does not count the same day twice', () => {
    const stats = recordAnswer(recordAnswer({ answers: 0, activeDays: [] }, day(2)), day(2));
    expect(stats.activeDays).toHaveLength(1);
    expect(stats.answers).toBe(2);
  });
});
