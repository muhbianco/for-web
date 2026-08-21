type WindowStatePayload = { maximised?: boolean };

/**
 * Apply Electron custom-frame classes as soon as the SPA boots, so the
 * pre-mount splash and #root clip to the same CSS radius as the HWND.
 */
export function applyDesktopChrome() {
  const native = window.native;
  if (!native?.hasCustomFrame?.()) return;

  document.documentElement.classList.add("muchat-custom-frame");
  if (native.usesCssRoundedCorners?.()) {
    document.documentElement.classList.add("muchat-css-round");
  }

  function applyMaximised(maximised: boolean) {
    document.documentElement.classList.toggle("muchat-maximized", maximised);
  }

  native.onWindowState?.((state: WindowStatePayload) => {
    applyMaximised(Boolean(state?.maximised));
  });
  void native
    .getWindowState?.()
    .then((state) => applyMaximised(Boolean(state?.maximised)))
    .catch(() => {
      /* an older shell may not expose this yet */
    });
}
