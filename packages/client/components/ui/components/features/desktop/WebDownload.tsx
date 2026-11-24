import { Show, createSignal } from "solid-js";

import { styled } from "styled-system/jsx";

import { Symbol } from "../../utils/Symbol";

import { nativeDownloadHref } from "./microsoftStore";

function isNativeShell() {
  return Boolean(window.native || window.MuchatNative);
}

/** "Fechar" lasts a month (it used to come back on every reload). */
const DISMISS_KEY = "muchat:download-banner-dismissed-at";
const DISMISS_MS = 30 * 24 * 3600_000;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function rememberDismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Private mode or blocked storage: closed for this session only.
  }
}

/**
 * Pill offering the native installer. Only the browser needs it — Electron and
 * the Android WebView already are the app.
 */
export function WebDownloadBanner() {
  const [dismissed, setDismissed] = createSignal(dismissedRecently());

  return (
    <Show when={!isNativeShell() && !dismissed()}>
      <Banner>
        <span>Muchat fica melhor no app</span>
        <Action
          href={nativeDownloadHref(
            typeof navigator === "undefined" ? "" : navigator.userAgent,
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          Baixar
        </Action>
        <Close
          type="button"
          aria-label="Fechar"
          onClick={() => {
            rememberDismiss();
            setDismissed(true);
          }}
        >
          <Symbol>close</Symbol>
        </Close>
      </Banner>
    </Show>
  );
}

const Banner = styled("div", {
  base: {
    // [Muchat] A corner at the bottom, not over the pages' headers (it covered the
    // Espaço's title and its Palco and Herói buttons, 23/11/2026).
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: 10040,
    // A phone's browser: above the Espaço's action dock, clear of the home bar.
    "@media (max-width: 600px)": {
      left: "8px",
      right: "8px",
      bottom: "calc(72px + env(safe-area-inset-bottom))",
      justifyContent: "space-between",
    },

    display: "flex",
    gap: "12px",
    alignItems: "center",
    padding: "8px 10px 8px 14px",

    fontSize: "13px",
    borderRadius: "var(--borderRadius-full)",
    color: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface-container-highest)",
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.35)",
  },
});

const Action = styled("a", {
  base: {
    border: 0,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
    padding: "6px 12px",
    borderRadius: "var(--borderRadius-full)",
    color: "#141210",
    background: "#e85a2a",
    textDecoration: "none",
  },
});

const Close = styled("button", {
  base: {
    border: 0,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    padding: "2px",
    color: "inherit",
    background: "transparent",
    opacity: 0.55,
    "&:hover": {
      opacity: 1,
    },
  },
});
