import type { Block, Settings, Task, Person, Ms } from './types';
import { Timeline } from './timeline';
import { nightFor, type Night } from './sleep';
import { placeMeals, gapSnacks } from './meals';
import { upcomingBirthdays } from './occasions';
import { addDays, startOfDay, overlaps, fmtTime, isoDay, MIN } from './time';

export interface DayView { day: Ms; blocks: Block[]; morning: Night; tonight: Night; warnings: string[] }

/** Stored blocks for a day plus derived sleep and meals (computed fresh, never stored). */
export function deriveDay(day: Ms, stored: Block[], settings: Settings): DayView {
  const d0 = startOfDay(day), d1 = addDays(d0, 1);
  const near = stored.filter(b => overlaps(b, { start: d0 - 12 * 3_600_000, end: d1 + 12 * 3_600_000 }));
  const morning = nightFor(addDays(d0, -1), settings.sleep, settings.schoolDays, near);
  const tonight = nightFor(d0, settings.sleep, settings.schoolDays, near);
  const tl = new Timeline([...near.filter(b => !b.allDay), morning.block, tonight.block]);
  const meals = placeMeals(d0, settings.meals, tl, morning.wake);
  const snacks = gapSnacks(d0, settings.meals, tl, morning.wake, tonight.bedtime);
  const inDay = (b: Block) => overlaps(b, { start: d0, end: d1 });
  const blocks = [...stored.filter(inDay), morning.block, tonight.block, ...meals.blocks, ...snacks].filter(inDay).sort((a, b) => a.start - b.start);
  return { day: d0, blocks, morning, tonight, warnings: [...meals.warnings, ...(tonight.warning ? [tonight.warning] : [])] };
}

export type OutlookIcon = 'school' | 'event' | 'lunch' | 'due' | 'prep' | 'moon' | 'cake' | 'off';
export interface OutlookLine { icon: OutlookIcon; text: string }

export function dayOutlook(v: DayView, tasks: Task[], people: Person[], lunchMenus: Record<string, string[]>, now: Ms): OutlookLine[] {
  const lines: OutlookLine[] = [];
  const d0 = v.day, d1 = addDays(d0, 1);
  const off = v.blocks.find(b => b.kind === 'no-school');
  if (off) lines.push({ icon: 'off', text: off.title });
  const classes = v.blocks.filter(b => b.kind === 'class' && !b.allDay);
  if (classes.length) lines.push({ icon: 'school', text: `${classes.length} ${classes.length === 1 ? 'class' : 'classes'} · ${fmtTime(classes[0].start)}–${fmtTime(classes[classes.length - 1].end)}` });
  const events = v.blocks.filter(b => (b.kind === 'event' || b.kind === 'study') && !b.derived);
  if (events.length) lines.push({ icon: 'event', text: events.slice(0, 3).map(e => (e.allDay ? e.title : `${e.title} ${fmtTime(e.start)}`)).join(' · ') + (events.length > 3 ? ` +${events.length - 3}` : '') });
  const lunch = lunchMenus[isoDay(d0)];
  if (lunch?.length) lines.push({ icon: 'lunch', text: `Lunch: ${lunch.join(', ')}` });
  const due = tasks.filter(t => !t.done && t.due !== undefined && t.due >= d0 && t.due < d1);
  if (due.length) lines.push({ icon: 'due', text: `Due: ${due.map(t => t.title).join(', ')}` });
  const bdays = upcomingBirthdays(people, d0, 0).filter(b => b.date === d0);
  for (const b of bdays) lines.push({ icon: 'cake', text: `${b.person.name}'s birthday${b.turning ? ` (${b.turning})` : ''}` });
  const tomorrowDue = tasks.filter(t => !t.done && t.due !== undefined && t.due >= d1 && t.due < addDays(d1, 1));
  const earlyTomorrow = v.blocks.length ? [] : [];
  if (tomorrowDue.length) lines.push({ icon: 'prep', text: `Prep for tomorrow: ${tomorrowDue.map(t => t.title).join(', ')}` });
  void earlyTomorrow;
  if (v.tonight.bedtime > now || d0 > startOfDay(now)) {
    const homework = tomorrowDue.some(t => t.type === 'school') || v.blocks.some(b => b.kind === 'study' && b.end > v.tonight.windDownBy - 3 * 60 * MIN);
    lines.push({ icon: 'moon', text: homework ? `Wrap homework by ${fmtTime(v.tonight.windDownBy)} to hit bed ~${fmtTime(v.tonight.bedtime)}` : `Bed ~${fmtTime(v.tonight.bedtime)} · up ${fmtTime(v.tonight.wake)}` });
  }
  return lines;
}
