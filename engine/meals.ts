import type { Block, Ms, MealSlot, MealType } from './types';
import { Timeline, candidateStarts } from './timeline';
import { at, MIN, HOUR, fmtTime, hashId, startOfDay, fmtDur } from './time';

const LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

/** Place each meal near the middle of its window, reflowing around fixed events. Mutates `tl`. */
export function placeMeals(day: Ms, meals: MealSlot[], tl: Timeline, earliest: Ms): { blocks: Block[]; warnings: string[] } {
  const d0 = startOfDay(day); const blocks: Block[] = []; const warnings: string[] = [];
  for (const slot of meals) {
    if (tl.blocks.some(b => b.mealType === slot.type && startOfDay(b.start) === d0)) continue;
    const ws = at(d0, slot.window[0]), we = at(d0, slot.window[1]);
    const center = ws + (we - ws) / 2;
    const tryPlace = (from: Ms, to: Ms, dur: number) => {
      const starts = candidateStarts(tl.free({ start: Math.max(from, earliest), end: to }), dur, 5);
      return starts.length ? starts.reduce((b, s) => (Math.abs(s - center) < Math.abs(b - center) ? s : b)) : undefined;
    };
    let dur = slot.durationMin, reason = 'Your usual window';
    let s = tryPlace(ws, we, dur);
    if (s === undefined) { dur = slot.minDurationMin; s = tryPlace(ws, we, dur); reason = 'Short — tight window'; }
    if (s === undefined) { s = tryPlace(ws - 90 * MIN, we + 90 * MIN, dur); if (s !== undefined) reason = 'Moved — your window is booked'; }
    if (s === undefined) { warnings.push(`No time for ${slot.type}. Pack something.`); continue; }
    const b: Block = { id: `meal_${slot.type}_${hashId(String(d0))}`, title: LABEL[slot.type], kind: 'meal', mealType: slot.type, start: s, end: s + dur * MIN, fixed: false, source: 'manual', derived: true, reason };
    tl.add(b); blocks.push(b);
  }
  return { blocks, warnings };
}

/** A long stretch without food (e.g. late practice) gets a snack just before the longest fixed block. */
export function gapSnacks(day: Ms, meals: MealSlot[], tl: Timeline, wake: Ms, bed: Ms, maxGapMin = 300): Block[] {
  const d0 = startOfDay(day);
  const eats = tl.blocks.filter(b => b.mealType && b.start >= wake && b.start < bed).map(b => ({ t: b.start, end: b.end }));
  const points = [{ t: wake, end: wake }, ...eats.sort((a, b) => a.t - b.t), { t: bed, end: bed }];
  const out: Block[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i].end, b = points[i + 1].t;
    if (b - a <= maxGapMin * MIN || (i === points.length - 2 && b - a <= (maxGapMin + 120) * MIN)) continue;
    const anchor = tl.blocks.filter(x => x.fixed && x.kind !== 'sleep' && x.start > a && x.start < b).sort((x, y) => (y.end - y.start) - (x.end - x.start))[0];
    const target = anchor && anchor.end - anchor.start >= HOUR ? anchor.start - 20 * MIN : a + maxGapMin * 0.6 * MIN;
    const starts = candidateStarts(tl.free({ start: a + HOUR, end: b - HOUR }), 15, 5);
    if (!starts.length) continue;
    const s = starts.reduce((best, x) => (Math.abs(x - target) < Math.abs(best - target) ? x : best));
    const snack: Block = { id: `snack_${hashId(`${d0}_${a}`)}`, title: anchor ? `Snack before ${anchor.title}` : 'Snack', kind: 'meal', mealType: 'snack', start: s, end: s + 15 * MIN, fixed: false, source: 'manual', derived: true, reason: `${fmtDur((b - a) / MIN)} without food (${fmtTime(a)}–${fmtTime(b)})` };
    tl.add(snack); out.push(snack);
  }
  void meals;
  return out;
}
