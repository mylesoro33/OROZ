import type { Block, Task, Routine, Activity, Settings, Place, TravelTime, Habit, Ms, ID, Weights } from './types';
import { Timeline, candidateStarts } from './timeline';
import { MIN, DAY, HOUR, at, addDays, startOfDay, fmtTime, fmtDay, dayName, hashId, parseHM, weekday, minutesOfDay, overlaps, fmtDur } from './time';
import { sleepForNight } from './sleep';
import { placeMealsForDay, detectMealGaps } from './meals';
import { placeForTag, travelMinutes } from './location';

export interface PlanInput {
  now: Ms;
  rangeStart: Ms;
  rangeEnd: Ms;
  blocks: Block[];
  tasks: Task[];
  routines?: Routine[];
  activities?: Activity[];
  settings: Settings;
  places?: Place[];
  travel?: TravelTime[];
  habits?: Habit[];
  energy?: number[];          // learned by-hour energy, overrides settings
  currentPlaceId?: ID;
  /** Re-plan: drop future planner-made movable blocks in range and place again. Default true. */
  replan?: boolean;
}

export interface Unplaced { id: ID; title: string; reason: string }
export interface ScoreBreakdown { total: number; parts: Record<string, number> }
export interface PlanResult {
  blocks: Block[];       // full resulting set (sorted)
  added: Block[];
  removed: ID[];
  unplaced: Unplaced[];
  warnings: string[];
  debug: { taskId: ID; start: Ms; score: ScoreBreakdown }[];
}

const isPlannerFlexible = (b: Block) => b.source === 'planner' && b.flexibility !== 'fixed' && b.status !== 'done' && b.status !== 'active';

export function plan(input: PlanInput): PlanResult {
  const { now, settings } = input;
  const places = input.places ?? [], travel = input.travel ?? [];
  const energy = input.energy ?? settings.energyByHour;
  const W = settings.weights;
  const rangeStart = Math.max(input.rangeStart, now);
  const rangeEnd = input.rangeEnd;
  const warnings: string[] = [], unplaced: Unplaced[] = [], debug: PlanResult['debug'] = [];

  // 1. Keep everything except future planner-made flexible blocks (those get re-placed).
  const replan = input.replan !== false;
  const removed: ID[] = [];
  const keep = input.blocks.filter(b => {
    const plannerSleep = b.kind === 'sleep' && b.source === 'planner' && b.end > rangeStart - DAY && b.start < rangeEnd;
    const drop = replan && ((isPlannerFlexible(b) && b.start >= rangeStart && b.start < rangeEnd) || plannerSleep);
    if (drop) removed.push(b.id);
    return !drop;
  });
  const tl = new Timeline(keep);
  const added: Block[] = [];
  const push = (b: Block) => { tl.add(b); added.push(b); };

  // 2. Protected sleep for every night touching the range.
  const days: Ms[] = [];
  for (let d = startOfDay(rangeStart); d < rangeEnd; d = addDays(d, 1)) days.push(d);
  const fixed = keep.filter(b => b.flexibility === 'fixed');
  const sleepByNight = new Map<Ms, Block>();
  for (const d of [addDays(days[0] ?? startOfDay(rangeStart), -1), ...days]) {
    const existing = tl.blocks.find(b => b.kind === 'sleep' && startOfDay(b.start - 12 * HOUR) === d);
    if (existing) { sleepByNight.set(d, existing); continue; }
    const { block, warning } = sleepForNight(d, settings, fixed);
    if (warning && d >= startOfDay(rangeStart)) warnings.push(warning);
    if (block.end > rangeStart - DAY) { push(block); sleepByNight.set(d, block); }
  }
  const wakeOf = (d: Ms) => sleepByNight.get(addDays(d, -1))?.end ?? at(d, settings.wake);
  const bedOf = (d: Ms) => sleepByNight.get(d)?.start ?? at(d, settings.bedtime);

  // 3. Meals (protected, reflowed around fixed events) + gap snacks.
  for (const d of days) {
    const r = placeMealsForDay(d, settings, tl, rangeStart, wakeOf(d));
    added.push(...r.blocks); warnings.push(...r.warnings);
  }

  // 4b. Learned holds: a confident nap habit gets its usual slot (optional, so work can't take it silently).
  const nap = (input.habits ?? []).find(h => h.key === 'hobby:nap' && h.confidence >= 0.5 && h.status !== 'learned' || h.key === 'hobby:nap' && h.confidence >= 0.6);
  if (nap) for (const d of days) {
    if (!nap.weekdays.includes(weekday(d))) continue;
    if (tl.blocks.some(b => (b.kind === 'nap' || b.activityId === 'nap') && startOfDay(b.start) === d)) continue;
    const want = at(d, nap.windowStart), len = nap.durationMin * MIN;
    for (const off of [0, 15, -15, 30, -30]) {
      const s = want + off * MIN;
      if (s >= rangeStart && tl.isFree(s, s + len, 5)) {
        push({ id: `nap_${hashId(String(d))}`, title: `Nap (${nap.durationMin}m)`, kind: 'nap', start: s, end: s + len, flexibility: 'optional', source: 'planner', importance: 'passive', reason: `You usually nap around ${fmtTime(want)} on ${dayName(d)}s (${Math.round(nap.confidence * 100)}% confident)` });
        break;
      }
    }
  }

  // 4. Routines.
  for (const d of days) for (const r of input.routines ?? []) {
    if (!r.days.includes(weekday(d))) continue;
    if (tl.blocks.some(b => b.activityId === r.id && startOfDay(b.start) === d)) continue;
    const b = placeRoutine(r, d, tl, rangeStart, settings);
    if (b) push(b);
    else if (r.flexibility !== 'optional') warnings.push(`Couldn't fit ${r.title} on ${dayName(d)}.`);
  }

  // 4c. Gap snacks go in after holds and routines so they work around them.
  for (const d of days) added.push(...detectMealGaps(d, settings, tl, wakeOf(d), bedOf(d), rangeStart));

  const ctx: Ctx = { now, rangeStart, rangeEnd, tl, settings, W, energy, places, travel, wakeOf, bedOf, currentPlaceId: input.currentPlaceId, debug };

  // 5. Urgent tasks first (due within 36h), then life targets, then the rest.
  const pending = input.tasks.filter(t => !t.done).sort(taskOrder);
  const urgent = pending.filter(t => t.due !== undefined && t.due - now <= 36 * HOUR);
  const later = pending.filter(t => !urgent.includes(t));
  for (const t of urgent) placeTask(t, ctx, push, unplaced, warnings, true);
  for (const a of input.activities ?? []) placeWeeklyTarget(a, days, ctx, push, input.habits ?? []);
  for (const t of later) placeTask(t, ctx, push, unplaced, warnings, false);

  return { blocks: tl.blocks, added, removed, unplaced, warnings, debug };
}

export function taskOrder(a: Task, b: Task): number {
  const da = a.due ?? Infinity, db = b.due ?? Infinity;
  return da - db || a.priority - b.priority || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

interface Ctx {
  now: Ms; rangeStart: Ms; rangeEnd: Ms; tl: Timeline; settings: Settings; W: Weights; energy: number[];
  places: Place[]; travel: TravelTime[]; wakeOf: (d: Ms) => Ms; bedOf: (d: Ms) => Ms; currentPlaceId?: ID;
  debug: PlanResult['debug'];
}

function placeRoutine(r: Routine, d: Ms, tl: Timeline, earliest: Ms, s: Settings): Block | undefined {
  const pref = at(d, r.start);
  const dur = r.durationMin * MIN;
  const mk = (start: Ms, reason: string): Block => ({
    id: `rt_${r.id}_${hashId(String(d))}`, title: r.title, kind: r.kind === 'hobby' ? 'hobby' : 'routine',
    start, end: start + dur, flexibility: r.flexibility, source: 'planner', activityId: r.id, placeId: r.placeId, reason,
  });
  if (pref < earliest) return undefined;
  if (r.flexibility === 'fixed') return mk(pref, 'Fixed routine');
  if (tl.isFree(pref, pref + dur, s.bufferMin)) return mk(pref, `Your usual ${r.title.toLowerCase()} time`);
  if (r.flexibility === 'optional') return undefined;
  const win = (r.windowMin ?? 90) * MIN;
  const free = tl.free({ start: Math.max(earliest, pref - win), end: pref + win + dur }, s.bufferMin);
  const starts = candidateStarts(free, r.durationMin);
  if (!starts.length) return undefined;
  const best = starts.reduce((a, b) => (Math.abs(b - pref) < Math.abs(a - pref) ? b : a));
  return mk(best, `Moved from ${fmtTime(pref)} — that slot was taken`);
}

export function chunkTask(totalMin: number, focus: boolean, chunkable: boolean | undefined, capMin: number): number[] {
  const canChunk = chunkable ?? totalMin > 60;
  const size = focus ? Math.min(60, capMin) : Math.min(90, capMin);
  if (!canChunk || totalMin <= Math.max(size, 75)) return [totalMin];
  const out: number[] = [];
  let left = totalMin;
  while (left > 0) { const c = Math.min(size, left); out.push(c); left -= c; }
  if (out.length > 1 && out[out.length - 1] < 20) { const r = out.pop()!; out[out.length - 1] += r; }
  return out;
}

function placeTask(t: Task, c: Ctx, push: (b: Block) => void, unplaced: Unplaced[], warnings: string[], urgent: boolean) {
  const scheduled = c.tl.blocks.filter(b => b.taskId === t.id).reduce((s, b) => s + (b.end - b.start) / MIN, 0);
  const remaining = Math.max(0, t.durationMin - scheduled);
  if (remaining < 5) return;
  const chunks = chunkTask(remaining, !!t.needsFocus, t.chunkable, c.settings.focusCapMin);
  const overdue = t.due !== undefined && t.due < c.rangeStart;
  const windowEnd = t.due !== undefined && !overdue ? Math.min(c.rangeEnd, t.due) : c.rangeEnd;
  if (overdue) warnings.push(`"${t.title}" is past due — placing it as soon as possible.`);
  let placedCount = 0;
  let lastEnd = c.rangeStart;
  for (let i = 0; i < chunks.length; i++) {
    const dur = chunks[i];
    // chunks of the same task go in order, with a break between them
    const from = Math.max(i === 0 ? c.rangeStart : lastEnd + c.settings.breakMin * MIN, t.notBefore ?? 0);
    const best = bestSlot(t, dur, from, windowEnd, c, urgent);
    if (!best) {
      const longest = Math.max(0, ...c.tl.free({ start: c.rangeStart, end: windowEnd }, c.settings.bufferMin).map(f => (f.end - f.start) / MIN));
      const reason = c.rangeStart >= windowEnd ? 'Not enough time left before the due date'
        : longest < dur ? `Needs ${fmtDur(dur)} but the longest free slot ${t.due ? 'before it is due' : 'in range'} is ${fmtDur(longest)}`
          : 'Placing it would eat your protected free time';
      unplaced.push({ id: t.id, title: chunks.length > 1 ? `${t.title} (part ${i + 1}/${chunks.length})` : t.title, reason });
      continue;
    }
    placedCount++;
    lastEnd = best.start + dur * MIN;
    if (best.travelBlock) push(best.travelBlock);
    push({
      id: `pt_${hashId(`${t.id}_${i}_${best.start}`)}`,
      title: chunks.length > 1 ? `${t.title} (${i + 1}/${chunks.length})` : t.title,
      kind: t.milestoneId ? 'milestone' : 'task',
      start: best.start, end: best.start + dur * MIN,
      flexibility: 'movable', source: 'planner',
      taskId: t.id, projectId: t.projectId, milestoneId: t.milestoneId,
      focus: t.needsFocus, placeId: best.placeId, importance: t.importance,
      reason: best.reason + (chunks.length > 1 ? ` · split into ${chunks.length} sessions` : ''),
    });
    c.debug.push({ taskId: t.id, start: best.start, score: best.score });
  }
  if (placedCount && placedCount < chunks.length) warnings.push(`Only part of "${t.title}" fit before it's due.`);
}

interface Slot { start: Ms; score: ScoreBreakdown; reason: string; placeId?: ID; travelBlock?: Block }

function energyAt(c: Ctx, start: Ms, durMin: number): number {
  let s = 0, n = 0;
  for (let t = start; t < start + durMin * MIN; t += 30 * MIN) { s += c.energy[new Date(t).getHours()] ?? 0.5; n++; }
  return n ? s / n : 0.5;
}

function contiguousFocus(c: Ctx, start: Ms, end: Ms): number {
  const gap = (c.settings.breakMin) * MIN;
  let total = (end - start) / MIN;
  let lo = start, hi = end, changed = true;
  const focusBlocks = c.tl.blocks.filter(b => b.focus || b.kind === 'class');
  while (changed) {
    changed = false;
    for (const b of focusBlocks) {
      if (b.end <= lo && lo - b.end < gap) { total += (b.end - b.start) / MIN; lo = b.start; changed = true; }
      else if (b.start >= hi && b.start - hi < gap) { total += (b.end - b.start) / MIN; hi = b.end; changed = true; }
    }
  }
  return total;
}

function bestSlot(t: Task, durMin: number, from: Ms, to: Ms, c: Ctx, urgent: boolean): Slot | undefined {
  if (to <= from) return undefined;
  const free = c.tl.free({ start: from, end: to }, c.settings.bufferMin);
  const starts = candidateStarts(free, durMin);
  const requiredPlace = placeForTag(t.location, c.places, c.currentPlaceId);
  const horizon = Math.max(DAY, to - from);
  let best: Slot | undefined;
  for (const s of starts) {
    const e = s + durMin * MIN;
    const day = startOfDay(s);
    if (s < c.wakeOf(day) + 45 * MIN || e > c.bedOf(day)) continue; // waking hours, with time to get ready
    const prev = c.tl.prevBlock(s);
    const next = c.tl.nextBlock(e);
    // travel feasibility
    let travelBlock: Block | undefined;
    let travelPenalty = 0;
    const home = c.places.find(p => p.tags.includes('home'))?.id;
    const prevPlace = c.tl.placeAt(s, s - c.now < 2 * HOUR ? c.currentPlaceId ?? home : home);
    if (requiredPlace && prevPlace && prevPlace !== requiredPlace) {
      const tm = travelMinutes(prevPlace, requiredPlace, c.travel, c.places);
      const gapBefore = prev ? (s - prev.end) / MIN : (s - c.wakeOf(day)) / MIN;
      if (gapBefore < tm + c.settings.bufferMin) continue;
      travelBlock = { id: `tr_${hashId(`${t.id}_${s}`)}`, title: `Travel to ${c.places.find(p => p.id === requiredPlace)?.name ?? 'place'}`, kind: 'travel', start: s - tm * MIN, end: s, flexibility: 'movable', source: 'planner', placeId: requiredPlace, reason: `${tm} min travel` };
      travelPenalty = tm / 60;
    }
    const nextP = c.tl.nextPlaced(e);
    if (requiredPlace && nextP?.placeId && nextP.placeId !== requiredPlace) {
      const back = travelMinutes(requiredPlace, nextP.placeId, c.travel, c.places);
      if ((nextP.start - e) / MIN < back + c.settings.bufferMin) continue;
    }

    const parts: Record<string, number> = {};
    const soon = 1 - Math.min(1, (s - from) / horizon);
    const urgency = t.due !== undefined ? Math.max(0.1, 1 - (t.due - c.now) / (7 * DAY)) : 0.15;
    parts.deadline = c.W.deadline * urgency * soon;
    parts.priority = c.W.priority * ((4 - t.priority) / 3) * soon;
    parts.soonness = c.W.soonness * soon * 0.5;
    const en = energyAt(c, s, durMin);
    parts.energy = t.needsFocus ? c.W.energy * en : c.W.energy * 0.3 * (1 - Math.abs(en - 0.5));
    parts.location = requiredPlace ? (travelBlock ? -c.W.location * travelPenalty : c.W.location) : 0;
    if (t.needsFocus) {
      const run = contiguousFocus(c, s, e);
      parts.focusCap = run > c.settings.focusCapMin ? -c.W.focusCap * ((run - c.settings.focusCapMin) / 60 + 0.5) : 0;
    }
    const freeAfter = c.tl.freeMinutesOnDay(s, c.wakeOf(day), c.bedOf(day)) - durMin - (travelBlock ? (s - travelBlock.start) / MIN : 0);
    if (freeAfter < c.settings.minFreeMinPerDay) {
      if (!urgent) continue; // protect free time from non-urgent work
      parts.freeTime = -c.W.freeTime;
    }
    const lateness = (c.bedOf(day) - e) / MIN;
    if (lateness < 60) parts.windDown = -0.5;
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    if (!best || total > best.score.total + 1e-9) {
      best = { start: s, score: { total, parts }, placeId: requiredPlace, travelBlock, reason: explain(t, s, prev, en, requiredPlace, c, travelBlock) };
    }
  }
  return best;
}

function explain(t: Task, s: Ms, prev: Block | undefined, en: number, placeId: ID | undefined, c: Ctx, travel?: Block): string {
  const bits: string[] = [];
  if (prev && (prev.kind === 'class') && (s - prev.end) <= 45 * MIN) bits.push("you're free after school");
  else if (prev && prev.kind === 'meal' && (s - prev.end) <= 30 * MIN) bits.push(`free after ${prev.title.toLowerCase()}`);
  else bits.push(`open slot at ${fmtTime(s)}`);
  if (t.due !== undefined) bits.push(`due ${fmtDay(t.due, c.now)}`);
  if (t.priority === 1) bits.push('high priority');
  if (t.needsFocus && en >= 0.65) bits.push(`your energy is usually high around ${fmtTime(s)}`);
  if (placeId && !travel) bits.push(`you'll be at ${c.places.find(p => p.id === placeId)?.name}`);
  if (travel) bits.push(`includes ${Math.round((travel.end - travel.start) / MIN)}m travel`);
  return `Placed here because ${bits.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Weekly life targets ("read 3x a week"). Placed before non-urgent work so
// productivity never crowds out the life stuff.
// ---------------------------------------------------------------------------
function placeWeeklyTarget(a: Activity, days: Ms[], c: Ctx, push: (b: Block) => void, habits: Habit[]) {
  if (!a.weeklyTarget) return;
  const weekStart = addDays(startOfDay(c.rangeStart), -weekday(c.rangeStart));
  const weekEnd = addDays(weekStart, 7);
  const done = c.tl.blocks.filter(b => b.activityId === a.id && b.start >= weekStart && b.start < weekEnd && b.status !== 'skipped').length;
  let deficit = a.weeklyTarget - done;
  if (deficit <= 0) return;
  const habit = habits.find(h => h.key === `hobby:${a.category}` || h.key === `hobby:${a.id}`);
  const weekDays = days.filter(d => d < weekEnd);
  // Spread: pick the days with the most free evening time, one per day.
  const scored = weekDays.map(d => {
    const evening = { start: Math.max(at(d, 15 * 60), c.rangeStart), end: c.bedOf(d) - 30 * MIN };
    const free = c.tl.free(evening, c.settings.bufferMin).reduce((s, f) => s + (f.end - f.start) / MIN, 0);
    const habitBonus = habit?.weekdays.includes(weekday(d)) ? 120 : 0;
    return { d, score: free + habitBonus };
  }).sort((x, y) => y.score - x.score || x.d - y.d);
  const daysLeft = weekDays.length;
  // In a single-day plan only place when the week is running out.
  if (days.length === 1 && daysLeft > 0) {
    const remainingDaysInWeek = Math.round((weekEnd - startOfDay(c.rangeStart)) / DAY);
    if (remainingDaysInWeek > deficit + 1 && (scored[0]?.score ?? 0) < 240) return;
  }
  for (const { d } of scored) {
    if (deficit <= 0) break;
    if (c.tl.blocks.some(b => b.activityId === a.id && startOfDay(b.start) === d)) continue;
    const slot = lifeSlot(a, d, c, habit);
    if (!slot) continue;
    push({
      id: `hb_${hashId(`${a.id}_${d}`)}`, title: a.name, kind: a.category === 'nap' ? 'nap' : 'hobby',
      start: slot.start, end: slot.start + a.durationMin * MIN, flexibility: 'optional', source: 'planner',
      activityId: a.id, placeId: a.placeId, importance: 'passive', reason: slot.reason,
    });
    deficit--;
  }
}

function lifeSlot(a: Activity, d: Ms, c: Ctx, habit?: Habit): { start: Ms; reason: string } | undefined {
  const range = { start: Math.max(c.wakeOf(d) + HOUR, c.rangeStart), end: c.bedOf(d) - 15 * MIN };
  const free = c.tl.free(range, c.settings.bufferMin);
  const starts = candidateStarts(free, a.durationMin);
  let best: { start: Ms; score: number; reason: string } | undefined;
  for (const s of starts) {
    const freeAfter = c.tl.freeMinutesOnDay(s, c.wakeOf(d), c.bedOf(d)) - a.durationMin;
    if (freeAfter < c.settings.minFreeMinPerDay) continue;
    const m = minutesOfDay(s);
    let score = 0; const why: string[] = [];
    if (habit && m >= habit.windowStart - 30 && m <= habit.windowEnd) { score += c.W.habit * habit.confidence * 2; why.push(`you usually do this around ${fmtTime(at(d, habit.windowStart))}`); }
    const en = energyAt(c, s, a.durationMin);
    if (a.energy === 'energizing') score += c.W.energy * (1 - en) * 0.8; // pick-me-up when energy dips
    else if (a.energy === 'draining') score += c.W.energy * en * 0.8;
    else score += 0.3;
    if (a.social || a.category === 'movie' || a.category === 'going-out') score += m >= 18 * 60 ? 1 : -0.5;
    if (a.category === 'nap') score += m >= 13 * 60 && m <= 16 * 60 ? 1.5 : -2;
    if (!best || score > best.score + 1e-9) best = { start: s, score, reason: '' + (why[0] ?? `keeps your ${a.weeklyTarget}x/week ${a.name.toLowerCase()} goal on track`) };
  }
  return best ? { start: best.start, reason: `Life time: ${best.reason}` } : undefined;
}

// Convenience wrappers ------------------------------------------------------
export function planDay(input: Omit<PlanInput, 'rangeStart' | 'rangeEnd'> & { day?: Ms }): PlanResult {
  const d = startOfDay(input.day ?? input.now);
  return plan({ ...input, rangeStart: d, rangeEnd: addDays(d, 1) });
}
export function planWeek(input: Omit<PlanInput, 'rangeStart' | 'rangeEnd'>): PlanResult {
  const d = startOfDay(input.now);
  return plan({ ...input, rangeStart: d, rangeEnd: addDays(d, 7) });
}

export { parseHM, overlaps };
