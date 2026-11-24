import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './index.css';
import { createRepository } from './data/repository';
import { Store, setStore } from './data/store';
import { App } from './ui/App';
import { registerSW } from 'virtual:pwa-register';

async function boot() {
  const store = new Store(await createRepository());
  setStore(store);
  await store.load();
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
  registerSW({ immediate: true });
}
boot();
