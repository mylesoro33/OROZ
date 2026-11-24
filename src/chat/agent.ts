// OROZ chat on Claude (your own API key). Web search/fetch run on Anthropic's side;
// schedule tools run here on your device. Only the conversation and the tool results
// it asks for are sent — never your full data dump.
import Anthropic from '@anthropic-ai/sdk';
import { isoDay, dayName } from '@engine/time';
import { store } from '../data/store';
import { TOOL_DEFS, TOOL_SOURCE, runTool, host, type ToolCtx } from './tools';
import { CONNECTIONS } from '../integrations/connect';

const MODEL = 'claude-opus-5-5';

const INSTRUCTIONS = `You are OROZ, a calm, warm personal planner for a student. Always write the name as OROZ.
Keep replies short: one to three sentences, plain text, no headings, no emojis. Ask a follow-up only when you truly can't act.
Use tools to read the schedule, tasks and people before answering questions about them; don't guess.
When the user asks you to change something (add a study block, move bedtime, add a task), just do it with the tools and confirm briefly.
For school info (academic calendar, no-school days, early dismissals, exams, lunch menu, events) use web_search / web_fetch on the school's official site, then call propose_events or propose_lunch_menu so the user can approve. Never claim something is saved before they approve.
Only use public web pages or the user's connected accounts. Never invent dates, menus, places or birthdays — if you can't find it, say so.
When the user tells you a lasting fact (a routine, a preference, a person detail), call remember.`;

let history: Anthropic.Beta.BetaMessageParam[] = [];
export const resetConversation = () => { history = []; };

function context(): string {
  const st = store().state; const now = new Date();
  const connected = CONNECTIONS.filter(c => st.connections[c.id]?.connected).map(c => c.name);
  return [
    `Today is ${dayName(now.getTime(), true)} ${isoDay(now.getTime())}, local time ${now.toTimeString().slice(0, 5)} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    `User: ${st.profile.name ?? 'unknown name'}${st.profile.school ? `, ${st.profile.grade ? `grade ${st.profile.grade} at ` : ''}${st.profile.school}` : ''}.`,
    `School-night bedtime about ${st.settings.sleep.schoolNight.bedtime} (±${st.settings.sleep.schoolNight.flexMin}m), wake ${st.settings.sleep.schoolNight.wake}; weekend ${st.settings.sleep.weekend.bedtime}.`,
    `Connected: ${connected.join(', ') || 'nothing yet'}.`,
    st.memory.length ? `Things the user told you:\n- ${st.memory.map(m => m.text).join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}

export interface AgentReply { text: string; sources: string[]; ctx: ToolCtx }

export async function askClaude(userText: string, apiKey: string, onStatus?: (s: string) => void): Promise<AgentReply> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const ctx: ToolCtx = { changed: false, sources: new Set() };
  history.push({ role: 'user', content: userText });
  if (history.length > 40) { // trim at a plain user turn so tool_use/tool_result pairs stay intact
    const cut = history.findIndex((m, i) => i >= history.length - 30 && m.role === 'user' && typeof m.content === 'string');
    if (cut > 0) history = history.slice(cut);
  }
  const tools: any[] = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
    ...TOOL_DEFS,
  ];
  for (let step = 0; step < 12; step++) {
    const res: any = await client.beta.messages.create({
      model: MODEL, max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: INSTRUCTIONS, cache_control: { type: 'ephemeral' } }, { type: 'text', text: context() }],
      tools, messages: history,
    } as any);
    history.push({ role: 'assistant', content: res.content });
    for (const b of res.content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content.slice(0, 2)) if (r.url) ctx.sources.add(host(r.url));
      if (b.type === 'web_fetch_tool_result' && b.content?.url) ctx.sources.add(host(b.content.url));
      if (b.type === 'server_tool_use') onStatus?.(b.name === 'web_search' ? 'Searching the web…' : 'Reading a page…');
      if (b.type === 'text') for (const c of b.citations ?? []) if (c.url) ctx.sources.add(host(c.url));
    }
    if (res.stop_reason === 'refusal') return { text: "Sorry, I can't help with that one.", sources: [], ctx };
    if (res.stop_reason === 'pause_turn') continue;
    if (res.stop_reason === 'tool_use') {
      const results = res.content.filter((b: any) => b.type === 'tool_use').map((b: any) => {
        onStatus?.(b.name.startsWith('get_') ? 'Checking your schedule…' : 'Updating…');
        if (TOOL_SOURCE[b.name]) ctx.sources.add(TOOL_SOURCE[b.name]);
        let out: string; let isErr = false;
        try { out = runTool(b.name, b.input, ctx); } catch (e) { out = `Error: ${(e as Error).message}`; isErr = true; }
        return { type: 'tool_result', tool_use_id: b.id, content: out, is_error: isErr || undefined };
      });
      history.push({ role: 'user', content: results });
      continue;
    }
    const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
    return { text: text || 'Done.', sources: [...ctx.sources], ctx };
  }
  return { text: 'That took too many steps. Try asking a smaller piece.', sources: [...ctx.sources], ctx };
}
