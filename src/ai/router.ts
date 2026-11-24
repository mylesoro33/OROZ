// What happens when you tell OROZ something, paste a link, or send a photo.
import { talkToDraft } from '@engine/talk';
import { normalizeLink, itemsFor, daySummary } from '@engine/week';
import { icsToBlocks } from '@engine/ics';
import { extractDate } from '@engine/parser';
import { upcomingBirthdays } from '@engine/occasions';
import { startOfDay, addDays, fmtDay, fmtTime, uid, DAY } from '@engine/time';
import { store, emptyDraft, type Draft } from '../data/store';
import { fetchIcsText } from '../integrations/ics';

export interface Reply { text: string; draft?: Draft; sources?: string[]; fitTaskId?: string; needsKey?: boolean }

const hasKey = () => !!store().state.settings.apiKey;

export async function tell(text: string, onStatus?: (s: string) => void): Promise<Reply> {
  const t = text.trim(); if (!t) return { text: '' };
  if (/^https?:\/\/|^webcal:|^www\.|\.(com|org|edu|net|gov|ics)(\/|$)/i.test(t) && !/\s/.test(t)) return link(t, onStatus);
  if (hasKey()) {
    const { talk } = await import('./claude');
    try { return await talk(t, onStatus); } catch (e) { if ((e as Error).message !== 'NO_KEY' && !/fetch|network/i.test(String(e))) throw e; }
  }
  return local(t);
}

/** Offline: understand the common things without any AI. */
export function local(text: string): Reply {
  const st = store().state; const now = Date.now();
  const l = text.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(look like|what('s| is| do i have)|how('s| is) my|am i free|anything)\b/.test(l) && /\b(day|today|tomorrow|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight)\b/.test(l)) {
    const day = extractDate(' ' + l + ' ', now).day ?? startOfDay(now);
    const s = daySummary(day, st.blocks, st.tasks, st.people, st.settings, now);
    const items = itemsFor(day, st.blocks, st.tasks).slice(0, 4).map(b => (b.allDay ? b.title : `${b.title} ${fmtTime(b.start)}`));
    return { text: `${cap(fmtDay(day, now))}: ${items.join(', ') || 'nothing scheduled'}. ${s.open}.`, sources: ['Calendar'] };
  }
  if (/birthday/.test(l) && /\b(coming|upcoming|soon|next|who)\b/.test(l)) {
    const up = upcomingBirthdays(st.people, now, 60).slice(0, 3);
    return { text: up.length ? up.map(b => `${b.person.name}, ${fmtDay(b.date, now)}`).join('; ') + '.' : 'No birthdays in the next two months.', sources: ['People'] };
  }
  const d = talkToDraft(text, now, st.places);
  if (d.kind === 'event') return { text: d.line, draft: { ...emptyDraft('Add to calendar'), events: d.events ?? [d.event!] } };
  if (d.kind === 'task') return { text: d.line, draft: { ...emptyDraft('Add to To-Do'), tasks: [d.task!] }, fitTaskId: d.fitIn ? d.task!.id : undefined };
  if (d.kind === 'person' && d.person) return { text: d.line, draft: { ...emptyDraft('Add person'), people: [{ id: uid('person'), name: d.person.name, birthday: d.person.month ? { month: d.person.month, day: d.person.day ?? 1 } : undefined, source: 'talk' }] } };
  return { text: hasKey() ? "I didn't catch that. Try again?" : "I didn't catch that. Try something like “dentist Tuesday at 3”.", needsKey: !hasKey() };
}

export async function link(raw: string, onStatus?: (s: string) => void): Promise<Reply> {
  const { kind, url } = normalizeLink(raw);
  if (kind === 'ics') {
    try {
      onStatus?.('Opening the calendar…');
      const from = startOfDay(Date.now()) - DAY;
      const events = icsToBlocks(await fetchIcsText(url), from, addDays(from, 120), 'link');
      return { text: `Found ${events.length} event${events.length === 1 ? '' : 's'}.`, draft: { ...emptyDraft(`From ${new URL(url).hostname}`), events }, sources: [new URL(url).hostname] };
    } catch (e) { if (!hasKey()) return { text: (e as Error).message }; }
  }
  if (!hasKey()) return { text: 'Reading web pages needs a Claude key (Settings → Preferences). Calendar links (.ics) work without one.', needsKey: true };
  const { readPage } = await import('./claude');
  return readPage(url, onStatus);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
