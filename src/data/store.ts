import { useSyncExternalStore, useRef } from 'react';
import type { Block, Task, Person, Memory, Settings, Profile } from '@engine/types';
import { History } from '@engine/history';
import { defaultSettings } from '@engine/defaults';
import { uid } from '@engine/time';
import type { Repository, TableName } from './repository';

export type ConnectionId = 'google-calendar' | 'classroom' | 'schoology' | 'google-tasks' | 'school-calendar' | 'contacts';
export interface Connection { connected: boolean; at?: number; detail?: string; url?: string }

export interface ChatMsg {
  id: string; at: number; role: 'user' | 'assistant';
  text: string;
  sources?: string[];            // "Schedule", "Google Calendar", "lincolnhigh.org"
  pending?: PendingImport;       // something waiting for "Add"
}

/** Anything coming in from outside waits here until the user approves it. */
export interface PendingImport {
  id: string;
  title: string;                 // "12 dates from Lincoln High's calendar"
  source: Block['source'];
  connection?: ConnectionId;
  blocks?: Block[];
  tasks?: Task[];
  people?: Person[];
  lunch?: Record<string, string[]>;
  status: 'pending' | 'added' | 'dismissed';
}

export interface AppData {
  blocks: Block[]; tasks: Task[]; people: Person[]; memory: Memory[]; chat: ChatMsg[];
  settings: Settings; profile: Profile;
  connections: Partial<Record<ConnectionId, Connection>>;
  lunchMenus: Record<string, string[]>;
  dismissed: string[];
  attendees: Record<string, number>;
  bedtimeSet: boolean;
  ready: boolean;
}
type Tables = Pick<AppData, TableName>;
const KV = ['settings', 'profile', 'connections', 'lunchMenus', 'dismissed', 'attendees', 'bedtimeSet'] as const;

export class Store {
  state: AppData = {
    blocks: [], tasks: [], people: [], memory: [], chat: [],
    settings: defaultSettings(), profile: { setupDone: false }, connections: {}, lunchMenus: {}, dismissed: [], attendees: {}, bedtimeSet: false, ready: false,
  };
  private listeners = new Set<() => void>();
  history = new History<Pick<AppData, 'blocks' | 'tasks'>>(60);
  constructor(public repo: Repository) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit() { for (const l of this.listeners) l(); }

  async load() {
    const next = { ...this.state };
    for (const t of ['blocks', 'tasks', 'people', 'memory', 'chat'] as TableName[]) (next as any)[t] = await this.repo.all(t);
    next.chat.sort((a, b) => a.at - b.at);
    for (const k of KV) { const v = await this.repo.getKV(k); if (v !== undefined) (next as any)[k] = v; }
    const d = defaultSettings();
    next.settings = { ...d, ...next.settings, sleep: { ...d.sleep, ...next.settings.sleep } };
    next.ready = true; this.state = next; this.emit();
  }

  /** Snapshot blocks+tasks before a change so it can be undone. */
  checkpoint() { this.history.push({ blocks: this.state.blocks, tasks: this.state.tasks }); }
  undo() {
    const p = this.history.undo({ blocks: this.state.blocks, tasks: this.state.tasks });
    if (!p) return false;
    this.replace('blocks', p.blocks); this.replace('tasks', p.tasks); return true;
  }
  private replace<K extends 'blocks' | 'tasks'>(table: K, rows: AppData[K]) {
    const keep = new Set(rows.map(r => r.id));
    const gone = this.state[table].filter(r => !keep.has(r.id)).map(r => r.id);
    this.state = { ...this.state, [table]: rows }; this.emit();
    void this.repo.bulkDelete(table, gone); void this.repo.bulkPut(table, rows as { id: string }[]);
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
  remember(text: string) { this.upsert('memory', [{ id: uid('mem'), text, at: Date.now() }]); }

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
