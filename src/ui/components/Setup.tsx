import { useState } from 'react';
import { Camera, ImagePlus, Link2, Mic, X } from 'lucide-react';
import type { Place, PlaceKind, Occupation } from '@engine/types';
import { uid } from '@engine/time';
import { store } from '../../data/store';
import { openTalk, go, pickPhotos, openPhotoImport } from '../nav';
import { Btn, Chip, inputCls } from '../ui';
import { AGES, OCCUPATIONS } from '../views/Profile';

const QUICK: [PlaceKind, string][] = [['gym', 'Gym'], ['work', 'Work'], ['school', 'School'], ['church', 'Church'], ['friend', "Friend's place"], ['coffee', 'Coffee shop'], ['relative', "Relative's house"]];

/** First launch: six questions, one at a time, all skippable. */
export function Setup({ onDone }: { onDone: () => void }) {
  const p0 = store().state.profile;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(p0.name ?? '');
  const [age, setAge] = useState(p0.ageRange);
  const [occ, setOcc] = useState<Occupation | undefined>(p0.occupation);
  const [detail, setDetail] = useState(p0.occupationDetail ?? '');
  const [home, setHome] = useState(p0.hometown ?? '');
  const [city, setCity] = useState(p0.city ?? '');
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeName, setPlaceName] = useState('');

  const save = () => {
    store().set('profile', { ...store().state.profile, name: name.trim() || undefined, ageRange: age, occupation: occ, occupationDetail: detail.trim() || undefined, hometown: home.trim() || undefined, city: city.trim() || undefined, setupDone: true });
    store().upsert('places', places);
  };
  const finish = (then?: () => void) => { save(); onDone(); then?.(); };
  const addPlace = (kind: PlaceKind, label: string) => { const n = label.trim(); if (!n || places.some(p => p.name.toLowerCase() === n.toLowerCase())) return; setPlaces([...places, { id: uid('place'), name: n, kind }]); };

  const steps: { q: string; hint?: string; body: React.ReactNode }[] = [
    { q: 'What should I call you?', body: <input autoFocus className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" onKeyDown={e => e.key === 'Enter' && setStep(1)} /> },
    { q: 'Roughly how old are you?', hint: 'Helps OROZ surface dates that matter to you.', body: <div className="flex flex-wrap gap-2">{AGES.map(a => <Chip key={a} active={age === a} onClick={() => setAge(a)} className="px-3 py-1.5 text-sm">{a}</Chip>)}</div> },
    { q: 'What do you do?', body: <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{OCCUPATIONS.map(o => <Chip key={o.key} active={occ === o.key} onClick={() => setOcc(o.key)} className="px-3 py-1.5 text-sm">{o.label}</Chip>)}</div>
      {occ && !['home', 'retired'].includes(occ) && <input className={inputCls} value={detail} onChange={e => setDetail(e.target.value)} placeholder={occ === 'student' ? 'Grade or level, e.g. 11th grade' : 'Kind of work and usual hours'} />}
    </div> },
    { q: 'Where are you from, and where do you live now?', body: <div className="space-y-2"><input className={inputCls} value={home} onChange={e => setHome(e.target.value)} placeholder="Hometown" /><input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="Where you live now (City, State)" /></div> },
    { q: 'Where do you go often?', hint: 'Add as many as you like.', body: <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{QUICK.map(([k, l]) => <Chip key={k} active={places.some(p => p.kind === k)} onClick={() => addPlace(k, l)} className="px-3 py-1.5 text-sm">{l}</Chip>)}</div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); addPlace('other', placeName); setPlaceName(''); }}><input className={inputCls} value={placeName} onChange={e => setPlaceName(e.target.value)} placeholder="Another place, e.g. Grandma's" /><Btn type="submit" disabled={!placeName.trim()}>Add</Btn></form>
      {places.length > 0 && <div className="flex flex-wrap gap-1.5">{places.map(p => <span key={p.id} className="inline-flex items-center gap-1 rounded-md bg-linen px-2 py-1 text-xs">{p.name}<button aria-label={`Remove ${p.name}`} onClick={() => setPlaces(places.filter(x => x.id !== p.id))}><X size={12} /></button></span>)}</div>}
    </div> },
    { q: 'Got a picture of your schedule?', hint: 'Add it here. Class, shift or practice schedules, even a screenshot. You check everything before it’s added.', body: <div className="grid gap-2">
      <Btn kind="primary" className="justify-start py-3" onClick={() => pickPhotos('camera', () => finish())}><Camera size={18} />Take a photo</Btn>
      <Btn kind="quiet" className="justify-start py-3" onClick={() => pickPhotos('upload', () => finish())}><ImagePlus size={18} />Choose photos or screenshots</Btn>
      <Btn kind="quiet" className="justify-start py-3" onClick={() => finish(() => openPhotoImport({ from: 'menu' }))}><Link2 size={18} />Paste a link instead</Btn>
      <Btn kind="quiet" className="justify-start py-3" onClick={() => finish(() => openTalk('voice'))}><Mic size={18} />Say it out loud</Btn>
      <Btn kind="quiet" className="justify-start py-3" onClick={() => finish(() => go({ settings: true, settingsFocus: 'connections' }))}>Connect a calendar account</Btn>
    </div> },
  ];
  const cur = steps[step]; const last = step === steps.length - 1;
  return <div className="fixed inset-0 z-[60] flex flex-col bg-paper safe-top safe-bottom">
    <div className="flex items-center justify-between px-6 pt-5"><span className="wordmark text-sm">OROZ</span><span className="text-xs text-muted">{step + 1} of {steps.length}</span></div>
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
      {step === 0 && <p className="mb-2 text-sm text-muted">OROZ starts empty and learns as you go.</p>}
      <h1 key={step} className="rise mb-2 text-3xl font-semibold leading-tight">{cur.q}</h1>
      {cur.hint && <p className="mb-4 text-sm text-muted">{cur.hint}</p>}
      <div className={cur.hint ? '' : 'mt-4'}>{cur.body}</div>
    </div>
    <div className="mx-auto flex w-full max-w-md items-center gap-2 px-6 pb-6">
      {step > 0 && <Btn kind="ghost" onClick={() => setStep(step - 1)}>Back</Btn>}
      <div className="flex-1" />
      <Btn kind="ghost" onClick={() => (last ? finish() : setStep(step + 1))}>{last ? 'Later' : 'Skip'}</Btn>
      {!last && <Btn kind="primary" onClick={() => setStep(step + 1)}>Next</Btn>}
    </div>
  </div>;
}
