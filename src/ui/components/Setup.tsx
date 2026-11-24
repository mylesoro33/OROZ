import { useState } from 'react';
import { X } from 'lucide-react';
import type { Person } from '@engine/types';
import { parseHM, hm, uid } from '@engine/time';
import { store } from '../../data/store';
import { go } from '../nav';
import { Btn, Chip, inputCls } from '../ui';
import { SleepDial } from './SleepDial';

/** First launch: five questions, one at a time. Everything is skippable. */
export function Setup({ onDone }: { onDone: () => void }) {
  const st = store().state;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(st.profile.name ?? '');
  const [school, setSchool] = useState(st.profile.school ?? '');
  const [grade, setGrade] = useState(st.profile.grade ?? '');
  const [bed, setBed] = useState(parseHM(st.settings.sleep.schoolNight.bedtime));
  const [wake, setWake] = useState(parseHM(st.settings.sleep.schoolNight.wake));
  const [touchedSleep, setTouchedSleep] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [pName, setPName] = useState(''); const [pRel, setPRel] = useState('friend'); const [pBday, setPBday] = useState('');
  const [connectAfter, setConnectAfter] = useState(false);

  const finish = (toConnections = connectAfter) => {
    const s = store();
    s.set('profile', { ...s.state.profile, name: name.trim() || undefined, school: school.trim() || undefined, grade: grade.trim() || undefined, setupDone: true });
    if (touchedSleep) {
      s.set('settings', { ...s.state.settings, sleep: { ...s.state.settings.sleep, schoolNight: { ...s.state.settings.sleep.schoolNight, bedtime: hm(bed), wake: hm(wake) } } });
      s.set('bedtimeSet', true);
    }
    s.upsert('people', people);
    if (toConnections) go({ tab: 'settings', settingsFocus: 'connections' });
    onDone();
  };
  const addPerson = () => {
    if (!pName.trim()) return;
    const [, m, d] = pBday ? pBday.split('-').map(Number) : [];
    setPeople([...people, { id: uid('person'), name: pName.trim(), relationship: pRel, birthday: m ? { month: m, day: d } : undefined, source: 'manual' }]);
    setPName(''); setPBday('');
  };

  const steps = [
    { q: 'What should I call you?', body: <input autoFocus className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" onKeyDown={e => e.key === 'Enter' && setStep(1)} /> },
    { q: 'Where do you go to school, and what grade?', body: <div className="space-y-2"><input autoFocus className={inputCls} value={school} onChange={e => setSchool(e.target.value)} placeholder="School name" /><input className={inputCls} value={grade} onChange={e => setGrade(e.target.value)} placeholder="Grade (e.g. 10)" inputMode="numeric" /></div> },
    { q: 'Usual bedtime on school nights?', hint: "It changes, so this is a typical time. You can set each night later.", body: <SleepDial bed={bed} wake={wake} onBed={m => { setBed(m); setTouchedSleep(true); }} onWake={m => { setWake(m); setTouchedSleep(true); }} range={30} size={240} /> },
    { q: 'Connect your calendar and classes?', hint: 'Google Calendar, Classroom, Schoology and more. You choose what comes in.', body: <div className="flex gap-2"><Chip active={connectAfter} onClick={() => setConnectAfter(true)}>Yes, after setup</Chip><Chip active={!connectAfter} onClick={() => setConnectAfter(false)}>Later</Chip></div> },
    { q: 'Who do you want to celebrate or keep up with?', hint: 'Friends, family, teammates. Add a few now or later.', body: <div className="space-y-2">
      {people.map(p => <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span>{p.name} <span className="text-muted">· {p.relationship}{p.birthday ? ` · ${p.birthday.month}/${p.birthday.day}` : ''}</span></span><button aria-label={`Remove ${p.name}`} onClick={() => setPeople(people.filter(x => x.id !== p.id))}><X size={14} /></button></div>)}
      <input className={inputCls} value={pName} onChange={e => setPName(e.target.value)} placeholder="Name" onKeyDown={e => e.key === 'Enter' && addPerson()} />
      <div className="flex flex-wrap gap-1.5">{['friend', 'family', 'teammate'].map(r => <Chip key={r} active={pRel === r} onClick={() => setPRel(r)}>{r}</Chip>)}</div>
      <div className="flex gap-2"><input type="date" className={inputCls} value={pBday} onChange={e => setPBday(e.target.value)} aria-label="Birthday (optional)" /><Btn onClick={addPerson} disabled={!pName.trim()}>Add</Btn></div>
    </div> },
  ];
  const cur = steps[step];
  const last = step === steps.length - 1;
  return <div className="fixed inset-0 z-[60] flex flex-col bg-paper safe-top safe-bottom">
    <div className="flex items-center justify-between px-6 pt-5">
      <span className="wordmark text-sm">OROZ</span>
      <span className="text-xs text-muted">{step + 1} of {steps.length}</span>
    </div>
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
      {step === 0 && <p className="mb-2 text-sm text-muted">Hi, I'm OROZ. I'll start empty and learn as we go.</p>}
      <h1 key={step} className="rise mb-2 text-3xl font-semibold leading-tight">{cur.q}</h1>
      {cur.hint && <p className="mb-5 text-sm text-muted">{cur.hint}</p>}
      <div className={cur.hint ? '' : 'mt-4'}>{cur.body}</div>
    </div>
    <div className="mx-auto flex w-full max-w-md items-center gap-2 px-6 pb-6">
      {step > 0 && <Btn kind="ghost" onClick={() => setStep(step - 1)}>Back</Btn>}
      <div className="flex-1" />
      <Btn kind="ghost" onClick={() => (last ? finish(false) : setStep(step + 1))}>Skip</Btn>
      <Btn kind="primary" onClick={() => (last ? finish() : setStep(step + 1))}>{last ? 'Done' : 'Next'}</Btn>
    </div>
  </div>;
}
