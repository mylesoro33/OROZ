import { describe, it, expect } from 'vitest';
import { suggest } from '../suggest';
import { previewMove, autoReflow, pushRest, replanFromNow } from '../reflow';
import { parseIcs, expand, icsToBlocks, icsToAssignments } from '../ics';
import { holidays, leadDaysFor, occasionStages, giftIdeas, personOccasions } from '../occasions';
import { detectPlace, travelMinutes } from '../location';
import { History } from '../history';
import { settings, T, MON, places, travel, task, schoolDay, fixed } from './fixtures';
import { MIN, DAY } from '../time';
import type { Block, Person, Activity } from '../types';
import { defaultFoodProfile } from '../defaults';

describe('suggestions ("30 school")', () => {
  const activities: Activity[] = [
    { id: 'read', name: 'Read a chapter', durationMin: 30, energy: 'neutral', category: 'reading' },
    { id: 'movie', name: 'Movie', durationMin: 120, energy: 'neutral', category: 'movie', location: 'home' },
  ];
  const base = { now: T(0, '15:10'), minutes: 30, placeId: 'school', places, travel, settings: settings(), activities, blocks: schoolDay(0), food: defaultFoodProfile() };
  it('ranks 3–5 options that fit time and place, each with a why', () => {
    const s = suggest({ ...base, tasks: [task('math', { durationMin: 25, due: T(1, '08:00') }), task('poster', { durationMin: 40, location: 'home' }), task('bio', { durationMin: 120, due: T(3, '08:00'), needsFocus: true })] });
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(5);
    expect(s[0].id).toBe('task:math');
    expect(s.some(x => x.id === 'task:poster')).toBe(false);   // home-only
    expect(s.some(x => x.id === 'hobby:movie')).toBe(false);   // too long
    for (const x of s) { expect(x.minutes).toBeLessThanOrEqual(30); expect(x.why.length).toBeGreaterThan(0); }
  });
  it('honors "don\'t suggest this again" and learned rejections', () => {
    const tasks = [task('math', { durationMin: 25, due: T(1, '08:00') })];
    expect(suggest({ ...base, tasks, blocked: ['task:math'] }).some(x => x.id === 'task:math')).toBe(false);
    const a = suggest({ ...base, tasks: [], acceptance: { 'hobby:read': 1 } }).find(x => x.id === 'hobby:read')!;
    const b = suggest({ ...base, tasks: [], acceptance: { 'hobby:read': -1 } }).find(x => x.id === 'hobby:read')!;
    expect(a.score).toBeGreaterThan(b.score);
  });
  it('suggests food when it has been a while since the last meal', () => {
    const blocks: Block[] = [...schoolDay(0), { id: 'l', title: 'Lunch', kind: 'meal', mealType: 'lunch', start: T(0, '11:30'), end: T(0, '11:50'), flexibility: 'movable', source: 'planner' }];
    const s = suggest({ ...base, now: T(0, '16:30'), minutes: 30, tasks: [], blocks });
    expect(s.some(x => x.kind === 'food')).toBe(true);
  });
});

describe('reflow', () => {
  const s = settings();
  const blocks: Block[] = [
    fixed('Class', T(0, '13:00'), T(0, '14:00')),
    { id: 'a', title: 'A', kind: 'task', start: T(0, '15:00'), end: T(0, '16:00'), flexibility: 'movable', source: 'planner' },
    { id: 'b', title: 'B', kind: 'task', start: T(0, '16:10'), end: T(0, '17:00'), flexibility: 'movable', source: 'planner' },
    { id: 'sleep', title: 'Sleep', kind: 'sleep', start: T(0, '23:00'), end: T(1, '07:00'), flexibility: 'fixed', source: 'planner' },
  ];
  it('previews what a move displaces', () => {
    const p = previewMove(blocks, 'a', T(0, '16:00'), T(0, '17:00'));
    expect(p.displaced.map(b => b.id)).toEqual(['b']);
    expect(previewMove(blocks, 'a', T(0, '13:30'), T(0, '14:30')).ok).toBe(false);
  });
  it('auto-reflows the rest of the day around the moved block', () => {
    const moved = blocks.map(b => (b.id === 'a' ? { ...b, start: T(0, '16:00'), end: T(0, '17:00') } : b));
    const r = autoReflow(moved, T(0, '12:00'), T(0, '23:00'), s, ['a']);
    const b = r.blocks.find(x => x.id === 'b')!;
    expect(b.start).toBe(T(0, '17:10'));
    expect(r.blocks.find(x => x.id === 'a')!.start).toBe(T(0, '16:00'));
  });
  it('push 1h shifts movable blocks, never fixed ones', () => {
    const r = pushRest(blocks, T(0, '12:00'), 60, s);
    expect(r.blocks.find(x => x.id === 'a')!.start).toBe(T(0, '16:00'));
    expect(r.blocks.find(x => x.title === 'Class')!.start).toBe(T(0, '13:00'));
  });
  it('"my day fell apart" re-plans the remaining hours', () => {
    const r = replanFromNow({ now: T(0, '15:30'), blocks, tasks: [task('A', { durationMin: 60, due: T(0, '22:00') })], settings: s, places, travel });
    expect(r.removed).toContain('a');
    const placed = r.added.filter(b => b.taskId === 'A');
    expect(placed[0].start).toBeGreaterThanOrEqual(T(0, '15:30'));
  });
  it('undo/redo', () => {
    const h = new History<number>(); h.push(1); h.push(2);
    expect(h.undo(3)).toBe(2); expect(h.undo(2)).toBe(1); expect(h.redo(1)).toBe(2);
  });
});

describe('ics import', () => {
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:Period 1 - Biology\r\nDTSTART:20261123T080000\r\nDTEND:20261123T085000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:hol\r\nSUMMARY:No school\r\nDTSTART;VALUE=DATE:20261126\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:z\r\nSUMMARY:Game\r\nDTSTART:20261124T230000Z\r\nDURATION:PT2H\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  it('parses, expands weekly rules, skips all-day, keeps blocks fixed', () => {
    const evs = parseIcs(ics);
    expect(evs).toHaveLength(3);
    expect(expand(evs[0], MON, MON + 14 * DAY)).toHaveLength(6);
    const blocks = icsToBlocks(ics, MON, MON + 7 * DAY);
    expect(blocks.filter(b => b.title.startsWith('Period'))).toHaveLength(3);
    expect(blocks.every(b => b.flexibility === 'fixed')).toBe(true);
    expect(blocks.find(b => b.title === 'Game')!.end - blocks.find(b => b.title === 'Game')!.start).toBe(120 * MIN);
    expect(blocks.find(b => b.title.startsWith('Period'))!.kind).toBe('class');
  });
  it('reads assignment feeds (Canvas style "Title [Course]")', () => {
    const feed = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a1\nSUMMARY:Essay 2 [ENG 101]\nDTSTART;VALUE=DATE:20261204\nEND:VEVENT\nEND:VCALENDAR`;
    const [a] = icsToAssignments(feed, MON);
    expect(a.title).toBe('Essay 2');
    expect(a.course).toBe('ENG 101');
  });
});

describe('occasions + gifts', () => {
  const mom: Person = { id: 'mom', name: 'Mom', relationship: 'mom', closeness: 1, birthday: { month: 12, day: 20 }, interests: ['gardening', 'coffee'], foodLikes: ['thai'], dietary: [], giftIdeas: [], pastGifts: [{ year: 2025, gift: 'Local coffee beans + mug' }], budget: 30, notes: [], source: 'manual' };
  it('lead time scales with occasion and closeness', () => {
    const xmas = holidays(MON).find(h => h.title === 'Christmas')!;
    expect(leadDaysFor(xmas)).toBe(56);
    const [bd] = personOccasions([mom], MON);
    expect(leadDaysFor(bd, mom)).toBe(28);
    expect(leadDaysFor(bd, { ...mom, closeness: 3 })).toBe(7);
  });
  it('stages move from brainstorm to celebrate, leaving shipping time', () => {
    const [bd] = personOccasions([mom], MON);
    const st = occasionStages(bd, mom, MON, { shippingDays: 5 });
    expect(st.map(s => s.key)).toEqual(['brainstorm', 'decide', 'reserve', 'order', 'card', 'wrap', 'celebrate']);
    const order = st.find(s => s.key === 'order')!;
    expect(bd.date - order.due).toBeGreaterThanOrEqual(5 * DAY);
  });
  it('gift ideas follow interests + budget and skip past gifts', () => {
    const g = giftIdeas(mom);
    expect(g.some(x => /garden/i.test(x.idea))).toBe(true);
    expect(g.some(x => x.idea === 'Local coffee beans + mug')).toBe(false);
    expect(g[0].withinBudget).toBe(true);
  });
});

describe('location', () => {
  it('detects the containing place and estimates travel', () => {
    expect(detectPlace(40.0001, -75.0001, places)?.id).toBe('home');
    expect(detectPlace(41, -75, places)).toBeUndefined();
    expect(travelMinutes('home', 'school', travel)).toBe(15);
    expect(travelMinutes('school', 'home', travel)).toBe(15);
  });
});
