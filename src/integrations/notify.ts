// Local notifications through the service worker. Honest about platform limits:
// - iPhone/iPad: only works after "Add to Home Screen" (iOS 16.4+), and only while iOS lets the PWA run.
// - Without a push server, reminders fire while the app (or its service worker) is alive.
export function platformNote(): string {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
  if (!('Notification' in window)) return ios && !standalone ? 'On iPhone, notifications need Oroz installed: Share → Add to Home Screen, then open it from there.' : 'This browser does not support notifications. In-app banners still work.';
  if (ios && !standalone) return 'On iPhone, notifications only work after Share → Add to Home Screen (iOS 16.4+).';
  return 'Reminders are delivered while Oroz is open or recently used. Fully reliable background push needs a push server or the native app (see roadmap).';
}
export const notifPermission = (): NotificationPermission | 'unsupported' => ('Notification' in window ? Notification.permission : 'unsupported');
export async function requestNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}
export async function notify(title: string, body: string, tag: string, aggressive: boolean) {
  if (notifPermission() !== 'granted') return false;
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts: NotificationOptions & { renotify?: boolean; actions?: { action: string; title: string }[] } = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', requireInteraction: aggressive, renotify: aggressive, data: { tag }, actions: [{ action: 'snooze10', title: 'Snooze 10m' }, { action: 'done', title: 'Done' }] };
  if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  return true;
}
