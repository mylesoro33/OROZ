import type { Block, Ms } from './types';
import { MIN, Interval, subtract, startOfDay, addDays, overlaps } from './time';

/** A sorted set of occupied blocks with free-slot queries. Pure and deterministic. */
export class Timeline {
  blocks: Block[];
  constructor(blocks: Block[]) { this.blocks = [...blocks].sort(cmpBlock); }

  add(b: Block) { this.blocks.push(b); this.blocks.sort(cmpBlock); }
  remove(id: string) { this.blocks = this.blocks.filter(b => b.id !== id); }

  /** Can [start,end) be placed, keeping `bufferMin` from non-sleep blocks? */
  isFree(start: Ms, end: Ms, bufferMin = 0, ignore?: (b: Block) => boolean): boolean {
    const buf = bufferMin * MIN;
    for (const b of this.blocks) {
      if (ignore?.(b)) continue;
      const pad = b.kind === 'sleep' || b.kind === 'travel' ? 0 : buf;
      if (start < b.end + pad && b.start - pad < end) return false;
    }
    return true;
  }

  free(range: Interval, bufferMin = 0, ignore?: (b: Block) => boolean): Interval[] {
    const buf = bufferMin * MIN;
    const busy = this.blocks.filter(b => !ignore?.(b)).map(b => {
      const pad = b.kind === 'sleep' || b.kind === 'travel' ? 0 : buf;
      return { start: b.start - pad, end: b.end + pad };
    });
    return subtract(range, busy);
  }

  /** Block that ends at/before t (closest), same day. */
  prevBlock(t: Ms): Block | undefined {
    let best: Block | undefined;
    for (const b of this.blocks) if (b.end <= t && b.kind !== 'sleep' && b.start >= startOfDay(t) - 6 * 3_600_000) { if (!best || b.end > best.end) best = b; }
    return best;
  }
  /** Where will you be at time t? The place of the latest block with a place that ended by t, same day. */
  placeAt(t: Ms, fallback?: string): string | undefined {
    let best: Block | undefined;
    for (const b of this.blocks) if (b.placeId && b.end <= t && b.kind !== 'sleep' && b.end >= startOfDay(t)) { if (!best || b.end > best.end) best = b; }
    return best?.placeId ?? fallback;
  }
  nextPlaced(t: Ms): Block | undefined {
    let best: Block | undefined;
    for (const b of this.blocks) if (b.placeId && b.start >= t && b.kind !== 'sleep' && b.start < startOfDay(t) + 86_400_000) { if (!best || b.start < best.start) best = b; }
    return best;
  }
  nextBlock(t: Ms): Block | undefined {
    let best: Block | undefined;
    for (const b of this.blocks) if (b.start >= t && b.kind !== 'sleep') { if (!best || b.start < best.start) best = b; }
    return best;
  }

  inRange(start: Ms, end: Ms): Block[] { return this.blocks.filter(b => overlaps(b, { start, end })); }

  /** Free waking minutes on the day of t (excludes sleep and all blocks). */
  freeMinutesOnDay(t: Ms, wakeStart: Ms, sleepStart: Ms): number {
    const day = { start: Math.max(startOfDay(t), wakeStart), end: Math.min(addDays(startOfDay(t), 1), sleepStart) };
    if (day.end <= day.start) return 0;
    return subtract(day, this.blocks.map(b => ({ start: b.start, end: b.end }))).reduce((s, i) => s + (i.end - i.start) / MIN, 0);
  }
}

export function cmpBlock(a: Block, b: Block): number {
  return a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Candidate start times on a 15-minute grid inside free intervals. */
export function candidateStarts(free: Interval[], durMin: number, stepMin = 15): Ms[] {
  const out: Ms[] = [];
  const step = stepMin * MIN, dur = durMin * MIN;
  for (const f of free) {
    let t = Math.ceil(f.start / step) * step;
    for (; t + dur <= f.end; t += step) out.push(t);
  }
  return out;
}
