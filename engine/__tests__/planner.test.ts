import { describe, it, expect } from 'vitest';
import { plan, planDay, planWeek, chunkTask } from '../planner';
import { sleepForNight } from '../sleep';
import { overlaps, MIN, at, addDays } from '../time';
import type { Block } from '../types';
import { MON, T, settings, schoolDay, fixed, task, places, travel } from './fixtures';

const base = (over: Record<string, unknown> = {}) => ({
  now: T(0, '07:00'), blocks: schoolDay(0), tasks: [], settings: settings(), places, travel, ...over,
});

function noHardOverlap(blocks: Block[]) {
  const hard = blocks.filter(b => b.flexibility === 'fixed');
  const soft = blocks.filter(b => b.source === 'planner' && b.flexibility !== 'fixed');
  for (const s of soft) for (const h of hard) if (overlaps(s, h)) throw new Error(`${s.title} overlaps ${h.title}`);
}

describe('planner', () => {
  it('is deterministic: same input → same plan', () => {
    const input = base({ tasks: [task('essay', { durationMin: 150, due: T(3, '08:00'), needsFocus: true }), task('email', { durationMin: 15 })] });
    const a = planWeek(input as any), b = planWeek(input as any);
    expect(a.added).toEqual(b.added);
    expect(a.unplaced).toEqual(b.unplaced);
  });

  it('never schedules over fixed events or sleep, and leaves buffers', () => {
    const r = planDay(base({ tasks: [task('a', { durationMin: 45 }), task('b', { durationMin: 30, due: T(0, '22:00') }), task('c', { durationMin: 60 })] }) as any);
    noHardOverlap(r.blocks);
    const placed = r.added.filter(b => b.taskId);
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) for (const f of schoolDay(0)) {
      expect(p.start >= f.end + 10 * MIN || p.end <= f.start - 10 * MIN).toBe(true);
    }
    for (const p of placed) expect(p.reason).toMatch(/Placed here because/);
  });

  it('handles overlapping fixed events', () => {
    const blocks = [fixed('A', T(0, '09:00'), T(0, '11:00'), { kind: 'event' }), fixed('B', T(0, '10:00'), T(0, '12:00'), { kind: 'event' })];
    const r = planDay(base({ blocks, now: T(0, '08:00'), tasks: [task('x', { durationMin: 60, due: T(0, '20:00') })] }) as any);
    const x = r.added.find(b => b.taskId === 'x')!;
    expect(x).toBeTruthy();
    expect(overlaps(x, { start: T(0, '09:00'), end: T(0, '12:00') })).toBe(false);
  });

  it('reports a non-splittable task longer than any free slot', () => {
    const blocks = [fixed('Busy1', T(0, '07:00'), T(0, '12:00')), fixed('Busy2', T(0, '13:30'), T(0, '18:00')), fixed('Busy3', T(0, '19:30'), T(0, '23:00'))];
    const r = planDay(base({ blocks, tasks: [task('big', { durationMin: 180, chunkable: false, due: T(0, '23:30') })] }) as any);
    expect(r.added.some(b => b.taskId === 'big')).toBe(false);
    expect(r.unplaced[0].reason).toMatch(/longest free slot/);
  });

  it('splits long tasks into chunks before the due date', () => {
    const r = planWeek(base({ tasks: [task('paper', { durationMin: 200, due: T(2, '08:00'), needsFocus: true })] }) as any);
    const chunks = r.added.filter(b => b.taskId === 'paper');
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.reduce((s, c) => s + (c.end - c.start) / MIN, 0)).toBe(200);
    for (const c of chunks) expect(c.end).toBeLessThanOrEqual(T(2, '08:00'));
    expect(chunks[0].reason).toMatch(/split into/);
  });

  it('survives a day with no free time', () => {
    const blocks = [fixed('Marathon', T(0, '06:00'), T(0, '23:00'), { kind: 'event' })];
    const r = planDay(base({ blocks, now: T(0, '05:00'), tasks: [task('t', { due: T(0, '22:00') })] }) as any);
    expect(r.added.filter(b => b.taskId)).toHaveLength(0);
    expect(r.unplaced).toHaveLength(1);
    expect(r.warnings.some(w => /No room for lunch/.test(w))).toBe(true);
    noHardOverlap(r.blocks);
  });

  it('protects sleep when a late-night event runs over bedtime', () => {
    const late = fixed('Concert', T(0, '20:00'), T(1, '00:30'), { kind: 'event' });
    const { block, warning } = sleepForNight(MON, settings(), [late]);
    expect(block.start).toBe(T(1, '00:45'));        // 15 min wind-down after the event
    expect(block.end - block.start).toBeGreaterThanOrEqual(480 * MIN); // slept in to keep 8h
    expect(warning).toBeUndefined();
    // …but with an early class next morning it can't, so it warns
    const early = fixed('Zero period', T(1, '07:00'), T(1, '08:00'));
    const r2 = sleepForNight(MON, settings(), [late, early]);
    expect(r2.block.end).toBe(T(1, '06:30'));
    expect(r2.warning).toMatch(/Only 5.8h of sleep/);
    // the planner never puts tasks inside sleep
    const r = planDay(base({ blocks: [late, early], now: T(0, '18:00'), tasks: [task('late', { durationMin: 60 })] }) as any);
    const sleep = r.blocks.find(b => b.kind === 'sleep' && b.start === T(1, '00:45'))!;
    expect(sleep).toBeTruthy();
    for (const b of r.added.filter(b => b.taskId)) expect(overlaps(b, sleep)).toBe(false);
  });

  it('reflows meals when fixed events cover every normal meal window', () => {
    const blocks = [
      fixed('Exam block', T(0, '06:30'), T(0, '09:30'), { kind: 'event' }),
      fixed('Field trip', T(0, '11:00'), T(0, '13:30'), { kind: 'event' }),
      fixed('Rehearsal', T(0, '17:30'), T(0, '20:30'), { kind: 'event' }),
    ];
    const r = planDay(base({ blocks, now: T(0, '06:00') }) as any);
    const meals = r.added.filter(b => b.kind === 'meal' && b.mealType !== 'snack');
    expect(meals.map(m => m.mealType).sort()).toEqual(['breakfast', 'dinner', 'lunch']);
    for (const m of meals) { expect(m.reason).toMatch(/Moved|Short/); for (const f of blocks) expect(overlaps(m, f)).toBe(false); }
  });

  it('inserts a snack before a late practice after a short early lunch', () => {
    const s = settings({ meals: [
      { type: 'breakfast', window: ['06:30', '07:30'], durationMin: 20, minDurationMin: 10 },
      { type: 'lunch', window: ['11:00', '11:45'], durationMin: 20, minDurationMin: 15 },
      { type: 'dinner', window: ['19:00', '20:30'], durationMin: 45, minDurationMin: 20 },
    ] });
    const blocks = [...schoolDay(0), fixed('Practice', T(0, '16:00'), T(0, '19:00'), { kind: 'event' })];
    const r = planDay(base({ blocks, settings: s, now: T(0, '06:00') }) as any);
    const snack = r.added.find(b => b.mealType === 'snack')!;
    expect(snack).toBeTruthy();
    expect(snack.title).toMatch(/Practice/);
    expect(snack.end).toBeLessThanOrEqual(T(0, '16:00'));
    expect(snack.start).toBeGreaterThanOrEqual(T(0, '15:00'));
  });

  it('protects minimum free time from non-urgent work', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(`t${i}`, { durationMin: 60, priority: 3 }));
    const r = planDay(base({ tasks, now: T(0, '07:00') }) as any);
    const placedMin = r.added.filter(b => b.taskId).reduce((s, b) => s + (b.end - b.start) / MIN, 0);
    expect(r.unplaced.length).toBeGreaterThan(0);
    expect(placedMin).toBeGreaterThan(0);
    expect(r.unplaced.some(u => /free time|longest/.test(u.reason))).toBe(true);
  });

  it('adds travel time for location-bound tasks', () => {
    const r = planDay(base({ tasks: [task('lift', { durationMin: 45, location: 'gym', due: T(0, '21:00') })] }) as any);
    const lift = r.added.find(b => b.taskId === 'lift')!;
    const trip = r.added.find(b => b.kind === 'travel')!;
    expect(lift.placeId).toBe('gym');
    expect(trip.end).toBe(lift.start);
    expect(lift.start - trip.start).toBe(12 * MIN); // school → gym
  });

  it('works weekly hobby targets into the week', () => {
    const activities = [{ id: 'read', name: 'Reading', durationMin: 30, energy: 'neutral' as const, weeklyTarget: 3, category: 'reading' as const }];
    const r = planWeek(base({ activities, blocks: [0, 1, 2, 3, 4].flatMap(schoolDay) }) as any);
    const reads = r.added.filter(b => b.activityId === 'read');
    expect(reads.length).toBe(3);
    expect(new Set(reads.map(b => new Date(b.start).getDate())).size).toBe(3); // spread across days
  });

  it('keeps user-placed blocks and only replaces its own movable blocks', () => {
    const manual: Block = { id: 'm1', title: 'Hang out', kind: 'hobby', start: T(0, '16:00'), end: T(0, '18:00'), flexibility: 'movable', source: 'manual' };
    const old: Block = { id: 'old', title: 'stale', kind: 'task', start: T(0, '19:00'), end: T(0, '20:00'), flexibility: 'movable', source: 'planner', taskId: 'gone' };
    const r = planDay(base({ blocks: [...schoolDay(0), manual, old] }) as any);
    expect(r.blocks.some(b => b.id === 'm1')).toBe(true);
    expect(r.removed).toContain('old');
  });

  it('chunks according to focus cap', () => {
    expect(chunkTask(200, true, undefined, 90)).toEqual([60, 60, 60, 20]);
    expect(chunkTask(70, false, undefined, 90)).toEqual([70]);
    expect(chunkTask(181, false, undefined, 90)).toEqual([90, 91]);
  });

  it('places urgent work even when the day is tight, with a warning about past-due', () => {
    const r = plan({ ...(base({ tasks: [task('late', { due: T(-1, '08:00'), priority: 1 })] }) as any), rangeStart: MON, rangeEnd: addDays(MON, 1) });
    expect(r.added.some(b => b.taskId === 'late')).toBe(true);
    expect(r.warnings.some(w => /past due/.test(w))).toBe(true);
    void at;
  });
});
