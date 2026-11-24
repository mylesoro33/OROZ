import { useState } from 'react';
import type { Activity } from '@engine/types';
import { uid } from '@engine/time';
import { store } from '../../data/store';
import * as A from '../../data/actions';
import { Btn, Chip, Field, TagEditor, inputCls } from '../ui';
import { toast } from '../toast';

const HOBBIES: { name: string; category: Activity['category']; durationMin: number; energy: Activity['energy'] }[] = [
  { name: 'Reading', category: 'reading', durationMin: 30, energy: 'neutral' },
  { name: 'Movies', category: 'movie', durationMin: 120, energy: 'neutral' },
  { name: 'Gaming', category: 'gaming', durationMin: 60, energy: 'neutral' },
  { name: 'Gym / sports', category: 'gym', durationMin: 60, energy: 'energizing' },
  { name: 'Friends', category: 'friends', durationMin: 120, energy: 'energizing' },
  { name: 'Family time', category: 'family', durationMin: 60, energy: 'neutral' },
  { name: 'Music / art', category: 'other', durationMin: 45, energy: 'energizing' },
];

/** Short cold-start quiz. Everything has a default; every step is skippable. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const st = store().state;
  const [step, setStep] = useState(0);
  const [bed, setBed] = useState(st.settings.bedtime);
  const [wake, setWake] = useState(st.settings.wake);
  const [lunch, setLunch] = useState(st.settings.meals.find(m => m.type === 'lunch')?.window[0] ?? '11:30');
  const [dinner, setDinner] = useState('18:30');
  const [likes, setLikes] = useState<string[]>(st.food.cuisines);
  const [dislikes, setDislikes] = useState<string[]>(st.food.dislikes);
  const [hobbies, setHobbies] = useState<string[]>(st.activities.map(a => a.name));
  const [nightsOut, setNightsOut] = useState(1);
  const [nap, setNap] = useState<'never' | 'sometimes' | 'often'>('sometimes');
  const [napLen, setNapLen] = useState(st.settings.napLengthMin);

  const finish = () => {
    const s = store().state;
    const shift = (t: string, mins: number) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + mins; return `${String(Math.floor(((x % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((x % 60) + 60) % 60).padStart(2, '0')}`; };
    const meals = s.settings.meals.map(m => m.type === 'lunch' ? { ...m, window: [shift(lunch, -45), shift(lunch, 60)] as [string, string] } : m.type === 'dinner' ? { ...m, window: [shift(dinner, -60), shift(dinner, 90)] as [string, string] } : m);
    store().setKV('settings', { ...s.settings, bedtime: bed, wake, meals, napLengthMin: napLen, onboarded: true });
    store().setKV('food', { ...s.food, cuisines: likes, dislikes });
    const existing = new Map(s.activities.map(a => [a.name, a]));
    const acts: Activity[] = hobbies.map(n => existing.get(n) ?? (() => { const h = HOBBIES.find(x => x.name === n)!; return { id: uid('act'), name: h.name, category: h.category, durationMin: h.durationMin, energy: h.energy, weeklyTarget: 2 }; })());
    const friends = acts.find(a => a.category === 'friends' || a.category === 'going-out');
    if (friends) friends.weeklyTarget = nightsOut || undefined;
    if (nap !== 'never' && !acts.some(a => a.category === 'nap')) acts.push({ id: uid('act'), name: 'Nap', category: 'nap', durationMin: napLen, energy: 'energizing', weeklyTarget: nap === 'often' ? 3 : undefined, location: 'home' });
    store().remove('activities', s.activities.filter(a => !acts.some(x => x.id === a.id)).map(a => a.id));
    store().upsert('activities', acts);
    A.runPlan('week');
    toast('All set — your week is planned around you');
    onDone();
  };

  const steps = [
    <><h2 className="text-xl font-bold">Hi, I'm Oroz 👋</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Tell me a few things and I'll answer one question fast: <b>"I have X minutes at Y — what should I do?"</b></p><p className="mt-2 text-xs text-slate-500">Demo data is loaded so you can look around. Everything stays on this device.</p></>,
    <><h2 className="text-lg font-bold">😴 Sleep</h2><div className="grid grid-cols-2 gap-2"><Field label="Bedtime"><input type="time" className={inputCls} value={bed} onChange={e => setBed(e.target.value)} /></Field><Field label="Wake up"><input type="time" className={inputCls} value={wake} onChange={e => setWake(e.target.value)} /></Field></div><p className="text-xs text-slate-500">I'll protect this and never schedule over it.</p></>,
    <><h2 className="text-lg font-bold">🍽 Meals</h2><div className="grid grid-cols-2 gap-2"><Field label="Usual lunch"><input type="time" className={inputCls} value={lunch} onChange={e => setLunch(e.target.value)} /></Field><Field label="Usual dinner"><input type="time" className={inputCls} value={dinner} onChange={e => setDinner(e.target.value)} /></Field></div>
      <Field label="Foods / cuisines you love"><TagEditor values={likes} onChange={setLikes} placeholder="thai, pasta…" /></Field><Field label="Can't stand"><TagEditor values={dislikes} onChange={setDislikes} placeholder="mushrooms…" /></Field></>,
    <><h2 className="text-lg font-bold">🎈 Your life stuff</h2><div className="flex flex-wrap gap-1.5">{HOBBIES.map(h => <Chip key={h.name} active={hobbies.includes(h.name)} onClick={() => setHobbies(hobbies.includes(h.name) ? hobbies.filter(x => x !== h.name) : [...hobbies, h.name])}>{h.name}</Chip>)}</div>
      <Field label="Nights out with friends per week"><div className="flex gap-1.5">{[0, 1, 2, 3].map(n => <Chip key={n} active={nightsOut === n} onClick={() => setNightsOut(n)}>{n}</Chip>)}</div></Field></>,
    <><h2 className="text-lg font-bold">💤 Naps</h2><div className="flex gap-1.5">{(['never', 'sometimes', 'often'] as const).map(n => <Chip key={n} active={nap === n} onClick={() => setNap(n)}>{n}</Chip>)}</div>
      {nap !== 'never' && <Field label={`Usual nap length: ${napLen} min`}><input type="range" min={10} max={90} step={5} value={napLen} onChange={e => setNapLen(+e.target.value)} className="w-full" /></Field>}</>,
  ];
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center">
    <div className="pop w-full max-w-md rounded-t-3xl bg-white p-5 pb-8 dark:bg-[#15151f] sm:rounded-3xl safe-bottom">
      <div className="mb-4 flex gap-1">{steps.map((_, i) => <div key={i} className={`h-1 flex-1 rounded ${i <= step ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-white/10'}`} />)}</div>
      <div className="min-h-48">{steps[step]}</div>
      <div className="mt-4 flex gap-2">
        <Btn kind="ghost" onClick={() => { store().setKV('settings', { ...store().state.settings, onboarded: true }); onDone(); }}>Skip</Btn>
        <div className="flex-1" />
        {step > 0 && <Btn onClick={() => setStep(step - 1)}>Back</Btn>}
        {step < steps.length - 1 ? <Btn kind="primary" onClick={() => setStep(step + 1)}>Next</Btn> : <Btn kind="primary" onClick={finish}>Plan my week ✨</Btn>}
      </div>
    </div>
  </div>;
}
