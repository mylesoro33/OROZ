import type { Block, BlockKind, Ms } from './types';
import { at, addDays, startOfDay, fromIsoDay, isoDay, parseHM, hm, uid, MIN } from './time';

// Schedule photo → draft. The model only *reads* (Scan). Everything after that —
// questions, recurring rows, duplicates, routine — is plain, tested code here.

export type ScanKind = 'classes' | 'work' | 'practice' | 'bell' | 'rotation' | 'mixed' | 'other';
export type Pattern = 'weekly' | 'rotating' | 'dated' | 'unknown';

export interface ScanItem {
  title: string;
  days?: number[];          // weekly: 0=Sun..6=Sat
  rotation?: string;        // rotating: "A", "Day 2"
  date?: string;            // dated: YYYY-MM-DD
  start?: string;           // HH:MM
  end?: string;
  location?: string;
  confidence: 'high' | 'low';
  note?: string;            // why it's uncertain
}
export interface Scan {
  kind: ScanKind;
  readable: 'good' | 'partial' | 'unreadable';
  problems: string[];       // "Bottom rows are cut off"
  missed: string[];         // parts it couldn't read
  pattern: Pattern;
  rotation_labels: string[];
  start_date?: string;
  end_date?: string;
  person?: string;          // a name printed on the schedule
  items: ScanItem[];
}

export interface Answers {
  pattern: 'weekly' | 'rotating' | 'dated';
  start: string;            // YYYY-MM-DD
  end: string;
  rotationToday?: string;   // which rotation label `start` is
  schoolDays: number[];     // days a rotation advances on
  who: 'me' | 'other';
  otherName?: string;
}

export interface Row {
  id: string;
  title: string;
  kind: BlockKind;
  days: number[];
  rotation?: string;
  date?: string;
  start: string;
  end: string;
  location?: string;
  flags: string[];          // shown highlighted: "Check the time", "Looks like a duplicate"
  duplicate?: boolean;
  skip?: Ms[];              // days already on the calendar
  include: boolean;
}

export type Question = 'pattern' | 'dates' | 'rotation' | 'who';

/** Ask only what's needed. Dates are always confirmed (prefilled). */
export function questionsFor(s: Scan): Question[] {
  const q: Question[] = [];
  const anyDated = s.items.some(i => i.date);
  if (s.pattern === 'unknown' || (s.pattern === 'weekly' && s.rotation_labels.length > 1)) q.push('pattern');
  if (s.pattern === 'rotating' || s.rotation_labels.length > 1 || s.items.some(i => i.rotation)) q.push('rotation');
  if (!(s.pattern === 'dated' && anyDated)) q.push('dates');
  if (s.person) q.push('who');
  return [...new Set(q)];
}

export function defaultAnswers(s: Scan, now: Ms): Answers {
  const today = startOfDay(now);
  const start = s.start_date && fromIsoDay(s.start_date) >= addDays(today, -365) ? s.start_date : isoDay(today);
  const end = s.end_date ?? isoDay(addDays(fromIsoDay(start), 7 * 16 - 1));
  const pattern: Answers['pattern'] = s.pattern === 'rotating' || (s.pattern === 'unknown' && s.items.some(i => i.rotation)) ? 'rotating' : s.pattern === 'dated' ? 'dated' : 'weekly';
  return { pattern, start, end, rotationToday: s.rotation_labels[0], schoolDays: [1, 2, 3, 4, 5], who: 'me', otherName: s.person };
}

const KIND: Record<ScanKind, BlockKind> = { classes: 'class', bell: 'class', rotation: 'class', work: 'work', practice: 'event', mixed: 'event', other: 'event' };

/** Merge items that are the same thing on different days into one recurring row. */
export function rowsFromScan(s: Scan): Row[] {
  const groups = new Map<string, Row>();
  for (const it of s.items) {
    const title = it.title.trim().replace(/\s+/g, ' ');
    if (!title) continue;
    const flags: string[] = [];
    if (it.confidence === 'low') flags.push(it.note || 'Check this one');
    let start = it.start, end = it.end;
    if (!start) { flags.push('No start time found'); start = '09:00'; }
    if (!end) { flags.push('No end time found'); end = hm(parseHM(start) + (s.kind === 'classes' || s.kind === 'bell' ? 50 : 60)); }
    if (parseHM(end) <= parseHM(start)) { flags.push('End time looks wrong'); end = hm(parseHM(start) + 60); }
    const key = [title.toLowerCase(), start, end, it.rotation ?? '', it.date ?? '', (it.location ?? '').toLowerCase()].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.days = [...new Set([...existing.days, ...(it.days ?? [])])].sort();
      existing.flags = [...new Set([...existing.flags, ...flags])];
      continue;
    }
    groups.set(key, { id: uid('row'), title, kind: KIND[s.kind], days: [...new Set(it.days ?? [])].sort(), rotation: it.rotation, date: it.date, start, end, location: it.location, flags, include: true });
  }
  return [...groups.values()].sort((a, b) => (a.days[0] ?? 9) - (b.days[0] ?? 9) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** Every day a row happens between start and end (minus days already on the calendar). */
export function occurrences(r: Row, a: Answers): Ms[] {
  const all = allOccurrences(r, a);
  return r.skip?.length ? all.filter(d => !r.skip!.includes(d)) : all;
}
function allOccurrences(r: Row, a: Answers): Ms[] {
  const from = fromIsoDay(a.start), to = fromIsoDay(a.end);
  if (r.date) { const d = fromIsoDay(r.date); return d >= from - 366 * 86_400_000 ? [d] : []; }
  const out: Ms[] = [];
  if (a.pattern === 'rotating' && r.rotation) {
    const labels = rotationLabels(a, r);
    let idx = Math.max(0, labels.indexOf(a.rotationToday ?? labels[0]));
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!a.schoolDays.includes(new Date(d).getDay())) continue;
      if (labels[idx % labels.length] === r.rotation) out.push(d);
      idx++;
    }
    return out;
  }
  for (let d = from; d <= to; d = addDays(d, 1)) if (r.days.includes(new Date(d).getDay())) out.push(d);
  return out;
}
let _labels: string[] = [];
export const setRotationLabels = (l: string[]) => { _labels = l; };
function rotationLabels(a: Answers, r: Row): string[] { return _labels.length ? _labels : [a.rotationToday ?? r.rotation!, r.rotation!]; }

/** Same title and start time as something already on the calendar → skip those days; all of them → duplicate. */
const DUP = 'Already on your calendar';
export function markDuplicates(rows: Row[], a: Answers, existing: Block[]): Row[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const have = new Set(existing.filter(b => !b.allDay).map(b => `${norm(b.title)}|${b.start}`));
  return rows.map(r => {
    const clean = { ...r, skip: undefined, duplicate: false, flags: r.flags.filter(f => f !== DUP && !f.endsWith('already on your calendar')) };
    const occ = allOccurrences(clean, a);
    const skip = occ.filter(d => have.has(`${norm(r.title)}|${at(d, r.start)}`));
    if (!skip.length) return clean;
    if (skip.length === occ.length) return { ...clean, duplicate: true, include: false, flags: [...clean.flags, DUP] };
    const days = [...new Set(skip.map(d => new Date(d).toLocaleDateString(undefined, { weekday: 'long' })))];
    return { ...clean, skip, flags: [...clean.flags, `${days.join(' and ')} already on your calendar`] };
  });
}

/** Approved rows → calendar blocks, one series per row. */
export function toBlocks(rows: Row[], a: Answers): Block[] {
  const prefix = a.who === 'other' && a.otherName ? `${a.otherName}: ` : '';
  const out: Block[] = [];
  for (const r of rows.filter(r => r.include)) {
    const seriesId = uid('series');
    for (const d of occurrences(r, a)) out.push({ id: uid('blk'), title: prefix + r.title, kind: a.who === 'other' ? 'event' : r.kind, start: at(d, r.start), end: at(d, r.end), fixed: false, source: 'photo', seriesId, location: r.location });
  }
  return out;
}

export interface Routine { label: string; days: number[]; from: string; to: string; lunch?: { from: string; to: string } }

/** "Work Mon–Fri, usually 7am–3pm" from what was confirmed. Offered, never saved silently. */
export function learnRoutine(rows: Row[], a: Answers): Routine | undefined {
  if (a.who === 'other') return undefined;
  const mine = rows.filter(r => r.include && (r.kind === 'work' || r.kind === 'class'));
  if (!mine.length) return undefined;
  const days = new Set<number>();
  const hours = new Map<string, number>();
  for (const r of mine) {
    const occ = allOccurrences(r, a).slice(0, 14);   // duplicates still count: you do go those days
    for (const d of occ) days.add(new Date(d).getDay());
    hours.set(`${r.start}-${r.end}`, (hours.get(`${r.start}-${r.end}`) ?? 0) + occ.length);
  }
  if (!days.size) return undefined;
  let from: string, to: string;
  if (mine.every(r => r.kind === 'class')) { from = mine.map(r => r.start).sort()[0]; to = mine.map(r => r.end).sort().at(-1)!; }
  else [from, to] = [...hours.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0].split('-');
  let lunch: Routine['lunch'];
  const spans = mine.filter(r => !r.rotation || r.rotation === mine[0].rotation).map(r => [parseHM(r.start), parseHM(r.end)] as const).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < spans.length; i++) {
    const g0 = spans[i - 1][1], g1 = spans[i][0];
    if (g1 - g0 >= 20 && g0 >= 10 * 60 + 30 && g1 <= 14 * 60) { lunch = { from: hm(g0), to: hm(g1) }; break; }
  }
  return { label: mine.every(r => r.kind === 'work') ? 'Work' : 'School', days: [...days].sort(), from, to, lunch };
}

export function describeDays(days: number[]): string {
  const n = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const s = [...days].sort();
  if (s.length > 2 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)) return `${n[s[0]]}–${n[s[s.length - 1]]}`;
  return s.map(d => n[d]).join(', ');
}

export const _scan = { MIN };
