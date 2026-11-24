import type { Block, Ms } from './types';
import { MIN, overlaps } from './time';

export interface MovePreview { displaced: Block[]; hardConflicts: Block[]; ok: boolean }

/** What would a move bump into? Used for the live drag preview. */
export function previewMove(blocks: Block[], id: string, start: Ms, end: Ms): MovePreview {
  const others = blocks.filter(b => b.id !== id && !b.allDay && overlaps(b, { start, end }));
  const hardConflicts = others.filter(b => b.fixed);
  return { displaced: others.filter(b => !b.fixed), hardConflicts, ok: hardConflicts.length === 0 };
}

