import { useEffect, useRef, useState } from 'react';
import type { Block } from '@engine/types';
import { MIN, addDays, startOfDay, dayName } from '@engine/time';
import { useApp, store } from '../../data/store';
import * as A from '../../data/actions';
import { DayColumn } from '../components/DayColumn';
import { BlockSheet } from '../components/BlockSheet';
import { Btn, cx, useNow } from '../ui';
import { toast } from '../toast';

export function Week() {
  const blocks = useApp(s => s.blocks);
  const [start, setStart] = useState(startOfDay(Date.now()));
  const [sel, setSel] = useState<Block | null>(null);
  const now = useNow(60_000);
  const scroller = useRef<HTMLDivElement>(null);
  const px = 0.55;
  useEffect(() => { scroller.current?.scrollTo({ top: 7 * 60 * px }); }, []);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return <div className="flex h-full flex-col">
    <div className="flex items-center gap-2 px-3 pb-2">
      <Btn kind="ghost" onClick={() => setStart(addDays(start, -7))}>‹</Btn>
      <div className="flex-1 text-lg font-bold">Next 7 days</div>
      <Btn kind="primary" className="text-xs" onClick={() => { A.runPlan('week'); toast('Week re-planned', { label: 'Undo', run: () => store().undo() }); }}>✨ Plan my week</Btn>
      <Btn kind="ghost" onClick={() => setStart(addDays(start, 7))}>›</Btn>
    </div>
    <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-0.5 px-1 text-center text-[11px] font-semibold">
      <span />
      {days.map(d => <span key={d} className={cx('rounded py-0.5', d === startOfDay(now) && 'bg-indigo-600 text-white')}>{dayName(d)} {new Date(d).getDate()}</span>)}
    </div>
    <div ref={scroller} className="flex-1 overflow-y-auto px-1 pb-40">
      <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-0.5">
        <div className="relative" style={{ height: 24 * 60 * px }}>{Array.from({ length: 24 }, (_, h) => <span key={h} className="absolute right-0.5 text-[9px] text-slate-400" style={{ top: h * 60 * px - 5 }}>{h % 12 || 12}{h < 12 ? 'a' : 'p'}</span>)}</div>
        {days.map(d => <div key={d} className="border-l border-slate-200/70 dark:border-white/5">
          <DayColumn compact day={d} blocks={blocks} pxPerMin={px} now={now} onSelect={setSel}
            onMove={(b, s, e) => { A.moveBlock(b.id, s, e); toast(`Moved ${b.title}`, { label: 'Undo', run: () => store().undo() }); }}
            onCreate={s => setSel(A.createBlock({ title: 'New block', start: s, end: s + 30 * MIN }))} />
        </div>)}
      </div>
    </div>
    <BlockSheet block={sel} onClose={() => setSel(null)} />
  </div>;
}
