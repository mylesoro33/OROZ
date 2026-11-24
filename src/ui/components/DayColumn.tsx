import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import type { Block } from '@engine/types';
import { MIN, addDays, startOfDay, fmtTime } from '@engine/time';
import { previewMove } from '@engine/reflow';
import { blockStyle, cx, isOwn } from '../ui';

interface Props {
  day: number; blocks: Block[]; pxPerMin: number; compact?: boolean; now: number;
  onSelect: (b: Block) => void;
  onMove?: (b: Block, start: number, end: number) => void;
  onCreate?: (start: number) => void;
}
interface Drag { id: string; mode: 'move' | 'resize'; y0: number; s0: number; e0: number; s: number; e: number; active: boolean; touch: boolean; timer?: number }
const SNAP = 5 * MIN;

/** One day's timeline. Drag your own blocks to move, drag the bottom edge to resize, long-press empty space to add. */
export function DayColumn({ day, blocks, pxPerMin, compact, now, onSelect, onMove, onCreate }: Props) {
  const d0 = startOfDay(day), d1 = addDays(d0, 1);
  const visible = useMemo(() => blocks.filter(b => !b.allDay && b.end > d0 && b.start < d1), [blocks, d0, d1]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const ref = useRef<Drag | null>(null); ref.current = drag;
  const col = useRef<HTMLDivElement>(null);
  const press = useRef<number | undefined>(undefined);
  useEffect(() => {
    const el = col.current; if (!el) return;
    const stop = (e: TouchEvent) => { if (ref.current?.active) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);
  const preview = drag?.active ? previewMove(visible, drag.id, drag.s, drag.e) : null;
  const y = (t: number) => ((Math.max(t, d0) - d0) / MIN) * pxPerMin;

  const down = (e: React.PointerEvent, b: Block, mode: Drag['mode']) => {
    e.stopPropagation();
    if (!onMove || !isOwn(b)) { setDrag({ id: b.id, mode, y0: e.clientY, s0: b.start, e0: b.end, s: b.start, e: b.end, active: false, touch: true }); return; }
    const touch = e.pointerType === 'touch';
    const d: Drag = { id: b.id, mode, y0: e.clientY, s0: b.start, e0: b.end, s: b.start, e: b.end, active: false, touch };
    if (touch) d.timer = window.setTimeout(() => { if (ref.current?.id === b.id) { setDrag({ ...ref.current, active: true }); navigator.vibrate?.(8); } }, 300);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(d);
  };
  const move = (e: React.PointerEvent) => {
    const d = ref.current; if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.active) { if (d.touch) { if (Math.abs(dy) > 8) { clearTimeout(d.timer); setDrag(null); } return; } if (Math.abs(dy) < 4) return; }
    const dt = Math.round((dy / pxPerMin) * MIN / SNAP) * SNAP;
    setDrag(d.mode === 'move' ? { ...d, s: d.s0 + dt, e: d.e0 + dt, active: true } : { ...d, e: Math.max(d.s0 + 10 * MIN, d.e0 + dt), active: true });
  };
  const up = (b: Block) => {
    const d = ref.current; setDrag(null);
    if (!d) return;
    clearTimeout(d.timer);
    if (d.active && (d.s !== d.s0 || d.e !== d.e0)) onMove?.(b, d.s, d.e); else if (!d.active) onSelect(b);
  };

  return <div ref={col} className="relative select-none" style={{ height: 24 * 60 * pxPerMin }}
    onPointerDown={e => { if (!onCreate) return; const yy = e.clientY - col.current!.getBoundingClientRect().top; press.current = window.setTimeout(() => onCreate(d0 + Math.round(yy / pxPerMin / 15) * 15 * MIN), 550); }}
    onPointerUp={() => clearTimeout(press.current)} onPointerLeave={() => clearTimeout(press.current)} onPointerMove={() => clearTimeout(press.current)}>
    {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute inset-x-0 border-t border-line/60" style={{ top: h * 60 * pxPerMin }}>
      {!compact && <span className="absolute -top-2 left-0 bg-paper pr-1 text-[10px] tabular-nums text-muted">{h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}</span>}
    </div>)}
    {now >= d0 && now < d1 && <div className="pointer-events-none absolute inset-x-0 z-20 border-t border-clay" style={{ top: y(now) }}><span className="absolute -left-0.5 -top-[4px] h-2 w-2 rounded-full bg-clay" /></div>}
    {visible.map(b => {
      const isDrag = drag?.active && drag.id === b.id;
      const top = isDrag ? y(drag!.s) : y(b.start);
      const height = Math.max(compact ? 5 : 16, (((isDrag ? drag!.e : Math.min(b.end, d1)) - (isDrag ? drag!.s : Math.max(b.start, d0))) / MIN) * pxPerMin);
      const lane = laneFor(b, visible);
      const gutter = compact ? 0 : 30;
      return <div key={b.id} onPointerDown={e => down(e, b, 'move')} onPointerMove={move} onPointerUp={() => up(b)} onPointerCancel={() => { clearTimeout(ref.current?.timer); setDrag(null); }}
        className={cx('absolute overflow-hidden rounded-md border-l-[3px] px-1.5', blockStyle(b), compact ? 'text-[9px] leading-tight' : 'text-xs',
          isDrag && 'z-30 shadow-md', preview?.displaced.some(x => x.id === b.id) && 'ring-1 ring-clay', isOwn(b) && onMove && 'cursor-grab')}
        style={{ top, height, left: `calc(${gutter}px + ${lane.i} * (100% - ${gutter}px) / ${lane.n})`, width: `calc((100% - ${gutter}px) / ${lane.n} - 2px)` }}>
        <div className="flex items-center gap-1 pt-0.5">
          {!compact && b.fixed && b.kind !== 'sleep' && !isOwn(b) && <Lock size={10} strokeWidth={2} className="shrink-0 opacity-60" />}
          <span className="truncate font-medium">{b.title}</span>
          {!compact && height > 22 && height <= 34 && <span className="ml-auto shrink-0 tabular-nums opacity-70">{fmtTime(isDrag ? drag!.s : b.start)}</span>}
        </div>
        {!compact && height > 34 && <div className="truncate tabular-nums opacity-70">{fmtTime(isDrag ? drag!.s : b.start)}–{fmtTime(isDrag ? drag!.e : b.end)}</div>}
        {!compact && onMove && isOwn(b) && height >= 32 && <div onPointerDown={e => down(e, b, 'resize')} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" aria-label="Resize" />}
      </div>;
    })}
    {drag?.active && preview && !compact && <div className="pointer-events-none absolute right-1 z-40 rounded-md bg-ink px-2 py-1 text-[11px] text-paper" style={{ top: Math.max(0, y(drag.s) - 26) }}>
      {fmtTime(drag.s)}–{fmtTime(drag.e)}{preview.displaced.length ? ` · overlaps ${preview.displaced.length}` : ''}{preview.hardConflicts.length ? ' · fixed event' : ''}
    </div>}
  </div>;
}

function laneFor(b: Block, all: Block[]): { i: number; n: number } {
  if (b.kind === 'sleep') return { i: 0, n: 1 };
  const g = all.filter(x => x.kind !== 'sleep' && x.start < b.end && b.start < x.end).sort((a, c) => a.start - c.start || a.id.localeCompare(c.id));
  return { i: Math.max(0, g.findIndex(x => x.id === b.id)), n: Math.max(1, g.length) };
}
