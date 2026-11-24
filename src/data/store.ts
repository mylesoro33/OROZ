import { useSyncExternalStore, useRef } from 'react';
import type { Block, Task, Project, Routine, Activity, Place, TravelTime, Person, Reminder, LogEntry, Habit, Note, Settings, FoodProfile } from '@engine/types';
import type { Restaurant } from '@engine/dining';
import { History } from '@engine/history';
import { defaultSettings, defaultFoodProfile } from '@engine/defaults';
import { uid } from '@engine/time';
import type { Repository, TableName } from './repository';

export type TravelRow = TravelTime & { id: string };

export interface AppData {
  blocks: Block[]; tasks: Task[]; projects: Project[]; routines: Routine[]; activities: Activity[];
  places: Place[]; travel: TravelRow[]; people: Person[]; reminders: Reminder[]; logs: LogEntry[]; habits: Habit[]; notes: Note[];
  settings: Settings; food: FoodProfile;
  currentPlaceId?: string; placeSource?: 'gps' | 'manual';
  blockedSuggestions: string[];
  restaurants: Restaurant[];
  sync: Record<string, number>;
  ready: boolean;
}

type Tables = Pick<AppData, TableName>;
const KV_KEYS = ['settings', 'food', 'currentPlaceId', 'placeSource', 'blockedSuggestions', 'restaurants', 'sync'] as const;

export class Store {
  state: AppData = {
    blocks: [], tasks: [], projects: [], routines: [], activities: [], places: [], travel: [], people: [], reminders: [], logs: [], habits: [], notes: [],
    settings: defaultSettings(), food: defaultFoodProfile(), blockedSuggestions: [], restaurants: [], sync: {}, ready: false,
  };
  private listeners = new Set<() => void>();
  history = new History<Block[]>(80);
  constructor(public repo: Repository) {}

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private emit() { for (const l of this.listeners) l(); }

  async load() {
    const next = { ...this.state };
    for (const t of ['blocks', 'tasks', 'projects', 'routines', 'activities', 'places', 'travel', 'people', 'reminders', 'logs', 'habits', 'notes'] as TableName[]) {
      (next as any)[t] = await this.repo.all(t);
    }
    for (const k of KV_KEYS) { const v = await this.repo.getKV(k); if (v !== undefined) (next as any)[k] = v; }
    next.settings = { ...defaultSettings(), ...next.settings, flags: { ...defaultSettings().flags, ...next.settings.flags }, weights: { ...defaultSettings().weights, ...next.settings.weights } };
    next.ready = true;
    this.state = next; this.emit();
  }

  /** Upsert rows into a table (memory + repository). */
  upsert<K extends TableName>(table: K, items: Tables[K]) {
    const list = this.state[table] as { id: string }[];
    const map = new Map(list.map(x => [x.id, x]));
    for (const i of items as { id: string }[]) map.set(i.id, i);
    this.state = { ...this.state, [table]: [...map.values()] };
    this.emit();
    void this.repo.bulkPut(table, items as { id: string }[]);
  }
  remove(table: TableName, ids: string[]) {
    if (!ids.length) return;
    const set = new Set(ids);
    this.state = { ...this.state, [table]: (this.state[table] as { id: string }[]).filter(x => !set.has(x.id)) };
    this.emit();
    void this.repo.bulkDelete(table, ids);
  }
  setKV<K extends (typeof KV_KEYS)[number]>(key: K, value: AppData[K]) {
    this.state = { ...this.state, [key]: value };
    this.emit();
    void this.repo.setKV(key, value);
  }

  /** Replace the block set with undo support. */
  commitBlocks(next: Block[]) {
    this.history.push(this.state.blocks);
    this.writeBlocks(next);
  }
  private writeBlocks(next: Block[]) {
    const prevIds = new Set(this.state.blocks.map(b => b.id));
    const nextIds = new Set(next.map(b => b.id));
    const removed = [...prevIds].filter(id => !nextIds.has(id));
    const prevMap = new Map(this.state.blocks.map(b => [b.id, b]));
    const changed = next.filter(b => prevMap.get(b.id) !== b);
    this.state = { ...this.state, blocks: next };
    this.emit();
    if (removed.length) void this.repo.bulkDelete('blocks', removed);
    if (changed.length) void this.repo.bulkPut('blocks', changed);
  }
  undo() { const p = this.history.undo(this.state.blocks); if (p) this.writeBlocks(p); }
  redo() { const n = this.history.redo(this.state.blocks); if (n) this.writeBlocks(n); }

  log(e: Omit<LogEntry, 'id' | 'at'> & { at?: number }) {
    const entry: LogEntry = { id: uid('log'), at: e.at ?? Date.now(), ...e } as LogEntry;
    this.upsert('logs', [entry]);
  }

  async exportJSON(): Promise<string> { return JSON.stringify(await this.repo.exportAll(), null, 2); }
  async importJSON(text: string) { await this.repo.importAll(JSON.parse(text)); await this.load(); }
  async wipe() { await this.repo.wipe(); location.reload(); }
}

let _store: Store | null = null;
export const setStore = (s: Store) => { _store = s; };
export const store = () => { if (!_store) throw new Error('store not ready'); return _store; };

export function useApp<T>(select: (s: AppData) => T): T {
  const s = store();
  const last = useRef<{ state: AppData; value: T } | null>(null);
  // Selectors may close over props: a new selector invalidates the cache (once per render).
  const sel = useRef(select);
  if (sel.current !== select) { sel.current = select; last.current = null; }
  return useSyncExternalStore(s.subscribe, () => {
    if (last.current && last.current.state === s.state) return last.current.value;
    const value = sel.current(s.state);
    last.current = { state: s.state, value };
    return value;
  });
}
