// Giro Frota — recebe as notificações (app aberto ou fechado) e mostra sempre.
const APP = self.registration.scope; // https://painel-locadora.web.app/

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { p = { notification: { body: e.data && e.data.text() } }; }
  const n = p.notification || {};
  const d = p.data || {};
  const link = (p.fcmOptions && p.fcmOptions.link) || (p.fcm_options && p.fcm_options.link) || d.link || APP;
  e.waitUntil(self.registration.showNotification(n.title || 'Giro Frota', {
    body: n.body || '',
    icon: n.icon || APP + 'icon-192.png',
    badge: APP + 'icon-192.png',
    tag: n.tag || 'avisos-diarios',
    renotify: true,
    data: { link }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || APP;
  e.waitUntil((async () => {
    const abertos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abertos) if (c.url.startsWith(APP)) { await c.focus(); return; }
    await self.clients.openWindow(link);
  })());
});
