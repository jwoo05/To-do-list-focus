// Vercel serverless function: GET /api/ical?url=<calendar .ics link>
//
// Fetches a calendar feed server-side so the browser can read it without a
// third-party CORS proxy. Private calendar links (Google "secret address in
// iCal format", Outlook, iCloud, Canvas) give read access to the whole
// calendar, so they should never pass through public proxy sites.
//
// Only known calendar hosts are allowed, so this can't be used as an open proxy.

const ALLOWED = [
  /(^|\.)calendar\.google\.com$/i,
  /(^|\.)outlook\.(live|office365)\.com$/i,
  /(^|\.)icloud\.com$/i,
  /(^|\.)instructure\.com$/i,
  /(^|\.)canvas\.uw\.edu$/i,
];

export default async function handler(req, res) {
  let target;
  try {
    target = new URL(String(req.query.url || '').trim().replace(/^webcal:/i, 'https:'));
  } catch {
    return res.status(400).send('Not a valid calendar link.');
  }
  if (target.protocol !== 'https:' || !ALLOWED.some((re) => re.test(target.hostname))) {
    return res.status(400).send('Calendar host not allowed. Use a Google, Outlook, iCloud or Canvas calendar link.');
  }
  try {
    const upstream = await fetch(target, { headers: { 'User-Agent': 'FocusHub-Calendar-Sync/1.0' }, redirect: 'follow' });
    if (!upstream.ok) return res.status(502).send(`Calendar server answered ${upstream.status}.`);
    const text = await upstream.text();
    if (!/BEGIN:VCALENDAR/.test(text)) return res.status(502).send('That link did not return a calendar.');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(text);
  } catch (err) {
    return res.status(502).send('Could not reach the calendar: ' + err.message);
  }
}
