importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyAV48-01oI8-EuzcHGVwvK0TXL94CAgH1s",
  authDomain:        "zivcars.firebaseapp.com",
  projectId:         "zivcars",
  storageBucket:     "zivcars.firebasestorage.app",
  messagingSenderId: "1002138936040",
  appId:             "1:1002138936040:web:64f879bf38b8728aefdf5d"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  self.registration.showNotification(payload.notification.title, {
    body:             payload.notification.body,
    icon:             './icon-192.png',
    badge:            './icon-192.png',
    tag:              'vehicle-maint',
    requireInteraction: true,
    data:             { url: 'https://levisagi.github.io/vehicle-maintenance/' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('https://levisagi.github.io/vehicle-maintenance/'));
});

const CACHE = 'vehicle-maint-v4';
const STATIC = ['./manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // HTML — תמיד מהרשת, fallback לקאש רק אם אין אינטרנט
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // שאר הנכסים — קאש ראשון
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
