import type { Block, Ms, Source } from './types';
import { DAY, MIN, hashId } from './time';

// Minimal RFC 5545 parser: VEVENT with DTSTART/DTEND/DURATION/SUMMARY/UID/LOCATION/DESCRIPTION,
// all-day dates, UTC 'Z' times, floating/TZID local times, and simple RRULEs (DAILY/WEEKLY with BYDAY, COUNT, UNTIL).

export interface IcsEvent { uid: string; summary: string; start: Ms; end: Ms; allDay: boolean; location?: string; description?: string; rrule?: string; exdates: Ms[]; categories?: string }

function unfold(text: string): string[] { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n'); }
function unescape(v: string) { return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }

export function parseIcsDate(value: string, params: string): { t: Ms; allDay: boolean } {
  const v = value.trim();
  if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(v)) {
    return { t: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)).getTime(), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return { t: Date.parse(v), allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false };
  // TZID or floating: treat as local wall time (good enough for a school calendar in your own timezone)
  return { t: new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)).getTime(), allDay: false };
}

function parseDuration(v: string): number {
  const m = v.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
  if (!m) return 0;
  return ((+(m[1] ?? 0) * 7 + +(m[2] ?? 0)) * 24 * 60 + +(m[3] ?? 0) * 60 + +(m[4] ?? 0)) * MIN;
}

export function parseIcs(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Partial<IcsEvent> & { dur?: number } | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start !== undefined) {
        const end = cur.end ?? (cur.dur ? cur.start + cur.dur : cur.allDay ? cur.start + DAY : cur.start + 60 * MIN);
        out.push({ uid: cur.uid ?? hashId(`${cur.summary}${cur.start}`), summary: cur.summary ?? '(untitled)', start: cur.start, end, allDay: !!cur.allDay, location: cur.location, description: cur.description, rrule: cur.rrule, exdates: cur.exdates ?? [], categories: cur.categories });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':'); if (idx < 0) continue;
    const left = line.slice(0, idx), value = line.slice(idx + 1);
    const [name, ...p] = left.split(';'); const params = p.join(';');
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.summary = unescape(value); break;
      case 'LOCATION': cur.location = unescape(value); break;
      case 'DESCRIPTION': cur.description = unescape(value); break;
      case 'CATEGORIES': cur.categories = value; break;
      case 'DTSTART': { const d = parseIcsDate(value, params); cur.start = d.t; cur.allDay = d.allDay; break; }
      case 'DTEND': cur.end = parseIcsDate(value, params).t; break;
      case 'DURATION': cur.dur = parseDuration(value); break;
      case 'RRULE': cur.rrule = value; break;
      case 'EXDATE': for (const v of value.split(',')) cur.exdates!.push(parseIcsDate(v, params).t); break;
    }
  }
  return out;
}

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Expand recurring events into concrete occurrences within [from, to). */
export function expand(ev: IcsEvent, from: Ms, to: Ms): IcsEvent[] {
  if (!ev.rrule) return ev.end > from && ev.start < to ? [ev] : [];
  const rule = Object.fromEntries(ev.rrule.split(';').map(kv => kv.split('=')));
  const freq = rule.FREQ; const interval = +(rule.INTERVAL ?? 1);
  const count = rule.COUNT ? +rule.COUNT : Infinity;
  const until = rule.UNTIL ? parseIcsDate(rule.UNTIL, '').t + (rule.UNTIL.length === 8 ? DAY - 1 : 0) : Infinity;
  const days: number[] | undefined = rule.BYDAY ? rule.BYDAY.split(',').map((d: string) => BYDAY[d.slice(-2)]) : undefined;
  const dur = ev.end - ev.start;
  const out: IcsEvent[] = [];
  let n = 0;
  const step = (t: Ms, k: number) => { const d = new Date(t); d.setDate(d.getDate() + k); return d.getTime(); };
  if (freq === 'DAILY' || (freq === 'WEEKLY' && days)) {
    for (let t = ev.start, i = 0; t < to && t <= until && n < count && i < 3000; t = step(t, 1), i++) {
      const wd = new Date(t).getDay();
      const weekIdx = Math.floor((t - ev.start) / (7 * DAY));
      const okDay = freq === 'DAILY' ? Math.round((t - ev.start) / DAY) % interval === 0 : days!.includes(wd) && weekIdx % interval === 0;
      if (!okDay) continue;
      n++;
      if (ev.exdates.some(x => Math.abs(x - t) < MIN)) continue;
      if (t + dur > from) out.push({ ...ev, start: t, end: t + dur, uid: `${ev.uid}_${t}` });
    }
  } else if (freq === 'WEEKLY' || freq === 'MONTHLY' || freq === 'YEARLY') {
    for (let t = ev.start, i = 0; t < to && t <= until && n < count && i < 1000; i++) {
      n++;
      if (!ev.exdates.some(x => Math.abs(x - t) < MIN) && t + dur > from) out.push({ ...ev, start: t, end: t + dur, uid: `${ev.uid}_${t}` });
      const d = new Date(t);
      if (freq === 'WEEKLY') d.setDate(d.getDate() + 7 * interval); else if (freq === 'MONTHLY') d.setMonth(d.getMonth() + interval); else d.setFullYear(d.getFullYear() + interval);
      t = d.getTime();
    }
  }
  return out;
}

/** Calendar events → fixed blocks (imported events can never be moved by the planner). */
export function icsToBlocks(text: string, from: Ms, to: Ms, source: Source = 'link'): Block[] {
  const blocks: Block[] = [];
  for (const ev of parseIcs(text)) for (const o of expand(ev, from, to)) {
    blocks.push({
      id: `${source}_${hashId(o.uid)}`, externalId: o.uid, title: o.summary,
      kind: /\b(class|period|lecture|lab)\b/i.test(o.summary + (o.categories ?? '')) ? 'class' : /\bshift\b/i.test(o.summary) ? 'work' : 'event',
      start: o.start, end: o.end, fixed: true, source, location: o.location, allDay: o.allDay || undefined,
    });
  }
  return blocks;
}

/** Assignment feeds (Canvas/Schoology/Classroom iCal) publish due dates as events. */
export interface FeedAssignment { externalId: string; title: string; course?: string; due: Ms; description?: string }
export function icsToAssignments(text: string, now: Ms): FeedAssignment[] {
  return parseIcs(text).filter(e => e.start >= now - DAY).map(e => {
    const m = e.summary.match(/^(.*?)\s*\[(.+?)\]\s*$/); // Canvas: "Essay 2 [ENG 101]"
    return { externalId: e.uid, title: (m ? m[1] : e.summary).trim(), course: m?.[2], due: e.allDay ? e.start + 23 * 3_600_000 + 59 * MIN : e.start, description: e.description };
  });
}
