// Focus Hub — extension popup logic
// Lightweight: a quick-capture input + buttons that open the full app
// at the right deep-link. Nothing persistent lives in the popup itself.

const SITE = 'https://whattodo-sable.vercel.app';

// ── Greeting + date ───────────────────────────────────────────
function renderGreeting() {
  const h = new Date().getHours();
  const part =
    h < 5  ? 'Late night'      :
    h < 12 ? 'Good morning'    :
    h < 17 ? 'Good afternoon'  :
    h < 21 ? 'Good evening'    : 'Good night';
  // Optional: load the user's name from chrome.storage if previously saved
  chrome.storage?.local?.get(['name'], (res) => {
    const name = (res && res.name) ? `, ${res.name}` : '';
    document.getElementById('greetText').textContent = `${part}${name}`;
  });
  const dateEl = document.getElementById('greetDate');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }
}

// ── Open the full app ─────────────────────────────────────────
function openFullApp(path = '/') {
  const url = SITE + (path.startsWith('/') ? path : '/' + path);
  chrome.tabs.create({ url, active: true });
  window.close();
}

document.getElementById('openFullBtn')?.addEventListener('click', () => openFullApp('/'));

document.querySelectorAll('.hub-action[data-route]').forEach(btn => {
  btn.addEventListener('click', () => openFullApp(btn.dataset.route));
});

// ── Quick capture ─────────────────────────────────────────────
const captureInput = document.getElementById('captureInput');
const captureSend  = document.getElementById('captureSend');
const captureStatus = document.getElementById('captureStatus');

function flashStatus(msg) {
  if (!captureStatus) return;
  captureStatus.textContent = msg;
  captureStatus.classList.add('show');
  setTimeout(() => captureStatus.classList.remove('show'), 1400);
}

function submitCapture() {
  const text = (captureInput?.value || '').trim();
  if (!text) return;
  // Buffer the capture in extension storage. The main app picks it up
  // from a ?capture=... URL parameter we'll pass when opening a tab.
  const url = SITE + '/?capture=' + encodeURIComponent(text.slice(0, 80));
  chrome.tabs.create({ url, active: true });
  // Also keep a queue in storage so future improvements can sync if the
  // user dismisses the tab before the site loads.
  chrome.storage?.local?.get(['captureQueue'], (res) => {
    const queue = Array.isArray(res?.captureQueue) ? res.captureQueue : [];
    queue.unshift({ text, ts: Date.now() });
    chrome.storage.local.set({ captureQueue: queue.slice(0, 50) });
  });
  captureInput.value = '';
  flashStatus('✓ Captured and opening Focus Hub…');
  setTimeout(() => window.close(), 300);
}

captureSend?.addEventListener('click', submitCapture);
captureInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitCapture(); }
  if (e.key === 'Escape') { window.close(); }
});

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderGreeting();
  // Auto-focus the capture input so the user can start typing immediately
  setTimeout(() => captureInput?.focus(), 50);
});
