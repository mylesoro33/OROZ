import { describe, it, expect } from 'vitest';
import { parseCapture, captureDue } from '../parser';
import { MON, T } from './fixtures';
import { at, addDays } from '../time';

const ctx = { now: T(0, '10:00'), places: [{ id: 'gym', name: 'Gym' }, { id: 'school', name: 'School' }, { id: 'home', name: 'Home' }], people: ['Jake', 'Mom'] };
const p = (s: string) => parseCapture(s, ctx);

describe('quick capture parser', () => {
  it('task: "bio lab report 90m fri high"', () => {
    const c = p('bio lab report 90m fri high');
    expect(c.kind).toBe('task');
    expect(c.title).toBe('Bio lab report');
    expect(c.durationMin).toBe(90);
    expect(c.priority).toBe(1);
    expect(c.day).toBe(addDays(MON, 4));
    expect(captureDue(c)).toBe(at(addDays(MON, 4), '08:00'));
  });
  it('event: "dinner with Jake saturday 7"', () => {
    const c = p('dinner with Jake saturday 7');
    expect(c.kind).toBe('event');
    expect(c.mealType).toBe('dinner');
    expect(c.person).toBe('Jake');
    expect(c.title).toBe('Dinner with Jake');
    expect(c.start).toBe(at(addDays(MON, 5), '19:00'));
    expect(c.defaulted).not.toContain('am/pm');
  });
  it('birthday: "Mom\'s birthday march 3"', () => {
    const c = p("Mom's birthday march 3");
    expect(c.kind).toBe('birthday');
    expect(c.person).toBe('Mom');
    expect([c.month, c.dayOfMonth]).toEqual([3, 3]);
  });
  it('reminder: "remind me to call grandma sunday"', () => {
    const c = p('remind me to call grandma sunday');
    expect(c.kind).toBe('reminder');
    expect(c.title).toBe('Call grandma');
    expect(c.day).toBe(addDays(MON, 6));
    expect(c.defaulted).toContain('time');
  });
  it('commands', () => {
    expect(p('nap').command).toEqual({ type: 'nap', minutes: undefined });
    expect(p('30 school').command).toEqual({ type: 'free', minutes: 30, place: 'school' });
    expect(p('free 30').command).toEqual({ type: 'free', minutes: 30, place: undefined });
    expect(p('45 gym').command).toEqual({ type: 'free', minutes: 45, place: 'gym' });
    expect(p('eat 30').command).toEqual({ type: 'eat', minutes: 30 });
    expect(p('hungry').command).toEqual({ type: 'eat', minutes: undefined });
    expect(p('movie').command).toEqual({ type: 'movie' });
    expect(p('tonight').command).toEqual({ type: 'quickplan', when: 'tonight' });
    expect(p('tomorrow').command).toEqual({ type: 'quickplan', when: 'tomorrow' });
    expect(p('push 1h').command).toEqual({ type: 'push', minutes: 60 });
    expect(p('plan my week').command).toEqual({ type: 'plan', range: 'week' });
    expect(p('my day fell apart').command).toEqual({ type: 'fellApart' });
  });
  it('hobby: "movie tonight"', () => {
    const c = p('movie tonight');
    expect(c.kind).toBe('hobby');
    expect(c.activity).toBe('movie');
    expect(c.start).toBe(at(MON, '19:30'));
    expect(c.durationMin).toBe(120);
  });
  it('food preferences', () => {
    expect(p('I hate mushrooms').pref).toEqual({ target: 'me', field: 'dislikes', value: 'mushrooms' });
    expect(p('love Thai').pref).toEqual({ target: 'me', field: 'cuisines', value: 'thai' });
    expect(p("I'm vegetarian").pref?.field).toBe('dietary');
  });
  it('person preferences', () => {
    const c = p('Jake likes fishing');
    expect(c.kind).toBe('person_pref');
    expect(c.pref).toEqual({ target: 'Jake', field: 'interests', value: 'fishing' });
    expect(p('Mom is vegetarian').pref).toEqual({ target: 'Mom', field: 'dietary', value: 'vegetarian' });
    expect(p('Jake loves thai food').pref?.field).toBe('foodLikes');
  });
  it('never blocks: unknown input still gets a sensible default with chips', () => {
    const c = p('buy poster board');
    expect(c.kind).toBe('task');
    expect(c.defaulted).toEqual(expect.arrayContaining(['duration', 'priority', 'due']));
  });
  it('place + explicit time', () => {
    const c = p('study session at school tomorrow 3:30pm 45m');
    expect(c.place?.id).toBe('school');
    expect(c.start).toBe(at(addDays(MON, 1), '15:30'));
    expect(c.durationMin).toBe(45);
  });
  it('am/pm ambiguity gets a chip, not a question', () => {
    const c = p('dentist thursday 9');
    expect(c.kind).toBe('event');
    expect(c.start).toBe(at(addDays(MON, 3), '09:00'));
    expect(c.defaulted).toContain('am/pm');
  });
});
