// Vercel serverless function: /api/gcal — keeps Google Calendar signed in.
//
// The browser only ever holds a one-hour access token. The long-lived refresh
// token stays here: it is saved with the Admin SDK at gcalSecrets/<uid>, a path
// the database rules give no browser access to, and is used with the client
// secret (which never leaves Vercel) to mint new access tokens.
//
// Required Vercel env vars:
//   GCAL_CLIENT_ID          → Web OAuth client ID (…apps.googleusercontent.com)
//   GCAL_CLIENT_SECRET      → its client secret
//   FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL → same as /api/today
//
// Requests (POST JSON, header Authorization: Bearer <Firebase ID token>):
//   GET  /api/gcal                      → { enabled, clientId }      (no auth)
//   POST { action:'exchange', code }    → { access_token, expires_in, scope }
//   POST { action:'token' }             → { access_token, expires_in, scope }  | 401 { error:'reconnect' }
//   POST { action:'revoke' }            → { ok:true }
//   Extra Google accounts (read-only: their calendars and Gmail) — add  acct  to the same calls:
//   POST { action:'exchange', code, acct:'new' } → { access_token, …, acct, email }   (stored at gcalExtra/<uid>/<acct>)
//   POST { action:'token',  acct }               → { access_token, … } | 401 { error:'reconnect' }
//   POST { action:'revoke', acct }               → { ok:true }
//   POST { action:'accounts' }                   → { accounts:[{ acct, email }] }

import admin from 'firebase-admin';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

function ensureApp() {
  if (admin.apps.length) return admin.app();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) throw new Error('FIREBASE_DATABASE_URL env var is not set');
  return admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)), databaseURL });
}

const realDeps = {
  env: process.env,
  fetch: (...a) => fetch(...a),
  verify: (idToken) => { ensureApp(); return admin.auth().verifyIdToken(idToken); },
  read: async (uid) => { ensureApp(); return (await admin.database().ref('gcalSecrets/' + uid).get()).val(); },
  write: (uid, v) => { ensureApp(); return admin.database().ref('gcalSecrets/' + uid).set(v); },
  remove: (uid) => { ensureApp(); return admin.database().ref('gcalSecrets/' + uid).remove(); },
  readX: async (uid, a) => { ensureApp(); return (await admin.database().ref('gcalExtra/' + uid + '/' + a).get()).val(); },
  writeX: (uid, a, v) => { ensureApp(); return admin.database().ref('gcalExtra/' + uid + '/' + a).set(v); },
  removeX: (uid, a) => { ensureApp(); return admin.database().ref('gcalExtra/' + uid + '/' + a).remove(); },
  listX: async (uid) => { ensureApp(); return (await admin.database().ref('gcalExtra/' + uid).get()).val() || {}; }
};
// the email inside Google's id_token (it came straight from Google's token endpoint over TLS)
const emailOf = (idt) => { try { return JSON.parse(Buffer.from(String(idt).split('.')[1], 'base64url').toString('utf8')).email || ''; } catch (_) { return ''; } };
const acctKey = (email) => String(email || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 80);
const okAcct = (a) => typeof a === 'string' && /^[a-z0-9_]{1,80}$/.test(a);

async function google(deps, params) {
  const r = await deps.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: deps.env.GCAL_CLIENT_ID, client_secret: deps.env.GCAL_CLIENT_SECRET }, params)).toString()
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
const tokenOut = (j) => ({ access_token: j.access_token, expires_in: j.expires_in || 3600, scope: j.scope || '' });

export function makeHandler(deps) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const enabled = !!(deps.env.GCAL_CLIENT_ID && deps.env.GCAL_CLIENT_SECRET);
    if (req.method === 'GET') return res.status(200).json({ enabled, clientId: enabled ? deps.env.GCAL_CLIENT_ID : '' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    if (!enabled) return res.status(501).json({ error: 'not-configured' });

    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    let uid;
    try { uid = (await deps.verify(m ? m[1] : '')).uid; } catch (_) { return res.status(401).json({ error: 'signed-out' }); }
    if (!uid) return res.status(401).json({ error: 'signed-out' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    try {
      // ── extra accounts ──
      if (body.action === 'accounts') {
        const all = await deps.listX(uid);
        return res.status(200).json({ accounts: Object.keys(all).map(a => ({ acct: a, email: (all[a] && all[a].email) || '' })) });
      }
      if (body.acct) {
        if (body.action === 'exchange' && body.acct === 'new') {
          if (!body.code || typeof body.code !== 'string') return res.status(400).json({ error: 'code' });
          const g = await google(deps, { code: body.code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });
          if (!g.ok) return res.status(400).json({ error: g.j.error || 'exchange' });
          const email = emailOf(g.j.id_token), a = acctKey(email);
          if (!a) return res.status(400).json({ error: 'no-email' });
          const old = await deps.readX(uid, a), rt = g.j.refresh_token || (old && old.rt);
          if (!rt) return res.status(400).json({ error: 'no-refresh' });
          await deps.writeX(uid, a, { rt, scope: g.j.scope || '', email, at: Date.now() });
          return res.status(200).json(Object.assign(tokenOut(g.j), { acct: a, email }));
        }
        if (!okAcct(body.acct)) return res.status(400).json({ error: 'acct' });
        if (body.action === 'token') {
          const s = await deps.readX(uid, body.acct);
          if (!s || !s.rt) return res.status(401).json({ error: 'reconnect' });
          const g = await google(deps, { refresh_token: s.rt, grant_type: 'refresh_token' });
          if (!g.ok) { if (g.j.error === 'invalid_grant') { await deps.removeX(uid, body.acct); return res.status(401).json({ error: 'reconnect' }); } return res.status(502).json({ error: g.j.error || 'google' }); }
          return res.status(200).json(tokenOut(g.j));
        }
        if (body.action === 'revoke') {
          const s = await deps.readX(uid, body.acct);
          if (s && s.rt) await deps.fetch(REVOKE_URL + '?token=' + encodeURIComponent(s.rt), { method: 'POST' }).catch(() => {});
          await deps.removeX(uid, body.acct);
          return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'action' });
      }
      if (body.action === 'exchange') {
        if (!body.code || typeof body.code !== 'string') return res.status(400).json({ error: 'code' });
        const g = await google(deps, { code: body.code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });
        if (!g.ok) return res.status(400).json({ error: g.j.error || 'exchange' });
        const old = await deps.read(uid);
        const rt = g.j.refresh_token || (old && old.rt);   // Google only sends one on first consent
        if (!rt) return res.status(400).json({ error: 'no-refresh' });
        await deps.write(uid, { rt, scope: g.j.scope || '', at: Date.now() });
        return res.status(200).json(tokenOut(g.j));
      }
      if (body.action === 'token') {
        const s = await deps.read(uid);
        if (!s || !s.rt) return res.status(401).json({ error: 'reconnect' });
        const g = await google(deps, { refresh_token: s.rt, grant_type: 'refresh_token' });
        if (!g.ok) {
          if (g.j.error === 'invalid_grant') { await deps.remove(uid); return res.status(401).json({ error: 'reconnect' }); }   // revoked in Google, or password changed
          return res.status(502).json({ error: g.j.error || 'google' });
        }
        return res.status(200).json(tokenOut(g.j));
      }
      if (body.action === 'revoke') {
        const s = await deps.read(uid);
        if (s && s.rt) await deps.fetch(REVOKE_URL + '?token=' + encodeURIComponent(s.rt), { method: 'POST' }).catch(() => {});
        await deps.remove(uid);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'action' });
    } catch (err) {
      console.error('[gcal]', err);
      return res.status(500).json({ error: 'server' });
    }
  };
}

export default makeHandler(realDeps);
