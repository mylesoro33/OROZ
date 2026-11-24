import { useState } from 'react';
import type { Person, Occasion } from '@engine/types';
import { personOccasions, holidays, occasionStages, stagesToTasks, giftIdeas, leadDaysFor, isInLeadWindow } from '@engine/occasions';
import { planDining, diningTimeline, restaurantLinks, type Restaurant, type DiningPlan } from '@engine/dining';
import { buildReminder } from '@engine/reminders';
import { fmtDay, fmtTime, uid, MIN, DAY, startOfDay } from '@engine/time';
import { useApp, store } from '../../data/store';
import * as A from '../../data/actions';
import { searchRestaurants } from '../../integrations/places';
import { Btn, Card, Chip, Section, Sheet, Field, TagEditor, inputCls, cx } from '../ui';
import { toast } from '../toast';

export function People() {
  const people = useApp(s => s.people);
  const [sel, setSel] = useState<Person | null>(null);
  const [dining, setDining] = useState<{ occasion?: Occasion; guests: string[] } | null>(null);
  const now = Date.now();
  const occ = [...personOccasions(people, now), ...holidays(now)].sort((a, b) => a.date - b.date).slice(0, 10);
  return <div className="h-full overflow-y-auto px-3 pb-40">
    <Section title="Coming up">
      <div className="space-y-2">{occ.map(o => {
        const p = people.find(x => x.id === o.personId);
        const days = Math.round((o.date - startOfDay(now)) / DAY);
        const st = occasionStages(o, p, now);
        const nextStage = st.find(s => s.due >= now);
        const inLead = isInLeadWindow(o, p, now);
        return <Card key={o.id} className="p-2.5">
          <div className="flex items-start justify-between gap-2">
            <button className="text-left" onClick={() => p && setSel(p)}><div className="font-medium">{o.kind === 'holiday' ? ({ Christmas: '🎄', Thanksgiving: '🦃', Halloween: '🎃', "Valentine's Day": '💝', "New Year's Eve": '🎆' } as Record<string, string>)[o.title] ?? '💐' : o.kind === 'anniversary' ? '💍' : '🎂'} {o.title}</div>
              <div className="text-xs text-slate-500">{fmtDay(o.date, now)} · in {days} days · prep starts {leadDaysFor(o, p)} days out</div></button>
            {inLead && <span className="shrink-0 rounded-full bg-pink-100 px-2 py-0.5 text-[11px] font-semibold text-pink-800">prep time</span>}
          </div>
          {inLead && nextStage && <div className="mt-1 text-xs">Next: <b>{nextStage.title}</b> by {fmtDay(nextStage.due, now)}</div>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Btn className="px-2 py-1 text-xs" onClick={() => { const tasks = stagesToTasks(o, st, now); const have = new Set(store().state.tasks.map(t => t.id)); const add = tasks.filter(t => !have.has(t.id)); store().upsert('tasks', add); A.placeTasks(add, 60); toast(add.length ? `Scheduled ${add.length} prep steps` : 'Prep steps are already scheduled'); }}>📋 {o.kind === 'holiday' ? 'Prep checklist' : 'Plan gift & prep'}</Btn>
            <Btn className="px-2 py-1 text-xs" onClick={() => setDining({ occasion: o, guests: p ? [p.id] : [] })}>🍽 Dinner ideas</Btn>
          </div>
        </Card>;
      })}</div>
    </Section>
    <Section title="People" right={<Btn kind="ghost" className="text-xs" onClick={() => setSel(A.findOrCreatePerson('New person'))}>＋ Add</Btn>}>
      <div className="grid grid-cols-2 gap-2">{people.map(p => <Card key={p.id} className="p-2.5" onClick={() => setSel(p)}>
        <div className="font-medium">{p.name}</div>
        <div className="text-xs text-slate-500">{p.relationship} · {'●'.repeat(4 - p.closeness)}{p.birthday ? ` · 🎂 ${p.birthday.month}/${p.birthday.day}` : ''}</div>
        <div className="mt-1 truncate text-xs">{[...p.interests, ...p.foodLikes].join(', ')}</div>
      </Card>)}</div>
      <p className="mt-2 text-xs text-slate-500">Only what you typed or imported from your own contacts. Stored on this device. Add notes fast: "Jake likes fishing", "Mom is vegetarian".</p>
      <Btn className="mt-2 w-full" onClick={() => setDining({ guests: [] })}>🍽 Plan a group dinner</Btn>
    </Section>
    <PersonSheet p={sel} onClose={() => setSel(null)} />
    {dining && <DiningSheet {...dining} onClose={() => setDining(null)} />}
  </div>;
}

function PersonSheet({ p, onClose }: { p: Person | null; onClose: () => void }) {
  const live = useApp(s => (p ? s.people.find(x => x.id === p.id) : undefined));
  const [gift, setGift] = useState('');
  if (!p || !live) return null;
  const set = (patch: Partial<Person>) => store().upsert('people', [{ ...live, ...patch }]);
  const ideas = giftIdeas(live);
  return <Sheet open onClose={onClose}>
    <input className="mb-2 w-full bg-transparent text-lg font-semibold outline-none" value={live.name} onChange={e => set({ name: e.target.value })} />
    <div className="grid grid-cols-2 gap-2">
      <Field label="Relationship"><input className={inputCls} value={live.relationship} onChange={e => set({ relationship: e.target.value })} /></Field>
      <Field label="Budget"><input type="number" className={inputCls} value={live.budget ?? ''} onChange={e => set({ budget: +e.target.value || undefined })} /></Field>
      <Field label="Birthday"><input type="date" className={inputCls} value={live.birthday ? `2000-${String(live.birthday.month).padStart(2, '0')}-${String(live.birthday.day).padStart(2, '0')}` : ''} onChange={e => { const [, m, d] = e.target.value.split('-').map(Number); set({ birthday: m ? { month: m, day: d } : undefined }); A.syncOccasions(); }} /></Field>
      <Field label="Closeness"><div className="flex gap-1">{([1, 2, 3] as const).map(c => <Chip key={c} active={live.closeness === c} onClick={() => set({ closeness: c })}>{['', 'close', 'friend', 'acquaint.'][c]}</Chip>)}</div></Field>
    </div>
    <Field label="Interests"><TagEditor values={live.interests} onChange={v => set({ interests: v })} /></Field>
    <Field label="Food they like"><TagEditor values={live.foodLikes} onChange={v => set({ foodLikes: v })} /></Field>
    <Field label="Dietary needs"><TagEditor values={live.dietary} onChange={v => set({ dietary: v })} placeholder="vegetarian, no nuts…" /></Field>
    <Field label="Notes"><TagEditor values={live.notes} onChange={v => set({ notes: v })} /></Field>
    <Section title="Gift ideas" className="mt-3">
      <div className="space-y-1">{ideas.map(g => <div key={g.idea} className="flex items-center justify-between gap-2 text-sm">
        <span>{g.withinBudget ? '🎁' : '💸'} {g.idea} <span className="text-xs text-slate-500">~{store().state.settings.currency}{g.approx} · {g.why}</span></span>
        <a className="shrink-0 text-xs text-indigo-600" href={g.searchUrl} target="_blank" rel="noreferrer">search ↗</a>
      </div>)}</div>
      <div className="mt-2 flex gap-2"><input className={inputCls} placeholder="Save a gift idea" value={gift} onChange={e => setGift(e.target.value)} /><Btn disabled={!gift} onClick={() => { set({ giftIdeas: [...live.giftIdeas, gift] }); setGift(''); }}>Save</Btn></div>
      {live.pastGifts.length > 0 && <p className="mt-2 text-xs text-slate-500">Past gifts: {live.pastGifts.map(g => `${g.gift} (${g.year})`).join(', ')}</p>}
    </Section>
    <Btn kind="danger" className="mt-2" onClick={() => { store().remove('people', [live.id]); onClose(); }}>Delete person</Btn>
  </Sheet>;
}

function DiningSheet({ occasion, guests: initial, onClose }: { occasion?: Occasion; guests: string[]; onClose: () => void }) {
  const people = useApp(s => s.people);
  const st = useApp(s => s);
  const [guests, setGuests] = useState<string[]>(initial);
  const [party, setParty] = useState(Math.max(2, initial.length + 1));
  const [budget, setBudget] = useState(st.food.budget[1]);
  const [area, setArea] = useState(st.settings.searchArea ?? '');
  const [results, setResults] = useState<Restaurant[] | null>(null);
  const [manual, setManual] = useState('');
  const [loading, setLoading] = useState(false);
  const now = Date.now();
  const target = occasion?.date ?? now + 3 * DAY;
  const guestPeople = people.filter(p => guests.includes(p.id));
  const restaurants = [...(results ?? []), ...st.restaurants];
  const plan: DiningPlan = planDining({ title: occasion?.title ?? 'Group dinner', date: target, guests: guestPeople, me: st.food, partySize: party, budgetPerPerson: budget, areaLabel: area, fromLabel: st.places.find(p => p.id === st.currentPlaceId)?.name, restaurants });
  const tl = diningTimeline({ targetDay: target, now, blocks: st.blocks, settings: st.settings, partySize: party });
  const placesOn = st.settings.flags.places && !!st.settings.placesApiKey;

  const search = async () => {
    setLoading(true);
    try { const q = `${plan.groupLikes[0] ?? ''} restaurant ${plan.groupDiets.filter(d => ['vegetarian', 'vegan', 'gluten-free', 'halal'].includes(d)).join(' ')} ${area}`.trim(); setResults(await searchRestaurants(st.settings.placesApiKey!, q)); }
    catch (e) { toast(`Places search failed: ${(e as Error).message}`); }
    finally { setLoading(false); }
  };

  const confirm = (name: string, r?: Restaurant) => {
    if (!tl) return;
    const b = A.createBlock({ title: `${occasion?.title ? occasion.title + ': ' : ''}Dinner at ${name}`, kind: 'reservation', mealType: 'dinner', start: tl.dinnerAt, end: tl.dinnerAt + 90 * MIN, flexibility: 'fixed', importance: 'aggressive', reason: `Reserved for ${party}`, notes: name });
    const rems = [
      buildReminder({ id: uid('rem'), itemId: `${b.id}_confirm`, itemType: 'reminder', title: `Confirm reservation at ${name} (party of ${party})`, dueAt: tl.confirmAt, importance: 'normal', now, settings: st.settings, leadMin: 0 }),
      buildReminder({ id: uid('rem'), itemId: `${b.id}_leave`, itemType: 'reminder', title: `Leave for ${name}`, dueAt: tl.leaveAt, importance: 'aggressive', now, settings: st.settings, leadMin: 10 }),
    ];
    store().upsert('reminders', rems);
    if (r && !st.restaurants.some(x => x.id === r.id)) store().setKV('restaurants', [...st.restaurants, r].slice(-30));
    toast(`Added to your calendar: ${fmtDay(tl.dinnerAt, now)} ${fmtTime(tl.dinnerAt)} + confirm & leave reminders`);
    onClose();
  };

  return <Sheet open onClose={onClose} title={`🍽 ${occasion?.title ?? 'Group dinner'}`}>
    <Field label="Who's coming?"><div className="flex flex-wrap gap-1.5">{people.map(p => <Chip key={p.id} active={guests.includes(p.id)} onClick={() => { const g = guests.includes(p.id) ? guests.filter(x => x !== p.id) : [...guests, p.id]; setGuests(g); setParty(Math.max(party, g.length + 1)); }}>{p.name}{p.dietary.length ? ` (${p.dietary.join(', ')})` : ''}</Chip>)}</div></Field>
    <div className="grid grid-cols-3 gap-2">
      <Field label="Party size"><input type="number" className={inputCls} value={party} min={1} onChange={e => setParty(+e.target.value)} /></Field>
      <Field label="Budget pp"><input type="number" className={inputCls} value={budget} onChange={e => setBudget(+e.target.value)} /></Field>
      <Field label="Area"><input className={inputCls} value={area} onChange={e => setArea(e.target.value)} placeholder="neighborhood" /></Field>
    </div>

    {tl ? <Card className="my-2 bg-indigo-50 text-sm dark:bg-indigo-500/10">
      <div><b>Best time:</b> {fmtDay(tl.dinnerAt, now)} {fmtTime(tl.dinnerAt)} <span className="text-xs text-slate-500">({tl.why})</span></div>
      <div className="mt-1 text-xs">📞 Reserve by {fmtDay(tl.reserveBy, now)} · ✅ Confirm {fmtDay(tl.confirmAt, now)} {fmtTime(tl.confirmAt)} · 🚶 Leave {fmtTime(tl.leaveAt)}</div>
      {tl.alternatives.length > 0 && <div className="mt-1 text-xs text-slate-500">Also free: {tl.alternatives.map(a => `${fmtDay(a, now)} ${fmtTime(a)}`).join(', ')}</div>}
    </Card> : <p className="my-2 text-sm text-rose-600">No free evening near that date — clear something or pick another day.</p>}

    {plan.groupDiets.length > 0 && <p className="text-xs">Must work for: <b>{plan.groupDiets.join(', ')}</b></p>}

    <Section title="Good fit for everyone" className="mt-3">
      {placesOn ? <Btn className="mb-2 w-full" disabled={loading} onClick={search}>{loading ? 'Searching…' : '🔎 Search real restaurants (Places API)'}</Btn>
        : <p className="mb-2 text-xs text-slate-500">No places API configured, so Oroz won't guess restaurant names. Use the search links + checklist below, then add the place you pick.</p>}
      <div className="space-y-2">{plan.shortlist.map(s => <Card key={s.restaurant.id} className="p-2.5">
        <div className="font-semibold">{s.restaurant.name}</div>
        <div className="text-xs">{s.reasons.join(', ')}</div>
        {s.caveats.length > 0 && <div className="text-xs text-amber-700">⚠ {s.caveats.join(' · ')}</div>}
        <div className="mt-1.5 flex flex-wrap gap-2 text-xs">{restaurantLinks(s.restaurant, { partySize: party }, tl?.dinnerAt).map(l => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">{l.label}</a>)}</div>
        <Btn kind="primary" className="mt-2 w-full px-2 py-1.5 text-xs" disabled={!tl} onClick={() => confirm(s.restaurant.name, s.restaurant)}>I reserved it → add to calendar</Btn>
      </Card>)}</div>
      {plan.excluded.length > 0 && <p className="mt-2 text-xs text-slate-500">Left out: {plan.excluded.map(e => `${e.restaurant.name} (${e.why.join(', ')})`).join('; ')}</p>}
    </Section>

    <Section title="Checklist + search">
      <ul className="text-sm">{plan.checklist.map(c => <li key={c}>☐ {c}</li>)}</ul>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">{plan.searchLinks.map(l => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-100 px-2 py-1 text-indigo-700 dark:bg-white/10 dark:text-indigo-300">{l.label} ↗</a>)}</div>
      <div className="mt-3 flex gap-2"><input className={inputCls} placeholder="Restaurant you picked" value={manual} onChange={e => setManual(e.target.value)} />
        <Btn kind="primary" disabled={!manual || !tl} onClick={() => confirm(manual)}>Reserved ✓</Btn></div>
      <p className="mt-2 text-[11px] text-slate-500">Oroz never books or pays. It prepares links and timing, and adds the reservation to your calendar only after you confirm.</p>
    </Section>
  </Sheet>;
}
export const _cx = cx;
