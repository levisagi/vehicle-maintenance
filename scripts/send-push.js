#!/usr/bin/env node
/**
 * Daily push notification script — runs via GitHub Actions
 * Sends FCM push ONLY when a vehicle service is overdue/due,
 * or when a test (טסט) is expired or expiring within 30 days.
 */

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'zivcars',
});

const db = admin.firestore();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function getServiceStatus(v) {
  if (!v.lastService) return 'overdue';
  const elapsed  = daysBetween(v.lastService, todayStr());
  const interval = v.intervalDays || 28;
  if (elapsed >= interval)       return 'overdue';
  if (elapsed >= interval - 3)   return 'due';
  return 'ok';
}

function getTestStatus(v) {
  if (!v.testExpiry) return 'ok';
  const daysLeft = daysBetween(todayStr(), v.testExpiry);
  if (daysLeft < 0)    return 'expired';
  if (daysLeft <= 30)  return 'soon';
  return 'ok';
}

async function run() {
  const [vehiclesSnap, tokensSnap] = await Promise.all([
    db.collection('vehicles').get(),
    db.collection('tokens').get(),
  ]);

  const vehicles = vehiclesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tokens   = tokensSnap.docs.map(d => d.id).filter(Boolean);

  if (!tokens.length) {
    console.log('No FCM tokens registered — skipping push.');
    return;
  }

  // ── Service alerts ──
  const overdueService = vehicles.filter(v => getServiceStatus(v) === 'overdue');
  const dueService     = vehicles.filter(v => getServiceStatus(v) === 'due');

  // ── Test expiry alerts ──
  const expiredTest = vehicles.filter(v => getTestStatus(v) === 'expired');
  const soonTest    = vehicles.filter(v => getTestStatus(v) === 'soon');

  const lines = [];
  let title = '';

  if (overdueService.length) {
    if (!title) title = '🚨 טיפול דחוף נדרש!';
    lines.push(`טיפול באיחור: ${overdueService.map(v => `${v.type} ${v.name}`).join(', ')}`);
  }
  if (dueService.length) {
    if (!title) title = '⚠️ תזכורת טיפול';
    lines.push(`קרוב לטיפול: ${dueService.map(v => `${v.type} ${v.name}`).join(', ')}`);
  }
  if (expiredTest.length) {
    if (!title) title = '🚨 טסט פג תוקף!';
    lines.push(`טסט פג: ${expiredTest.map(v => `${v.type} ${v.name}`).join(', ')}`);
  }
  if (soonTest.length) {
    if (!title) title = title || '⚠️ תזכורת טסט';
    lines.push(`טסט קרוב: ${soonTest.map(v => `${v.type} ${v.name}`).join(', ')}`);
  }

  if (!lines.length) {
    console.log('All vehicles OK — no push needed today.');
    return;
  }

  const body = lines.join('\n');
  console.log(`Sending push: ${title}`);
  console.log(body);
  console.log(`Tokens: ${tokens.length}`);

  const message = {
    notification: { title, body },
    webpush: {
      notification: {
        icon:               'https://levisagi.github.io/vehicle-maintenance/icon-192.png',
        badge:              'https://levisagi.github.io/vehicle-maintenance/icon-192.png',
        tag:                'vehicle-maint',
        requireInteraction: true,
      },
      fcmOptions: {
        link: 'https://levisagi.github.io/vehicle-maintenance/',
      },
    },
    tokens,
  };

  const result = await admin.messaging().sendEachForMulticast(message);
  console.log(`Success: ${result.successCount}, Failed: ${result.failureCount}`);

  // Clean up invalid/expired tokens automatically
  const staleTokens = [];
  result.responses.forEach((resp, i) => {
    if (!resp.success) {
      const code = resp.error && resp.error.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        staleTokens.push(tokens[i]);
      }
    }
  });
  if (staleTokens.length) {
    const batch = db.batch();
    staleTokens.forEach(t => batch.delete(db.collection('tokens').doc(t)));
    await batch.commit();
    console.log(`Cleaned up ${staleTokens.length} stale token(s).`);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
