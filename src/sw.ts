/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
try { registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'))); } catch { /* dev */ }

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Notification actions → tell the open app (snooze / done), or open it.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const msg = { type: 'reminder-action', tag: event.notification.data?.tag, action: event.action || 'open' };
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) { all[0].postMessage(msg); await (all[0] as WindowClient).focus(); }
    else await self.clients.openWindow(self.registration.scope + '?reminder=' + encodeURIComponent(msg.tag ?? ''));
  })());
});

// Web Push (when a push server is added later — see ROADMAP): show what the server sends.
self.addEventListener('push', event => {
  const data = event.data?.json() ?? { title: 'Oroz', body: '' };
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, data: { tag: data.tag } }));
});
