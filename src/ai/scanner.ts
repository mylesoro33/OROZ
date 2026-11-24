// Read schedule photos (or a link) into a Scan. Photos go only to Claude, only to be read.
import Anthropic from '@anthropic-ai/sdk';
import type { Scan, ScanItem } from '@engine/scan';
import { icsToBlocks } from '@engine/ics';
import { normalizeLink } from '@engine/week';
import { isoDay, hm, startOfDay, addDays, DAY } from '@engine/time';
import { store } from '../data/store';
import { fetchIcsText } from '../integrations/ics';

const MODEL = 'claude-opus-5-5';

const SCAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'readable', 'problems', 'missed', 'pattern', 'rotation_labels', 'items'],
  properties: {
    kind: { type: 'string', enum: ['classes', 'work', 'practice', 'bell', 'rotation', 'mixed', 'other'] },
    readable: { type: 'string', enum: ['good', 'partial', 'unreadable'] },
    problems: { type: 'array', items: { type: 'string' }, description: 'Short, plain reasons a part is hard to read, e.g. "Right column is blurry". Empty if fine.' },
    missed: { type: 'array', items: { type: 'string' }, description: 'Parts you could not read at all, e.g. "Friday row". Empty if none.' },
    pattern: { type: 'string', enum: ['weekly', 'rotating', 'dated', 'unknown'] },
    rotation_labels: { type: 'array', items: { type: 'string' }, description: 'For rotating schedules, the day labels in order (A, B or Day 1, Day 2...). Empty otherwise.' },
    start_date: { type: 'string', description: 'YYYY-MM-DD if the schedule states when it starts' },
    end_date: { type: 'string', description: 'YYYY-MM-DD if the schedule states when it ends' },
    person: { type: 'string', description: 'A person named on the schedule, if any' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'confidence'], properties: {
      title: { type: 'string' },
      days: { type: 'array', items: { type: 'integer' }, description: 'Weekly: weekdays 0=Sun..6=Sat' },
      rotation: { type: 'string', description: 'Rotating: which label this item is on' },
      date: { type: 'string', description: 'Dated: YYYY-MM-DD' },
      start: { type: 'string', description: 'HH:MM 24-hour' },
      end: { type: 'string', description: 'HH:MM 24-hour' },
      location: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'low'] },
      note: { type: 'string', description: 'If low confidence: what to check, in a few words' },
    } } },
  },
};

const INSTRUCTIONS = (n: number) => `${n > 1 ? `These ${n} images are pages of one schedule.` : 'This image is a schedule.'} It may be tilted, dim, handwritten, a table, or a screenshot of an app or portal.
Read every entry you can. Today is ${isoDay(Date.now())} (${new Date().toLocaleDateString(undefined, { weekday: 'long' })}).
- Use 24-hour HH:MM times. Infer am/pm from context (a class at 1:10 is 13:10).
- Weekly schedules: list each entry with its weekdays. Rotating schedules (A/B, Day 1/Day 2): use rotation labels. Dated calendars: use dates.
- A bell schedule (periods with times, no subjects) is fine: use the period names as titles.
- Mark confidence "low" with a short note for anything you're unsure of. Never invent entries.
- If something is blurry or cut off, say so in problems/missed rather than guessing. If nothing is readable, set readable "unreadable".`;

export async function readImages(files: File[], onStatus?: (s: string) => void): Promise<Scan> {
  const key = store().state.settings.apiKey; if (!key) throw new Error('NO_KEY');
  onStatus?.(files.length > 1 ? `Reading ${files.length} photos…` : 'Reading your photo…');
  const images = await Promise.all(files.map(shrink));
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const res: any = await client.messages.create({
    model: MODEL, max_tokens: 8000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCAN_SCHEMA } },
    messages: [{ role: 'user', content: [...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: i } })), { type: 'text', text: INSTRUCTIONS(files.length) }] }],
  } as any);
  return parse(res);
}

export async function readLink(raw: string, onStatus?: (s: string) => void): Promise<Scan> {
  const { kind, url } = normalizeLink(raw);
  if (kind === 'ics') {
    onStatus?.('Opening the calendar…');
    try { return icsToScan(await fetchIcsText(url)); } catch (e) { if (!store().state.settings.apiKey) throw e; }
  }
  const key = store().state.settings.apiKey; if (!key) throw new Error('NO_KEY');
  onStatus?.('Reading the page…');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const messages: any[] = [{ role: 'user', content: `Open ${url} with web_fetch and read the schedule or upcoming events on it. ${INSTRUCTIONS(1).replace(/^This image is a schedule\.[^\n]*\n/, '')}` }];
  for (let i = 0; i < 6; i++) {
    const res: any = await client.messages.create({
      model: MODEL, max_tokens: 8000, tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCAN_SCHEMA } }, messages,
    } as any);
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    return parse(res);
  }
  throw new Error("Couldn't read that page.");
}

function parse(res: any): Scan {
  if (res.stop_reason === 'refusal') throw new Error("Couldn't read that.");
  const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const s = JSON.parse(text) as Scan;
  return { ...s, problems: s.problems ?? [], missed: s.missed ?? [], rotation_labels: s.rotation_labels ?? [], items: s.items ?? [] };
}

/** Calendar feed → Scan. Repeating weekly events become weekly items. */
export function icsToScan(text: string): Scan {
  const from = startOfDay(Date.now()) - DAY;
  const blocks = icsToBlocks(text, from, addDays(from, 120), 'link').filter(b => !b.allDay);
  const groups = new Map<string, { title: string; start: string; end: string; days: Set<number>; dates: string[]; loc?: string }>();
  for (const b of blocks) {
    const s = new Date(b.start), e = new Date(b.end);
    const k = `${b.title}|${s.getHours()}:${s.getMinutes()}|${e.getHours()}:${e.getMinutes()}`;
    const g = groups.get(k) ?? { title: b.title, start: hm(s.getHours() * 60 + s.getMinutes()), end: hm(e.getHours() * 60 + e.getMinutes()), days: new Set(), dates: [], loc: b.location };
    g.days.add(s.getDay()); g.dates.push(isoDay(b.start)); groups.set(k, g);
  }
  const items: ScanItem[] = [];
  let weekly = 0;
  for (const g of groups.values()) {
    if (g.dates.length >= 3) { weekly++; items.push({ title: g.title, days: [...g.days].sort(), start: g.start, end: g.end, location: g.loc, confidence: 'high' }); }
    else for (const d of g.dates) items.push({ title: g.title, date: d, start: g.start, end: g.end, location: g.loc, confidence: 'high' });
  }
  return { kind: 'mixed', readable: 'good', problems: [], missed: [], pattern: weekly && weekly === groups.size ? 'weekly' : 'dated', rotation_labels: [], items };
}

/** Downscale so photos upload fast. Returns base64 JPEG. */
export async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}
export async function tooSmall(file: File): Promise<boolean> { const i = await createImageBitmap(file); return Math.max(i.width, i.height) < 500; }
