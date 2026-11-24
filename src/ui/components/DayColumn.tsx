import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import type { Block } from '@engine/types';
import type { Band } from '@engine/week';
import { MIN, addDays, startOfDay, fmtTime } from '@engine/time';
import { previewMove } from '@engine/reflow';
import { blockStyle, cx, isOwn } from '../ui';

interface Props {
  day: number; items: Block[]; bands: Band[]; pxPerMin: number; compact?: boolean; now: number;
  onSelect: (b: Block) => void;
  onMove?: (b: Block, start: number, end: number) => void;
  onCreate?: (start: number) => void;
  onBandMove?: (kind: Band['kind'], start: number) => void;
  onBandTap?: (kind: Band['kind']) => void;
}
interface Drag { id: string; band?: Band['kind']; mode: 'move' | 'resize'; y0: number; s0: number; e0: number; s: number; e: number; active: boolean; touch: boolean; timer?: number }
const SNAP = 5 * MIN;
const BAND_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', sleep: 'Sleep' };

/** One day. Events are solid; meals and sleep are faint bands you can drag. */
export function DayColumn({ day, items, bands, pxPerMin, compact, now, onSelect, onMove, onCreate, onBandMove, onBandTap }: Props) {
  const d0 = startOfDay(day), d1 = addDays(d0, 1);
  const visible = useMemo(() => items.filter(b => !b.allDay && b.end > d0 && b.start < d1), [items, d0, d1]);
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
  const y = (t: number) => ((Math.min(Math.max(t, d0), d1) - d0) / MIN) * pxPerMin;
  const preview = drag?.active && !drag.band ? previewMove(visible, drag.id, drag.s, drag.e) : null;

  const begin = (e: React.PointerEvent, d: Omit<Drag, 'y0' | 'active' | 'touch' | 's' | 'e'>, draggable: boolean) => {
    e.stopPropagation(); clearTimeout(press.current);
    const touch = e.pointerType === 'touch';
    const nd: Drag = { ...d, y0: e.clientY, s: d.s0, e: d.e0, active: false, touch: touch || !draggable };
    if (draggable && touch) nd.timer = window.setTimeout(() => { if (ref.current?.id === d.id) { setDrag({ ...ref.current, active: true }); navigator.vibrate?.(8); } }, 300);
    if (draggable) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(nd);
  };
  const move = (e: React.PointerEvent) => {
    const d = ref.current; if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.active) { if (d.touch) { if (Math.abs(dy) > 8) { clearTimeout(d.timer); setDrag(null); } return; } if (Math.abs(dy) < 4) return; }
    const dt = Math.round((dy / pxPerMin) * MIN / SNAP) * SNAP;
    setDrag(d.mode === 'move' ? { ...d, s: d.s0 + dt, e: d.e0 + dt, active: true } : { ...d, e: Math.max(d.s0 + 10 * MIN, d.e0 + dt), active: true });
  };
  const end = (b?: Block) => {
    const d = ref.current; setDrag(null); if (!d) return;
    clearTimeout(d.timer);
    const moved = d.active && (d.s !== d.s0 || d.e !== d.e0);
    if (d.band) { if (moved) onBandMove?.(d.band, d.s); else if (!d.active) onBandTap?.(d.band); return; }
    if (!b) return;
    if (moved) onMove?.(b, d.s, d.e); else if (!d.active) onSelect(b);
  };

  return <div ref={col} className="relative select-none" style={{ height: 24 * 60 * pxPerMin }}
    onPointerDown={e => { if (!onCreate) return; const yy = e.clientY - col.current!.getBoundingClientRect().top; press.current = window.setTimeout(() => onCreate(d0 + Math.round(yy / pxPerMin / 15) * 15 * MIN), 550); }}
    onPointerUp={() => clearTimeout(press.current)} onPointerLeave={() => clearTimeout(press.current)} onPointerMove={() => clearTimeout(press.current)}>
    {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute inset-x-0 border-t border-line/50" style={{ top: h * 60 * pxPerMin }}>
      {!compact && <span className="absolute -top-2 left-0 bg-paper pr-1 text-[10px] tabular-nums text-muted">{h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}</span>}
    </div>)}

    {bands.map(band => {
      const isDrag = drag?.band === band.kind && drag.active;
      const s = isDrag ? drag!.s : band.start, e = isDrag ? drag!.e : band.end;
      if (e <= d0 || s >= d1) return null;
      const sleep = band.kind === 'sleep';
      return <div key={band.kind + band.start} aria-label={`${BAND_LABEL[band.kind]} ${fmtTime(band.start)}–${fmtTime(band.end)}`}
        onPointerDown={ev => begin(ev, { id: `band_${band.kind}_${band.start}`, band: band.kind, mode: 'move', s0: band.start, e0: band.end }, !sleep && !!onBandMove)}
        onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => setDrag(null)}
        className={cx('absolute rounded-sm', sleep ? 'hatch bg-linen/60' : 'bg-brass-soft/45', !sleep && onBandMove && 'cursor-grab', isDrag && 'ring-1 ring-brass')}
        style={{ top: y(s), height: Math.max(4, y(e) - y(s)), left: compact ? 0 : 30, right: 0 }}>
        {!compact && y(e) - y(s) > 14 && <span className="absolute right-2 top-0.5 text-[10px] text-muted/80">{BAND_LABEL[band.kind]}{isDrag ? ` ${fmtTime(s)}` : ''}</span>}
      </div>;
    })}

    {now >= d0 && now < d1 && <div className="pointer-events-none absolute inset-x-0 z-20 border-t border-clay" style={{ top: y(now) }}><span className="absolute -left-0.5 -top-[4px] h-2 w-2 rounded-full bg-clay" /></div>}

    {visible.map(b => {
      const isDrag = drag?.active && drag.id === b.id;
      const s = isDrag ? drag!.s : b.start, e = isDrag ? drag!.e : b.end;
      const height = Math.max(compact ? 5 : 18, y(e) - y(s));
      const lane = laneFor(b, visible); const gutter = compact ? 0 : 30;
      const own = isOwn(b) && !!onMove;
      return <div key={b.id} onPointerDown={ev => begin(ev, { id: b.id, mode: 'move', s0: b.start, e0: b.end }, own)} onPointerMove={move} onPointerUp={() => end(b)} onPointerCancel={() => { clearTimeout(ref.current?.timer); setDrag(null); }}
        className={cx('absolute z-10 overflow-hidden rounded-md border-l-[3px] px-1.5', blockStyle(b), compact ? 'text-[9px] leading-tight' : 'text-xs', isDrag && 'z-30 shadow-md', preview?.displaced.some(x => x.id === b.id) && 'ring-1 ring-clay', own && 'cursor-grab')}
        style={{ top: y(s), height, left: `calc(${gutter}px + ${lane.i} * (100% - ${gutter}px) / ${lane.n})`, width: `calc((100% - ${gutter}px) / ${lane.n} - 2px)` }}>
        <div className="flex items-center gap-1 pt-0.5">
          {!compact && b.fixed && !isOwn(b) && <Lock size={10} strokeWidth={2} className="shrink-0 opacity-50" />}
          <span className="truncate font-medium">{b.title}</span>
          {!compact && height <= 34 && height > 20 && <span className="ml-auto shrink-0 tabular-nums opacity-60">{fmtTime(s)}</span>}
        </div>
        {!compact && height > 34 && <div className="truncate tabular-nums opacity-60">{fmtTime(s)}–{fmtTime(e)}{b.location ? ` · ${b.location}` : ''}</div>}
        {!compact && own && height >= 32 && <div onPointerDown={ev => begin(ev, { id: b.id, mode: 'resize', s0: b.start, e0: b.end }, true)} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" aria-label="Resize" />}
      </div>;
    })}
    {drag?.active && !drag.band && !compact && <div className="pointer-events-none absolute right-1 z-40 rounded-md bg-ink px-2 py-1 text-[11px] text-paper" style={{ top: Math.max(0, y(drag.s) - 26) }}>
      {fmtTime(drag.s)}–{fmtTime(drag.e)}{preview?.hardConflicts.length ? ' · overlaps a fixed event' : ''}
    </div>}
  </div>;
}

function laneFor(b: Block, all: Block[]): { i: number; n: number } {
  const g = all.filter(x => x.start < b.end && b.start < x.end).sort((a, c) => a.start - c.start || a.id.localeCompare(c.id));
  return { i: Math.max(0, g.findIndex(x => x.id === b.id)), n: Math.max(1, g.length) };
}
