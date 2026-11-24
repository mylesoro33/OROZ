import { useEffect, useState } from 'react';
import type { Reminder } from '@engine/types';
import { dueNow, markFired, snooze, type SnoozeOption } from '@engine/reminders';
import { fmtTime, HOUR } from '@engine/time';
import { useApp, store } from '../data/store';
import * as A from '../data/actions';
import { syncAll } from '../integrations/sync';
import { notify } from '../integrations/notify';
import { CommandBar } from './components/CommandBar';
import { Onboarding } from './components/Onboarding';
import { Today } from './views/Today';
import { Week } from './views/Week';
import { Tasks } from './views/Tasks';
import { Life } from './views/Life';
import { People } from './views/People';
import { Me } from './views/Me';
import { Btn, cx, useNow } from './ui';
import { toast, useToasts, dismissToast } from './toast';

type Tab = 'today' | 'week' | 'tasks' | 'life' | 'people' | 'me';
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'today', label: 'Today', icon: '◷' }, { key: 'week', label: 'Week', icon: '▦' }, { key: 'tasks', label: 'Tasks', icon: '✓' },
  { key: 'life', label: 'Life', icon: '✿' }, { key: 'people', label: 'People', icon: '☺' }, { key: 'me', label: 'Me', icon: '◉' },
];

export function App() {
  const [tab, setTab] = useState<Tab>(() => (localStorageGet('oroz.tab') as Tab) || 'today');
  const settings = useApp(s => s.settings);
  const places = useApp(s => s.places);
  const current = useApp(s => s.currentPlaceId);
  const reminders = useApp(s => s.reminders);
  const now = useNow(15_000);
  const [onboard, setOnboard] = useState(!settings.onboarded);
  useEffect(() => setOnboard(!settings.onboarded), [settings.onboarded]);
  useEffect(() => { try { localStorage.setItem('oroz.tab', tab); } catch { /* private mode */ } }, [tab]);

  // Theme
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', settings.theme === 'dark' || (settings.theme === 'system' && mq.matches));
    apply(); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  // Background loop: reminders every 15s, calendar re-sync every 30 min, daily learning refresh.
  useEffect(() => {
    A.syncReminders();
    A.syncOccasions();
    A.scheduleIdle(() => { for (const p of store().state.projects) if (!p.starterKit) A.ensureStarterKit(p.id); });
    const tick = () => {
      const st = store().state;
      for (const f of dueNow(st.reminders, Date.now())) {
        store().upsert('reminders', [markFired(f.reminder, f.stageIndex)]);
        if (f.stage.stage === 'digest') continue; // passive: in-app digest only
        notify('Oroz', f.stage.label, f.reminder.id, f.persistentBanner).then(shown => { if (!shown && !f.persistentBanner) toast(`⏰ ${f.stage.label}`); });
      }
    };
    tick();
    const t1 = setInterval(tick, 15_000);
    const t2 = setInterval(() => { syncAll(false).catch(() => {}); }, 30 * 60_000);
    const last = Number(localStorageGet('oroz.learned') || 0);
    if (Date.now() - last > 20 * HOUR) { A.refreshLearning(); try { localStorage.setItem('oroz.learned', String(Date.now())); } catch { /* ignore */ } }
    syncAll(false).catch(() => {});
    const vis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', vis);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'reminder-action') return;
      const r = store().state.reminders.find(x => x.id === e.data.tag); if (!r) return;
      if (e.data.action === 'snooze10') snoozeR(r, '10m'); else if (e.data.action === 'done') doneR(r);
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => { clearInterval(t1); clearInterval(t2); document.removeEventListener('visibilitychange', vis); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, []);

  const alert = reminders.filter(r => r.importance === 'aggressive' && !r.done && r.firedStages.length > 0 && (!r.snoozedUntil || r.snoozedUntil <= now) && r.dueAt > now - 2 * HOUR).sort((a, b) => a.dueAt - b.dueAt)[0];
  const badge = reminders.filter(r => !r.done && r.firedStages.length > 0 && r.importance !== 'aggressive' && r.dueAt > now - 2 * HOUR).length;
  const place = places.find(p => p.id === current);

  return <div className="mx-auto flex h-full max-w-2xl flex-col">
    <header className="safe-top flex items-center gap-2 px-3 pb-2 pt-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-sm font-black text-white">O</div>
      <span className="text-lg font-black tracking-tight">Oroz</span>
      <div className="flex-1" />
      {badge > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white" title="Reminders">{badge}</span>}
      <button onClick={() => { const ids = [...places.map(p => p.id), undefined]; const i = ids.indexOf(current); store().setKV('currentPlaceId', ids[(i + 1) % ids.length]); store().setKV('placeSource', 'manual'); }}
        className="rounded-full bg-slate-200/70 px-3 py-1 text-xs font-medium dark:bg-white/10" title="Tap to change where you are">📍 {place?.name ?? 'Somewhere'}</button>
    </header>

    {alert && <ReminderBanner r={alert} />}

    <main className="min-h-0 flex-1">
      {tab === 'today' && <Today />}{tab === 'week' && <Week />}{tab === 'tasks' && <Tasks />}
      {tab === 'life' && <Life />}{tab === 'people' && <People />}{tab === 'me' && <Me />}
    </main>

    <CommandBar />
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#0f0f18]/95">
      <div className="mx-auto grid max-w-2xl grid-cols-6">{TABS.map(t => <button key={t.key} onClick={() => setTab(t.key)} className={cx('flex h-[60px] flex-col items-center justify-center gap-0.5 text-[11px]', tab === t.key ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-slate-500')}>
        <span className="text-lg leading-none">{t.icon}</span>{t.label}
      </button>)}</div>
    </nav>
    <Toasts />
    {onboard && <Onboarding onDone={() => setOnboard(false)} />}
  </div>;
}

function snoozeR(r: Reminder, opt: SnoozeOption) {
  store().upsert('reminders', [snooze(r, opt, Date.now(), store().state.settings)]);
  store().log({ action: 'snoozed', key: `reminder:${r.category ?? 'other'}` });
  toast(`Snoozed ${opt === 'tomorrow' ? 'until tomorrow' : opt}`);
}
function doneR(r: Reminder) {
  store().upsert('reminders', [{ ...r, done: true }]);
  store().log({ action: 'completed', key: `reminder:${r.category ?? 'other'}` });
  const b = store().state.blocks.find(x => x.id === r.itemId);
  if (b && b.end <= Date.now()) A.completeBlock(b);
}

function ReminderBanner({ r }: { r: Reminder }) {
  return <div className="pop mx-3 mb-2 rounded-2xl bg-rose-600 p-3 text-white shadow-lg" role="alert">
    <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Important · {fmtTime(r.dueAt)}</div>
    <div className="font-semibold">{r.title}</div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Btn className="bg-white/20 px-2 py-1 text-xs text-white" onClick={() => snoozeR(r, '10m')}>10 min</Btn>
      <Btn className="bg-white/20 px-2 py-1 text-xs text-white" onClick={() => snoozeR(r, '1h')}>1 hr</Btn>
      <Btn className="bg-white/20 px-2 py-1 text-xs text-white" onClick={() => snoozeR(r, 'tomorrow')}>Tomorrow</Btn>
      <Btn className="ml-auto bg-white px-3 py-1 text-xs text-rose-700" onClick={() => doneR(r)}>Done ✓</Btn>
    </div>
  </div>;
}

function Toasts() {
  const ts = useToasts();
  return <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3">
    {ts.map(t => <div key={t.id} className="pop pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-xl dark:bg-white dark:text-slate-900">
      <span className="min-w-0">{t.text}</span>
      {t.action && <button className="shrink-0 font-semibold text-indigo-300 dark:text-indigo-600" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
    </div>)}
  </div>;
}

function localStorageGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
