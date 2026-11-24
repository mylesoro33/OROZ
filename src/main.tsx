import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { createRepository } from './data/repository';
import { Store, setStore } from './data/store';
import { seedDemo } from './data/seed';
import { App } from './ui/App';
import { registerSW } from 'virtual:pwa-register';

async function boot() {
  const repo = await createRepository();
  const store = new Store(repo);
  setStore(store);
  await store.load();
  if (!(await repo.getKV('seeded'))) await seedDemo(store);
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
  registerSW({ immediate: true });
}
boot();
