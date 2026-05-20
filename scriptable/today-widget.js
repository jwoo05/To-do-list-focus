// Focus Hub — Today widget for iOS Scriptable (v2)
// ---------------------------------------------
// 1. Install Scriptable from the App Store (free).
// 2. Open Scriptable → "+" → paste this whole file.
// 3. Set the two CONFIG values below.
// 4. Add a Scriptable widget to your home screen,
//    long-press → Edit Widget → Script: pick this script.

// ═══════════════════ CONFIG ═══════════════════
const API_URL = 'https://whattodo-sable.vercel.app/api/today';
const API_KEY = 'PASTE_YOUR_MOONLIT_API_KEY_HERE';
// ═════════════════════════════════════════════

const ACCENT = new Color('#7aa2ff');
const GREEN  = new Color('#46c97e');
const ORANGE = new Color('#f59040');
const PURPLE = new Color('#b07fff');
const RED    = new Color('#f26060');
const BG_TOP = new Color('#1a1c24');
const BG_BOT = new Color('#0f1014');
const DIM    = new Color('#777a85');
const TEXT   = new Color('#ecedef');
const MUTED  = new Color('#9aa0ac');
const TRACK  = new Color('#23262d');

function priorityColor(p) {
  if (p === 'MUST') return RED;
  if (p === 'high') return ORANGE;
  if (p === 'low')  return DIM;
  return ACCENT;
}
function priorityTint(p) {
  if (p === 'MUST') return new Color('#f26060', 0.18);
  if (p === 'high') return new Color('#f59040', 0.13);
  if (p === 'low')  return new Color('#777a85', 0.10);
  return            new Color('#7aa2ff', 0.10);
}

async function loadData() {
  try {
    const req = new Request(`${API_URL}?key=${encodeURIComponent(API_KEY)}`);
    req.timeoutInterval = 8;
    return { ok: true, data: await req.loadJSON() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function fmtHeaderDate() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function sizesFor(family) {
  if (family === 'small') {
    return { title: 14, sub: 9, row: 11, header: 8, padding: 10, rowPad: 3,
             maxRows: 4, progressWidth: 110, gap: 3, dot: 9 };
  }
  if (family === 'large') {
    return { title: 22, sub: 12, row: 14, header: 10, padding: 16, rowPad: 4,
             maxRows: 12, progressWidth: 290, gap: 6, dot: 12 };
  }
  // medium
  return { title: 18, sub: 11, row: 13, header: 9, padding: 14, rowPad: 3,
           maxRows: 6, progressWidth: 250, gap: 4, dot: 11 };
}

function addProgressBar(parent, done, total, width) {
  const bar = parent.addStack();
  bar.layoutHorizontally();
  bar.cornerRadius = 3;
  bar.size = new Size(width, 6);
  bar.backgroundColor = TRACK;
  if (total > 0 && done > 0) {
    const fillW = Math.max(6, Math.round(width * (done / total)));
    const fill = bar.addStack();
    fill.size = new Size(fillW, 6);
    fill.backgroundColor = done === total ? GREEN : ACCENT;
    fill.cornerRadius = 3;
  }
  bar.addSpacer();
}

function centeredText(parent, text, font, color) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const t = row.addText(text);
  t.font = font;
  t.textColor = color;
  row.addSpacer();
  return t;
}

function buildAllClear(widget, family, S, total) {
  widget.addSpacer();
  centeredText(widget, '✓',
    Font.boldSystemFont(family === 'small' ? 32 : family === 'large' ? 64 : 44),
    GREEN);
  widget.addSpacer(4);
  centeredText(widget, 'All clear today', Font.boldSystemFont(S.title), TEXT);
  centeredText(widget, `${total} task${total === 1 ? '' : 's'} done`,
    Font.systemFont(S.sub), MUTED);
  widget.addSpacer();
}

function buildWidget(payload) {
  const widget = new ListWidget();
  const gradient = new LinearGradient();
  gradient.colors = [BG_TOP, BG_BOT];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  const family = config.widgetFamily || 'medium';
  const S = sizesFor(family);
  widget.setPadding(S.padding, S.padding, S.padding, S.padding);

  // Error state
  if (!payload.ok) {
    const err = widget.addText('Focus Hub offline');
    err.font = Font.boldSystemFont(S.title - 4);
    err.textColor = RED;
    widget.addSpacer(4);
    const sub = widget.addText(payload.error || 'Could not reach the API.');
    sub.font = Font.systemFont(S.sub);
    sub.textColor = MUTED;
    sub.lineLimit = 4;
    return widget;
  }

  const allTasks = Array.isArray(payload.data?.tasks) ? payload.data.tasks : [];
  const done = allTasks.filter((t) => t.done).length;
  const total = allTasks.length;
  const open = allTasks.filter((t) => !t.done);

  // Header: date + progress counter text
  const head = widget.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const dateLabel = head.addText(fmtHeaderDate());
  dateLabel.font = Font.semiboldSystemFont(S.sub);
  dateLabel.textColor = MUTED;
  head.addSpacer();
  const counter = head.addText(`${done} / ${total} done`);
  counter.font = Font.boldSystemFont(S.sub);
  counter.textColor = (done === total && total > 0) ? GREEN : ACCENT;

  widget.addSpacer(6);

  // All clear vs empty vs normal
  if (total === 0) {
    widget.addSpacer();
    centeredText(widget, 'Nothing scheduled today.',
      Font.systemFont(S.row), MUTED);
    widget.addSpacer();
    widget.url = API_URL.replace(/\/api\/today.*$/, '/');
    widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
    return widget;
  }

  if (open.length === 0) {
    buildAllClear(widget, family, S, total);
    widget.url = API_URL.replace(/\/api\/today.*$/, '/');
    widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
    return widget;
  }

  // Title: how many open
  const title = widget.addText(`${open.length} left today`);
  title.font = Font.boldSystemFont(S.title);
  title.textColor = TEXT;
  widget.addSpacer(4);

  // Progress bar
  addProgressBar(widget, done, total, S.progressWidth);
  widget.addSpacer(S.gap + 4);

  // Group OPEN tasks by section, preserving server order (which is priority-sorted)
  const grouped = new Map();
  for (const t of open) {
    const sec = String(t.section || 'Other').trim() || 'Other';
    if (!grouped.has(sec)) grouped.set(sec, []);
    grouped.get(sec).push(t);
  }

  let renderedRows = 0;
  let truncated = 0;
  const showHeaders = grouped.size > 1;

  for (const [sectionName, items] of grouped.entries()) {
    if (renderedRows >= S.maxRows) {
      truncated += items.length;
      continue;
    }

    if (showHeaders) {
      const header = widget.addText(sectionName.toUpperCase());
      header.font = Font.boldSystemFont(S.header);
      header.textColor = DIM;
      widget.addSpacer(2);
    }

    for (const t of items) {
      if (renderedRows >= S.maxRows) {
        truncated += 1;
        continue;
      }

      const row = widget.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();
      row.spacing = 6;
      row.cornerRadius = 6;
      row.setPadding(S.rowPad, 7, S.rowPad, 7);
      row.backgroundColor = priorityTint(t.priority);

      const dot = row.addText('●');
      dot.font = Font.systemFont(S.dot);
      dot.textColor = priorityColor(t.priority);

      const label = row.addText(t.title);
      label.font = Font.semiboldSystemFont(S.row);
      label.textColor = TEXT;
      label.lineLimit = 1;

      if (t.isHabit) {
        const tag = row.addText('↻');
        tag.font = Font.systemFont(S.dot - 1);
        tag.textColor = PURPLE;
      }

      row.addSpacer();

      if (t.priority === 'MUST') {
        const must = row.addText('⚡');
        must.font = Font.systemFont(S.dot);
        must.textColor = RED;
      }

      widget.addSpacer(S.gap);
      renderedRows += 1;
    }
  }

  if (truncated > 0) {
    const more = widget.addText(`+${truncated} more`);
    more.font = Font.systemFont(S.sub);
    more.textColor = DIM;
  }

  widget.url = API_URL.replace(/\/api\/today.*$/, '/');
  widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
  return widget;
}

const payload = await loadData();
const widget = buildWidget(payload);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  const family = config.widgetFamily || 'medium';
  if (family === 'small') await widget.presentSmall();
  else if (family === 'large') await widget.presentLarge();
  else await widget.presentMedium();
}
Script.complete();
