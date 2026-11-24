import { describe, it, expect } from 'vitest';
import { nightFor, isSchoolNight, bedtimeAt } from '../sleep';
import { deriveDay, dayOutlook } from '../day';
import { nudges, type NudgeState } from '../nudges';
import { upcomingBirthdays, frequentPeople } from '../occasions';
import { previewMove, autoReflow } from '../reflow';
import { icsToBlocks } from '../ics';
import { parseCapture, captureDue } from '../parser';
import { MIN, DAY, overlaps, isoDay, at, addDays } from '../time';
import { MON, T, settings, block, schoolDay, task, person } from './fixtures';

describe('sleep is a range with per-night overrides', () => {
  it('uses school-night defaults Sun–Thu and weekend on Fri/Sat', () => {
    const s = settings();
    expect(isSchoolNight(MON, s.schoolDays)).toBe(true);
    expect(isSchoolNight(addDays(MON, 4), s.schoolDays)).toBe(false);
    const n = nightFor(MON, s.sleep, s.schoolDays);
    expect(n.bedtime).toBe(T(0, '22:45'));
    expect(n.range).toEqual([T(0, '22:15'), T(0, '23:15')]);
    expect(n.windDownBy).toBe(T(0, '21:45'));
    expect(nightFor(addDays(MON, 4), s.sleep, s.schoolDays).bedtime).toBe(T(4, '23:30'));
  });
  it('a per-night override wins, and times after midnight land on the next day', () => {
    const s = settings(); s.sleep.overrides[isoDay(MON)] = '00:15';
    const n = nightFor(MON, s.sleep, s.schoolDays);
    expect(n.overridden).toBe(true);
    expect(n.bedtime).toBe(T(1, '00:15'));
    expect(n.warning).toMatch(/Only 6.5h/);
    expect(bedtimeAt(MON, '23:00')).toBe(T(0, '23:00'));
  });
  it('a late fixed event pushes bedtime back', () => {
    const s = settings();
    const n = nightFor(MON, s.sleep, s.schoolDays, [block('Concert', T(0, '20:00'), T(0, '23:30'), { kind: 'event' })]);
    expect(n.bedtime).toBe(T(0, '23:45'));
  });
});

describe('day derivation', () => {
  it('adds sleep and meals around fixed events without overlap', () => {
    const v = deriveDay(MON, schoolDay(0), settings());
    const meals = v.blocks.filter(b => b.kind === 'meal');
    expect(meals.map(m => m.mealType)).toEqual(expect.arrayContaining(['breakfast', 'lunch', 'dinner']));
    for (const m of meals) for (const c of schoolDay(0)) expect(overlaps(m, c)).toBe(false);
  });
  it('a dinner event counts as dinner', () => {
    const v = deriveDay(MON, [block('Dinner with Jake', T(0, '19:00'), T(0, '20:30'), { kind: 'event', mealType: 'dinner' })], settings());
    expect(v.blocks.filter(b => b.mealType === 'dinner')).toHaveLength(1);
  });
  it('a late practice gets a snack before it', () => {
    const s = settings(); s.meals[1].window = ['11:00', '11:45']; s.meals[2].window = ['19:00', '20:30'];
    const v = deriveDay(MON, [...schoolDay(0), block('Practice', T(0, '16:00'), T(0, '19:00'), { kind: 'event' })], s);
    const snack = v.blocks.find(b => b.mealType === 'snack')!;
    expect(snack.title).toBe('Snack before Practice');
    expect(snack.end).toBeLessThanOrEqual(T(0, '16:00'));
  });
  it('outlook is a few compact lines', () => {
    const v = deriveDay(MON, schoolDay(0), settings());
    const lines = dayOutlook(v, [task('Bio lab', { due: T(1, '08:00') }), task('Read ch 4', { due: T(0, '20:00') })], [person('Sam', { birthday: { month: 11, day: 23, year: 2010 } })], { [isoDay(MON)]: ['Tacos', 'Salad bar'] }, T(0, '07:00'));
    expect(lines.map(l => l.icon)).toEqual(['school', 'lunch', 'due', 'cake', 'prep', 'moon']);
    expect(lines[0].text).toBe('2 classes · 8am–3pm');
    expect(lines.find(l => l.icon === 'cake')!.text).toBe("Sam's birthday (16)");
    expect(lines.at(-1)!.text).toBe('Wrap homework by 9:45pm to hit bed ~10:45pm');
  });
});

describe('nudges ask one small thing at a time', () => {
  const base: NudgeState = { now: T(0, '08:00'), profile: { setupDone: true }, blocks: [], people: [], tasks: [], connected: [], lunchMenus: {}, schoolDays: [1, 2, 3, 4, 5], dismissed: [], hasKey: false, bedtimeSet: true };
  it('asks for missing basics first, then the next missing school day', () => {
    expect(nudges(base)[0].id).toBe('name');
    const n = nudges({ ...base, profile: { name: 'Ari', setupDone: true }, blocks: schoolDay(0) });
    expect(n[0].text).toBe("I don't have your Tuesday schedule yet. Want to add it?");
  });
  it('skips dismissed ones and only offers web lookups with a key', () => {
    const s = { ...base, profile: { name: 'Ari', school: 'Lincoln High', setupDone: true }, dismissed: ['sched-1', 'sched-2', 'sched-3', 'sched-4', 'sched-5', 'people'] };
    expect(nudges(s).some(n => n.id === 'school-cal')).toBe(false);
    expect(nudges({ ...s, hasKey: true })[0].id).toBe('school-cal');
  });
});

describe('people', () => {
  it('upcoming birthdays with age', () => {
    const list = upcomingBirthdays([person('Mom', { birthday: { month: 12, day: 1 } }), person('Jo', { birthday: { month: 6, day: 1 } })], MON, 30);
    expect(list.map(b => [b.person.name, b.inDays])).toEqual([['Mom', 8]]);
  });
  it('suggests people you share events with', () => {
    expect(frequentPeople({ Sam: 6, Lee: 1, Mom: 4 }, [person('Mom')])).toEqual([{ name: 'Sam', count: 6 }]);
  });
});

describe('reflow + import + parsing', () => {
  it('previews and reflows around a moved block', () => {
    const bl = [block('Class', T(0, '13:00'), T(0, '14:00')), block('Study', T(0, '15:00'), T(0, '16:00'), { kind: 'study', fixed: false, id: 'a' }), block('Read', T(0, '16:05'), T(0, '17:00'), { kind: 'study', fixed: false, id: 'b' })];
    expect(previewMove(bl, 'a', T(0, '16:00'), T(0, '17:00')).displaced.map(b => b.id)).toEqual(['b']);
    const moved = bl.map(b => (b.id === 'a' ? { ...b, start: T(0, '16:00'), end: T(0, '17:00') } : b));
    expect(autoReflow(moved, T(0, '12:00'), T(0, '23:00'), ['a']).blocks.find(b => b.id === 'b')!.start).toBe(T(0, '17:05'));
  });
  it('school iCal: no-school days stay all-day, classes are fixed', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nSUMMARY:No School - Thanksgiving Break\nDTSTART;VALUE=DATE:20261126\nEND:VEVENT\nBEGIN:VEVENT\nUID:2\nSUMMARY:Period 1 Biology\nDTSTART:20261123T080000\nDTEND:20261123T085000\nEND:VEVENT\nEND:VCALENDAR';
    const bl = icsToBlocks(ics, MON, MON + 7 * DAY);
    expect(bl.map(b => [b.kind, !!b.allDay])).toEqual([['no-school', true], ['class', false]]);
    expect(bl.every(b => b.fixed)).toBe(true);
  });
  it('quick add parses due dates', () => {
    const c = parseCapture('bio lab report fri', { now: T(0, '10:00') });
    expect(c.kind).toBe('task');
    expect(captureDue(c)).toBe(at(addDays(MON, 4), '08:00'));
    void MIN;
  });
});
