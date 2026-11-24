// Offline fallback when no API key is set: understands the everyday basics.
import { deriveDay } from '@engine/day';
import { upcomingBirthdays } from '@engine/occasions';
import { parseCapture, captureDue, extractDate, extractTime } from '@engine/parser';
import { addDays, startOfDay, fmtTime, fmtDay, isoDay, hm, uid } from '@engine/time';
import { store } from '../data/store';
import type { ToolCtx } from './tools';

export function localReply(text: string): { text: string; sources: string[]; ctx: ToolCtx } {
  const st = store().state; const now = Date.now(); const s = store();
  const ctx: ToolCtx = { changed: false, sources: new Set() };
  const l = text.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const say = (t: string, src: string[] = []) => ({ text: t, sources: src, ctx });

  if (/birthday/.test(l) && /(coming|upcoming|soon|next|who)/.test(l)) {
    const up = upcomingBirthdays(st.people, now, 45);
    return say(up.length ? up.slice(0, 4).map(b => `${b.person.name}: ${fmtDay(b.date, now)}${b.inDays > 1 ? ` (in ${b.inDays} days)` : ''}`).join('. ') + '.' : 'No birthdays in the next 6 weeks.', ['People']);
  }
  if (/bed ?time|go to bed|sleep/.test(l)) {
    const day = extractDate(l, now).day ?? startOfDay(now);
    const night = deriveDay(day, st.blocks, st.settings).tonight;
    let target: number | undefined;
    const t = extractTime(' ' + l.replace(/bed ?time|tonight|at|to/g, ' ') + ' ', 'tonight').timeMin;
    if (t !== undefined) target = t;
    else if (/later/.test(l)) target = (new Date(night.bedtime).getHours() * 60 + new Date(night.bedtime).getMinutes() + 30) % 1440;
    else if (/earlier/.test(l)) target = (new Date(night.bedtime).getHours() * 60 + new Date(night.bedtime).getMinutes() + 1410) % 1440;
    if (target !== undefined) {
      ctx.changed = true;
      s.set('settings', { ...st.settings, sleep: { ...st.settings.sleep, overrides: { ...st.settings.sleep.overrides, [isoDay(day)]: hm(target) } } });
      const n = deriveDay(day, store().state.blocks, store().state.settings).tonight;
      return say(`Bedtime ${fmtTime(n.bedtime)} ${fmtDay(day, now)}. That's ${((n.wake - n.bedtime) / 3_600_000).toFixed(1)}h before ${fmtTime(n.wake)}.`, ['Sleep']);
    }
    return say(`Bed around ${fmtTime(night.bedtime)} ${fmtDay(day, now)}, up at ${fmtTime(night.wake)}.`, ['Sleep']);
  }
  if (/what('s| is)? (my )?(day|schedule)|how('s| does) .* look|what do i have/.test(l)) {
    const day = extractDate(l, now).day ?? startOfDay(now);
    const v = deriveDay(day, st.blocks, st.settings);
    const items = v.blocks.filter(b => !b.derived);
    const due = st.tasks.filter(t => !t.done && t.due && startOfDay(t.due) === day);
    const parts = [items.length ? items.slice(0, 5).map(b => (b.allDay ? b.title : `${b.title} ${fmtTime(b.start)}`)).join(', ') : 'Nothing scheduled'];
    if (due.length) parts.push(`due: ${due.map(t => t.title).join(', ')}`);
    parts.push(`bed ~${fmtTime(v.tonight.bedtime)}`);
    return say(`${fmtDay(day, now)[0].toUpperCase() + fmtDay(day, now).slice(1)}: ${parts.join('; ')}.`, ['Schedule']);
  }
  if (/^remember\b|^note that\b/.test(l)) { s.remember(text.replace(/^(remember( that)?|note that)\s*/i, '')); return say("Got it, I'll remember that.", ['Memory']); }

  const c = parseCapture(text.replace(/^(add|schedule|put)\s+/i, ''), { now });
  if (c.kind === 'task' || c.kind === 'reminder') {
    s.checkpoint(); ctx.changed = true;
    s.upsert('tasks', [{ id: uid('task'), title: c.title, due: captureDue(c), type: /study|test|quiz|essay|lab|homework|read/i.test(c.title) ? 'school' : 'personal', done: false, source: 'chat', createdAt: now }]);
    return say(`Added "${c.title}"${c.day !== undefined ? ` for ${fmtDay(c.day, now)}` : ''}.`, ['To-Do']);
  }
  if ((c.kind === 'event' || c.kind === 'hobby' || c.kind === 'meal') && c.start) {
    s.checkpoint(); ctx.changed = true;
    s.upsert('blocks', [{ id: uid('blk'), title: c.title, kind: /study/i.test(c.title) ? 'study' : 'event', start: c.start, end: c.start + (c.durationMin ?? 60) * 60_000, fixed: false, source: 'chat', mealType: c.mealType }]);
    return say(`Added ${c.title}, ${fmtDay(c.start, now)} at ${fmtTime(c.start)}.`, ['Schedule']);
  }
  void addDays;
  return say('I can handle your schedule, tasks, bedtime and birthdays offline. For web search and longer conversations, add a Claude key in Settings.');
}
