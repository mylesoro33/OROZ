import type { Block, Ms } from './types';
import { MIN, Interval, subtract } from './time';

/** Sorted occupied blocks with free-slot queries. Pure and deterministic. */
export class Timeline {
  blocks: Block[];
  constructor(blocks: Block[]) { this.blocks = blocks.filter(b => !b.allDay).sort(cmpBlock); }
  add(b: Block) { this.blocks.push(b); this.blocks.sort(cmpBlock); }
  isFree(start: Ms, end: Ms, bufferMin = 0): boolean {
    const buf = bufferMin * MIN;
    return this.blocks.every(b => { const pad = b.kind === 'sleep' ? 0 : buf; return !(start < b.end + pad && b.start - pad < end); });
  }
  free(range: Interval, bufferMin = 0): Interval[] {
    const buf = bufferMin * MIN;
    return subtract(range, this.blocks.map(b => { const pad = b.kind === 'sleep' ? 0 : buf; return { start: b.start - pad, end: b.end + pad }; }));
  }
}

export function cmpBlock(a: Block, b: Block): number {
  return a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Candidate start times on a grid inside free intervals. */
export function candidateStarts(free: Interval[], durMin: number, stepMin = 15): Ms[] {
  const out: Ms[] = []; const step = stepMin * MIN, dur = durMin * MIN;
  for (const f of free) for (let t = Math.ceil(f.start / step) * step; t + dur <= f.end; t += step) out.push(t);
  return out;
}
