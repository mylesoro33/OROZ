import { describe, it, expect } from 'vitest';
import { talkToDraft, guessType } from '../talk';
import { suggestSlots, errandHints, bandsFor, daySummary, openTime, normalizeLink, weatherNote, nudges, dateTopics, itemsFor } from '../week';
import { nightFor } from '../sleep';
import { icsToBlocks } from '../ics';
import { upcomingBirthdays } from '../occasions';
import { MIN, DAY, isoDay, overlaps, addDays } from '../time';
import { MON, T, settings, block, task, person, place } from './fixtures';

const now = T(1, '09:00'); // Tuesday 9am
const places = [place('Gym', { kind: 'gym' }), place('Pharmacy', { kind: 'store' })];

describe('Tell OROZ (offline)', () => {
  it('"Gotta pick up Jake at 4:30 Thursday" → timed to-do', () => {
    const d = talkToDraft('Gotta pick up Jake at 4:30 Thursday', now, places);
    expect(d.kind).toBe('task');
    expect(d.task!.title).toBe('Pick up Jake');
    expect(d.task!.at).toBe(T(3, '16:30'));
    expect(d.line).toBe('Pick up Jake, Thursday at 4:30pm.');
  });
  it('"Dentist next Tuesday afternoon" → event', () => {
    const d = talkToDraft('Dentist next Tuesday afternoon', now, places);
    expect(d.kind).toBe('event');
    expect(d.event!.start).toBe(T(8, '15:00'));
  });
  it('"Buy a birthday gift for Mom" → to-do with no time', () => {
    const d = talkToDraft('Buy a birthday gift for Mom', now, places);
    expect(d.kind).toBe('task');
    expect(d.task!.at).toBeUndefined();
    expect(d.task!.type).toBe('errand');
    expect(d.line).toBe('To-do: Buy a birthday gift for Mom. No time set.');
  });
  it('"Fit in a haircut sometime this week" → flexible, fit in by Sunday', () => {
    const d = talkToDraft('Fit in a haircut sometime this week', now, places);
    expect(d.fitIn).toBe(true);
    expect(d.task!.title).toBe('A haircut');
    expect(d.task!.by).toBe(addDays(MON, 6));
  });
  it('types', () => {
    expect(guessType('call grandma')).toBe('call');
    expect(guessType('refill prescription')).toBe('health');
    expect(guessType('do laundry')).toBe('home');
  });
});

describe('Fit in + errands', () => {
  const blocks = [block('Work', T(1, '09:00'), T(1, '17:00'), { kind: 'work' }), block('Workout', T(2, '17:00'), T(2, '18:00'), { location: 'Gym' })];
  it('suggests open slots, one per day, never over events or sleep', () => {
    const slots = suggestSlots(task('Haircut', { by: addDays(MON, 6) }), { blocks, tasks: [], settings: settings(), places, now });
    expect(slots.length).toBe(3);
    expect(new Set(slots.map(s => isoDay(s.start))).size).toBe(3);
    for (const s of slots) for (const b of blocks) expect(overlaps(s, b)).toBe(false);
    for (const s of slots) expect(new Date(s.start).getHours()).toBeGreaterThanOrEqual(7);
  });
  it('prefers a slot next to where you already are', () => {
    const slots = suggestSlots(task('Buy protein', { placeName: 'Gym' }), { blocks, tasks: [], settings: settings(), places, now });
    const best = slots.find(s => s.why.includes('Gym'))!;
    expect(best).toBeTruthy();
    expect(Math.min(Math.abs(best.start - T(2, '18:00')), Math.abs(T(2, '17:00') - best.end))).toBeLessThanOrEqual(30 * MIN);
  });
  it('errand hint when an event is at the same place', () => {
    const hints = errandHints(MON + 2 * DAY, blocks, [task('Buy protein', { placeName: 'Gym' })], places);
    expect(hints[0].text).toBe('You\'re at Gym at 5pm. Add "Buy protein" after?');
  });
});

describe('Schedule', () => {
  it('meals and sleep are soft bands, and open time ignores meals', () => {
    const bands = bandsFor(MON, settings());
    expect(bands.map(b => b.kind)).toEqual(['breakfast', 'lunch', 'dinner', 'sleep', 'sleep']);
    const open = openTime(MON, [], [], settings());
    expect(open).toHaveLength(1); // meals don't split the day
  });
  it('per-night bedtime override', () => {
    const s = settings(); s.sleep.overrides[isoDay(MON)] = '00:30';
    const n = nightFor(MON, s.sleep, s.workDays);
    expect(n.bedtime).toBe(T(1, '00:30'));
    expect(n.hours).toBeCloseTo(6.25);
    expect(nightFor(addDays(MON, 4), s.sleep, s.workDays).bedtime).toBe(T(4, '23:30')); // Friday = weekend
  });
  it('timed to-dos appear on the calendar', () => {
    expect(itemsFor(MON, [], [task('Call', { at: T(0, '10:00') })]).map(b => b.kind)).toEqual(['todo']);
  });
  it('summary: on, open, coming', () => {
    const s = daySummary(MON, [block('Class', T(0, '08:00'), T(0, '15:00'))], [], [person('Sam', { birthday: { month: 11, day: 27 } })], settings(), T(0, '07:00'), '58°/41°F');
    expect(s.on).toBe('1 thing, 8am–3pm');
    expect(s.open).toBe('Open 3pm–10:45pm');
    expect(s.coming).toBe("Sam's birthday Friday");
  });
});

describe('links, weather, nudges, dates', () => {
  it('normalizes calendar links', () => {
    expect(normalizeLink('webcal://example.org/cal.ics')).toEqual({ kind: 'ics', url: 'https://example.org/cal.ics' });
    expect(normalizeLink('https://calendar.google.com/calendar/embed?src=team%40example.com').url).toBe('https://calendar.google.com/calendar/ical/team%40example.com/public/basic.ics');
    expect(normalizeLink('lincolnhigh.org/calendar').kind).toBe('page');
  });
  it('weather is one quiet line', () => {
    expect(weatherNote({ tmax: 61.4, tmin: 44, precip: 70, code: 61 })).toBe('61°/44°F · rain likely, bring a jacket');
  });
  it('one small question at a time, based on what you do', () => {
    const base = { now, profile: { name: 'Ana', occupation: 'working' as const, setupDone: true }, blocks: [block('Work', T(1, '08:00'), T(1, '16:00'), { kind: 'work' })], people: [], places: [], dismissed: ['connect'], hasKey: false, connected: false, workDays: [1, 2, 3, 4, 5], foundDates: false };
    expect(nudges(base)[0].text).toBe("I don't have your Wednesday hours. Want to add them?");
    expect(nudges({ ...base, profile: { ...base.profile, occupation: 'student' } })[0].text).toBe("I don't have your Wednesday class schedule. Want to add it?");
  });
  it('date topics fit the person', () => {
    expect(dateTopics({ occupation: 'student', occupationDetail: '11th grade', setupDone: true })).toContain('college application deadlines');
    expect(dateTopics({ occupation: 'working', setupDone: true })).toContain('federal and state tax filing deadline');
  });
  it('iCal → events; birthdays', () => {
    const bl = icsToBlocks('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nSUMMARY:Morning shift\nDTSTART:20261123T080000\nDTEND:20261123T160000\nEND:VEVENT\nEND:VCALENDAR', MON, MON + 7 * DAY);
    expect(bl[0].kind).toBe('work');
    expect(upcomingBirthdays([person('Mom', { birthday: { month: 12, day: 1 } })], MON)[0].inDays).toBe(8);
  });
});
