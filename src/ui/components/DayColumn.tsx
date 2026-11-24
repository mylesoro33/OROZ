import { useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '@engine/types';
import { MIN, HOUR, addDays, startOfDay, fmtTime } from '@engine/time';
import { previewMove } from '@engine/reflow';
import { blockStyle, cx, isImported } from '../ui';

interface Props {
  day: number;
  blocks: Block[];          // all blocks (filtered to this day inside)
  pxPerMin: number;
  compact?: boolean;
  now: number;
  onSelect: (b: Block) => void;
  onMove: (b: Block, start: number, end: number, displaced: number) => void;
  onCreate: (start: number) => void;
}

interface Drag { id: string; mode: 'move' | 'resize'; y0: number; s0: number; e0: number; s: number; e: number; active: boolean; pointer: string; timer?: number }

const SNAP = 5 * MIN;

export function DayColumn({ day, blocks, pxPerMin, compact, now, onSelect, onMove, onCreate }: Props) {
  const d0 = startOfDay(day), d1 = addDays(d0, 1);
  const visible = useMemo(() => blocks.filter(b => b.end > d0 && b.start < d1), [blocks, d0, d1]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const colRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ t?: number; y: number; x: number } | null>(null);

  // Block page scroll while a touch drag is active (needs a non-passive listener).
  useEffect(() => {
    const el = colRef.current; if (!el) return;
    const stop = (e: TouchEvent) => { if (dragRef.current?.active) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

  const preview = useMemo(() => (drag?.active ? previewMove(blocks, drag.id, drag.s, drag.e) : null), [drag, blocks]);
  const displacedIds = new Set(preview?.displaced.map(b => b.id));
  const hardIds = new Set(preview?.hardConflicts.map(b => b.id));

  const y = (t: number) => ((Math.max(t, d0) - d0) / MIN) * pxPerMin;
  const h = (b: Block) => Math.max(compact ? 6 : 14, ((Math.min(b.end, d1) - Math.max(b.start, d0)) / MIN) * pxPerMin);

  const down = (e: React.PointerEvent, b: Block, mode: Drag['mode']) => {
    e.stopPropagation();
    if (isImported(b) || b.kind === 'sleep') { press.current = null; return; }
    const d: Drag = { id: b.id, mode, y0: e.clientY, s0: b.start, e0: b.end, s: b.start, e: b.end, active: false, pointer: e.pointerType };
    if (e.pointerType === 'touch' || mode === 'resize') {
      d.timer = window.setTimeout(() => { if (dragRef.current?.id === b.id) { setDrag({ ...dragRef.current, active: true }); navigator.vibrate?.(10); } }, mode === 'resize' ? 120 : 280);
    }
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(d);
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (d.pointer === 'touch') { if (Math.abs(dy) > 8) { clearTimeout(d.timer); setDrag(null); } return; }
      if (Math.abs(dy) < 4) return;
      d.active = true;
    }
    const dt = Math.round((dy / pxPerMin) * MIN / SNAP) * SNAP;
    if (d.mode === 'move') setDrag({ ...d, s: d.s0 + dt, e: d.e0 + dt, active: true });
    else setDrag({ ...d, e: Math.max(d.s0 + 10 * MIN, d.e0 + dt), active: true });
  };
  const up = (b: Block) => {
    const d = dragRef.current; if (!d) { onSelect(b); return; }
    clearTimeout(d.timer);
    setDrag(null);
    if (d.active && (d.s !== d.s0 || d.e !== d.e0)) onMove(b, d.s, d.e, previewMove(blocks, d.id, d.s, d.e).displaced.length);
    else if (!d.active) onSelect(b);
  };

  // long-press on empty space → create
  const bgDown = (e: React.PointerEvent) => {
    const rect = colRef.current!.getBoundingClientRect();
    const yy = e.clientY - rect.top;
    press.current = { y: yy, x: e.clientX, t: window.setTimeout(() => {
      const t = d0 + Math.round((yy / pxPerMin) / 15) * 15 * MIN;
      navigator.vibrate?.(15); onCreate(t); press.current = null;
    }, 500) };
  };
  const bgCancel = () => { if (press.current?.t) clearTimeout(press.current.t); press.current = null; };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  return <div ref={colRef} className="relative select-none" style={{ height: 24 * 60 * pxPerMin }}
    onPointerDown={bgDown} onPointerUp={bgCancel} onPointerLeave={bgCancel} onPointerCancel={bgCancel}
    onPointerMove={e => { if (press.current && Math.abs(e.clientY - (colRef.current!.getBoundingClientRect().top + press.current.y)) > 8) bgCancel(); }}>
    {hours.map(hr => <div key={hr} className="absolute inset-x-0 border-t border-slate-200/80 dark:border-white/5" style={{ top: hr * 60 * pxPerMin }}>
      {!compact && <span className="absolute -top-2 left-0 bg-slate-50 pr-1 text-[10px] tabular-nums text-slate-400 dark:bg-[#0b0b12]">{hr === 0 ? '12am' : hr < 12 ? `${hr}am` : hr === 12 ? '12pm' : `${hr - 12}pm`}</span>}
    </div>)}
    {now >= d0 && now < d1 && <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-rose-500" style={{ top: y(now) }}><span className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-rose-500" /></div>}
    {visible.map(b => {
      const isDrag = drag?.active && drag.id === b.id;
      const top = isDrag ? y(drag!.s) : y(b.start);
      const height = isDrag ? ((drag!.e - drag!.s) / MIN) * pxPerMin : h(b);
      const locked = isImported(b) || b.kind === 'sleep';
      const lane = laneFor(b, visible);
      return <div key={b.id}
        onPointerDown={e => down(e, b, 'move')} onPointerMove={move} onPointerUp={() => up(b)} onPointerCancel={() => { clearTimeout(dragRef.current?.timer); setDrag(null); }}
        onClick={e => e.stopPropagation()}
        className={cx('absolute overflow-hidden rounded-lg px-1.5 text-left shadow-sm', blockStyle(b), compact ? 'text-[9px] leading-tight' : 'text-xs',
          isDrag && 'z-30 scale-[1.02] shadow-2xl ring-2 ring-white', displacedIds.has(b.id) && 'ring-2 ring-amber-400', hardIds.has(b.id) && 'ring-2 ring-rose-500',
          !locked && 'cursor-grab', b.kind === 'sleep' && 'opacity-70')}
        style={{ top, height, left: `calc(${compact ? 0 : 34}px + ${lane.i} * (100% - ${compact ? 0 : 34}px) / ${lane.n})`, width: `calc((100% - ${compact ? 0 : 34}px) / ${lane.n} - 2px)` }}
        title={b.reason}>
        <div className="flex items-start gap-1 pt-0.5">
          {locked && !compact && <span aria-label="fixed">🔒</span>}
          <span className="truncate font-semibold">{b.status === 'active' && '▶ '}{b.title}</span>
        </div>
        {!compact && height > 28 && <div className="truncate opacity-80">{fmtTime(isDrag ? drag!.s : b.start)}–{fmtTime(isDrag ? drag!.e : b.end)}{b.reason && b.source === 'planner' && height > 44 ? ` · ${b.reason}` : ''}</div>}
        {!locked && !compact && height >= 30 && <div onPointerDown={e => down(e, b, 'resize')} className="absolute inset-x-0 bottom-0 h-2.5 cursor-ns-resize" aria-label="Resize"><div className="mx-auto mt-1 h-0.5 w-6 rounded bg-white/70" /></div>}
      </div>;
    })}
    {drag?.active && preview && !compact && <div className="pointer-events-none absolute right-1 z-40 rounded-lg bg-black/80 px-2 py-1 text-[11px] text-white" style={{ top: Math.max(0, y(drag.s) - 26) }}>
      {fmtTime(drag.s)}–{fmtTime(drag.e)}{preview.displaced.length ? ` · bumps ${preview.displaced.length}` : ''}{preview.hardConflicts.length ? ' · ⚠ overlaps a fixed event' : ''}
    </div>}
  </div>;
}

/** Simple overlap lanes so concurrent blocks sit side by side. */
function laneFor(b: Block, all: Block[]): { i: number; n: number } {
  if (b.kind === 'sleep') return { i: 0, n: 1 };
  const group = all.filter(x => x.kind !== 'sleep' && x.start < b.end && b.start < x.end).sort((a, c) => a.start - c.start || a.id.localeCompare(c.id));
  return { i: Math.max(0, group.findIndex(x => x.id === b.id)), n: Math.max(1, group.length) };
}

export const HOUR_PX = (pxPerMin: number) => 60 * pxPerMin;
export { HOUR };
