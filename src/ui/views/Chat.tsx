import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Undo2, KeyRound } from 'lucide-react';
import { uid } from '@engine/time';
import { useApp, store, type ChatMsg } from '../../data/store';
import { askClaude, resetConversation } from '../../chat/agent';
import { localReply } from '../../chat/local';
import { useNav, go } from '../nav';
import { Btn, cx } from '../ui';
import { ImportReview } from '../components/ImportReview';

const STARTERS = ["What's my day like Thursday?", 'Add a study block before my quiz', 'Who has a birthday coming up?'];

export function Chat() {
  const chat = useApp(s => s.chat);
  const name = useApp(s => s.profile.name);
  const apiKey = useApp(s => s.settings.apiKey);
  const nav = useNav();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.length, busy]);
  useEffect(() => { if (nav.chatDraft) { const d = nav.chatDraft; go({ chatDraft: undefined }); send(d); } }, [nav.chatDraft]);

  const push = (m: Omit<ChatMsg, 'id' | 'at'>) => { const msg = { id: uid('msg'), at: Date.now(), ...m }; store().upsert('chat', [msg]); return msg; };

  async function send(raw: string) {
    const t = raw.trim(); if (!t || busy) return;
    setText(''); setUndoable(null);
    push({ role: 'user', text: t });
    setBusy('Thinking…');
    try {
      const r = apiKey ? await askClaude(t, apiKey, setBusy) : localReply(t);
      const m = push({ role: 'assistant', text: r.text, sources: r.sources, pending: r.ctx.pending });
      if (r.ctx.changed) setUndoable(m.id);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      push({ role: 'assistant', text: /401|authentication|api.key/i.test(msg) ? "That Claude key didn't work. Check it in Settings." : /fetch|network|Failed/i.test(msg) ? "I'm offline right now. I can still handle the basics without the web." : `Something went wrong: ${msg.slice(0, 120)}` });
    } finally { setBusy(null); }
  }

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { input.current?.focus(); return; }
    const rec = new SR(); rec.lang = navigator.language || 'en-US';
    rec.onresult = (e: any) => send(e.results[0][0].transcript);
    rec.start();
  };

  return <div className="flex h-full flex-col">
    <div className="flex items-baseline justify-between px-5 pb-2">
      <h1 className="wordmark text-xl">OROZ</h1>
      {chat.length > 0 && <button className="text-xs text-muted" onClick={() => { store().remove('chat', chat.map(c => c.id)); resetConversation(); }}>Clear</button>}
    </div>
    <div className="flex-1 overflow-y-auto px-5 pb-4">
      {!chat.length && <div className="pt-10">
        <p className="serif text-2xl leading-snug">{name ? `Hi ${name}.` : 'Hi.'} What can I help with?</p>
        <div className="mt-5 flex flex-col items-start gap-2">{STARTERS.map(s => <button key={s} onClick={() => send(s)} className="rounded-lg border border-line bg-card px-3 py-2 text-left text-sm hover:bg-linen">{s}</button>)}</div>
        {!apiKey && <p className="mt-8 flex items-start gap-2 text-xs text-muted"><KeyRound size={14} className="mt-0.5 shrink-0" />Works offline for your schedule, tasks, bedtime and birthdays. Add a Claude key in Settings for web search and fuller answers.</p>}
      </div>}
      <ul className="space-y-4">{chat.map(m => <li key={m.id} className={cx('rise flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
        <div className={cx('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed', m.role === 'user' ? 'rounded-br-md bg-green text-paper' : 'rounded-bl-md border border-line bg-card')}>{m.text}</div>
        {m.sources?.length ? <p className="mt-1 px-1 text-[11px] text-muted">Used: {m.sources.join(' · ')}</p> : null}
        {m.pending && <div className="mt-2 w-full max-w-[85%] rounded-xl border border-line bg-card p-3"><ImportReview compact p={m.pending} onDone={p => store().upsert('chat', [{ ...m, pending: p }])} /></div>}
        {undoable === m.id && <button className="mt-1 flex items-center gap-1 px-1 text-[11px] text-muted hover:text-ink" onClick={() => { store().undo(); setUndoable(null); }}><Undo2 size={12} />Undo</button>}
      </li>)}</ul>
      {busy && <p className="mt-4 text-sm text-muted">{busy}</p>}
      <div ref={end} />
    </div>
    <form onSubmit={e => { e.preventDefault(); send(text); }} className="mx-4 mb-[76px] flex items-end gap-2 rounded-2xl border border-line bg-card p-1.5 shadow-sm">
      <textarea ref={input} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
        placeholder="Message OROZ" aria-label="Message OROZ" className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted" />
      {text.trim() ? <Btn kind="primary" type="submit" aria-label="Send" className="h-10 w-10 rounded-xl p-0"><ArrowUp size={18} /></Btn>
        : <Btn kind="ghost" type="button" aria-label="Speak" className="h-10 w-10 p-0" onClick={voice}><Mic size={18} /></Btn>}
    </form>
  </div>;
}
