/* RinoMagic Web Push Service Worker
 * Handles incoming push messages and click routing.
 * Registered from the app on first launch with notifications enabled.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: 'RinoMagic', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'RinoMagic';
  const options = {
    body: data.body || '',
    icon: data.icon || '/favicon.png',
    badge: data.badge || '/favicon.png',
    data: { url: data.url || '/hub' },
    tag: data.tag || 'rinomagic-generic',
    renotify: true,
    vibrate: [120, 60, 120],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/hub';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      // If a client is already open, focus it and navigate.
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new window.
      return self.clients.openWindow(targetUrl);
    }),
  );
});
