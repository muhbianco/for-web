/**
 * Safari needs a 32ms delay before onPress; Electron and the Android APK drop
 * user-activation (getDisplayMedia / MediaProjection) if we wait.
 */
export function dispatchPress<E>(
  handler: ((ev: E) => void) | undefined,
  ev: E,
) {
  if (window.native || window.MuchatNative) {
    handler?.(ev);
    return;
  }
  setTimeout(() => handler?.(ev), 32);
}
