/**
 * Safari needs a 32ms delay before onPress; Electron and the Android APK drop
 * user-activation (getDisplayMedia / MediaProjection) if we wait.
 *
 * Android WebView often never delivers a complete PointerEvent, so
 * `@solid-aria/button` `onPress` stays silent. The native `click` still
 * fires — {@link apkClickFallback} uses it, and a short window collapses
 * the pair when both arrive.
 */
let lastApkPressAt = 0;
const APK_DEDUPE_MS = 80;

export function dispatchPress<E>(
  handler: ((ev: E) => void) | undefined,
  ev: E,
) {
  if (!handler) return;
  if (window.MuchatNative && !window.native) {
    const now = Date.now();
    if (now - lastApkPressAt < APK_DEDUPE_MS) return;
    lastApkPressAt = now;
    handler(ev);
    return;
  }
  if (window.native) {
    handler(ev);
    return;
  }
  setTimeout(() => handler(ev), 32);
}

/** APK-only: same handler as `onPress`, skipped on Electron and the browser. */
export function apkClickFallback<E>(
  handler: ((ev: E) => void) | undefined,
  ev: E,
) {
  if (!window.MuchatNative || window.native) return;
  dispatchPress(handler, ev);
}
