import type { Ms, ID } from './types';
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
import { at, addDays, startOfDay, weekday, MIN } from './time';

// Offline, rule-based natural-language capture. An optional LLM can refine the
// result later, but this parser must always produce a sensible answer.

export type CaptureKind = 'task' | 'event' | 'reminder' | 'birthday' | 'anniversary' | 'hobby' | 'meal' | 'note' | 'food_pref' | 'person_pref' | 'command';

export type Command =
  | { type: 'free'; minutes: number; place?: string }
  | { type: 'nap'; minutes?: number }
  | { type: 'movie' }
  | { type: 'eat'; minutes?: number }
  | { type: 'quickplan'; when: 'tonight' | 'tomorrow' }
  | { type: 'push'; minutes: number }
  | { type: 'plan'; range: 'day' | 'week' }
  | { type: 'fellApart' };

export interface PrefUpdate { target: 'me' | string; field: 'dislikes' | 'cuisines' | 'favorites' | 'dietary' | 'interests' | 'foodLikes' | 'notes'; value: string }

export interface Capture {
  kind: CaptureKind;
  raw: string;
  title: string;
  day?: Ms;              // start of day
  timeMin?: number;      // minutes of day
  start?: Ms;
  durationMin?: number;
  priority?: 1 | 2 | 3;
  place?: { id?: ID; name: string };
  person?: string;
  mealType?: MealType;
  activity?: string;
  month?: number; dayOfMonth?: number;
  pref?: PrefUpdate;
  command?: Command;
  defaulted: string[];   // fields filled with a default → show a quick-edit chip
  confidence: number;
}

export interface ParseContext { now: Ms; places?: { id: ID; name: string }[]; people?: string[] }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const CUISINES = ['thai', 'italian', 'mexican', 'chinese', 'japanese', 'sushi', 'indian', 'korean', 'vietnamese', 'pho', 'greek', 'mediterranean', 'american', 'bbq', 'pizza', 'burgers', 'ramen', 'french', 'ethiopian', 'middle eastern', 'caribbean', 'spanish', 'tacos'];
const DIETS = ['vegetarian', 'vegan', 'pescatarian', 'gluten-free', 'gluten free', 'dairy-free', 'dairy free', 'halal', 'kosher', 'nut-free', 'no pork', 'no beef', 'no nuts', 'no fish', 'no dairy'];
const HOBBY: Record<string, string> = { movie: 'movie', movies: 'movie', film: 'movie', nap: 'nap', read: 'reading', reading: 'reading', book: 'reading', gaming: 'gaming', game: 'gaming', games: 'gaming', gym: 'gym', workout: 'gym', run: 'gym', hangout: 'friends', 'hang out': 'friends', party: 'going-out', concert: 'going-out', 'family time': 'family' };
const MEALS: Record<string, MealType> = { breakfast: 'breakfast', brunch: 'lunch', lunch: 'lunch', dinner: 'dinner', supper: 'dinner', snack: 'snack' };
const TASKY = /\b(report|essay|homework|hw|study|project|paper|worksheet|read ch|chapter|assignment|lab|problem set|pset|email|call|buy|pick up|clean|laundry|finish|write|practice|review|submit|apply|fix|book)\b/;
const EVENTY = /\b(test|exam|quiz|appointment|appt|meeting|practice at|game at|recital|interview|dentist|doctor|party|concert|class)\b/;

function durToMin(n: number, unit: string): number {
  return /^h/.test(unit) ? Math.round(n * 60) : Math.round(n);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string) => s.replace(/\s{2,}/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '').trim();

export function parseCapture(input: string, ctx: ParseContext): Capture {
  const raw = input.trim();
  const lower = raw.toLowerCase().replace(/[’]/g, "'");
  const base: Capture = { kind: 'note', raw, title: raw, defaulted: [], confidence: 0.5 };

  // ---------- Commands ----------
  const cmd = parseCommand(lower, ctx);
  if (cmd) return { ...base, kind: 'command', command: cmd, title: raw, confidence: 0.95 };

  // ---------- Preferences ----------
  const pref = parsePref(raw, lower, ctx);
  if (pref) return { ...base, ...pref, confidence: 0.85 };

  if (/^(note|idea|thought)[:\s]/.test(lower)) return { ...base, kind: 'note', title: clean(raw.replace(/^(note|idea|thought)[:\s]*/i, '')), confidence: 0.9 };

  // ---------- Birthdays / anniversaries ----------
  const bd = lower.match(/^(.+?)(?:'s)?\s+(birthday|bday|b-day|anniversary)\s*(?:is\s+|on\s+)?(.*)$/);
  if (bd) {
    const who = raw.slice(0, bd[1].length).replace(/'s$/i, '').trim();
    const dt = extractDate(bd[3], ctx.now);
    const kind = bd[2] === 'anniversary' ? 'anniversary' : 'birthday';
    const c: Capture = { ...base, kind, person: cap(who), title: `${cap(who)}'s ${kind}`, confidence: dt.day ? 0.9 : 0.6 };
    if (dt.day) { const d = new Date(dt.day); c.month = d.getMonth() + 1; c.dayOfMonth = d.getDate(); c.day = dt.day; }
    else c.defaulted.push('date');
    return c;
  }

  // ---------- General extraction ----------
  let text = ' ' + lower + ' ';
  const out: Capture = { ...base, kind: 'task' };
  let isReminder = false;
  const rm = text.match(/^\s*(remind me|reminder|don't forget|dont forget)\s+(to\s+)?/);
  if (rm) { isReminder = true; text = ' ' + text.slice(rm[0].length) ; }

  // duration
  const dm = text.match(/\s(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hour|hours)\b/);
  if (dm) { out.durationMin = durToMin(parseFloat(dm[1]), dm[2]); text = text.replace(dm[0], ' '); }

  // priority
  const pm = text.match(/\s(high|urgent|important|asap|p1|!!+|!|medium|med|normal|p2|low|p3|whenever)(?=\s)/);
  if (pm) {
    const p = pm[1];
    out.priority = /high|urgent|important|asap|p1|!/.test(p) ? 1 : /low|p3|whenever/.test(p) ? 3 : 2;
    text = text.replace(pm[0], ' ');
  }

  // place
  for (const p of ctx.places ?? []) {
    const re = new RegExp(`\\s(?:at|@|in)\\s+(?:the\\s+)?${escapeRe(p.name.toLowerCase())}(?=\\s)`);
    const m = text.match(re) ?? (p.name.length > 3 ? text.match(new RegExp(`\\s@${escapeRe(p.name.toLowerCase())}(?=\\s)`)) : null);
    if (m) { out.place = { id: p.id, name: p.name }; text = text.replace(m[0], ' '); break; }
  }

  // date
  const dt = extractDate(text, ctx.now);
  if (dt.day !== undefined) { out.day = dt.day; text = dt.rest; }
  // time
  const tm = extractTime(text, dt.hint);
  if (tm.timeMin !== undefined) { out.timeMin = tm.timeMin; text = tm.rest; if (tm.ambiguous) out.defaulted.push('am/pm'); }
  if (dt.hint === 'tonight' && out.timeMin === undefined) { out.timeMin = 19 * 60 + 30; out.defaulted.push('time'); }

  // person ("with Jake")
  const wm = raw.match(/\bwith\s+([A-Z][a-zA-Z'-]+(?:\s+(?:and|&)\s+[A-Z][a-zA-Z'-]+)*)/) ?? lower.match(/\bwith\s+([a-z][a-z'-]+)/);
  if (wm) out.person = wm[1].split(/\s+(?:and|&)\s+/).map(cap).join(' & ');

  // meal / hobby
  const mealWord = Object.keys(MEALS).find(k => new RegExp(`\\b${k}\\b`).test(text));
  const hobbyWord = Object.keys(HOBBY).sort((a, b) => b.length - a.length).find(k => new RegExp(`\\b${k}\\b`).test(text));

  let title = clean(text.replace(/\s(on|at|by|due|for)\s*$/g, ' ').replace(/\s(on|by|due)\s(?=\s)/g, ' '));
  // Keep the person's original capitalization in the title.
  if (out.person) title = title.replace(new RegExp(`with\\s+${escapeRe(out.person.toLowerCase())}`, 'i'), `with ${out.person}`);
  out.title = cap(title || raw);

  if (isReminder) {
    out.kind = 'reminder';
    out.title = cap(title);
    if (out.timeMin === undefined) { out.timeMin = 9 * 60; out.defaulted.push('time'); }
    if (out.day === undefined) { out.day = out.timeMin * MIN + startOfDay(ctx.now) > ctx.now ? startOfDay(ctx.now) : addDays(startOfDay(ctx.now), 1); out.defaulted.push('date'); }
  } else if (mealWord) {
    out.mealType = MEALS[mealWord];
    out.kind = out.person || out.place ? 'event' : 'meal';
    if (out.timeMin === undefined) { out.timeMin = { breakfast: 8 * 60, lunch: 12 * 60, dinner: 19 * 60, snack: 15 * 60 + 30 }[out.mealType]; out.defaulted.push('time'); }
    out.durationMin ??= out.person ? 90 : 45;
    if (out.day === undefined) { out.day = startOfDay(ctx.now); out.defaulted.push('date'); }
  } else if (hobbyWord && !TASKY.test(text)) {
    out.kind = 'hobby'; out.activity = HOBBY[hobbyWord];
    out.durationMin ??= { movie: 120, nap: 25, reading: 30, gaming: 60, gym: 60, friends: 120, 'going-out': 180, family: 90 }[out.activity] ?? 60;
    if (out.day === undefined) { out.day = startOfDay(ctx.now); out.defaulted.push('date'); }
    if (out.timeMin === undefined && out.activity !== 'nap') { out.timeMin = out.activity === 'movie' || out.activity === 'going-out' ? 19 * 60 + 30 : 17 * 60; out.defaulted.push('time'); }
  } else if (out.timeMin !== undefined && !(out.durationMin && TASKY.test(text)) || EVENTY.test(text) && out.day !== undefined) {
    out.kind = 'event';
    out.durationMin ??= 60;
    if (out.day === undefined) { out.day = startOfDay(ctx.now); out.defaulted.push('date'); }
    if (out.timeMin === undefined) { out.timeMin = 9 * 60; out.defaulted.push('time'); }
  } else if (out.durationMin || out.priority || out.day !== undefined || TASKY.test(text) || title.split(' ').length <= 6) {
    out.kind = 'task';
    if (out.durationMin === undefined) { out.durationMin = 30; out.defaulted.push('duration'); }
    if (out.priority === undefined) { out.priority = 2; out.defaulted.push('priority'); }
    if (out.day === undefined) out.defaulted.push('due');
  } else {
    out.kind = 'note';
  }

  if (out.day !== undefined && out.timeMin !== undefined) out.start = at(out.day, out.timeMin);
  out.confidence = Math.max(0.4, 0.95 - out.defaulted.length * 0.12);
  return out;
}

function parseCommand(l: string, ctx: ParseContext): Command | undefined {
  const s = l.replace(/[.!?]+$/, '').trim();
  if (/^(plan( my)? day|plan today)$/.test(s)) return { type: 'plan', range: 'day' };
  if (/^plan( my)? week$/.test(s)) return { type: 'plan', range: 'week' };
  if (/^(my day fell apart|day fell apart|fell apart|replan|re-plan|reset (my )?day)$/.test(s)) return { type: 'fellApart' };
  if (/^(tonight|tomorrow|tmrw)$/.test(s)) return { type: 'quickplan', when: s === 'tonight' ? 'tonight' : 'tomorrow' };
  let m = s.match(/^push( everything| rest( of today)?)?( back)?\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hour|hours)?$/);
  if (m) return { type: 'push', minutes: durToMin(parseFloat(m[4]), m[5] ?? 'm') };
  m = s.match(/^(eat|hungry|i'm hungry|im hungry|food|starving)(?:\s+(\d+)\s*(m|min|mins|h|hr)?)?$/);
  if (m) return { type: 'eat', minutes: m[2] ? durToMin(parseInt(m[2]), m[3] ?? 'm') : undefined };
  m = s.match(/^nap(?:\s+(\d+)\s*(m|min|mins)?)?$/);
  if (m) return { type: 'nap', minutes: m[1] ? parseInt(m[1]) : undefined };
  if (/^(movie|movie time|watch a movie)$/.test(s)) return { type: 'movie' };
  // "30 school", "free 30", "45 gym", "free 1h at home", "30"
  m = s.match(/^(?:free\s+|i have\s+|got\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours)?(?:\s+(?:free|here))?(?:\s+(?:at|@|in)?\s*(?:the\s+)?([a-z' ]+))?$/);
  if (m) {
    const minutes = durToMin(parseFloat(m[1]), m[2] ?? 'm');
    const place = m[3]?.trim();
    if (minutes >= 5 && minutes <= 600 && (!place || place.split(' ').length <= 3) && !(place && MONTHS.some(mo => place.startsWith(mo)))) {
      if (!place || (ctx.places ?? []).some(p => p.name.toLowerCase() === place) || /^(here|home|school|gym|work|library)$/.test(place)) return { type: 'free', minutes, place };
    }
  }
  m = s.match(/^free\s+(?:at|@)?\s*([a-z' ]+)\s+(\d+)$/);
  if (m) return { type: 'free', minutes: parseInt(m[2]), place: m[1].trim() };
  return undefined;
}

function parsePref(raw: string, l: string, ctx: ParseContext): Partial<Capture> | undefined {
  let m = l.match(/^i\s+(?:really\s+)?(hate|dislike|don't like|dont like|can't stand|cant stand)\s+(.+)$/);
  if (m) return { kind: 'food_pref', pref: { target: 'me', field: 'dislikes', value: clean(m[2]) }, title: `Dislike: ${clean(m[2])}` };
  m = l.match(/^(?:i\s+)?(?:really\s+)?(love|like|enjoy|adore)\s+(.+)$/);
  if (m) {
    const v = clean(m[2]);
    const field = CUISINES.includes(v.replace(/ food$/, '')) ? 'cuisines' : 'favorites';
    return { kind: 'food_pref', pref: { target: 'me', field, value: v.replace(/ food$/, '') }, title: `${field === 'cuisines' ? 'Cuisine' : 'Favorite'}: ${v}` };
  }
  m = l.match(/^i(?:'m| am)\s+(?:a\s+)?(.+)$/);
  if (m && DIETS.some(d => m![1].startsWith(d.replace('-', ' ')) || m![1].startsWith(d))) return { kind: 'food_pref', pref: { target: 'me', field: 'dietary', value: m[1].replace(/ian$/, 'ian') }, title: `Dietary: ${m[1]}` };
  if (DIETS.includes(l)) return { kind: 'food_pref', pref: { target: 'me', field: 'dietary', value: l }, title: `Dietary: ${l}` };
  // "Jake likes fishing", "Mom is vegetarian", "Grandma is allergic to nuts"
  m = raw.match(/^([A-Za-z][\w'-]*(?:\s[A-Z][\w'-]*)?)\s+(likes|loves|enjoys|is into|is obsessed with|hates|dislikes|doesn't eat|does not eat|is allergic to|is)\s+(.+)$/i);
  if (m && !/^(it|this|that|there|today|tomorrow|tonight|what)$/i.test(m[1])) {
    const who = cap(m[1].replace(/'s$/, ''));
    const verb = m[2].toLowerCase(); const v = clean(m[3].toLowerCase());
    const isPerson = /^[A-Z]/.test(m[1]) || (ctx.people ?? []).some(p => p.toLowerCase() === m![1].toLowerCase()) || /^(mom|dad|grandma|grandpa|sister|brother|aunt|uncle)$/i.test(m[1]);
    if (!isPerson) return undefined;
    if (verb === 'is') {
      if (DIETS.some(d => v.startsWith(d))) return { kind: 'person_pref', person: who, pref: { target: who, field: 'dietary', value: v }, title: `${who}: ${v}` };
      return undefined;
    }
    if (/allergic|doesn't eat|does not eat/.test(verb)) return { kind: 'person_pref', person: who, pref: { target: who, field: 'dietary', value: `no ${v}` }, title: `${who}: no ${v}` };
    if (/hates|dislikes/.test(verb)) return { kind: 'person_pref', person: who, pref: { target: who, field: 'notes', value: `dislikes ${v}` }, title: `${who} dislikes ${v}` };
    const field = CUISINES.includes(v.replace(/ food$/, '')) ? 'foodLikes' : 'interests';
    return { kind: 'person_pref', person: who, pref: { target: who, field, value: v.replace(/ food$/, '') }, title: `${who} likes ${v}` };
  }
  return undefined;
}

export interface DateHit { day?: Ms; rest: string; hint?: 'tonight' | 'morning' | 'afternoon' | 'evening' }

export function extractDate(text: string, now: Ms): DateHit {
  let t = ' ' + text.toLowerCase() + ' ';
  const today = startOfDay(now);
  let day: Ms | undefined; let hint: DateHit['hint'];
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => Ms | undefined) => {
    if (day !== undefined) return;
    const m = t.match(re);
    if (m) { const d = fn(m); if (d !== undefined) { day = d; t = t.replace(m[0], ' '); } }
  };
  take(/\s(tonight)\s/, () => { hint = 'tonight'; return today; });
  take(/\s(today|tdy)\s/, () => today);
  take(/\s(tomorrow|tmrw|tmr|tom)\s/, () => addDays(today, 1));
  take(/\s(this weekend|weekend)\s/, () => { const w = weekday(today); return addDays(today, w === 6 || w === 0 ? 0 : 6 - w); });
  take(/\snext week\s/, () => addDays(today, 7 - weekday(today) + 1));
  take(/\sin (\d+) (days?|weeks?)\s/, m => addDays(today, parseInt(m[1]) * (m[2].startsWith('w') ? 7 : 1)));
  take(/\s(next\s+|this\s+)?(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\s/, m => {
    const target = WEEKDAYS[m[2]];
    let diff = (target - weekday(today) + 7) % 7;
    if (m[1]?.trim() === 'next' && diff === 0) diff = 7;
    else if (m[1]?.trim() === 'next' && diff < 7) diff += diff === 0 ? 7 : 0;
    return addDays(today, diff);
  });
  take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s/, m => monthDay(MONTHS.indexOf(m[1].slice(0, 3)), parseInt(m[2]), today));
  take(/\s(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s/, m => monthDay(MONTHS.indexOf(m[2].slice(0, 3)), parseInt(m[1]), today));
  take(/\s(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\s/, m => monthDay(parseInt(m[1]) - 1, parseInt(m[2]), today));
  const pm = t.match(/\s(this\s+)?(morning|afternoon|evening)\s/);
  if (pm) { hint = pm[2] as DateHit['hint']; t = t.replace(pm[0], ' '); if (day === undefined) day = today; }
  return { day, rest: t, hint };
}

function monthDay(month: number, d: number, today: Ms): Ms | undefined {
  if (month < 0 || d < 1 || d > 31) return undefined;
  const y = new Date(today).getFullYear();
  let dt = new Date(y, month, d).getTime();
  if (dt < today) dt = new Date(y + 1, month, d).getTime();
  return dt;
}

export function extractTime(text: string, hint?: DateHit['hint']): { timeMin?: number; rest: string; ambiguous?: boolean } {
  let t = text;
  if (/\snoon\s/.test(t)) return { timeMin: 12 * 60, rest: t.replace(/\s(at\s+)?noon\s/, ' ') };
  if (/\smidnight\s/.test(t)) return { timeMin: 23 * 60 + 59, rest: t.replace(/\s(at\s+)?midnight\s/, ' ') };
  let m = t.match(/\s(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)\s/);
  if (m) {
    let h = parseInt(m[1]) % 12; if (m[3].startsWith('p')) h += 12;
    return { timeMin: h * 60 + (m[2] ? parseInt(m[2]) : 0), rest: t.replace(m[0], ' ') };
  }
  m = t.match(/\s(?:at\s+|@\s*)?(\d{1,2}):(\d{2})\s/) ?? t.match(/\s(?:at\s+|@\s*)(\d{1,2})()\s/) ?? t.match(/\s(\d{1,2})()\s*$/);
  if (m) {
    const h0 = parseInt(m[1]); const mm = m[2] ? parseInt(m[2]) : 0;
    if (h0 > 23 || mm > 59) return { rest: t };
    if (h0 >= 13 || h0 === 0) return { timeMin: h0 * 60 + mm, rest: t.replace(m[0], ' ') };
    let h = h0; let ambiguous = false;
    if (hint === 'morning') h = h0 % 12;
    else if (hint === 'tonight' || hint === 'evening' || hint === 'afternoon') h = h0 === 12 ? 12 : h0 + 12;
    else if (h0 <= 6) h = h0 + 12;               // "dinner 7" → 7pm, "3" → 3pm
    else if (h0 === 12) h = 12;
    else if (h0 >= 7 && h0 <= 11) { const eve = /dinner|supper|movie|party|tonight|concert|date|game night/.test(t); h = eve ? h0 + 12 : h0; ambiguous = !eve; }
    return { timeMin: h * 60 + mm, rest: t.replace(m[0], ' '), ambiguous };
  }
  if (hint === 'morning') return { timeMin: 9 * 60, rest: t, ambiguous: true };
  if (hint === 'afternoon') return { timeMin: 15 * 60, rest: t, ambiguous: true };
  if (hint === 'evening') return { timeMin: 19 * 60, rest: t, ambiguous: true };
  return { rest: t };
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const SCHOOLY = /\b(report|essay|homework|hw|worksheet|assignment|lab|paper|problem set|pset|project|reading)\b/i;
/** Due timestamp for a captured task: school work is due at the start of class (8am), else end of day. */
export function captureDue(c: Capture): Ms | undefined {
  if (c.day === undefined) return undefined;
  if (c.timeMin !== undefined) return at(c.day, c.timeMin);
  return at(c.day, SCHOOLY.test(c.title) ? 8 * 60 : 23 * 60 + 59);
}
