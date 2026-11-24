import { useSyncExternalStore, useRef } from 'react';
import type { Block, Task, Person, Place, Memory, Settings, Profile } from '@engine/types';
import { History } from '@engine/history';
import { defaultSettings } from '@engine/defaults';
import { uid } from '@engine/time';
import type { Repository, TableName } from './repository';

export type ConnectionId =
  | 'google-calendar' | 'apple-calendar' | 'outlook' | 'google-tasks' | 'apple-reminders'
  | 'classroom' | 'schoology' | 'canvas' | 'blackboard' | 'powerschool' | 'teams' | 'contacts';
export interface Connection { connected: boolean; at?: number; url?: string }

/** Anything from outside waits here until the person approves it. */
export interface Draft {
  id: string;
  title: string;
  events: Block[];
  tasks: Task[];
  people: Person[];
  dates: Block[];               // important dates (with sourceUrl)
  connection?: ConnectionId;
  sources?: string[];
  note?: string;
}
export const emptyDraft = (title: string, extra: Partial<Draft> = {}): Draft => ({ id: uid('draft'), title, events: [], tasks: [], people: [], dates: [], ...extra });
export const draftSize = (d: Draft) => d.events.length + d.tasks.length + d.people.length + d.dates.length;

/** A schedule photo kept only if the person chose to keep it. */
export interface SavedPhoto { id: string; at: number; title: string; dataUrl: string; seriesIds: string[] }

export interface WeatherDay { date: string; tmax: number; tmin: number; precip: number; code: number }

export interface AppData {
  blocks: Block[]; tasks: Task[]; people: Person[]; places: Place[]; memory: Memory[]; photos: SavedPhoto[];
  settings: Settings; profile: Profile;
  connections: Partial<Record<ConnectionId, Connection>>;
  dismissed: string[];
  attendees: Record<string, number>;
  weather: { city: string; at: number; unit: 'F' | 'C'; days: WeatherDay[] } | null;
  foundDates: boolean;
  ready: boolean;
}
type Tables = Pick<AppData, TableName>;
const KV = ['settings', 'profile', 'connections', 'dismissed', 'attendees', 'weather', 'foundDates'] as const;

export class Store {
  state: AppData = {
    blocks: [], tasks: [], people: [], places: [], memory: [], photos: [], settings: defaultSettings(), profile: { setupDone: false },
    connections: {}, dismissed: [], attendees: {}, weather: null, foundDates: false, ready: false,
  };
  private listeners = new Set<() => void>();
  history = new History<Pick<AppData, 'blocks' | 'tasks'>>(60);
  constructor(public repo: Repository) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit() { for (const l of this.listeners) l(); }

  async load() {
    const next = { ...this.state };
    for (const t of ['blocks', 'tasks', 'people', 'places', 'memory', 'photos'] as TableName[]) (next as any)[t] = await this.repo.all(t);
    for (const k of KV) { const v = await this.repo.getKV(k); if (v !== undefined) (next as any)[k] = v; }
    const d = defaultSettings();
    next.settings = { ...d, ...next.settings, sleep: { ...d.sleep, ...next.settings.sleep } };
    next.ready = true; this.state = next; this.emit();
  }

  checkpoint() { this.history.push({ blocks: this.state.blocks, tasks: this.state.tasks }); }
  undo() {
    const p = this.history.undo({ blocks: this.state.blocks, tasks: this.state.tasks });
    if (!p) return false;
    for (const t of ['blocks', 'tasks'] as const) {
      const keep = new Set(p[t].map(r => r.id));
      void this.repo.bulkDelete(t, this.state[t].filter(r => !keep.has(r.id)).map(r => r.id));
      void this.repo.bulkPut(t, p[t] as { id: string }[]);
    }
    this.state = { ...this.state, blocks: p.blocks, tasks: p.tasks }; this.emit(); return true;
  }

  upsert<K extends TableName>(table: K, items: Tables[K]) {
    if (!items.length) return;
    const map = new Map((this.state[table] as { id: string }[]).map(x => [x.id, x]));
    for (const i of items as { id: string }[]) map.set(i.id, i);
    this.state = { ...this.state, [table]: [...map.values()] }; this.emit();
    void this.repo.bulkPut(table, items as { id: string }[]);
  }
  remove(table: TableName, ids: string[]) {
    if (!ids.length) return;
    const set = new Set(ids);
    this.state = { ...this.state, [table]: (this.state[table] as { id: string }[]).filter(x => !set.has(x.id)) }; this.emit();
    void this.repo.bulkDelete(table, ids);
  }
  set<K extends (typeof KV)[number]>(key: K, value: AppData[K]) {
    this.state = { ...this.state, [key]: value }; this.emit();
    void this.repo.setKV(key, value);
  }
  remember(text: string, topic?: string) { this.upsert('memory', [{ id: uid('mem'), text, at: Date.now(), topic }]); }
  dismiss(id: string) { if (!this.state.dismissed.includes(id)) this.set('dismissed', [...this.state.dismissed, id]); }

  /** Save the approved parts of a draft. */
  approve(d: Draft, keep?: Set<string>) {
    const pick = <T extends { id: string }>(xs: T[]) => xs.filter(x => !keep || keep.has(x.id));
    this.checkpoint();
    this.upsert('blocks', [...pick(d.events), ...pick(d.dates)]);
    const done = new Set(this.state.tasks.filter(t => t.done).map(t => t.id));
    this.upsert('tasks', pick(d.tasks).filter(t => !done.has(t.id)));
    const known = new Set(this.state.people.map(p => p.name.toLowerCase()));
    this.upsert('people', pick(d.people).filter(p => !known.has(p.name.toLowerCase())));
    if (d.dates.length) this.set('foundDates', true);
    if (d.connection) this.set('connections', { ...this.state.connections, [d.connection]: { ...this.state.connections[d.connection], connected: true, at: Date.now() } });
  }

  async exportJSON() { return JSON.stringify(await this.repo.exportAll(), null, 2); }
  async wipe() { await this.repo.wipe(); location.reload(); }
}

let _store: Store | null = null;
export const setStore = (s: Store) => { _store = s; };
export const store = () => { if (!_store) throw new Error('store not ready'); return _store; };

export function useApp<T>(select: (s: AppData) => T): T {
  const s = store();
  const last = useRef<{ state: AppData; value: T } | null>(null);
  const sel = useRef(select);
  if (sel.current !== select) { sel.current = select; last.current = null; }
  return useSyncExternalStore(s.subscribe, () => {
    if (last.current && last.current.state === s.state) return last.current.value;
    const value = sel.current(s.state); last.current = { state: s.state, value }; return value;
  });
}
