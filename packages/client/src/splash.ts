const SPLASH_ID = "boot-splash";
const FADE_MS = 200;

// Never leave the splash covering a broken app: if mounting stalls, drop it
// anyway so the user sees whatever did render.
const HARD_TIMEOUT_MS = 12000;

let dismissed = false;

/**
 * Remove the pre-render splash from index.html and let the desktop shell know
 * it can reveal its window.
 *
 * Safe to call more than once.
 */
export function dismissBootSplash() {
  if (dismissed) return;
  dismissed = true;

  const splash = document.getElementById(SPLASH_ID);
  if (splash) {
    splash.style.transition = `opacity ${FADE_MS}ms ease`;
    splash.style.opacity = "0";
    setTimeout(() => splash.remove(), FADE_MS);
  }

  try {
    window.native?.splashReady?.();
  } catch {
    /* the shell is optional */
  }
}

/** Wire the splash lifecycle: dismiss on next frame, with a hard fallback. */
export function watchBootSplash() {
  if (!document.getElementById(SPLASH_ID)) return;

  setTimeout(dismissBootSplash, HARD_TIMEOUT_MS);
  requestAnimationFrame(() => requestAnimationFrame(dismissBootSplash));
}
