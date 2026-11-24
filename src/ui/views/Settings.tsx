import { useEffect, useRef, useState } from 'react';
import { X, ChevronDown, Download, Trash2 } from 'lucide-react';
import { useApp, store, type Draft } from '../../data/store';
import { CONNECTIONS, relevantGroups, pullConnection, disconnect, type ConnInfo } from '../../integrations/connect';
import { googleClientId } from '../../integrations/google';
import { useNav, go } from '../nav';
import { Btn, Card, Chip, Heading, Sheet, Field, inputCls, Monogram, cx } from '../ui';
import { DraftReview } from '../components/DraftReview';
import { toast } from '../toast';

export function SettingsPage() {
  const nav = useNav();
  const conns = useRef<HTMLDivElement>(null);
  useEffect(() => { if (nav.settingsFocus) conns.current?.scrollIntoView(); }, [nav.settingsFocus]);
  if (!nav.settings) return null;
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
    <div className="mx-auto max-w-2xl px-5 pb-16 safe-top">
      <div className="flex items-center justify-between pb-2 pt-5"><h1 className="text-2xl font-semibold">Settings</h1>
        <button aria-label="Close settings" className="p-1.5 text-muted" onClick={() => go({ settings: false, settingsFocus: undefined })}><X size={20} /></button></div>
      <div ref={conns}><Connections /></div>
      <Preferences />
    </div>
  </div>;
}

function Connections() {
  const conns = useApp(s => s.connections);
  const occ = useApp(s => s.profile.occupation);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ConnInfo | null>(null);
  const groups = relevantGroups(occ);
  const shown = all ? (['Calendars', 'Reminders', 'School', 'Work', 'Contacts'] as const) : groups;
  return <>
    <Heading>Connections</Heading>
    {shown.map(g => { const list = CONNECTIONS.filter(c => c.group === g); return <section key={g} className="mb-3">
      <p className="mb-1 text-xs font-medium text-muted">{g}</p>
      <Card className="divide-y divide-line p-0">{list.map(c => { const on = conns[c.id]?.connected; return <div key={c.id} className="flex items-center gap-3 px-4 py-3">
        <Monogram id={c.id} size={32} />
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{c.name}</span><span className={cx('block text-xs', on ? 'text-green' : 'text-muted')}>{c.kind === 'unavailable' ? 'Needs the iPhone app' : on ? 'Connected' : 'Not connected'}</span></span>
        {c.kind !== 'unavailable' && <Btn kind="quiet" className="px-3 py-1.5 text-xs" onClick={() => setOpen(c)}>{on ? 'Manage' : 'Connect'}</Btn>}
      </div>; })}</Card>
    </section>; })}
    {!all && shown.length < 5 && <button className="flex items-center gap-1 text-sm text-muted" onClick={() => setAll(true)}>Show all<ChevronDown size={14} /></button>}
    <p className="mt-2 text-xs text-muted">Read-only. You see everything before it's added, and can turn any of these off.</p>
    {open && <ConnSheet c={open} onClose={() => setOpen(null)} />}
  </>;
}

function ConnSheet({ c, onClose }: { c: ConnInfo; onClose: () => void }) {
  const conn = useApp(s => s.connections[c.id]);
  const hasGoogle = useApp(s => !!googleClientId(s.settings.googleClientId));
  const [url, setUrl] = useState(conn?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const pull = async () => { setBusy(true); setErr(''); try { setDraft(await pullConnection(c, url)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return <Sheet open onClose={onClose} title={c.name}>
    {draft ? <DraftReview draft={draft} onDone={added => { setDraft(null); if (added) { toast(`${c.name} connected`); onClose(); } }} /> : <>
      <p className="mb-3 text-sm text-muted">{c.help}</p>
      {c.kind === 'google' && !hasGoogle && <p className="mb-3 rounded-lg bg-brass-soft px-3 py-2 text-xs">Google sign-in needs a one-time client ID (Preferences, below).</p>}
      {c.kind === 'link' && <Field label="Link"><input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://… or webcal://…" inputMode="url" /></Field>}
      {err && <p className="mb-3 text-sm text-clay">{err}</p>}
      <div className="flex flex-col gap-2">
        <Btn kind="primary" disabled={busy || (c.kind === 'google' && !hasGoogle) || (c.kind === 'link' && !url.trim())} onClick={pull}>{busy ? 'Checking…' : c.kind === 'google' ? (conn?.connected ? 'Sync now' : 'Sign in with Google') : conn?.connected ? 'Sync now' : 'Connect'}</Btn>
        {conn?.connected && <Btn kind="danger" onClick={() => { disconnect(c); toast(`${c.name} turned off`); onClose(); }}>Turn off and remove its items</Btn>}
      </div>
    </>}
  </Sheet>;
}

function Preferences() {
  const s = useApp(x => x.settings);
  const set = (p: Partial<typeof s>) => store().set('settings', { ...s, ...p });
  return <>
    <Heading>Preferences</Heading>
    <Card className="space-y-2">
      <Field label="Theme"><div className="flex gap-1.5">{(['system', 'light', 'dark'] as const).map(t => <Chip key={t} active={s.theme === t} onClick={() => set({ theme: t })}>{t}</Chip>)}</div></Field>
      <Field label="Claude API key"><input type="password" className={inputCls} value={s.apiKey ?? ''} placeholder="sk-ant-…" onChange={e => set({ apiKey: e.target.value.trim() || undefined })} /></Field>
      <p className="text-xs text-muted">Lets OROZ understand anything you say, read photos and web pages, and look up dates. Stored on this device. Turn on web search for the key in the Claude Console.</p>
      <Field label="Google client ID"><input className={inputCls} value={s.googleClientId ?? ''} placeholder={import.meta.env.VITE_GOOGLE_CLIENT_ID ? 'set in .env' : 'xxxx.apps.googleusercontent.com'} onChange={e => set({ googleClientId: e.target.value.trim() || undefined })} /></Field>
    </Card>
    <SavedPhotos />
    <Heading>Data</Heading>
    <Card className="flex flex-wrap gap-2">
      <Btn onClick={async () => { const blob = new Blob([await store().exportJSON()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'oroz-data.json'; a.click(); }}><Download size={15} />Export</Btn>
      <Btn kind="danger" onClick={() => { if (confirm('Delete everything OROZ has saved on this device?')) store().wipe(); }}><Trash2 size={15} />Delete all</Btn>
    </Card>
    <p className="mt-3 text-xs text-muted">Everything stays on this device.</p>
  </>;
}

function SavedPhotos() {
  const photos = useApp(s => s.photos);
  if (!photos.length) return null;
  return <>
    <Heading>Saved schedule photos</Heading>
    <Card className="divide-y divide-line p-0">{photos.map(p => <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
      <a href={p.dataUrl} target="_blank" rel="noreferrer"><img src={p.dataUrl} alt={p.title} className="h-12 w-10 rounded border border-line object-cover" /></a>
      <span className="flex-1 text-sm">{p.title}<span className="block text-xs text-muted">{new Date(p.at).toLocaleDateString()}</span></span>
      <button aria-label="Delete photo" className="p-1 text-muted hover:text-clay" onClick={() => store().remove('photos', [p.id])}><Trash2 size={15} /></button>
    </div>)}</Card>
  </>;
}
