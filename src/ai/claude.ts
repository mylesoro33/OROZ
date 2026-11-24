// OROZ on Claude (your own key). Used for: talking naturally, reading photos and web pages,
// and looking up important dates. Everything comes back as a draft for approval.
import Anthropic from '@anthropic-ai/sdk';
import { isoDay, dayName, fmtTime, fmtDay, addDays, fromIsoDay, startOfDay } from '@engine/time';
import { itemsFor, bandsFor, suggestSlots, dateTopics } from '@engine/week';
import { nightFor } from '@engine/sleep';
import { upcomingBirthdays } from '@engine/occasions';
import type { Task } from '@engine/types';
import { store, draftSize, type Draft } from '../data/store';
import { ITEMS_SCHEMA, toDraft, type RawItems } from './convert';

const MODEL = 'claude-opus-5-5';

const RULES = `You are OROZ, the planning assistant inside a calendar app. Always write the name as OROZ.
Reply in one or two short, plain sentences. No greetings, no "As an AI", no emojis, no markdown.
Never save anything yourself. To add events, to-dos, people or important dates, call draft_items; the person approves them in the app.
If something has no time, make it a flexible to-do (flexible: true) rather than inventing a time. Use suggest_slots when they ask you to fit something in.
Read the calendar with get_week before answering questions about their week. Use web_search / web_fetch for links and facts; never invent dates, places or events.`;

export interface AiResult { text: string; draft?: Draft; sources: string[] }

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function context(): string {
  const st = store().state; const p = st.profile; const now = new Date();
  return [
    `Now: ${dayName(now.getTime(), true)} ${isoDay(now.getTime())} ${now.toTimeString().slice(0, 5)} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    `Person: ${[p.name, p.ageRange && `age ${p.ageRange}`, p.occupation && `${p.occupation}${p.occupationDetail ? ` (${p.occupationDetail})` : ''}`, p.city && `lives in ${p.city}`, p.hometown && `from ${p.hometown}`].filter(Boolean).join(', ') || 'unknown'}.`,
    st.places.length ? `Places they go: ${st.places.map(x => `${x.name} (${x.kind})`).join(', ')}.` : '',
    st.memory.length ? `What they've told you:\n- ${st.memory.map(m => m.text).join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}

const TOOLS: any[] = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
  { name: 'get_week', description: "Read the person's calendar (events, timed to-dos, meal and sleep habits) for days starting at start_date.", input_schema: { type: 'object', additionalProperties: false, required: ['start_date'], properties: { start_date: { type: 'string' }, days: { type: 'integer' } } } },
  { name: 'get_todos', description: 'Read open to-dos and upcoming birthdays.', input_schema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'suggest_slots', description: 'Find open times this week for a flexible to-do.', input_schema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' }, duration_min: { type: 'integer' }, type: { type: 'string', enum: ['errand', 'call', 'home', 'work', 'school', 'health', 'social'] }, place: { type: 'string' }, by_date: { type: 'string' } } } },
  { name: 'draft_items', description: 'Propose events, to-dos, people or important dates. Shown to the person to approve; nothing is saved until they tap Add.', input_schema: ITEMS_SCHEMA },
];

function runTool(name: string, input: any, sink: { raw?: RawItems; sources: Set<string> }): string {
  const st = store().state;
  if (name === 'get_week') {
    sink.sources.add('Calendar');
    const out: string[] = [];
    for (let i = 0; i < Math.min(14, input.days ?? 1); i++) {
      const d = addDays(fromIsoDay(input.start_date), i);
      const items = itemsFor(d, st.blocks, st.tasks);
      const n = nightFor(d, st.settings.sleep, st.settings.workDays);
      const meals = bandsFor(d, st.settings).filter(b => b.kind !== 'sleep').map(b => `${b.kind} ~${fmtTime(b.start)}`).join(', ');
      out.push(`${dayName(d, true)} ${isoDay(d)}: ${items.map(b => (b.allDay ? b.title : `${fmtTime(b.start)}–${fmtTime(b.end)} ${b.title}${b.location ? ` @ ${b.location}` : ''}`)).join('; ') || 'nothing'} | usual ${meals} | bed ~${fmtTime(n.bedtime)}`);
    }
    return out.join('\n');
  }
  if (name === 'get_todos') {
    sink.sources.add('To-Do');
    const open = st.tasks.filter(t => !t.done).map(t => `${t.title}${t.at ? ` (${fmtDay(t.at)} ${fmtTime(t.at)})` : t.date ? ` (${fmtDay(t.date)})` : ''}${t.placeName ? ` @ ${t.placeName}` : ''}`);
    const b = upcomingBirthdays(st.people, Date.now(), 30).map(x => `${x.person.name} ${fmtDay(x.date)}`);
    return `To-dos: ${open.join('; ') || 'none'}\nBirthdays: ${b.join('; ') || 'none soon'}`;
  }
  if (name === 'suggest_slots') {
    sink.sources.add('Calendar');
    const t: Task = { id: 'tmp', title: input.title, type: input.type ?? 'errand', durationMin: input.duration_min ?? 30, placeName: input.place, by: input.by_date ? addDays(fromIsoDay(input.by_date), 1) : undefined, done: false, source: 'talk', createdAt: Date.now() };
    return suggestSlots(t, { blocks: st.blocks, tasks: st.tasks, settings: st.settings, places: st.places, now: Date.now() }).map(s => `${fmtDay(s.start)} ${fmtTime(s.start)} (${s.why})`).join('; ') || 'No open time this week.';
  }
  if (name === 'draft_items') {
    sink.raw = { events: [...(sink.raw?.events ?? []), ...(input.events ?? [])], tasks: [...(sink.raw?.tasks ?? []), ...(input.tasks ?? [])], people: [...(sink.raw?.people ?? []), ...(input.people ?? [])], dates: [...(sink.raw?.dates ?? []), ...(input.dates ?? [])] };
    for (const d of input.dates ?? []) sink.sources.add(host(d.source_url));
    return 'Shown to the person for approval. Tell them in one line what you found.';
  }
  return 'Unknown tool.';
}

let history: any[] = [];
export const forget = () => { history = []; };

async function run(content: any, opts: { title: string; source: 'talk' | 'photo' | 'link' | 'web'; keep?: boolean; onStatus?: (s: string) => void; effort?: 'low' | 'medium' }): Promise<AiResult> {
  const key = store().state.settings.apiKey; if (!key) throw new Error('NO_KEY');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const sink: { raw?: RawItems; sources: Set<string> } = { sources: new Set() };
  const messages: any[] = opts.keep ? history : [];
  messages.push({ role: 'user', content });
  for (let step = 0; step < 10; step++) {
    const res: any = await client.beta.messages.create({
      model: MODEL, max_tokens: 6000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: opts.effort ?? 'low' },
      system: [{ type: 'text', text: RULES, cache_control: { type: 'ephemeral' } }, { type: 'text', text: context() }],
      tools: TOOLS, messages,
    } as any);
    messages.push({ role: 'assistant', content: res.content });
    for (const b of res.content) {
      if (b.type === 'server_tool_use') opts.onStatus?.(b.name === 'web_search' ? 'Searching…' : 'Reading the page…');
      if (b.type === 'web_fetch_tool_result' && b.content?.url) sink.sources.add(host(b.content.url));
      if (b.type === 'text') for (const c of b.citations ?? []) if (c.url) sink.sources.add(host(c.url));
    }
    if (res.stop_reason === 'refusal') return { text: "I can't help with that.", sources: [] };
    if (res.stop_reason === 'pause_turn') continue;
    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'user', content: res.content.filter((b: any) => b.type === 'tool_use').map((b: any) => {
        let out: string; try { out = runTool(b.name, b.input, sink); } catch (e) { out = `Error: ${(e as Error).message}`; }
        return { type: 'tool_result', tool_use_id: b.id, content: out };
      }) });
      continue;
    }
    if (opts.keep) history = messages.slice(-24).filter((_, i, a) => i > 0 || a[0]?.role === 'user' && typeof a[0].content === 'string');
    const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').trim();
    const draft = sink.raw ? toDraft(sink.raw, opts.title, opts.source === 'talk' ? 'talk' : opts.source) : undefined;
    return { text: text || (draft ? `Found ${draftSize(draft)}.` : 'Done.'), draft: draft && draftSize(draft) ? draft : undefined, sources: [...sink.sources] };
  }
  return { text: 'That took too long. Try a smaller piece.', sources: [...sink.sources] };
}

export const talk = (text: string, onStatus?: (s: string) => void) => run(text, { title: 'From what you said', source: 'talk', keep: true, onStatus });

export const readPage = (url: string, onStatus?: (s: string) => void) => run(
  `Open ${url} with web_fetch. Find the upcoming events or schedule on it (from today, ${isoDay(Date.now())}, onward) and call draft_items with them. If the page links to a calendar feed or a schedule page, follow it. Then say in one line what you found.`,
  { title: `From ${host(url)}`, source: 'link', onStatus, effort: 'medium' });

export const readProfile = (url: string, onStatus?: (s: string) => void) => run(
  `Open ${url} with web_fetch. It's a public page or profile the person shared about someone they know. Find that person's name and birthday only if the page states it publicly. Call draft_items with people (leave the birthday out if it isn't shown). Then say in one line what you found.`,
  { title: 'From a public page', source: 'web', onStatus });

export function findDates(onStatus?: (s: string) => void) {
  const p = store().state.profile;
  const topics = dateTopics(p);
  return run(
    `Look up important upcoming dates for me over the next 12 months, using web_search on official sources (government, school district, testing agencies). Where I live: ${p.city ?? 'unknown'}${p.hometown ? `; hometown ${p.hometown}` : ''}. Topics: ${topics.join('; ')}.
Only include dates you found on a page, each with its source_url. Skip anything you can't confirm. Call draft_items with "dates", then say in one line how many you found.`,
    { title: 'Important dates', source: 'web', onStatus, effort: 'medium' });
}

