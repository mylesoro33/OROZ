import { useEffect } from 'react';
import { CalendarDays, ListTodo, UserRound, Settings as Gear } from 'lucide-react';
import { useApp } from '../data/store';
import { refreshWeather } from '../integrations/weather';
import { useNav, go, type Tab } from './nav';
import { Setup } from './components/Setup';
import { TalkButton, TalkSheet } from './components/Talk';
import { Schedule } from './views/Schedule';
import { Todo } from './views/Todo';
import { Profile } from './views/Profile';
import { SettingsPage } from './views/Settings';
import { cx } from './ui';
import { useToasts, dismissToast, clearToasts } from './toast';

const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: 'schedule', label: 'Schedule', icon: CalendarDays },
  { key: 'todo', label: 'To-Do', icon: ListTodo },
  { key: 'profile', label: 'Profile', icon: UserRound },
];

export function App() {
  const nav = useNav();
  const theme = useApp(s => s.settings.theme);
  const setupDone = useApp(s => s.profile.setupDone);
  const city = useApp(s => s.profile.city);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
    apply(); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { void refreshWeather(); }, [city]);

  return <div className="mx-auto flex h-full max-w-2xl flex-col">
    <div className="safe-top h-5 shrink-0" />
    <button aria-label="Settings" onClick={() => go({ settings: true })} className="fixed right-[max(1rem,calc(50%-21rem+1rem))] top-[calc(env(safe-area-inset-top)+1.25rem)] z-30 rounded-full p-2 text-muted hover:text-ink"><Gear size={20} strokeWidth={1.6} /></button>
    <main className="min-h-0 flex-1">{nav.tab === 'schedule' && <Schedule />}{nav.tab === 'todo' && <Todo />}{nav.tab === 'profile' && <Profile />}</main>
    {nav.tab !== 'profile' && <TalkButton />}
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto grid max-w-2xl grid-cols-3">{TABS.map(t => { const I = t.icon; const on = nav.tab === t.key; return <button key={t.key} onClick={() => { clearToasts(); go({ tab: t.key }); }} aria-current={on ? 'page' : undefined}
        className={cx('flex h-[62px] flex-col items-center justify-center gap-1 text-[11px] transition-colors', on ? 'text-green' : 'text-muted')}><I size={21} strokeWidth={on ? 1.9 : 1.5} />{t.label}</button>; })}</div>
    </nav>
    <Toasts />
    <TalkSheet />
    <SettingsPage />
    {!setupDone && <Setup onDone={() => go({ tab: 'schedule' })} />}
  </div>;
}

function Toasts() {
  const ts = useToasts();
  return <div className="pointer-events-none fixed inset-x-0 bottom-[146px] z-[70] flex flex-col items-center gap-2 px-4">
    {ts.map(t => <div key={t.id} className="rise pointer-events-auto flex max-w-md items-center gap-4 rounded-lg bg-ink px-4 py-2.5 text-sm text-paper shadow-md">
      <span className="min-w-0">{t.text}</span>
      {t.action && <button className="shrink-0 font-medium text-brass" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
    </div>)}
  </div>;
}
