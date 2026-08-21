const SPLASH_ID = "boot-splash";
const FADE_MS = 200;

// Never leave the splash covering a broken app: if mounting stalls, drop it
// anyway so the user sees whatever did render.
const HARD_TIMEOUT_MS = 12000;

let dismissed = false;

function notifyShells() {
  try {
    window.native?.splashReady?.();
  } catch {
    /* desktop shell is optional */
  }
  try {
    window.MuchatNative?.hideSplash?.();
  } catch {
    /* android shell is optional */
  }
}

/**
 * Remove the pre-render splash from index.html and let native shells know
 * they can reveal the WebView / window.
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

  notifyShells();
}

/** Wire the splash lifecycle: dismiss once the logo has painted, with a hard fallback. */
export function watchBootSplash() {
  if (!document.getElementById(SPLASH_ID)) return;

  setTimeout(dismissBootSplash, HARD_TIMEOUT_MS);

  const dismissWhenUiReady = () =>
    requestAnimationFrame(() => requestAnimationFrame(dismissBootSplash));

  const img = document.querySelector<HTMLImageElement>(`#${SPLASH_ID} img`);
  if (!img || img.complete) {
    dismissWhenUiReady();
    return;
  }
  img.addEventListener("load", dismissWhenUiReady, { once: true });
  img.addEventListener("error", dismissWhenUiReady, { once: true });
}
