import { useState } from 'react';
import type { Activity, Place, Routine, MealType, Energy, LocationTag } from '@engine/types';
import { mealIdeas, groceryTask } from '@engine/meals';
import { detectPlace } from '@engine/location';
import { addDays, startOfDay, fmtDur, uid, hashId } from '@engine/time';
import { useApp, store } from '../../data/store';
import * as A from '../../data/actions';
import { currentPosition } from '../../integrations/geo';
import { Btn, Card, Chip, Section, TagEditor, Field, inputCls, Sheet, cx } from '../ui';
import { FoodList } from '../components/CommandBar';
import { toast } from '../toast';

export function Life() {
  const [tab, setTab] = useState<'food' | 'hobbies' | 'places'>('food');
  return <div className="h-full overflow-y-auto px-3 pb-40">
    <div className="mb-3 flex gap-1.5">{(['food', 'hobbies', 'places'] as const).map(t => <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{t === 'food' ? '🍽 Food' : t === 'hobbies' ? '🎈 Hobbies & routines' : '📍 Places'}</Chip>)}</div>
    {tab === 'food' ? <Food /> : tab === 'hobbies' ? <Hobbies /> : <Places />}
  </div>;
}

function Food() {
  const food = useApp(s => s.food);
  const settings = useApp(s => s.settings);
  const [hungry, setHungry] = useState<number | null>(null);
  const [meal, setMeal] = useState<MealType>('dinner');
  const set = (p: Partial<typeof food>) => store().setKV('food', { ...food, ...p });
  const ideas = mealIdeas(food, meal, 3);
  return <>
    <Section title="Hungry?">
      <div className="flex gap-1.5">{[15, 30, 45, 60].map(m => <Chip key={m} active={hungry === m} onClick={() => setHungry(m)}>eat {m}</Chip>)}</div>
      {hungry && <div className="mt-2"><FoodList minutes={hungry} items={A.foodOptions(hungry)} onDone={() => setHungry(null)} /></div>}
    </Section>
    <Section title="Food profile">
      <Card className="space-y-2">
        <Field label="Favorite foods"><TagEditor values={food.favorites} onChange={v => set({ favorites: v })} /></Field>
        <Field label="Cuisines you like"><TagEditor values={food.cuisines} onChange={v => set({ cuisines: v })} /></Field>
        <Field label="Dislikes"><TagEditor values={food.dislikes} onChange={v => set({ dislikes: v })} /></Field>
        <Field label="Dietary choices"><div className="flex flex-wrap gap-1.5">{['vegetarian', 'vegan', 'pescatarian', 'no pork', 'halal', 'kosher', 'gluten-free', 'dairy-free', 'nut-free'].map(d => <Chip key={d} active={food.dietary.includes(d)} onClick={() => set({ dietary: food.dietary.includes(d) ? food.dietary.filter(x => x !== d) : [...food.dietary, d] })}>{d}</Chip>)}</div></Field>
        <Field label={`Usual budget per meal: ${settings.currency}${food.budget[0]}–${settings.currency}${food.budget[1]}`}>
          <input type="range" min={5} max={80} step={5} value={food.budget[1]} onChange={e => set({ budget: [food.budget[0], +e.target.value] })} className="w-full" />
        </Field>
        <p className="text-xs text-slate-500">Tip: type "I hate mushrooms" or "love Thai" in the bar below. Oroz also learns from what you pick and skip.</p>
      </Card>
    </Section>
    <Section title="Cook at home">
      <Card>
        <Field label="What's in the kitchen?"><textarea className={cx(inputCls, 'h-16')} value={food.kitchenNote ?? ''} onChange={e => set({ kitchenNote: e.target.value })} placeholder="rice, eggs, spinach…" /></Field>
        <div className="my-2 flex gap-1.5">{(['breakfast', 'lunch', 'dinner'] as MealType[]).map(m => <Chip key={m} active={meal === m} onClick={() => setMeal(m)}>{m}</Chip>)}</div>
        <ul className="space-y-1 text-sm">{ideas.map(i => <li key={i.id}>• <b>{i.name}</b> <span className="text-xs text-slate-500">{i.minutes}m · {i.ingredients.join(', ')}</span></li>)}</ul>
        <Btn className="mt-2 w-full" onClick={() => { const g = groceryTask(ideas, food.kitchenNote, Date.now()); if (!g) return toast('You have everything for these!'); store().upsert('tasks', [g]); A.placeTasks([g]); toast('Grocery run added and scheduled'); }}>🛒 Plan these + grocery list</Btn>
        <p className="mt-2 text-[11px] text-slate-500">Suggestions aim for balanced, varied meals. No calorie targets unless you turn on tracking yourself.</p>
        <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={!!food.tracking} onChange={e => set({ tracking: e.target.checked })} /> Optional nutrition tracking (off by default)</label>
      </Card>
    </Section>
    <Section title="Meal windows (protected like sleep)">
      <Card className="space-y-1">{settings.meals.map((m, i) => <div key={m.type} className="flex items-center gap-2 text-sm">
        <span className="w-20 capitalize">{m.type}</span>
        <input type="time" className="rounded bg-slate-100 px-1 dark:bg-white/5" value={m.window[0]} onChange={e => saveMeal(i, { window: [e.target.value, m.window[1]] })} />–
        <input type="time" className="rounded bg-slate-100 px-1 dark:bg-white/5" value={m.window[1]} onChange={e => saveMeal(i, { window: [m.window[0], e.target.value] })} />
        <span className="text-xs text-slate-500">{m.durationMin}m</span>
      </div>)}
        <p className="text-xs text-slate-500">If you'd go more than {fmtDur(settings.maxMealGapMin)} without food (say, a late practice), Oroz slots in a snack and reminds you beforehand.</p>
      </Card>
    </Section>
  </>;
}
function saveMeal(i: number, patch: object) {
  const s = store().state.settings;
  store().setKV('settings', { ...s, meals: s.meals.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
}

function Hobbies() {
  const activities = useApp(s => s.activities);
  const routines = useApp(s => s.routines);
  const blocks = useApp(s => s.blocks);
  const [edit, setEdit] = useState<Activity | null>(null);
  const weekStart = addDays(startOfDay(Date.now()), -new Date().getDay());
  const count = (a: Activity) => blocks.filter(b => b.activityId === a.id && b.start >= weekStart && b.start < addDays(weekStart, 7) && b.status !== 'skipped').length;
  return <>
    <Section title="Life activities" right={<Btn kind="ghost" className="text-xs" onClick={() => setEdit({ id: uid('act'), name: '', durationMin: 60, energy: 'neutral', category: 'other' })}>＋ Add</Btn>}>
      <div className="space-y-2">{activities.map(a => <Card key={a.id} className="flex items-center justify-between p-2.5" onClick={() => setEdit(a)}>
        <div><div className="font-medium">{a.name}</div><div className="text-xs text-slate-500">{fmtDur(a.durationMin)} · {a.energy}{a.location && a.location !== 'anywhere' ? ` · ${a.location}` : ''}</div></div>
        {a.weeklyTarget ? <div className="text-right"><div className="text-sm font-semibold tabular-nums">{count(a)}/{a.weeklyTarget}</div><div className="text-[10px] text-slate-500">this week</div></div> : <span className="text-xs text-slate-400">no target</span>}
      </Card>)}</div>
      <p className="mt-2 text-xs text-slate-500">Weekly targets are worked into your plan before non-urgent work, and Oroz always keeps at least {fmtDur(store().state.settings.minFreeMinPerDay)} a day completely unscheduled.</p>
    </Section>
    <Section title="Routines">
      <div className="space-y-2">{routines.map(r => <Card key={r.id} className="p-2.5">
        <div className="flex items-center justify-between"><div className="font-medium">{r.title}</div><span className="text-xs text-slate-500">{r.start} · {fmtDur(r.durationMin)}</span></div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Chip key={i} active={r.days.includes(i)} onClick={() => saveRoutine({ ...r, days: r.days.includes(i) ? r.days.filter(x => x !== i) : [...r.days, i].sort() })}>{d}</Chip>)}
          <span className="w-2" />
          {(['fixed', 'movable', 'optional'] as const).map(f => <Chip key={f} active={r.flexibility === f} onClick={() => saveRoutine({ ...r, flexibility: f })}>{f}</Chip>)}
        </div>
      </Card>)}</div>
      <Btn className="mt-2 w-full" onClick={() => saveRoutine({ id: uid('rt'), title: 'Workout', kind: 'routine', days: [1, 3, 5], start: '17:00', durationMin: 45, flexibility: 'movable', windowMin: 90 })}>＋ Add routine</Btn>
    </Section>
    <ActivitySheet a={edit} onClose={() => setEdit(null)} />
  </>;
}
const saveRoutine = (r: Routine) => { store().upsert('routines', [r]); toast('Routine saved — re-plan to apply'); };

function ActivitySheet({ a, onClose }: { a: Activity | null; onClose: () => void }) {
  const [x, setX] = useState<Activity | null>(a);
  if (a && (!x || x.id !== a.id)) setX(a);
  if (!a || !x) return null;
  const set = (p: Partial<Activity>) => setX({ ...x, ...p });
  return <Sheet open onClose={onClose} title={a.name || 'New activity'}>
    <Field label="Name"><input className={inputCls} value={x.name} onChange={e => set({ name: e.target.value })} /></Field>
    <Field label="Category"><div className="flex flex-wrap gap-1.5">{(['movie', 'reading', 'nap', 'gaming', 'friends', 'going-out', 'gym', 'family', 'other'] as const).map(c => <Chip key={c} active={x.category === c} onClick={() => set({ category: c, social: c === 'friends' || c === 'going-out' })}>{c}</Chip>)}</div></Field>
    <Field label="Typical length"><div className="flex flex-wrap gap-1.5">{[20, 30, 45, 60, 90, 120, 180].map(d => <Chip key={d} active={x.durationMin === d} onClick={() => set({ durationMin: d })}>{fmtDur(d)}</Chip>)}</div></Field>
    <Field label="Energy"><div className="flex gap-1.5">{(['energizing', 'neutral', 'draining'] as Energy[]).map(e => <Chip key={e} active={x.energy === e} onClick={() => set({ energy: e })}>{e}</Chip>)}</div></Field>
    <Field label="Where"><div className="flex flex-wrap gap-1.5">{(['anywhere', 'home', 'outside', 'gym', 'quiet'] as LocationTag[]).map(l => <Chip key={l} active={(x.location ?? 'anywhere') === l} onClick={() => set({ location: l })}>{l}</Chip>)}</div></Field>
    <Field label="Weekly target"><div className="flex gap-1.5">{[0, 1, 2, 3, 4, 5, 7].map(n => <Chip key={n} active={(x.weeklyTarget ?? 0) === n} onClick={() => set({ weeklyTarget: n || undefined })}>{n ? `${n}x` : 'none'}</Chip>)}</div></Field>
    <div className="mt-3 flex gap-2"><Btn kind="primary" className="flex-1" onClick={() => { if (x.name) store().upsert('activities', [x]); onClose(); }}>Save</Btn><Btn kind="danger" onClick={() => { store().remove('activities', [x.id]); onClose(); }}>Delete</Btn></div>
  </Sheet>;
}

function Places() {
  const places = useApp(s => s.places);
  const travel = useApp(s => s.travel);
  const current = useApp(s => s.currentPlaceId);
  const src = useApp(s => s.placeSource);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const detect = async (addNew?: string) => {
    setBusy(true);
    try {
      const pos = await currentPosition();
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (addNew) {
        const p: Place = { id: uid('place'), name: addNew, lat, lng, radiusM: Math.max(80, Math.min(300, accuracy * 2)), tags: [] };
        store().upsert('places', [p]); store().setKV('currentPlaceId', p.id); toast(`Saved ${addNew} here`);
      } else {
        const hit = detectPlace(lat, lng, places, accuracy);
        store().setKV('currentPlaceId', hit?.id); store().setKV('placeSource', 'gps');
        toast(hit ? `You're at ${hit.name}` : "You're not at any saved place");
      }
    } catch (e) { toast(`Location unavailable: ${(e as Error).message}. You can pick your place manually.`); }
    finally { setBusy(false); }
  };
  const [newName, setNewName] = useState('');
  return <>
    {!asked && <Card className="mb-3 bg-indigo-50 text-sm dark:bg-indigo-500/10">
      <b>Why location?</b> Oroz checks which of your saved places you're at, so "30 here" suggests things you can actually do here. It runs only when you tap, stays on this device, and no location history is kept or sent anywhere.
      <div className="mt-2"><Btn kind="primary" disabled={busy} onClick={() => { setAsked(true); detect(); }}>{busy ? 'Locating…' : '📍 Detect where I am'}</Btn></div>
    </Card>}
    {asked && <Btn className="mb-3 w-full" disabled={busy} onClick={() => detect()}>{busy ? 'Locating…' : '📍 Detect again'}</Btn>}
    <Section title={`I'm at (${src === 'gps' ? 'detected' : 'manual'}) — tap to override`}>
      <div className="flex flex-wrap gap-1.5">{places.map(p => <Chip key={p.id} active={current === p.id} onClick={() => { store().setKV('currentPlaceId', p.id); store().setKV('placeSource', 'manual'); }}>{p.name}</Chip>)}<Chip active={!current} onClick={() => store().setKV('currentPlaceId', undefined)}>somewhere else</Chip></div>
    </Section>
    <Section title="Saved places">
      <div className="space-y-2">{places.map(p => <Card key={p.id} className="p-2.5">
        <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span><span className="text-xs text-slate-500">{p.radiusM}m radius</span></div>
        <div className="mt-1.5 flex flex-wrap gap-1">{(['home', 'school', 'quiet', 'gym'] as LocationTag[]).map(t => <Chip key={t} active={p.tags.includes(t)} onClick={() => store().upsert('places', [{ ...p, tags: p.tags.includes(t) ? p.tags.filter(x => x !== t) : [...p.tags, t] }])}>{t}</Chip>)}
          <button className="ml-auto text-xs text-rose-600" onClick={() => store().remove('places', [p.id])}>remove</button></div>
      </Card>)}</div>
      <div className="mt-2 flex gap-2"><input className={inputCls} placeholder="Name this spot (e.g. Library)" value={newName} onChange={e => setNewName(e.target.value)} /><Btn disabled={!newName || busy} onClick={() => { detect(newName); setNewName(''); }}>Save here</Btn></div>
    </Section>
    <Section title="Typical travel times">
      <Card className="space-y-1">{travel.map(t => <div key={t.id} className="flex items-center justify-between text-sm">
        <span>{places.find(p => p.id === t.from)?.name} ↔ {places.find(p => p.id === t.to)?.name}</span>
        <input type="number" className="w-16 rounded bg-slate-100 px-1 text-right dark:bg-white/5" value={t.minutes} onChange={e => store().upsert('travel', [{ ...t, minutes: +e.target.value }])} /> <span className="text-xs">min</span>
      </div>)}
        <AddTravel />
      </Card>
    </Section>
  </>;
}
function AddTravel() {
  const places = useApp(s => s.places);
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [m, setM] = useState(10);
  return <div className="flex flex-wrap items-center gap-1 pt-2 text-sm">
    <select className="rounded bg-slate-100 px-1 py-1 dark:bg-white/5" value={a} onChange={e => setA(e.target.value)}><option value="">from…</option>{places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <select className="rounded bg-slate-100 px-1 py-1 dark:bg-white/5" value={b} onChange={e => setB(e.target.value)}><option value="">to…</option>{places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <input type="number" className="w-14 rounded bg-slate-100 px-1 py-1 dark:bg-white/5" value={m} onChange={e => setM(+e.target.value)} />
    <Btn className="px-2 py-1 text-xs" disabled={!a || !b || a === b} onClick={() => store().upsert('travel', [{ id: `${a}_${b}_${hashId(a + b)}`, from: a, to: b, minutes: m }])}>Add</Btn>
  </div>;
}
