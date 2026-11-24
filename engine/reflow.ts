import type { Block, Ms } from './types';
import { MIN, overlaps } from './time';
import { Timeline, cmpBlock } from './timeline';

export interface MovePreview { displaced: Block[]; hardConflicts: Block[]; ok: boolean }

/** What would a move bump into? Used for the live drag preview. */
export function previewMove(blocks: Block[], id: string, start: Ms, end: Ms): MovePreview {
  const others = blocks.filter(b => b.id !== id && !b.allDay && b.kind !== 'sleep' && overlaps(b, { start, end }));
  const hardConflicts = others.filter(b => b.fixed);
  return { displaced: others.filter(b => !b.fixed), hardConflicts, ok: hardConflicts.length === 0 };
}

/** Cascade movable blocks after `from` so nothing overlaps. Fixed and pinned blocks stay put. */
export function autoReflow(blocks: Block[], from: Ms, until: Ms, pinned: string[] = [], bufferMin = 5): { blocks: Block[]; moved: string[]; dropped: Block[] } {
  const isAnchor = (b: Block) => b.fixed || b.allDay || b.kind === 'sleep' || pinned.includes(b.id) || b.end <= from || b.start >= until;
  const tl = new Timeline(blocks.filter(isAnchor));
  const allDay = blocks.filter(b => b.allDay);
  const moved: string[] = [], dropped: Block[] = [];
  for (const b of blocks.filter(x => !isAnchor(x)).sort(cmpBlock)) {
    const dur = b.end - b.start; let s = Math.max(b.start, from); let guard = 0;
    while (!tl.isFree(s, s + dur, bufferMin) && guard++ < 200) {
      const clash = tl.blocks.filter(x => s < x.end + bufferMin * MIN && x.start - bufferMin * MIN < s + dur).sort((x, y) => y.end - x.end)[0];
      s = clash ? clash.end + bufferMin * MIN : s + 5 * MIN;
    }
    if (s + dur > until) { dropped.push(b); continue; }
    const nb = s === b.start ? b : { ...b, start: s, end: s + dur };
    if (nb !== b) moved.push(b.id);
    tl.add(nb);
  }
  return { blocks: [...tl.blocks, ...allDay, ...dropped], moved, dropped };
}
