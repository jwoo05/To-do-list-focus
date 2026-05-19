// Vercel serverless function: GET /api/today
//
// Returns the tasks/habits due *today* for one Focus Hub user, gated by a
// shared secret. Used by the iOS Scriptable widget (see scriptable/today-widget.js).
//
// Required Vercel env vars:
//   FIREBASE_SERVICE_ACCOUNT  → JSON string of a Firebase service account key
//   FIREBASE_DATABASE_URL     → e.g. "https://<project-id>-default-rtdb.firebaseio.com"
//   MOONLIT_API_KEY           → any random string; widget must pass ?key=<this>
//   MOONLIT_USER_UID          → (optional) default UID if widget doesn't pass ?uid=
//
// Request:
//   GET /api/today?key=<MOONLIT_API_KEY>[&uid=<firebase-uid>]
// Response (200):
//   { date: "2026-05-19", tasks: [{ id, title, priority, isHabit, done }], updatedAt }

import admin from 'firebase-admin';

let initPromise = null;
function ensureApp() {
  if (admin.apps.length) return admin.app();
  if (!initPromise) {
    initPromise = (() => {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
      const databaseURL = process.env.FIREBASE_DATABASE_URL;
      if (!databaseURL) throw new Error('FIREBASE_DATABASE_URL env var is not set');
      let credentials;
      try {
        credentials = JSON.parse(raw);
      } catch (err) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + err.message);
      }
      return admin.initializeApp({
        credential: admin.credential.cert(credentials),
        databaseURL
      });
    })();
  }
  return initPromise;
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isHabitDueToday(t, dateStr, dow) {
  if (!t.isHabit) return false;
  if (t.skippedDates && t.skippedDates[dateStr]) return false;
  if (t.habitStart && dateStr < t.habitStart) return false;
  if (t.habitEnd && dateStr > t.habitEnd) return false;
  return Array.isArray(t.scheduledDays) && t.scheduledDays.includes(dow);
}

function isScheduledToday(t, dateStr) {
  if (t.skippedDates && t.skippedDates[dateStr]) return false;
  if (Array.isArray(t.scheduledDates) && t.scheduledDates.includes(dateStr)) return true;
  if (t.due === dateStr) return true;
  return false;
}

function isDone(t, dateStr) {
  if (t.isHabit) return !!(t.completedDates && t.completedDates[dateStr]);
  return !!t.completed;
}

function priorityRank(p) {
  return p === 'MUST' ? 0 : p === 'high' ? 1 : p === 'medium' ? 2 : 3;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const expectedKey = process.env.MOONLIT_API_KEY;
  if (!expectedKey) {
    return res.status(500).json({ error: 'MOONLIT_API_KEY is not set on the server' });
  }
  const providedKey = req.query.key || req.headers['x-api-key'];
  if (providedKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const uid = String(req.query.uid || process.env.MOONLIT_USER_UID || '').trim();
  if (!uid) {
    return res.status(400).json({ error: 'Missing uid (set ?uid=… or MOONLIT_USER_UID env var)' });
  }

  try {
    await ensureApp();
    // The web app's `saveUserDataToFirebase()` writes the entire S state directly
    // to `users/<uid>` (focus-logic.js). The older `focus-auth.js` module wrote
    // a nested shape to `users/<uid>/plannerState/state`. Support both.
    const snapshot = await admin.database().ref(`users/${uid}`).get();
    const raw = snapshot.val();
    let state = null;
    let updatedAt = 0;
    if (raw && typeof raw === 'object') {
      if (raw.plannerState && raw.plannerState.state) {
        state = raw.plannerState.state;
        updatedAt = raw.plannerState.updatedAt || 0;
      } else if (Array.isArray(raw.tasks) || Array.isArray(raw.events) || raw.settings) {
        state = raw;
        updatedAt = 0;
      }
    }
    if (!state || !Array.isArray(state.tasks)) {
      return res.status(200).json({ date: todayStr(), tasks: [], updatedAt, debug: { foundShape: raw ? Object.keys(raw).slice(0, 10) : 'null' } });
    }
    const ds = todayStr();
    const dow = new Date().getDay();
    const tasks = state.tasks
      .filter((t) => t && !t.archived && (isHabitDueToday(t, ds, dow) || isScheduledToday(t, ds)))
      .map((t) => ({
        id: t.id,
        title: t.title || '(untitled)',
        priority: t.priority || 'medium',
        isHabit: !!t.isHabit,
        section: t.dailySection || 'Study',
        done: isDone(t, ds)
      }))
      .sort((a, b) => {
        // Incomplete first, then by priority
        if (a.done !== b.done) return a.done ? 1 : -1;
        return priorityRank(a.priority) - priorityRank(b.priority);
      });
    return res.status(200).json({ date: ds, tasks, updatedAt });
  } catch (err) {
    console.error('today api error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
