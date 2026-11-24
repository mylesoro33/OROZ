// Optional LLM upgrade (Claude). Off by default; needs your own API key in Settings.
// We send the minimum: the one line you typed, or an assignment title + instructions.
// No calendar, location, contacts, or behavior data is ever included.
import Anthropic from '@anthropic-ai/sdk';
import type { Project, StarterKit } from '@engine/types';
import type { Capture } from '@engine/parser';
import { starterKitPrompt } from '@engine/projects';

const MODEL = 'claude-opus-5-5';
const client = (apiKey: string) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

async function json<T>(apiKey: string, system: string, user: string, schema: object, maxTokens = 4000): Promise<T | undefined> {
  const res: any = await client(apiKey).beta.messages.create({
    model: MODEL, max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system, messages: [{ role: 'user', content: user }],
  } as any);
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return undefined;
  const text = res.content.find((b: any) => b.type === 'text')?.text;
  return text ? (JSON.parse(text) as T) : undefined;
}

const CAPTURE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'title', 'date', 'time', 'durationMin', 'priority', 'person'],
  properties: {
    kind: { type: 'string', enum: ['task', 'event', 'reminder', 'birthday', 'hobby', 'meal', 'note', 'food_pref', 'person_pref'] },
    title: { type: 'string' }, date: { type: ['string', 'null'], description: 'YYYY-MM-DD' }, time: { type: ['string', 'null'], description: 'HH:MM 24h' },
    durationMin: { type: ['integer', 'null'] }, priority: { type: ['integer', 'null'] }, person: { type: ['string', 'null'] },
  },
};

/** Refine an ambiguous rule-based parse. Returns undefined to keep the offline result. */
export async function llmRefineCapture(line: string, today: Date, base: Capture, apiKey: string): Promise<Partial<Capture> | undefined> {
  const r = await json<{ kind: Capture['kind']; title: string; date: string | null; time: string | null; durationMin: number | null; priority: number | null; person: string | null }>(apiKey,
    'You turn one short line from a student\'s quick-capture box into structured fields. Today is ' + today.toDateString() + '. Prefer sensible defaults over nulls only when the line implies them.',
    line, CAPTURE_SCHEMA, 800);
  if (!r) return undefined;
  const out: Partial<Capture> = { kind: r.kind, title: r.title, person: r.person ?? base.person, durationMin: r.durationMin ?? base.durationMin, priority: (r.priority as 1 | 2 | 3) ?? base.priority };
  if (r.date) { const [y, m, d] = r.date.split('-').map(Number); out.day = new Date(y, m - 1, d).getTime(); }
  if (r.time) { const [h, mm] = r.time.split(':').map(Number); out.timeMin = h * 60 + mm; }
  if (out.day !== undefined && out.timeMin !== undefined) out.start = out.day + out.timeMin * 60_000;
  return out;
}

const ITEMS = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'body'], properties: { label: { type: 'string' }, body: { type: 'string' } } } };
const KIT_SCHEMA = { type: 'object', additionalProperties: false, required: ['breakdown', 'outline', 'questions', 'sources', 'scaffold'], properties: { breakdown: ITEMS, outline: ITEMS, questions: ITEMS, sources: ITEMS, scaffold: ITEMS } };

export async function llmStarterKit(p: Project, apiKey: string): Promise<StarterKit | undefined> {
  const r = await json<Record<'breakdown' | 'outline' | 'questions' | 'sources' | 'scaffold', { label: string; body: string }[]>>(apiKey,
    'You help a student get STARTED on an assignment — never do it for them. Produce: a task breakdown, an outline/skeleton, questions they must answer themselves, kinds of sources to look up (search queries or source types; do not invent citations, titles, or URLs), and a rough-draft scaffold made of headings with [bracketed prompts] — no finished prose they could submit.',
    starterKitPrompt(p), KIT_SCHEMA, 6000);
  if (!r) return undefined;
  const mark = (xs: { label: string; body: string }[]) => xs.map(x => ({ ...x, starter: true as const }));
  return { generatedAt: Date.now(), generator: 'llm', breakdown: mark(r.breakdown), outline: mark(r.outline), questions: mark(r.questions), sources: mark(r.sources), scaffold: mark(r.scaffold) };
}
