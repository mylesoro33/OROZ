import { describe, it, expect } from 'vitest';
import { rowsFromScan, questionsFor, defaultAnswers, occurrences, markDuplicates, toBlocks, learnRoutine, setRotationLabels, describeDays, type Scan } from '../scan';
import { fromIsoDay } from '../time';
import { MON, T, block } from './fixtures';

const base: Scan = { kind: 'work', readable: 'good', problems: [], missed: [], pattern: 'weekly', rotation_labels: [], items: [] };

describe('photo scan → draft', () => {
  const shifts: Scan = { ...base, items: [
    { title: 'Shift', days: [1], start: '07:00', end: '15:00', confidence: 'high' },
    { title: 'Shift', days: [3], start: '07:00', end: '15:00', confidence: 'high' },
    { title: 'Shift', days: [5], start: '11:00', end: '19:00', confidence: 'low', note: 'Hard to read: 11 or 1?' },
  ] };
  it('groups repeating items into recurring rows and flags uncertain ones', () => {
    const rows = rowsFromScan(shifts);
    expect(rows.map(r => [r.title, r.days, r.start])).toEqual([['Shift', [1, 3], '07:00'], ['Shift', [5], '11:00']]);
    expect(rows[1].flags).toEqual(['Hard to read: 11 or 1?']);
  });
  it('asks only what it needs', () => {
    expect(questionsFor(shifts)).toEqual(['dates']);
    expect(questionsFor({ ...base, pattern: 'unknown', items: [] })).toEqual(['pattern', 'dates']);
    expect(questionsFor({ ...base, pattern: 'rotating', rotation_labels: ['A', 'B'], person: 'Leo' })).toEqual(['rotation', 'dates', 'who']);
  });
  it('weekly rows become a semester of events, not dozens of rows', () => {
    const a = defaultAnswers(shifts, MON);
    const rows = rowsFromScan(shifts);
    expect(occurrences(rows[0], a)).toHaveLength(32); // Mon+Wed for 16 weeks
    const blocks = toBlocks(rows, a);
    expect(new Set(blocks.map(b => b.seriesId)).size).toBe(2);
    expect(blocks[0].start).toBe(T(0, '07:00'));
  });
  it('rotating A/B days follow school days', () => {
    const s: Scan = { ...base, kind: 'classes', pattern: 'rotating', rotation_labels: ['A', 'B'], items: [{ title: 'Biology', rotation: 'A', start: '08:00', end: '09:20', confidence: 'high' }, { title: 'Art', rotation: 'B', start: '08:00', end: '09:20', confidence: 'high' }] };
    setRotationLabels(s.rotation_labels);
    const a = { ...defaultAnswers(s, MON), end: '2026-12-04', rotationToday: 'A' };
    const rows = rowsFromScan(s); const bio = rows.find(r => r.title === 'Biology')!, art = rows.find(r => r.title === 'Art')!;
    expect(occurrences(bio, a).map(d => new Date(d).getDate())).toEqual([23, 25, 27, 1, 3]); // Mon, Wed, Fri, Tue, Thu
    expect(occurrences(art, a).map(d => new Date(d).getDate())).toEqual([24, 26, 30, 2, 4]);
    setRotationLabels([]);
  });
  it('flags duplicates already on the calendar and skips them by default', () => {
    const a = { ...defaultAnswers(shifts, MON), end: '2026-12-06' };
    const existing = [block('Shift', T(0, '07:00'), T(0, '15:00')), block('shift', T(2, '07:00'), T(2, '15:00')), block('Shift', T(7, '07:00'), T(7, '15:00')), block('Shift', T(9, '07:00'), T(9, '15:00'))];
    const rows = markDuplicates(rowsFromScan(shifts), a, existing);
    expect(rows[0].duplicate).toBe(true);           // Mon+Wed both already there
    expect(rows[0].include).toBe(false);
    expect(rows[1].duplicate).toBe(false);
    // only Mondays already there → keep the row, skip those days
    const partial = markDuplicates(rowsFromScan(shifts), a, existing.filter(b => new Date(b.start).getDay() === 1));
    expect(partial[0].include).toBe(true);
    expect(partial[0].flags).toContain('Monday already on your calendar');
    expect(occurrences(partial[0], a).map(d => new Date(d).getDay())).toEqual([3, 3]);
    expect(toBlocks(partial, a).filter(b => b.title === 'Shift' && new Date(b.start).getDay() === 1)).toHaveLength(0);
  });
  it('fills missing times with a flag instead of failing', () => {
    const rows = rowsFromScan({ ...base, kind: 'classes', items: [{ title: 'Chem', days: [2], start: '10:00', confidence: 'high' }] });
    expect(rows[0].end).toBe('10:50');
    expect(rows[0].flags).toContain('No end time found');
  });
  it('someone else’s schedule is labeled with their name', () => {
    const a = { ...defaultAnswers(shifts, MON), who: 'other' as const, otherName: 'Leo' };
    expect(toBlocks(rowsFromScan(shifts), a)[0].title).toBe('Leo: Shift');
    expect(learnRoutine(rowsFromScan(shifts), a)).toBeUndefined();
  });
  it('learns a routine (to offer, not save)', () => {
    const s: Scan = { ...base, kind: 'classes', items: [
      { title: 'Math', days: [1, 2, 3, 4, 5], start: '08:00', end: '11:45', confidence: 'high' },
      { title: 'History', days: [1, 2, 3, 4, 5], start: '12:30', end: '15:00', confidence: 'high' },
    ] };
    const r = learnRoutine(rowsFromScan(s), defaultAnswers(s, MON))!;
    expect(r).toEqual({ label: 'School', days: [1, 2, 3, 4, 5], from: '08:00', to: '15:00', lunch: { from: '11:45', to: '12:30' } });
    expect(describeDays(r.days)).toBe('Mon–Fri');
    void fromIsoDay;
  });
});

describe('routine from mixed shifts', () => {
  it('uses the most common hours and every day you go', () => {
    const s: Scan = { ...base, items: [
      { title: 'Shift', days: [1, 3], start: '07:00', end: '15:00', confidence: 'high' },
      { title: 'Shift', days: [5], start: '13:00', end: '19:00', confidence: 'high' }] };
    const a = defaultAnswers(s, MON);
    const rows = markDuplicates(rowsFromScan(s), a, [block('Shift', T(0, '07:00'), T(0, '15:00')), block('Shift', T(7, '07:00'), T(7, '15:00'))]);
    expect(learnRoutine(rows, a)).toEqual({ label: 'Work', days: [1, 3, 5], from: '07:00', to: '15:00', lunch: undefined });
  });
});
