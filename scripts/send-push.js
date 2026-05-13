#!/usr/bin/env node
/**
 * Daily push notification script — runs via GitHub Actions
 * Reads vehicles from Firestore, sends FCM push to all registered tokens
 * for vehicles that are overdue or due soon.
 */

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'zivcars',
});

const db = admin.firestore();

function daysBetween(dateStr) {
  if (!dateStr) return null;
  const last = new Date(dateStr);
  const now  = new Date();
  return Math.floor((now - last) / 86400000);
}

function getStatus(v) {
  const elapsed = daysBetween(v.lastService);
  if (elapsed === null) return 'ok';
  const interval = v.intervalDays || 28;
  if (elapsed >= interval)             return 'overdue';
  if (elapsed >= interval - 3)         return 'due';
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

  const overdue = vehicles.filter(v => getStatus(v) === 'overdue');
  const due     = vehicles.filter(v => getStatus(v) === 'due');

  let title, body;
  if (overdue.length) {
    title = '🚨 טיפול דחוף נדרש!';
    body  = overdue.map(v => `${v.type} ${v.name}`).join(', ');
  } else if (due.length) {
    title = '⚠️ טיפול קרוב';
    body  = due.map(v => `${v.type} ${v.name}`).join(', ');
  } else {
    console.log('All vehicles OK — no push needed.');
    return;
  }

  console.log(`Sending push: ${title} — ${body}`);
  console.log(`Tokens: ${tokens.length}`);

  const message = {
    notification: { title, body },
    webpush: {
      notification: {
        icon:             'https://levisagi.github.io/vehicle-maintenance/icon-192.png',
        badge:            'https://levisagi.github.io/vehicle-maintenance/icon-192.png',
        tag:              'vehicle-maint',
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

  // Clean up invalid tokens
  const staleTokens = [];
  result.responses.forEach((resp, i) => {
    if (!resp.success) {
      const code = resp.error && resp.error.code;
      if (code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered') {
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
