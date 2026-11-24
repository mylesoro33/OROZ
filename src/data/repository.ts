import Dexie, { type Table } from 'dexie';

// The UI only ever talks to `Repository`. Today it's IndexedDB (Dexie) on-device;
// a SupabaseRepository can implement the same interface later without UI changes.

export const TABLES = ['blocks', 'tasks', 'people', 'places', 'memory'] as const;
export type TableName = (typeof TABLES)[number];

export interface Repository {
  all<T>(table: TableName): Promise<T[]>;
  put<T extends { id: string }>(table: TableName, item: T): Promise<void>;
  bulkPut<T extends { id: string }>(table: TableName, items: T[]): Promise<void>;
  delete(table: TableName, id: string): Promise<void>;
  bulkDelete(table: TableName, ids: string[]): Promise<void>;
  getKV<T>(key: string): Promise<T | undefined>;
  setKV<T>(key: string, value: T): Promise<void>;
  exportAll(): Promise<Record<string, unknown>>;
  importAll(data: Record<string, unknown>): Promise<void>;
  wipe(): Promise<void>;
}

class OrozDB extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super('oroz-v3');
    const schema: Record<string, string> = { kv: 'key' };
    for (const t of TABLES) schema[t] = 'id';
    schema.blocks = 'id, start, taskId';
    this.version(1).stores(schema);
  }
}

export class DexieRepository implements Repository {
  private db = new OrozDB();
  private t(name: TableName) { return this.db.table(name); }
  all<T>(table: TableName) { return this.t(table).toArray() as Promise<T[]>; }
  async put<T extends { id: string }>(table: TableName, item: T) { await this.t(table).put(item); }
  async bulkPut<T extends { id: string }>(table: TableName, items: T[]) { await this.t(table).bulkPut(items); }
  async delete(table: TableName, id: string) { await this.t(table).delete(id); }
  async bulkDelete(table: TableName, ids: string[]) { await this.t(table).bulkDelete(ids); }
  async getKV<T>(key: string) { return (await this.db.kv.get(key))?.value as T | undefined; }
  async setKV<T>(key: string, value: T) { await this.db.kv.put({ key, value }); }
  async exportAll() {
    const out: Record<string, unknown> = { app: 'OROZ', version: 1, exportedAt: new Date().toISOString() };
    for (const t of TABLES) out[t] = await this.t(t).toArray();
    out.kv = await this.db.kv.toArray();
    return out;
  }
  async importAll(data: Record<string, unknown>) {
    await this.db.transaction('rw', [...TABLES.map(t => this.t(t)), this.db.kv], async () => {
      for (const t of TABLES) { await this.t(t).clear(); if (Array.isArray(data[t])) await this.t(t).bulkPut(data[t] as object[]); }
      await this.db.kv.clear();
      if (Array.isArray(data.kv)) await this.db.kv.bulkPut(data.kv as { key: string; value: unknown }[]);
    });
  }
  async wipe() { await this.db.delete(); this.db = new OrozDB(); }
}

/** In-memory implementation — used by tests and as a fallback when IndexedDB is unavailable (private mode). */
export class MemoryRepository implements Repository {
  private data = new Map<string, Map<string, unknown>>();
  private kv = new Map<string, unknown>();
  private m(t: string) { return this.data.get(t) ?? this.data.set(t, new Map()).get(t)!; }
  async all<T>(t: TableName) { return [...this.m(t).values()] as T[]; }
  async put<T extends { id: string }>(t: TableName, i: T) { this.m(t).set(i.id, structuredClone(i)); }
  async bulkPut<T extends { id: string }>(t: TableName, items: T[]) { for (const i of items) await this.put(t, i); }
  async delete(t: TableName, id: string) { this.m(t).delete(id); }
  async bulkDelete(t: TableName, ids: string[]) { for (const id of ids) this.m(t).delete(id); }
  async getKV<T>(k: string) { return this.kv.get(k) as T | undefined; }
  async setKV<T>(k: string, v: T) { this.kv.set(k, structuredClone(v)); }
  async exportAll() { const o: Record<string, unknown> = { app: 'OROZ', version: 1 }; for (const t of TABLES) o[t] = await this.all(t); o.kv = [...this.kv].map(([key, value]) => ({ key, value })); return o; }
  async importAll(d: Record<string, unknown>) { this.data.clear(); this.kv.clear(); for (const t of TABLES) if (Array.isArray(d[t])) await this.bulkPut(t, d[t] as { id: string }[]); if (Array.isArray(d.kv)) for (const { key, value } of d.kv as { key: string; value: unknown }[]) this.kv.set(key, value); }
  async wipe() { this.data.clear(); this.kv.clear(); }
}

export async function createRepository(): Promise<Repository> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no idb');
    const r = new DexieRepository();
    await r.getKV('probe');
    return r;
  } catch {
    console.warn('IndexedDB unavailable — using in-memory storage for this session.');
    return new MemoryRepository();
  }
}
