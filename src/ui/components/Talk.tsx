import { useEffect, useRef, useState } from 'react';
import { Mic, Camera, Link2, ArrowUp, Keyboard, X } from 'lucide-react';
import { useNav, go, pickPhotos, openPhotoImport } from '../nav';
import { store, type Draft } from '../../data/store';
import { tell, type Reply } from '../../ai/router';
import { DraftReview } from './DraftReview';
import { FitIn } from './FitIn';
import { Btn, cx, inputCls } from '../ui';
import { toast } from '../toast';

/** The big button. The main way to add anything. */
export function TalkButton({ withCamera }: { withCamera?: boolean }) {
  return <div className="fixed bottom-[80px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2">
    <button onClick={() => go({ talk: true, talkMode: 'voice' })} aria-label="Tell OROZ"
      className="flex h-14 items-center gap-2.5 rounded-full bg-ink pl-5 pr-6 text-paper shadow-[0_6px_18px_rgba(40,32,20,.25)] active:scale-[.98]">
      <Mic size={22} strokeWidth={2} /><span className="whitespace-nowrap text-[15px] font-semibold tracking-wide">Tell <span className="wordmark">OROZ</span></span>
    </button>
    {withCamera && <button onClick={() => pickPhotos('camera')} aria-label="Add from photo" title="Add from photo"
      className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-ink shadow-sm active:scale-[.97]"><Camera size={19} strokeWidth={1.75} /></button>}
  </div>;
}

const SR = () => (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export function TalkSheet() {
  const nav = useNav();
  const [mode, setMode] = useState<'voice' | 'type' | 'link'>('voice');
  const [heard, setHeard] = useState('');
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [fit, setFit] = useState<string | null>(null);
  const rec = useRef<any>(null);

  const close = () => { rec.current?.abort?.(); go({ talk: false }); setReply(null); setHeard(''); setText(''); setFit(null); };
  useEffect(() => {
    if (!nav.talk) return;
    const m = nav.talkMode ?? 'voice';
    setReply(null); setFit(null);
    if (m === 'photo' || m === 'link') { openPhotoImport({ from: m === 'link' ? 'menu' : 'menu' }); return; }
    else if (m === 'voice' && SR()) { setMode('voice'); listen(); }
    else setMode('type');
  }, [nav.talk]);

  async function run(fn: () => Promise<Reply>) {
    setBusy('Thinking…'); setReply(null); setFit(null);
    try { setReply(await fn()); }
    catch (e) { const m = String((e as Error).message ?? e); setReply({ text: /401|auth/i.test(m) ? "That Claude key didn't work. Check Settings." : /fetch|network/i.test(m) ? "Can't reach the internet right now." : m.slice(0, 160) }); }
    finally { setBusy(null); }
  }
  function listen() {
    const R = SR(); if (!R) { setMode('type'); return; }
    const r = new R(); rec.current = r;
    r.lang = navigator.language || 'en-US'; r.interimResults = true;
    r.onresult = (e: any) => { const t = Array.from(e.results).map((x: any) => x[0].transcript).join(''); setHeard(t); if (e.results[e.results.length - 1].isFinal) { setListening(false); run(() => tell(t, setBusy)); } };
    r.onerror = () => { setListening(false); setMode('type'); };
    r.onend = () => setListening(false);
    setHeard(''); setListening(true); r.start();
  }
  const isLink = (t: string) => !/\s/.test(t) && /^https?:\/\/|^webcal:|^www\.|\.(com|org|edu|net|gov|ics)(\/|$)/i.test(t);
  const submit = () => { const t = text.trim(); if (!t) return; if (mode === 'link' || isLink(t)) { setText(''); openPhotoImport({ link: t, from: 'link' }); return; } setHeard(t); setText(''); run(() => tell(t, setBusy)); };
  const done = (added: boolean, d: Draft) => {
    if (!added) { setReply(null); return; }
    const fitId = reply?.fitTaskId && d.tasks.some(t => t.id === reply.fitTaskId) ? reply.fitTaskId : undefined;
    if (fitId) { setFit(fitId); setReply({ text: 'Added. Pick a time, or leave it for later.' }); }
    else { toast('Added', { label: 'Undo', run: () => store().undo() }); close(); }
  };

  if (!nav.talk) return null;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30" onClick={close}>
    <div className="rise w-full max-w-lg rounded-t-2xl border border-line bg-paper p-5 pb-8 shadow-lg safe-bottom sm:mb-6 sm:rounded-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-label="Tell OROZ">
      <div className="mb-4 flex items-center justify-between"><span className="wordmark text-sm">OROZ</span><button aria-label="Close" onClick={close} className="p-1 text-muted"><X size={18} /></button></div>

      {heard && <p className="serif mb-3 text-xl leading-snug">“{heard}”</p>}
      {!heard && !reply && mode === 'voice' && <p className="serif mb-3 text-xl text-muted">{listening ? 'Listening…' : 'Tap the mic and say it.'}</p>}
      {!heard && !reply && mode === 'type' && <p className="mb-3 text-sm text-muted">Try “Dentist next Tuesday afternoon” or “Fit in a haircut this week”.</p>}
      {mode === 'link' && !reply && <p className="mb-3 text-sm text-muted">Paste a calendar link or any page with a schedule.</p>}

      {busy && <p className="mb-3 text-sm text-muted">{busy}</p>}
      {reply && <div className="mb-3">
        {reply.text && <p className="text-[15px]">{reply.text}</p>}
        {reply.sources?.length ? <p className="mt-0.5 text-[11px] text-muted">From {reply.sources.join(' · ')}</p> : null}
        {reply.needsKey && <button className="mt-1 text-xs text-green underline" onClick={() => { close(); go({ settings: true }); }}>Add a key in Settings</button>}
        {reply.draft && <div className="mt-3"><DraftReview compact draft={reply.draft} onDone={done} /></div>}
      </div>}
      {fit && <div className="mb-3"><FitIn taskId={fit} onDone={close} /></div>}

      {mode === 'voice' ? <div className="flex flex-col items-center gap-3 pt-2">
        <button onClick={listen} aria-label={listening ? 'Listening' : 'Speak'} className={cx('flex h-20 w-20 items-center justify-center rounded-full text-paper shadow-md', listening ? 'animate-pulse bg-clay' : 'bg-ink')}><Mic size={32} /></button>
        <div className="grid w-full grid-cols-3 gap-2 pt-1">
          <MenuBtn label="Type" onClick={() => setMode('type')}><Keyboard size={18} /></MenuBtn>
          <MenuBtn label="Add from photo" onClick={() => pickPhotos('upload')}><Camera size={18} /></MenuBtn>
          <MenuBtn label="Paste a link" onClick={() => setMode('link')}><Link2 size={18} /></MenuBtn>
        </div>
      </div> : <form onSubmit={e => { e.preventDefault(); submit(); }} className="flex items-center gap-2">
        <input autoFocus value={text} onChange={e => setText(e.target.value)} className={inputCls} placeholder={mode === 'link' ? 'https://…' : 'Tell OROZ…'} aria-label={mode === 'link' ? 'Link' : 'Tell OROZ'} inputMode={mode === 'link' ? 'url' : 'text'} />
        {text.trim() ? <Btn kind="primary" type="submit" aria-label="Send" className="h-10 w-10 shrink-0 p-0"><ArrowUp size={18} /></Btn>
          : <><IconBtn label="Speak" onClick={() => { setMode('voice'); listen(); }}><Mic size={18} /></IconBtn><IconBtn label="Add from photo" onClick={() => pickPhotos('upload')}><Camera size={18} /></IconBtn>{mode !== 'link' && <IconBtn label="Link" onClick={() => setMode('link')}><Link2 size={18} /></IconBtn>}</>}
      </form>}
    </div>
  </div>;
}

function MenuBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 rounded-lg border border-line bg-card px-2 py-2.5 text-xs text-ink hover:bg-linen">{children}{label}</button>;
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-linen hover:text-ink">{children}</button>;
}
