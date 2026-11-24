/** Generic undo/redo over immutable snapshots. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private limit = 100) {}
  push(snapshot: T) { this.past.push(snapshot); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  undo(current: T): T | undefined { const p = this.past.pop(); if (p === undefined) return; this.future.push(current); return p; }
  redo(current: T): T | undefined { const f = this.future.pop(); if (f === undefined) return; this.past.push(current); return f; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
