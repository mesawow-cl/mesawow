// Service worker de mesawow: solo avisos push. No guarda datos en caché (la app siempre pide lo último).
// El push llega sin contenido; se pide el aviso a la API con la sesión de la persona.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let aviso = { titulo: 'mesawow', cuerpo: 'Tienes avisos nuevos.', url: '/' };
    try {
      const r = await fetch('/api/v1/avisos/ultimo', { credentials: 'same-origin' });
      if (r.ok) aviso = await r.json();
    } catch { /* sin red: aviso genérico */ }
    await self.registration.showNotification(aviso.titulo, {
      body: aviso.cuerpo, icon: '/marca/favicon/favicon-192.png', badge: '/marca/favicon/favicon-48.png',
      tag: 'mesawow', renotify: true, data: { url: aviso.url },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const abierta = ventanas.find((v) => new URL(v.url).origin === self.location.origin);
    if (abierta) { await abierta.focus(); return abierta.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
