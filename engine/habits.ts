import type { LogEntry, Habit, Ms, Block } from './types';
import { DAY, MIN, minutesOfDay, weekday, fmtTime, at, startOfDay, hm } from './time';

// Explainable habit model: frequency counts, 30-min time-bucket histograms and
// exponentially decayed averages. No heavy ML — every number can be shown.

export const HALF_LIFE_DAYS = 21;
export const decay = (ageMs: number, halfLifeDays = HALF_LIFE_DAYS) => Math.pow(0.5, ageMs / (halfLifeDays * DAY));

const LABELS: Record<string, string> = {
  'meal:breakfast': 'Breakfast', 'meal:lunch': 'Lunch', 'meal:dinner': 'Dinner', 'meal:snack': 'Snack',
  nap: 'Nap', 'hobby:nap': 'Nap', 'hobby:friends': 'Hanging out with friends', 'hobby:going-out': 'Going out',
  'hobby:gym': 'Gym', 'hobby:reading': 'Reading', 'hobby:movie': 'Movies', 'hobby:gaming': 'Gaming', 'hobby:family': 'Family time',
};
export const habitLabel = (key: string) => LABELS[key] ?? key.replace(/^hobby:/, '').replace(/^meal:/, '');

export function learnHabits(logs: LogEntry[], now: Ms, existing: Habit[] = []): Habit[] {
  const done = logs.filter(l => l.action === 'completed' && (l.key.startsWith('meal:') || l.key.startsWith('hobby:') || l.key === 'nap'));
  const byKey = new Map<string, LogEntry[]>();
  for (const l of done) { const k = l.key === 'nap' ? 'hobby:nap' : l.key; (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(l); }
  const out: Habit[] = [];
  for (const [key, entries] of [...byKey.entries()].sort()) {
    const user = existing.find(h => h.key === key && h.status !== 'learned');
    if (user) { out.push(user); continue; } // never overwrite confirmed/edited habits
    if (entries.length < 3) continue;
    const buckets = new Array(48).fill(0);
    const days = new Array(7).fill(0);
    const places = new Map<string, number>();
    let wDur = 0, wSum = 0, total = 0;
    const weeks = new Set<number>();
    for (const e of entries) {
      const t = e.actualStart ?? e.plannedStart ?? e.at;
      const end = e.actualEnd ?? e.plannedEnd ?? t + 30 * MIN;
      const w = decay(now - t);
      buckets[Math.floor(minutesOfDay(t) / 30)] += w;
      days[weekday(t)] += w;
      if (e.placeId) places.set(e.placeId, (places.get(e.placeId) ?? 0) + w);
      wDur += ((end - t) / MIN) * w; wSum += w; total += w;
      weeks.add(Math.floor(t / (7 * DAY)));
    }
    // Peak 1.5h window (3 buckets)
    let bestI = 0, bestV = -1;
    for (let i = 0; i < 48; i++) { const v = buckets[i] + 0.5 * ((buckets[i - 1] ?? 0) + (buckets[i + 1] ?? 0)); if (v > bestV + 1e-12) { bestV = v; bestI = i; } }
    bestV = (buckets[bestI - 1] ?? 0) + buckets[bestI] + (buckets[bestI + 1] ?? 0);
    const concentration = bestV / total;
    const nWeeks = Math.max(1, weeks.size);
    const meanPerDay = total / 7;
    const weekdays = days.map((v, i) => ({ v, i })).filter(d => d.v >= Math.max(meanPerDay * 1.2, total * 0.12)).map(d => d.i);
    const sampleFactor = 1 - Math.exp(-entries.length / 6);
    const confidence = Math.round(Math.min(1, concentration * sampleFactor * (weekdays.length ? 1 : 0.7)) * 100) / 100;
    const place = [...places.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    out.push({
      id: key, key, label: habitLabel(key), weekdays: weekdays.length === 7 || key.startsWith('meal:') && weekdays.length >= 5 ? [0, 1, 2, 3, 4, 5, 6] : weekdays,
      windowStart: bestI * 30, windowEnd: Math.min(1440, bestI * 30 + 60), durationMin: Math.round(wDur / wSum),
      placeId: place, confidence, samples: entries.length, status: 'learned',
    });
    void nWeeks;
  }
  // keep user-confirmed habits that have no fresh data
  for (const h of existing) if (h.status !== 'learned' && !out.some(o => o.key === h.key)) out.push(h);
  return out;
}

/** Energy by hour learned from focus tasks completed vs skipped. Blends with the prior. */
export function learnEnergy(logs: LogEntry[], now: Ms, prior: number[]): number[] {
  const pos = new Array(24).fill(0), neg = new Array(24).fill(0);
  for (const l of logs) {
    if (!l.focus) continue;
    const t = l.actualStart ?? l.plannedStart ?? l.at;
    const h = new Date(t).getHours(); const w = decay(now - t);
    if (l.action === 'completed') pos[h] += w; else if (l.action === 'skipped' || l.action === 'moved') neg[h] += w;
  }
  return prior.map((p, h) => {
    const n = pos[h] + neg[h];
    if (n < 0.5) return p;
    const observed = pos[h] / n;
    const k = Math.min(0.8, n / (n + 3)); // more evidence → trust data more
    return Math.round((p * (1 - k) + observed * k) * 100) / 100;
  });
}

/** Acceptance weights for suggestions (by key) in -1..1, decayed. */
export function learnAcceptance(logs: LogEntry[], now: Ms): Record<string, number> {
  const acc: Record<string, { p: number; n: number }> = {};
  for (const l of logs) {
    if (!l.key.startsWith('suggest:') && !l.key.startsWith('food:')) continue;
    const k = l.key.replace(/^suggest:/, '');
    const w = decay(now - l.at);
    const a = (acc[k] ??= { p: 0, n: 0 });
    if (l.action === 'accepted' || l.action === 'completed') a.p += w;
    else if (l.action === 'rejected' || l.action === 'skipped') a.n += w;
    else if (l.action === 'blocked') a.n += 5 * w;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) out[k] = (v.p - v.n) / (v.p + v.n + 1);
  return out;
}

export function lastDone(logs: LogEntry[], keyPrefix: string, blocks: Block[] = [], now = Infinity): Ms | undefined {
  let t: Ms | undefined;
  for (const l of logs) if (l.action === 'completed' && l.key.startsWith(keyPrefix)) t = Math.max(t ?? 0, l.actualStart ?? l.at);
  return t !== undefined && t <= now ? t : undefined;
}

export interface Insight { id: string; text: string; action?: { label: string; kind: 'protect' | 'suggest' | 'hold'; key: string } }

export function insights(habits: Habit[], logs: LogEntry[], now: Ms): Insight[] {
  const out: Insight[] = [];
  const dn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const list = (ds: number[]) => ds.length >= 7 ? 'every day' : ds.length >= 5 && ds.every(d => d >= 1 && d <= 5) ? 'on weekdays' : ds.map(d => dn[d]).join(' and ');
  for (const h of habits.filter(h => h.confidence >= 0.35).sort((a, b) => b.confidence - a.confidence)) {
    const time = fmtTime(at(startOfDay(now), h.windowStart));
    if (h.key === 'hobby:nap' && h.weekdays.length) out.push({ id: `i_${h.key}`, text: `You usually nap ${list(h.weekdays)} around ${time}, so I held that time.`, action: { label: 'Keep holding it', kind: 'hold', key: h.key } });
    else if (h.key.startsWith('meal:')) out.push({ id: `i_${h.key}`, text: `You usually eat ${h.label.toLowerCase()} around ${time}. Want me to protect it?`, action: { label: `Protect ${h.label.toLowerCase()}`, kind: 'protect', key: h.key } });
    else if (h.weekdays.length) out.push({ id: `i_${h.key}`, text: `${h.label} tends to happen ${list(h.weekdays)} around ${time} (${Math.round(h.confidence * 100)}% confident).` });
  }
  const friends = lastDone(logs, 'hobby:friends', [], now);
  if (friends !== undefined) {
    const days = Math.floor((now - friends) / DAY);
    if (days >= 7) out.push({ id: 'i_friends', text: `You haven't seen friends in ${days} days. Want me to suggest Saturday?`, action: { label: 'Suggest Saturday', kind: 'suggest', key: 'hobby:friends' } });
  }
  return out;
}

export const _hm = hm;
