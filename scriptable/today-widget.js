// Focus Hub — Today widget for iOS Scriptable
// ---------------------------------------------
// 1. Install Scriptable from the App Store (free).
// 2. Open Scriptable → "+" → paste this whole file.
// 3. Set the two CONFIG values below.
// 4. Add a Scriptable widget to your home screen,
//    long-press → Edit Widget → Script: pick this script.
//
// The widget fetches /api/today from your Vercel project, so make sure
// MOONLIT_API_KEY, FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL and
// MOONLIT_USER_UID are set in Vercel project settings.

// ═══════════════════ CONFIG ═══════════════════
const API_URL = 'https://focuslists.vercel.app/api/today';
const API_KEY = 'PASTE_YOUR_MOONLIT_API_KEY_HERE';
// ═════════════════════════════════════════════

const ACCENT = new Color('#7aa2ff');
const GREEN = new Color('#46c97e');
const ORANGE = new Color('#f59040');
const PURPLE = new Color('#b07fff');
const RED = new Color('#f26060');
const BG_TOP = new Color('#1a1c24');
const BG_BOT = new Color('#0f1014');
const DIM = new Color('#777a85');
const TEXT = new Color('#ecedef');
const MUTED = new Color('#9aa0ac');

function priorityColor(p) {
  if (p === 'MUST') return RED;
  if (p === 'high') return ORANGE;
  if (p === 'low') return DIM;
  return ACCENT;
}

async function loadData() {
  try {
    const req = new Request(`${API_URL}?key=${encodeURIComponent(API_KEY)}`);
    req.timeoutInterval = 8;
    const json = await req.loadJSON();
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function fmtHeaderDate() {
  const d = new Date();
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function buildWidget(payload) {
  const widget = new ListWidget();
  const gradient = new LinearGradient();
  gradient.colors = [BG_TOP, BG_BOT];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(12, 14, 12, 14);

  const family = config.widgetFamily || 'medium';
  const maxRows = family === 'small' ? 4 : family === 'large' ? 14 : 6;

  if (!payload.ok) {
    const err = widget.addText('Focus Hub offline');
    err.font = Font.boldSystemFont(13);
    err.textColor = RED;
    widget.addSpacer(4);
    const sub = widget.addText(payload.error || 'Could not reach the API.');
    sub.font = Font.systemFont(10);
    sub.textColor = MUTED;
    sub.lineLimit = 4;
    return widget;
  }

  const tasks = Array.isArray(payload.data?.tasks) ? payload.data.tasks : [];
  const open = tasks.filter((t) => !t.done);
  const total = tasks.length;

  const head = widget.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();

  const dateLabel = head.addText(fmtHeaderDate());
  dateLabel.font = Font.semiboldSystemFont(10);
  dateLabel.textColor = MUTED;
  head.addSpacer();
  const counter = head.addText(`${open.length}/${total}`);
  counter.font = Font.boldSystemFont(10);
  counter.textColor = ACCENT;

  widget.addSpacer(2);
  const title = widget.addText(open.length ? `${open.length} left today` : 'All clear ✓');
  title.font = Font.boldSystemFont(15);
  title.textColor = TEXT;

  widget.addSpacer(6);

  if (!total) {
    const empty = widget.addText('Nothing scheduled.');
    empty.font = Font.systemFont(11);
    empty.textColor = MUTED;
    return widget;
  }

  const visible = tasks.slice(0, maxRows);
  for (const t of visible) {
    const row = widget.addStack();
    row.layoutHorizontally();
    row.spacing = 6;
    row.centerAlignContent();

    const dot = row.addText(t.done ? '✓' : '●');
    dot.font = Font.systemFont(family === 'small' ? 10 : 11);
    dot.textColor = t.done ? GREEN : priorityColor(t.priority);

    const label = row.addText(t.title);
    label.font = Font.systemFont(family === 'small' ? 10 : 11);
    label.textColor = t.done ? MUTED : TEXT;
    label.lineLimit = 1;

    if (t.isHabit) {
      const tag = row.addText('↻');
      tag.font = Font.systemFont(family === 'small' ? 9 : 10);
      tag.textColor = PURPLE;
    }
    row.addSpacer();
    if (t.priority === 'MUST') {
      const must = row.addText('⚡');
      must.font = Font.systemFont(family === 'small' ? 9 : 10);
      must.textColor = RED;
    }
  }

  if (tasks.length > maxRows) {
    widget.addSpacer(2);
    const more = widget.addText(`+${tasks.length - maxRows} more`);
    more.font = Font.systemFont(9);
    more.textColor = DIM;
  }

  // Tapping the widget opens the web app
  widget.url = API_URL.replace(/\/api\/today.*$/, '/');
  // Refresh hint: every 10 minutes
  widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);

  return widget;
}

const payload = await loadData();
const widget = buildWidget(payload);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // Running inside the Scriptable app — preview the medium widget
  await widget.presentMedium();
}
Script.complete();
