import { useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { fmtTime, at, startOfDay } from '@engine/time';

interface Props {
  bed: number;                 // minutes of day
  wake: number;
  onBed: (m: number) => void;
  onWake?: (m: number) => void; // omit to lock wake
  range?: number;              // ± minutes shown as a soft band around bedtime
  size?: number;
}

const SNAP = 5;
const toAngle = (m: number) => (m / 1440) * 2 * Math.PI - Math.PI / 2;
const pt = (m: number, r: number, c: number) => [c + r * Math.cos(toAngle(m)), c + r * Math.sin(toAngle(m))];
const span = (a: number, b: number) => ((b - a) % 1440 + 1440) % 1440;
const label = (m: number) => fmtTime(at(startOfDay(Date.now()), ((m % 1440) + 1440) % 1440));

/** A 24-hour dial. Drag the moon (bedtime) or sun (wake); hours update live. */
export function SleepDial({ bed, wake, onBed, onWake, range = 0, size = 260 }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<'bed' | 'wake' | null>(null);
  const c = size / 2, r = c - 28;
  const sleep = span(bed, wake);
  const arc = (a: number, b: number, rad: number) => {
    const [x1, y1] = pt(a, rad, c), [x2, y2] = pt(b, rad, c);
    return `M ${x1} ${y1} A ${rad} ${rad} 0 ${span(a, b) > 720 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const minutesAt = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const x = e.clientX - box.left - (box.width / 2), y = e.clientY - box.top - (box.height / 2);
    let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += 2 * Math.PI;
    return Math.round(((a / (2 * Math.PI)) * 1440) / SNAP) * SNAP % 1440;
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const m = minutesAt(e);
    if (drag === 'bed') onBed(m); else onWake?.(m);
  };
  const handle = (m: number, which: 'bed' | 'wake', Icon: typeof Moon, locked: boolean) => {
    const [x, y] = pt(m, r, c);
    return <g key={which} transform={`translate(${x} ${y})`} style={{ cursor: locked ? 'default' : 'grab' }}
      onPointerDown={e => { if (locked) return; e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(which); }}>
      <circle r={17} className={locked ? 'fill-linen stroke-line' : 'fill-card stroke-green'} strokeWidth={1.5} />
      <foreignObject x={-9} y={-9} width={18} height={18} style={{ pointerEvents: 'none' }}><Icon size={18} strokeWidth={1.75} className={locked ? 'text-muted' : 'text-green'} /></foreignObject>
    </g>;
  };
  const h = Math.floor(sleep / 60), m = sleep % 60;
  return <div className="flex flex-col items-center">
    <svg ref={ref} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-green/40"
      onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
      role="slider" aria-label="Bedtime" aria-valuetext={`Bed ${label(bed)}, wake ${label(wake)}`} tabIndex={0}
      onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onBed((bed + SNAP) % 1440); if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onBed((bed + 1440 - SNAP) % 1440); }}>
      <circle cx={c} cy={c} r={r} className="fill-none stroke-linen" strokeWidth={22} />
      {Array.from({ length: 24 }, (_, i) => { const [x1, y1] = pt(i * 60, r - 18, c), [x2, y2] = pt(i * 60, r - (i % 6 ? 22 : 26), c); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-line" strokeWidth={1} />; })}
      {[0, 6, 12, 18].map(hr => { const [x, y] = pt(hr * 60, r - 38, c); return <text key={hr} x={x} y={y + 4} textAnchor="middle" className="fill-muted text-[10px]">{['12a', '6a', '12p', '6p'][hr / 6]}</text>; })}
      {range > 0 && <path d={arc((bed - range + 1440) % 1440, (bed + range) % 1440, r)} className="fill-none stroke-brass/40" strokeWidth={22} strokeLinecap="round" />}
      <path d={arc(bed, wake, r)} className="fill-none stroke-green" strokeWidth={10} strokeLinecap="round" />
      {handle(wake, 'wake', Sun, !onWake)}
      {handle(bed, 'bed', Moon, false)}
      <text x={c} y={c - 4} textAnchor="middle" className="serif fill-ink text-[28px] font-semibold">{h}h{m ? ` ${m}m` : ''}</text>
      <text x={c} y={c + 18} textAnchor="middle" className="fill-muted text-[11px]">of sleep</text>
    </svg>
    <div className="mt-1 flex gap-6 text-sm"><span className="flex items-center gap-1.5"><Moon size={15} strokeWidth={1.75} className="text-green" />{label(bed)}</span><span className="flex items-center gap-1.5"><Sun size={15} strokeWidth={1.75} className="text-muted" />{label(wake)}</span></div>
  </div>;
}
