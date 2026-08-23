import { Show, createSignal } from "solid-js";

import { styled } from "styled-system/jsx";

import { Symbol } from "../../utils/Symbol";

function isNativeShell() {
  return Boolean(window.native || window.MuchatNative);
}

/**
 * Pill offering the native installer. Only the browser needs it — Electron and
 * the Android WebView already are the app.
 */
export function WebDownloadBanner() {
  const [dismissed, setDismissed] = createSignal(false);

  return (
    <Show when={!isNativeShell() && !dismissed()}>
      <Banner>
        <span>Muchat fica melhor no app</span>
        <Action href="/download" target="_blank" rel="noopener noreferrer">
          Baixar
        </Action>
        <Close
          type="button"
          aria-label="Fechar"
          onClick={() => setDismissed(true)}
        >
          <Symbol>close</Symbol>
        </Close>
      </Banner>
    </Show>
  );
}

const Banner = styled("div", {
  base: {
    position: "fixed",
    top: "12px",
    left: "50%",
    zIndex: 10040,
    transform: "translateX(-50%)",

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
