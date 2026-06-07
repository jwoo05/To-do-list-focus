/**
 * Focus Hub — PWA install + service worker registration
 *
 * Three jobs:
 *   1. Register the service worker (so the browser knows we're a PWA)
 *   2. Capture the `beforeinstallprompt` event, surface our own
 *      "Install" button in the home page banner, and trigger the
 *      native install flow on click
 *   3. Detect when the user is already running the installed app
 *      (display-mode: standalone) and hide the banner accordingly
 */

(function () {
  'use strict';

  // ── 1. Register the service worker ──────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // console.log('[PWA] service worker registered', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] service worker registration failed', err);
        });
    });
  }

  // ── 2. Install prompt handling ──────────────────────────────
  let deferredInstallPrompt = null;

  function isAlreadyInstalled() {
    // Chrome / Edge / Android home-screen installs run in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS Safari sets navigator.standalone when launched from home screen
    if (window.navigator.standalone === true) return true;
    return false;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isSafari() {
    return /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  }

  function userDismissed() {
    try { return localStorage.getItem('pwa_install_dismissed') === '1'; }
    catch (_) { return false; }
  }

  function showBanner() {
    const banner = document.getElementById('installBanner');
    if (!banner) return;
    if (isAlreadyInstalled()) {
      banner.hidden = true;
      return;
    }
    if (userDismissed()) {
      banner.hidden = true;
      return;
    }
    // Adjust copy per platform
    const sub = document.getElementById('installBannerSub');
    const btn = document.getElementById('installBtn');
    if (deferredInstallPrompt) {
      // Chrome-family — we have a real prompt to trigger
      if (sub) sub.textContent = 'Use it like a real app — opens in its own window, no browser tabs.';
      if (btn) {
        btn.textContent = 'Install';
        btn.disabled = false;
      }
    } else if (isIOS() && isSafari()) {
      // iOS Safari can install but doesn't fire beforeinstallprompt
      if (sub) sub.textContent = 'Tap Share, then "Add to Home Screen" to install on iOS.';
      if (btn) {
        btn.textContent = 'How?';
        btn.disabled = false;
        btn.onclick = function () { openInstallGuide(); };
      }
    } else if (isSafari() && !isIOS()) {
      // macOS Safari (16+) supports Add to Dock from the File menu
      if (sub) sub.textContent = 'In Safari, File → Add to Dock… to install as a real app.';
      if (btn) {
        btn.textContent = 'How?';
        btn.disabled = false;
        btn.onclick = function () { openInstallGuide(); };
      }
    } else {
      // Fallback for browsers without beforeinstallprompt yet —
      // surface the manual guide instead of a confusing greyed button
      if (sub) sub.textContent = 'Add Focus Hub to your home screen — works on every platform.';
      if (btn) {
        btn.textContent = 'How?';
        btn.disabled = false;
        btn.onclick = function () { openInstallGuide(); };
      }
    }
    banner.hidden = false;
  }

  // beforeinstallprompt fires on Chrome / Edge / Brave when the site
  // meets the install criteria (manifest + SW + engagement).
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    // Rebind the install button to actually fire the native prompt
    const btn = document.getElementById('installBtn');
    if (btn) {
      btn.onclick = function () { triggerInstall(); };
    }
    showBanner();
  });

  // When the user successfully installs, hide the banner.
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const banner = document.getElementById('installBanner');
    if (banner) banner.hidden = true;
    try {
      if (typeof showToast === 'function') {
        showToast('Focus Hub installed — find it in your apps.');
      }
    } catch (_) {}
  });

  async function triggerInstall() {
    if (!deferredInstallPrompt) {
      // Fall back to the manual guide
      openInstallGuide();
      return;
    }
    deferredInstallPrompt.prompt();
    try {
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        // The appinstalled handler will hide the banner
      } else {
        // Dismissed — don't pester them again this session
        deferredInstallPrompt = null;
      }
    } catch (_) {}
  }

  // Globals used by the home-page banner buttons
  window.openInstallGuide = function () {
    if (typeof openModal === 'function') {
      openModal('mInstallGuide');
    } else {
      document.getElementById('mInstallGuide')?.classList.add('show');
    }
  };
  window.dismissInstallBanner = function () {
    try { localStorage.setItem('pwa_install_dismissed', '1'); } catch (_) {}
    const banner = document.getElementById('installBanner');
    if (banner) banner.hidden = true;
  };

  // Show the banner on first load (with whatever default state we have).
  // If beforeinstallprompt fires later, showBanner() will be called again
  // with the upgraded copy.
  document.addEventListener('DOMContentLoaded', () => {
    // Tiny delay so the home greeting paints first — less jarring
    setTimeout(showBanner, 600);
  });
})();
