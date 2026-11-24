import { useState } from 'react';
import type { Habit, Weights, Importance } from '@engine/types';
import { insights, learnAcceptance } from '@engine/habits';
import { learnReminderBias } from '@engine/reminders';
import { DEFAULT_WEIGHTS, DEFAULT_ENERGY } from '@engine/defaults';
import { fmtTime, at, startOfDay, hm, parseHM, fmtDay } from '@engine/time';
import { useApp, store } from '../../data/store';
import * as A from '../../data/actions';
import { syncGoogle, syncIcsFeeds, importIcsText } from '../../integrations/sync';
import { googleClientId } from '../../integrations/google';
import { notifPermission, requestNotifications, platformNote } from '../../integrations/notify';
import { Btn, Card, Chip, Section, Toggle, Field, inputCls, IMPORTANCE, cx } from '../ui';
import { toast } from '../toast';

export function Me() {
  const [tab, setTab] = useState<'learned' | 'settings'>('learned');
  return <div className="h-full overflow-y-auto px-3 pb-40">
    <div className="mb-3 flex gap-1.5"><Chip active={tab === 'learned'} onClick={() => setTab('learned')}>🧠 What Oroz has learned</Chip><Chip active={tab === 'settings'} onClick={() => setTab('settings')}>⚙ Settings</Chip></div>
    {tab === 'learned' ? <Learned /> : <SettingsView />}
  </div>;
}

function Learned() {
  const habits = useApp(s => s.habits);
  const logs = useApp(s => s.logs);
  const blocked = useApp(s => s.blockedSuggestions);
  const now = Date.now();
  const ins = insights(habits, logs, now);
  const energy = A.energy();
  const acc = Object.entries(learnAcceptance(logs, now)).sort((a, b) => b[1] - a[1]);
  const bias = learnReminderBias(logs, now);
  return <>
    <Section title="Insights" right={<Btn kind="ghost" className="text-xs" onClick={() => { A.refreshLearning(); toast('Re-learned from your history'); }}>↻ Refresh</Btn>}>
      <div className="space-y-2">{ins.length ? ins.map(i => <Card key={i.id} className="text-sm">
        <p>{i.text}</p>
        {i.action && <Btn className="mt-2 px-2 py-1 text-xs" onClick={() => {
          if (i.action!.kind === 'protect') { A.protectMeal(i.action!.key); toast('Protected — meal window updated'); }
          else if (i.action!.kind === 'suggest') { const s = A.suggestFriendsSaturday(); toast(s ? `Held ${fmtDay(s, now)} ${fmtTime(s)} for friends` : 'Saturday is full'); }
          else { const h = habits.find(x => x.key === i.action!.key); if (h) A.editHabit(h, { status: 'confirmed' }); toast('Got it'); }
        }}>{i.action.label}</Btn>}
      </Card>) : <p className="text-sm text-slate-500">Not enough history yet. Use Oroz for a week and insights will appear here.</p>}</div>
    </Section>
    <Section title="Habits (confirm, edit or delete)">
      <div className="space-y-2">{habits.map(h => <HabitRow key={h.id} h={h} />)}</div>
    </Section>
    <Section title="Energy by hour">
      <Card>
        <div className="flex h-24 items-end gap-[2px]">{energy.map((e, h) => <div key={h} className="flex flex-1 flex-col items-center justify-end">
          <div className={cx('w-full rounded-t', Math.abs(e - DEFAULT_ENERGY[h]) > 0.05 ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-white/20')} style={{ height: `${e * 100}%` }} title={`${h}:00 — ${Math.round(e * 100)}%`} />
        </div>)}</div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-500"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
        <p className="mt-1 text-xs text-slate-500">Purple = learned from when you finish vs. skip focus work; gray = starting guess. Focus tasks go where bars are tall.</p>
      </Card>
    </Section>
    <Section title="Suggestions you accept / skip">
      <Card className="space-y-1 text-sm">{acc.length ? acc.map(([k, v]) => <div key={k} className="flex justify-between"><span className="truncate">{k}</span><span className={v >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span></div>) : <span className="text-slate-500">No feedback yet.</span>}
        {Object.entries(bias).map(([k, v]) => <div key={k} className="flex justify-between text-xs text-slate-500"><span>Reminders: {k}</span><span>{v < -0.5 ? 'you usually dismiss these → quieter' : v.toFixed(2)}</span></div>)}
      </Card>
      {blocked.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{blocked.map(b => <Chip key={b} onClick={() => store().setKV('blockedSuggestions', blocked.filter(x => x !== b))}>🚫 {b} ✕</Chip>)}</div>}
      <p className="mt-1 text-xs text-slate-500">Recent behavior counts more (3-week half-life). Simple, explainable stats — no black-box ML.</p>
    </Section>
  </>;
}

function HabitRow({ h }: { h: Habit }) {
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return <Card className="p-2.5">
    <div className="flex items-center justify-between gap-2">
      <div className="font-medium">{h.label} <span className="text-xs font-normal text-slate-500">· {h.samples} times · {Math.round(h.confidence * 100)}% sure{h.status !== 'learned' ? ` · ${h.status}` : ''}</span></div>
      <div className="flex gap-1">
        {h.status === 'learned' && <Btn className="px-2 py-1 text-xs" onClick={() => A.editHabit(h, { status: 'confirmed' })}>✓</Btn>}
        <Btn kind="danger" className="px-2 py-1 text-xs" onClick={() => { A.deleteHabit(h); toast('Forgot that habit'); }}>✕</Btn>
      </div>
    </div>
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
      {days.map((d, i) => <Chip key={i} active={h.weekdays.includes(i)} onClick={() => A.editHabit(h, { weekdays: h.weekdays.includes(i) ? h.weekdays.filter(x => x !== i) : [...h.weekdays, i].sort() })}>{d}</Chip>)}
      <input type="time" value={hm(h.windowStart)} onChange={e => A.editHabit(h, { windowStart: parseHM(e.target.value), windowEnd: parseHM(e.target.value) + (h.windowEnd - h.windowStart) })} className="ml-1 rounded bg-slate-100 px-1 dark:bg-white/5" />
      <span>· {h.durationMin}m</span>
    </div>
  </Card>;
}

function SettingsView() {
  const s = useApp(x => x.settings);
  const sync = useApp(x => x.sync);
  const reminders = useApp(x => x.reminders);
  const set = (p: Partial<typeof s>) => store().setKV('settings', { ...s, ...p });
  const [perm, setPerm] = useState(notifPermission());
  const [feed, setFeed] = useState({ url: '', kind: 'calendar' as 'calendar' | 'assignments', label: '' });
  const [busy, setBusy] = useState('');
  const run = async (label: string, fn: () => Promise<string[]>) => { setBusy(label); try { toast((await fn()).join(' · ') || 'Done'); } catch (e) { toast((e as Error).message); } finally { setBusy(''); } };
  const upcoming = reminders.filter(r => !r.done && r.dueAt > Date.now()).sort((a, b) => a.dueAt - b.dueAt).slice(0, 8);
  const hasGoogle = !!googleClientId(s.googleClientId);

  return <>
    <Section title="Appearance">
      <div className="flex gap-1.5">{(['system', 'light', 'dark'] as const).map(t => <Chip key={t} active={s.theme === t} onClick={() => set({ theme: t })}>{t}</Chip>)}</div>
    </Section>

    <Section title="Sleep & daily rhythm">
      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Target bedtime"><input type="time" className={inputCls} value={s.bedtime} onChange={e => set({ bedtime: e.target.value })} /></Field>
          <Field label="Wake time"><input type="time" className={inputCls} value={s.wake} onChange={e => set({ wake: e.target.value })} /></Field>
          <Field label={`Minimum sleep: ${s.minSleepMin / 60}h`}><input type="range" min={360} max={600} step={30} value={s.minSleepMin} onChange={e => set({ minSleepMin: +e.target.value })} className="w-full" /></Field>
          <Field label={`Usual nap: ${s.napLengthMin}m`}><input type="range" min={10} max={90} step={5} value={s.napLengthMin} onChange={e => set({ napLengthMin: +e.target.value })} className="w-full" /></Field>
          <Field label={`Buffer between blocks: ${s.bufferMin}m`}><input type="range" min={0} max={30} step={5} value={s.bufferMin} onChange={e => set({ bufferMin: +e.target.value })} className="w-full" /></Field>
          <Field label={`Focus cap before a break: ${s.focusCapMin}m`}><input type="range" min={30} max={180} step={15} value={s.focusCapMin} onChange={e => set({ focusCapMin: +e.target.value })} className="w-full" /></Field>
          <Field label={`Protected free time/day: ${s.minFreeMinPerDay}m`}><input type="range" min={0} max={240} step={15} value={s.minFreeMinPerDay} onChange={e => set({ minFreeMinPerDay: +e.target.value })} className="w-full" /></Field>
        </div>
        <p className="text-xs text-slate-500">Sleep is a protected block — the planner never schedules over it unless you override a night from the block itself.</p>
      </Card>
    </Section>

    <Section title="Reminders">
      <Card>
        <div className="flex items-center justify-between gap-2"><span className="text-sm">Notifications: <b>{perm}</b></span>
          {perm !== 'granted' && perm !== 'unsupported' && <Btn kind="primary" className="text-xs" onClick={async () => setPerm(await requestNotifications())}>Allow</Btn>}</div>
        <p className="mt-1 text-xs text-slate-500">Asked only now, when you tap. {platformNote()}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Quiet hours from"><input type="time" className={inputCls} value={s.quietHours[0]} onChange={e => set({ quietHours: [e.target.value, s.quietHours[1]] })} /></Field>
          <Field label="to"><input type="time" className={inputCls} value={s.quietHours[1]} onChange={e => set({ quietHours: [s.quietHours[0], e.target.value] })} /></Field>
        </div>
        <Field label="Allowed during quiet hours (exceptions)"><div className="flex gap-1.5">{IMPORTANCE.map(i => <Chip key={i.key} active={s.quietExceptions.includes(i.key)} onClick={() => set({ quietExceptions: s.quietExceptions.includes(i.key) ? s.quietExceptions.filter(x => x !== i.key) : [...s.quietExceptions, i.key] })}>{i.label}</Chip>)}</div></Field>
        <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Upcoming · tap to change style</div>
        <div className="mt-1 space-y-1">{upcoming.map(r => <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">{r.title} <span className="text-xs text-slate-500">{fmtDay(r.dueAt, Date.now())} {fmtTime(r.dueAt)}</span></span>
          <span className="flex shrink-0 gap-1">{IMPORTANCE.map(i => <button key={i.key} onClick={() => A.setReminderImportance(r, i.key as Importance)} className={cx('rounded-full px-1.5 py-0.5 text-[10px]', r.importance === i.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-white/10')}>{i.label[0]}</button>)}</span>
        </div>)}</div>
      </Card>
    </Section>

    <Section title="Connections (read-only)">
      <Card className="space-y-3">
        <div>
          <div className="text-sm font-semibold">Google (Calendar, Contacts birthdays, Classroom)</div>
          <Field label="OAuth Client ID (see README)"><input className={inputCls} value={s.googleClientId ?? ''} placeholder={import.meta.env.VITE_GOOGLE_CLIENT_ID ? 'set via .env' : 'xxxx.apps.googleusercontent.com'} onChange={e => set({ googleClientId: e.target.value.trim() || undefined })} /></Field>
          <div className="flex flex-wrap gap-1.5">
            <Btn className="text-xs" disabled={!hasGoogle || !!busy} onClick={() => run('cal', async () => { const m = await syncGoogle(true, { calendar: true }); set({ flags: { ...s.flags, googleSync: true } }); return m; })}>{busy === 'cal' ? '…' : '📅 Calendar'}</Btn>
            <Btn className="text-xs" disabled={!hasGoogle || !!busy} onClick={() => run('con', () => syncGoogle(true, { contacts: true }))}>{busy === 'con' ? '…' : '🎂 Contacts birthdays'}</Btn>
            <Btn className="text-xs" disabled={!hasGoogle || !!busy} onClick={() => run('cls', () => syncGoogle(true, { classroom: true }))}>{busy === 'cls' ? '…' : '🏫 Classroom'}</Btn>
          </div>
          <Toggle on={s.flags.googleSync} onChange={v => set({ flags: { ...s.flags, googleSync: v } })} label="Auto re-sync Google Calendar" hint={sync.google ? `Last sync ${fmtDay(sync.google, Date.now())} ${fmtTime(sync.google)}` : 'Every 30 min while open, and on pull-to-refresh'} />
        </div>
        <div className="border-t border-slate-200 pt-3 dark:border-white/10">
          <div className="text-sm font-semibold">Calendar & school feeds (.ics)</div>
          <p className="text-xs text-slate-500">School calendar, Canvas ("Calendar → Calendar Feed"), Schoology ("Calendar → Export"), or Classroom's calendar. Choose "assignments" for feeds where each event is a due date.</p>
          {s.icsUrls.map(f => <div key={f.url} className="mt-1 flex items-center justify-between gap-2 text-sm"><span className="truncate">{f.label} · {f.kind}{sync[f.url] ? ` · synced ${fmtTime(sync[f.url])}` : ''}</span><button className="text-xs text-rose-600" onClick={() => set({ icsUrls: s.icsUrls.filter(x => x.url !== f.url) })}>remove</button></div>)}
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
            <input className={inputCls} placeholder="https://… or webcal://…" value={feed.url} onChange={e => setFeed({ ...feed, url: e.target.value })} />
            <select className={inputCls} value={feed.kind} onChange={e => setFeed({ ...feed, kind: e.target.value as 'calendar' })}><option value="calendar">calendar</option><option value="assignments">assignments</option></select>
          </div>
          <div className="mt-2 flex gap-2"><input className={inputCls} placeholder="Label (e.g. School, Canvas)" value={feed.label} onChange={e => setFeed({ ...feed, label: e.target.value })} />
            <Btn kind="primary" disabled={!feed.url} onClick={() => { set({ icsUrls: [...s.icsUrls, { ...feed, label: feed.label || feed.kind }] }); setFeed({ url: '', kind: 'calendar', label: '' }); setTimeout(() => run('ics', syncIcsFeeds), 50); }}>Add</Btn></div>
          <label className="mt-2 block text-xs">Or import a downloaded .ics file: <input type="file" accept=".ics,text/calendar" className="text-xs" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; toast(importIcsText(await f.text(), feed.kind, f.name).join(' · ')); A.runPlan('week'); }} /></label>
          <Field label="CORS proxy (optional, only if your feed blocks browsers)"><input className={inputCls} value={s.corsProxy ?? ''} placeholder="https://your-proxy.example/?url={url}" onChange={e => set({ corsProxy: e.target.value || undefined })} /></Field>
          <Btn className="mt-1 text-xs" disabled={!s.icsUrls.length || !!busy} onClick={() => run('ics', syncIcsFeeds)}>⟳ Sync feeds now</Btn>
        </div>
      </Card>
    </Section>

    <Section title="Optional add-ons (off by default)">
      <Card>
        <Toggle on={s.flags.llm} onChange={v => set({ flags: { ...s.flags, llm: v } })} label="AI helper for capture + starter kits" hint="Uses your own Claude API key. Sends only the line you typed, or an assignment's title + instructions. Never calendar, location, contacts or history." />
        {s.flags.llm && <Field label="Anthropic API key (stored on this device only)"><input type="password" className={inputCls} value={s.llmApiKey ?? ''} onChange={e => set({ llmApiKey: e.target.value || undefined })} /></Field>}
        <Toggle on={s.flags.places} onChange={v => set({ flags: { ...s.flags, places: v } })} label="Real restaurant search (Google Places)" hint="Sends only a text query like “thai restaurant vegetarian Midtown” — never your coordinates. Without it, Oroz gives search links instead of inventing names." />
        {s.flags.places && <Field label="Places API key"><input type="password" className={inputCls} value={s.placesApiKey ?? ''} onChange={e => set({ placesApiKey: e.target.value || undefined })} /></Field>}
        <Field label="Search area (a neighborhood or city, used instead of GPS)"><input className={inputCls} value={s.searchArea ?? ''} onChange={e => set({ searchArea: e.target.value || undefined })} /></Field>
      </Card>
    </Section>

    <Section title="Debug: planner scoring weights">
      <Card>
        {(Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]).map(k => <div key={k} className="flex items-center gap-2 py-0.5 text-xs">
          <span className="w-32 shrink-0">{k}</span>
          <input type="range" min={0} max={5} step={0.1} value={s.weights[k]} onChange={e => set({ weights: { ...s.weights, [k]: +e.target.value } })} className="flex-1" />
          <span className="w-8 tabular-nums">{s.weights[k].toFixed(1)}</span>
        </div>)}
        <div className="mt-2 flex gap-2"><Btn className="text-xs" onClick={() => set({ weights: { ...DEFAULT_WEIGHTS } })}>Reset</Btn><Btn className="text-xs" onClick={() => { A.runPlan('week'); toast('Re-planned with these weights'); }}>Re-plan week</Btn></div>
      </Card>
    </Section>

    <Section title="Privacy & data">
      <Card className="text-sm">
        <p className="mb-2 text-xs text-slate-500">Everything — calendar, school data, location, contacts, food preferences, behavior history — lives in this browser's storage on this device. Nothing is uploaded.</p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={async () => { const blob = new Blob([await store().exportJSON()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `oroz-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}>⬇ Export all (JSON)</Btn>
          <label className="inline-flex cursor-pointer items-center rounded-xl bg-slate-200/70 px-3 py-2 text-sm font-medium dark:bg-white/10">⬆ Import<input type="file" accept="application/json" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { await store().importJSON(await f.text()); toast('Imported'); } }} /></label>
          <Btn kind="danger" onClick={() => { if (confirm('Delete ALL Oroz data on this device? This cannot be undone.')) store().wipe(); }}>🗑 Delete everything</Btn>
        </div>
        <p className="mt-2 text-xs text-slate-500">Deleting reloads Oroz with fresh demo data.</p>
      </Card>
    </Section>
    <Section title="Onboarding"><Btn onClick={() => set({ onboarded: false })}>Retake the 1-minute quiz</Btn></Section>
    <p className="pb-6 text-center text-xs text-slate-400">Oroz · on-device · v0.1 · {hm(parseHM(s.wake))}–{hm(parseHM(s.bedtime))}</p>
    {void at}{void startOfDay}
  </>;
}
