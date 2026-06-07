// Focus Hub — background service worker
// Reserved for future expansion (notifications, alarm-based capture
// reminders, badge counts pulled from Firebase). The popup itself
// is fully self-contained; this just keeps the manifest valid.

self.addEventListener('install', () => {
  // No-op for now. Future: cache the popup assets for offline opens.
});

self.addEventListener('activate', () => {
  // No-op.
});

// Set a default badge color matching the brand accent.
try {
  chrome.action.setBadgeBackgroundColor({ color: '#2C4A8B' });
} catch (_) { /* no-op if action API unavailable */ }
