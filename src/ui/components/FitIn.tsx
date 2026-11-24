import { suggestSlots } from '@engine/week';
import { fmtDay, fmtTime, startOfDay } from '@engine/time';
import { useApp, store } from '../../data/store';
import { Chip } from '../ui';
import { toast } from '../toast';

/** Tap a suggested open time to put a flexible to-do on the calendar. */
export function FitIn({ taskId, onDone }: { taskId: string; onDone?: () => void }) {
  const st = useApp(s => s);
  const t = st.tasks.find(x => x.id === taskId);
  if (!t) return null;
  const slots = suggestSlots(t, { blocks: st.blocks, tasks: st.tasks, settings: st.settings, places: st.places, now: Date.now() });
  if (!slots.length) return <p className="text-sm text-muted">No open time before {t.by ? fmtDay(t.by - 1) : 'next week'}.</p>;
  return <div>
    <p className="mb-2 text-xs text-muted">Open times</p>
    <div className="flex flex-col gap-1.5">{slots.map(s => <Chip key={s.start} className="justify-between py-2" onClick={() => {
      store().checkpoint(); store().upsert('tasks', [{ ...t, at: s.start, date: startOfDay(s.start) }]);
      toast(`${t.title}, ${fmtDay(s.start, Date.now())} ${fmtTime(s.start)}`, { label: 'Undo', run: () => store().undo() }); onDone?.();
    }}><span>{fmtDay(s.start, Date.now()).replace(/^./, c => c.toUpperCase())} · {fmtTime(s.start)}</span><span className="font-normal text-muted">{s.why}</span></Chip>)}</div>
  </div>;
}
