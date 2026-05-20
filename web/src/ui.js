// Small UI helpers added in M12 polish.

export function showToast(msg, opts = {}) {
  const t = document.createElement('div');
  t.className = `toast${opts.kind === 'err' ? ' err' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  // Trigger CSS transition on next frame.
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, opts.duration ?? 3800);
}

export function showBanner(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.classList.add('show');
  // Auto-clear after ~10s; user can also dismiss by clicking.
  el.onclick = () => el.classList.remove('show');
  setTimeout(() => el.classList.remove('show'), 10000);
}

// Wraps an async fn with button-busy state. Restores label + disabled state
// even on throw. Returns whatever the fn returns.
export async function withBusy(buttonEl, busyLabel, fn) {
  if (!buttonEl) return await fn();
  const origLabel = buttonEl.textContent;
  const origDisabled = buttonEl.disabled;
  buttonEl.textContent = busyLabel;
  buttonEl.disabled = true;
  try {
    return await fn();
  } finally {
    buttonEl.textContent = origLabel;
    buttonEl.disabled = origDisabled;
  }
}

export function installUnhandledRejectionBanner() {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message ?? String(e.reason ?? 'unknown error');
    showBanner(`Unhandled: ${msg.slice(0, 200)}`);
  });
  window.addEventListener('error', (e) => {
    showBanner(`Error: ${e.message?.slice(0, 200) ?? 'unknown error'}`);
  });
}
