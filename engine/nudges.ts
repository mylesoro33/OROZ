import type { Block, Person, Profile, Task, Ms } from './types';
import { addDays, startOfDay, dayName, overlaps, isoDay } from './time';

// One small question at a time, so OROZ builds up with you.

export type NudgeAction =
  | { type: 'setup' } | { type: 'add-class'; day: Ms } | { type: 'people' } | { type: 'person'; id: string }
  | { type: 'chat'; prompt: string } | { type: 'connections' } | { type: 'bedtime' };
export interface Nudge { id: string; text: string; cta: string; action: NudgeAction }

export interface NudgeState {
  now: Ms; profile: Profile; blocks: Block[]; people: Person[]; tasks: Task[];
  connected: string[]; lunchMenus: Record<string, string[]>; schoolDays: number[];
  dismissed: string[]; hasKey: boolean; bedtimeSet: boolean;
}

export function nudges(s: NudgeState): Nudge[] {
  const out: Nudge[] = [];
  const today = startOfDay(s.now);
  if (!s.profile.name) out.push({ id: 'name', text: 'What should I call you?', cta: 'Tell me', action: { type: 'setup' } });
  if (!s.bedtimeSet) out.push({ id: 'bedtime', text: 'When do you usually go to bed on school nights?', cta: 'Set it', action: { type: 'bedtime' } });
  // Missing class schedule for an upcoming school day
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    if (!s.schoolDays.includes(new Date(d).getDay())) continue;
    const dayBlocks = s.blocks.filter(b => overlaps(b, { start: d, end: addDays(d, 1) }));
    if (dayBlocks.some(b => b.kind === 'no-school')) continue;
    if (!dayBlocks.some(b => b.kind === 'class')) {
      out.push({ id: `sched-${new Date(d).getDay()}`, text: `I don't have your ${dayName(d, true)} schedule yet. Want to add it?`, cta: 'Add classes', action: { type: 'add-class', day: d } });
      break;
    }
  }
  if (!s.people.length) out.push({ id: 'people', text: 'Who do you want to celebrate or keep up with?', cta: 'Add people', action: { type: 'people' } });
  const noBday = s.people.find(p => !p.birthday);
  if (noBday) out.push({ id: `bday-${noBday.id}`, text: `When is ${noBday.name}'s birthday?`, cta: 'Add it', action: { type: 'person', id: noBday.id } });
  if (s.profile.school && s.hasKey && !s.connected.includes('school-calendar'))
    out.push({ id: 'school-cal', text: `Want me to find ${s.profile.school}'s calendar? No-school days, exams, early dismissals.`, cta: 'Search', action: { type: 'chat', prompt: `Find ${s.profile.school}'s academic calendar for this school year and add no-school days, early dismissals, exam weeks and events to my schedule.` } });
  const nextSchoolDay = [0, 1, 2].map(i => addDays(today, i)).find(d => s.schoolDays.includes(new Date(d).getDay()));
  if (s.profile.school && s.hasKey && nextSchoolDay && !s.lunchMenus[isoDay(nextSchoolDay)])
    out.push({ id: `lunch-${isoDay(today).slice(0, 7)}-${Math.floor(new Date(today).getDate() / 7)}`, text: `Look up this week's lunch menu at ${s.profile.school}?`, cta: 'Look it up', action: { type: 'chat', prompt: `Look up this week's school lunch menu at ${s.profile.school} and save it to my days.` } });
  return out.filter(n => !s.dismissed.includes(n.id));
}
