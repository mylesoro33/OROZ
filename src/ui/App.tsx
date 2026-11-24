import { useEffect } from 'react';
import { CalendarDays, ListTodo, MessageCircle, Settings2 } from 'lucide-react';
import { useApp } from '../data/store';
import { useNav, go, type Tab } from './nav';
import { Setup } from './components/Setup';
import { Schedule } from './views/Schedule';
import { Todo } from './views/Todo';
import { Chat } from './views/Chat';
import { Settings } from './views/Settings';
import { cx } from './ui';
import { useToasts, dismissToast, clearToasts } from './toast';

const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: 'schedule', label: 'Schedule', icon: CalendarDays },
  { key: 'todo', label: 'To-Do', icon: ListTodo },
  { key: 'oroz', label: 'OROZ', icon: MessageCircle },
  { key: 'settings', label: 'Settings', icon: Settings2 },
];

export function App() {
  const { tab } = useNav();
  const theme = useApp(s => s.settings.theme);
  const setupDone = useApp(s => s.profile.setupDone);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
    apply(); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [theme]);

  return <div className="mx-auto flex h-full max-w-2xl flex-col">
    <div className="safe-top h-5 shrink-0" />
    <main className="min-h-0 flex-1">
      {tab === 'schedule' && <Schedule />}{tab === 'todo' && <Todo />}{tab === 'oroz' && <Chat />}{tab === 'settings' && <Settings />}
    </main>
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto grid max-w-2xl grid-cols-4">{TABS.map(t => { const I = t.icon; const on = tab === t.key; return <button key={t.key} onClick={() => { clearToasts(); go({ tab: t.key }); }} aria-current={on ? 'page' : undefined}
        className={cx('flex h-[64px] flex-col items-center justify-center gap-1 text-[11px] transition-colors', on ? 'text-green' : 'text-muted')}>
        <I size={21} strokeWidth={on ? 1.9 : 1.5} /><span className={t.key === 'oroz' ? 'tracking-widest' : ''}>{t.label}</span>
      </button>; })}</div>
    </nav>
    <Toasts />
    {!setupDone && <Setup onDone={() => go({ tab: 'schedule' })} />}
  </div>;
}

function Toasts() {
  const ts = useToasts();
  return <div className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[70] flex flex-col items-center gap-2 px-4">
    {ts.map(t => <div key={t.id} className="rise pointer-events-auto flex max-w-md items-center gap-4 rounded-lg bg-ink px-4 py-2.5 text-sm text-paper shadow-md">
      <span className="min-w-0">{t.text}</span>
      {t.action && <button className="shrink-0 font-medium text-brass" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
    </div>)}
  </div>;
}
