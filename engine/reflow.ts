import type { Block, Ms, Settings } from './types';
import { MIN, overlaps, addDays, startOfDay } from './time';
import { Timeline, cmpBlock } from './timeline';
import { plan, type PlanInput, type PlanResult } from './planner';

export interface MovePreview { displaced: Block[]; hardConflicts: Block[]; ok: boolean }

/** What would a move bump into? Used for the live drag preview. */
export function previewMove(blocks: Block[], id: string, start: Ms, end: Ms): MovePreview {
  const moving = { start, end };
  const others = blocks.filter(b => b.id !== id && overlaps(b, moving));
  const hardConflicts = others.filter(b => b.flexibility === 'fixed');
  const displaced = others.filter(b => b.flexibility !== 'fixed');
  return { displaced, hardConflicts, ok: hardConflicts.length === 0 };
}

export interface ReflowResult { blocks: Block[]; moved: string[]; dropped: Block[] }

/**
 * Cascade movable blocks after `from` so nothing overlaps, keeping order.
 * Fixed blocks and sleep never move. Optional blocks that no longer fit before `until` are dropped.
 * `pinned` blocks (e.g. the one the user just dragged) are treated as fixed.
 */
export function autoReflow(blocks: Block[], from: Ms, until: Ms, settings: Settings, pinned: string[] = []): ReflowResult {
  const isAnchor = (b: Block) => b.flexibility === 'fixed' || b.kind === 'sleep' || pinned.includes(b.id) || b.end <= from || b.status === 'done' || b.status === 'active' || b.start >= until;
  const anchors = blocks.filter(isAnchor);
  const flow = blocks.filter(b => !isAnchor(b)).sort(cmpBlock);
  const tl = new Timeline(anchors);
  const moved: string[] = [], dropped: Block[] = [];
  const buf = settings.bufferMin;
  for (const b of flow) {
    const dur = b.end - b.start;
    let s = Math.max(b.start, from);
    // walk forward to the first free spot
    let guard = 0;
    while (!tl.isFree(s, s + dur, b.kind === 'meal' ? 0 : buf) && guard++ < 200) {
      const clash = tl.blocks.filter(x => s < x.end + buf * MIN && x.start - buf * MIN < s + dur).sort((a, c) => c.end - a.end)[0];
      s = clash ? clash.end + (b.kind === 'meal' || clash.kind === 'sleep' ? 0 : buf * MIN) : s + 5 * MIN;
    }
    if (s + dur > until || guard >= 200) {
      if (b.flexibility === 'optional' || b.kind === 'meal' && b.mealType === 'snack') { dropped.push(b); continue; }
      // movable that doesn't fit: drop too, the planner can re-place it on another day
      dropped.push(b); continue;
    }
    const nb = s === b.start ? b : { ...b, start: s, end: s + dur, reason: `Reflowed${b.reason ? ` · ${b.reason}` : ''}` };
    if (nb !== b) moved.push(b.id);
    tl.add(nb);
  }
  return { blocks: tl.blocks, moved, dropped };
}

/** "push 1h": shift every movable block left today back, then cascade around fixed ones. */
export function pushRest(blocks: Block[], now: Ms, minutes: number, settings: Settings): ReflowResult {
  const dayEnd = endOfWaking(blocks, now);
  const shifted = blocks.map(b => (b.start >= now && b.start < dayEnd && b.flexibility !== 'fixed' && b.kind !== 'sleep' && b.status !== 'done')
    ? { ...b, start: b.start + minutes * MIN, end: b.end + minutes * MIN } : b);
  return autoReflow(shifted, now, dayEnd, settings);
}

function endOfWaking(blocks: Block[], now: Ms): Ms {
  const sleep = blocks.filter(b => b.kind === 'sleep' && b.start > now).sort((a, b) => a.start - b.start)[0];
  return sleep && sleep.start < addDays(startOfDay(now), 1) + 4 * 3_600_000 ? sleep.start : addDays(startOfDay(now), 1);
}

/** "My day fell apart": throw away the remaining flexible plan for today and re-plan from right now. */
export function replanFromNow(input: Omit<PlanInput, 'rangeStart' | 'rangeEnd' | 'replan'>): PlanResult {
  const { now } = input;
  const end = addDays(startOfDay(now), 1);
  // Everything movable that hasn't started yet is up for grabs (including manual task blocks).
  const blocks = input.blocks
    .filter(b => !(b.start < now && b.end > now && b.flexibility !== 'fixed' && b.status !== 'active')) // drop the thing we were supposed to be doing
    .map(b => (b.start >= now && b.flexibility !== 'fixed' && b.taskId && b.status !== 'done' ? { ...b, source: 'planner' as const } : b));
  const res = plan({ ...input, blocks, rangeStart: now, rangeEnd: end, replan: true });
  const keptIds = new Set(blocks.map(b => b.id));
  const droppedNow = input.blocks.filter(b => !keptIds.has(b.id)).map(b => b.id);
  return { ...res, removed: [...res.removed, ...droppedNow] };
}
