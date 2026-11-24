import { describe, it, expect } from 'vitest';
import { learnHabits, learnEnergy, learnAcceptance, insights, decay } from '../habits';
import { MON, T } from './fixtures';
import { MIN, DAY } from '../time';
import type { LogEntry } from '../types';

function naps(): LogEntry[] {
  const out: LogEntry[] = [];
  for (let w = -4; w < 0; w++) for (const d of [1, 3]) { // Tue, Thu
    const s = T(w * 7 + d, '15:30');
    out.push({ id: `n${w}${d}`, at: s, action: 'completed', key: 'hobby:nap', actualStart: s, actualEnd: s + 25 * MIN });
  }
  return out;
}

describe('habit model', () => {
  it('learns weekday, window, duration with confidence', () => {
    const [h] = learnHabits(naps(), MON);
    expect(h.key).toBe('hobby:nap');
    expect(h.weekdays).toEqual([2, 4]);
    expect(h.windowStart).toBe(15 * 60 + 30);
    expect(h.durationMin).toBe(25);
    expect(h.confidence).toBeGreaterThan(0.5);
  });
  it('never overwrites a habit the user confirmed or edited', () => {
    const edited = { ...learnHabits(naps(), MON)[0], windowStart: 14 * 60, status: 'edited' as const };
    expect(learnHabits(naps(), MON, [edited])[0].windowStart).toBe(14 * 60);
  });
  it('produces plain-language insights', () => {
    const hs = learnHabits(naps(), MON);
    const friends: LogEntry = { id: 'f', at: MON - 9 * DAY, action: 'completed', key: 'hobby:friends' };
    const text = insights(hs, [...naps(), friends], MON).map(i => i.text);
    expect(text).toContain('You usually nap Tuesday and Thursday around 3:30pm, so I held that time.');
    expect(text).toContain("You haven't seen friends in 9 days. Want me to suggest Saturday?");
  });
  it('recent behavior counts more (exponential decay)', () => {
    expect(decay(0)).toBe(1);
    expect(decay(21 * DAY)).toBeCloseTo(0.5);
    const logs: LogEntry[] = [
      { id: 'a', at: MON - 60 * DAY, action: 'accepted', key: 'suggest:hobby:read' },
      { id: 'b', at: MON - 60 * DAY, action: 'accepted', key: 'suggest:hobby:read' },
      { id: 'c', at: MON - 1 * DAY, action: 'rejected', key: 'suggest:hobby:read' },
    ];
    expect(learnAcceptance(logs, MON)['hobby:read']).toBeLessThan(0);
  });
  it('learns energy from focus completions vs skips', () => {
    const logs: LogEntry[] = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, at: T(-i, '21:00'), plannedStart: T(-i, '21:00'), action: 'completed' as const, key: 'task:focus', focus: true }));
    const prior = new Array(24).fill(0.3);
    expect(learnEnergy(logs, MON, prior)[21]).toBeGreaterThan(0.6);
    expect(learnEnergy(logs, MON, prior)[10]).toBe(0.3);
  });
});
