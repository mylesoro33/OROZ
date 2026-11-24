import { describe, it, expect } from 'vitest';
import { autoImportance, buildReminder, buildStages, dueNow, markFired, snooze, inQuietHours, learnReminderBias, setImportance } from '../reminders';
import { settings, T } from './fixtures';
import { MIN, HOUR } from '../time';

const s = settings();
describe('reminders', () => {
  it('sets importance automatically', () => {
    const now = T(0, '10:00');
    expect(autoImportance({ title: 'Chem test', now })).toBe('aggressive');
    expect(autoImportance({ title: 'Dinner reservation', kind: 'reservation', now })).toBe('aggressive');
    expect(autoImportance({ title: 'Movie night', kind: 'hobby', now })).toBe('passive');
    expect(autoImportance({ title: 'Email coach', now })).toBe('normal');
  });
  it('aggressive reminders escalate: heads-up → lead → at-time → follow-ups', () => {
    const r = buildReminder({ itemId: 'x', itemType: 'block', title: 'Chem test', dueAt: T(2, '09:00'), importance: 'aggressive', now: T(0, '10:00'), settings: s });
    expect(r.stages.map(x => x.stage)).toEqual(['heads-up', 'lead', 'at-time', 'follow-up', 'follow-up', 'follow-up']);
    expect(r.stages[0].at).toBe(T(1, '19:00'));
  });
  it('normal = one notification at lead time; passive = digest only', () => {
    expect(buildStages(T(0, '16:00'), 'normal', T(0, '08:00'), s).map(x => x.at)).toEqual([T(0, '15:30')]);
    expect(buildStages(T(0, '20:00'), 'passive', T(0, '06:00'), s)[0].stage).toBe('digest');
  });
  it('respects quiet hours and sleep (non-exempt stages move out)', () => {
    expect(inQuietHours(T(0, '23:30'), s)).toBe(true);
    expect(inQuietHours(T(0, '12:00'), s)).toBe(false);
    const st = buildStages(T(1, '07:15'), 'normal', T(0, '12:00'), s, 30);
    // 6:45 lead is in quiet hours → moved to 7:00 (end of quiet), still before the event
    expect(st[0].at).toBe(T(1, '07:00'));
    // aggressive is an exception for at-time but heads-up still respects quiet hours
    const ag = buildStages(T(1, '07:15'), 'aggressive', T(0, '12:00'), s);
    expect(ag.find(x => x.stage === 'heads-up')!.at).toBeLessThan(T(0, '22:30'));
  });
  it('fires only the latest due stage, then snoozes', () => {
    let r = buildReminder({ itemId: 'x', itemType: 'block', title: 'Test', dueAt: T(0, '12:00'), importance: 'aggressive', now: T(0, '06:00'), settings: s });
    const fires = dueNow([r], T(0, '11:55'));
    expect(fires).toHaveLength(1);
    expect(fires[0].stage.stage).toBe('at-time');
    expect(fires[0].persistentBanner).toBe(true);
    r = markFired(r, fires[0].stageIndex);
    expect(dueNow([r], T(0, '11:56'))).toHaveLength(0);
    r = snooze(r, '10m', T(0, '11:56'), s);
    expect(dueNow([r], T(0, '12:00'))).toHaveLength(0);
    const after = dueNow([r], T(0, '12:06'));
    expect(after[0].stage.label).toMatch(/Snoozed/);
  });
  it('one-tap importance change rebuilds stages', () => {
    const r = buildReminder({ itemId: 'x', itemType: 'block', title: 'Movie', dueAt: T(0, '20:00'), importance: 'passive', now: T(0, '08:00'), settings: s });
    const r2 = setImportance(r, 'aggressive', T(0, '08:00'), s);
    expect(r2.importanceSetBy).toBe('user');
    expect(r2.stages.length).toBeGreaterThan(3);
  });
  it('learns from dismissals and quiets the category', () => {
    const now = T(0, '10:00');
    const logs = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, at: now - i * HOUR, action: 'dismissed' as const, key: 'reminder:hobby' }));
    const bias = learnReminderBias(logs, now);
    expect(bias.hobby).toBeLessThan(-0.5);
    expect(autoImportance({ title: 'Guitar', kind: 'hobby', priority: 1, dueAt: now + 2 * HOUR, now }, bias)).toBe('passive');
    void MIN;
  });
});
