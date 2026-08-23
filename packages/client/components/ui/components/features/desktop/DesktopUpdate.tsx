import { Match, Show, Switch, createSignal, onMount } from "solid-js";

import { styled } from "styled-system/jsx";

import type { AppUpdatePayload } from "@revolt/app/interface/settings/user/Native";

import { pendingUpdate } from "../../../../../src/serviceWorkerInterface";

import { CategoryButton } from "../../design/CategoryButton";
import { Symbol } from "../../utils/Symbol";

const IDLE: AppUpdatePayload = { state: "idle" };

const [update, setUpdate] = createSignal<AppUpdatePayload>(IDLE);
const [webStale, setWebStale] = createSignal(false);
let listening = false;
let webPollStarted = false;

const ASSET_JS_RE = /\/assets\/[^"' ]+\.js/g;
const WEB_POLL_MS = 60_000;

/**
 * Track the desktop shell's auto updater.
 *
 * The shell may finish checking before this app mounts, so we prime from
 * getUpdateState() instead of relying on the broadcast alone. Shared so the
 * titlebar, banner, and settings page see one lifecycle.
 */
function ensureDesktopUpdateListener() {
  const native = window.native;
  if (!native?.onAppUpdate || listening) return;
  listening = true;

  native.onAppUpdate((payload) => setUpdate(payload ?? IDLE));
  void native
    .getUpdateState?.()
    .then((payload) =>
      // Do not clobber a live event that landed while we were asking.
      setUpdate((current) =>
        current.state === "idle" ? (payload ?? IDLE) : current,
      ),
    )
    .catch(() => {
      /* an older shell may not expose this yet */
    });
}

function loadedAssetFingerprint() {
  return [
    ...document.querySelectorAll("script[src], link[rel='modulepreload']"),
  ]
    .map((el) =>
      (el.getAttribute("src") || el.getAttribute("href") || "").replace(
        /^https?:\/\/[^/]+/,
        "",
      ),
    )
    .filter((src) => src.includes("/assets/") && src.endsWith(".js"))
    .sort()
    .join();
}

function publishedAssetFingerprint(html: string) {
  return [...html.matchAll(ASSET_JS_RE)].map((match) => match[0]).sort().join();
}

/**
 * Desktop keeps one window open for hours. A new web build is picked up by
 * reloading — this poll shows the same Atualizar pill without a new .exe.
 */
function ensureWebClientPoll() {
  if (webPollStarted || !window.native) return;
  webPollStarted = true;

  const check = async () => {
    if (pendingUpdate()) {
      setWebStale(true);
      return;
    }
    try {
      const html = await fetch(`/?_=${Date.now()}`, { cache: "no-store" }).then(
        (r) => r.text(),
      );
      const current = loadedAssetFingerprint();
      const published = publishedAssetFingerprint(html);
      if (current && published && current !== published) setWebStale(true);
    } catch {
      /* offline or unexpected index shape */
    }
  };

  void check();
  window.setInterval(check, WEB_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
}

export function useDesktopUpdate() {
  onMount(() => ensureDesktopUpdateListener());

  const name = () => {
    const { version } = update();
    return version ? `Muchat ${version}` : "Uma nova versão";
  };

  const percent = () => Math.round(update().percent ?? 0);

  return {
    state: () => update().state,
    name,
    percent,
    pending: () => update().state !== "idle",
    install: () => window.native?.installAppUpdate?.(),
  };
}

export function useWebClientStale() {
  onMount(() => ensureWebClientPoll());

  return {
    stale: webStale,
    apply: () => {
      const apply = pendingUpdate();
      if (apply) apply();
      else window.location.reload();
    },
  };
}

/**
 * Banner offering a pending .exe update or a newer web client.
 *
 * Shown even with the custom titlebar so the pill is hard to miss. Web
 * reloads never go through electron-updater.
 */
export function DesktopUpdateBanner() {
  const { state, name, percent, pending, install } = useDesktopUpdate();
  const web = useWebClientStale();

  return (
    <Show when={pending() || web.stale()}>
      <Banner role="status">
        <Switch>
          <Match when={state() === "available"}>
            <span>{name()} disponível</span>
            <Action type="button" onClick={install}>
              Atualizar
            </Action>
          </Match>
          <Match when={state() === "downloading"}>
            <span>
              Baixando {name()}… {percent()}%
            </span>
            <Action type="button" disabled>
              Atualizar
            </Action>
          </Match>
          <Match when={state() === "ready"}>
            <span>{name()} pronta</span>
            <Action type="button" onClick={install}>
              Reiniciar e instalar
            </Action>
          </Match>
          <Match when={state() === "error"}>
            <span>Não deu pra atualizar agora</span>
            <Action type="button" onClick={install}>
              Tentar de novo
            </Action>
          </Match>
          <Match when={web.stale()}>
            <span>Nova interface pronta</span>
            <Action type="button" onClick={() => web.apply()}>
              Atualizar
            </Action>
          </Match>
        </Switch>
      </Banner>
    </Show>
  );
}

/**
 * Update controls on the desktop settings page.
 *
 * Mirrors the banner so an update stays reachable after it scrolls away.
 */
export function DesktopUpdateSection() {
  const { state, name, percent, pending, install } = useDesktopUpdate();
  const web = useWebClientStale();

  return (
    <Show when={window.native}>
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>system_update</Symbol>}
          action={
            <Show when={(pending() && state() !== "downloading") || web.stale()}>
              <Action
                type="button"
                onClick={() => (pending() ? install() : web.apply())}
              >
                {state() === "ready" ? "Reiniciar e instalar" : "Atualizar"}
              </Action>
            </Show>
          }
          description={
            <Switch fallback="Você está na versão mais recente.">
              <Match when={state() === "available"}>
                {name()} está disponível.
              </Match>
              <Match when={state() === "downloading"}>
                Baixando… {percent()}%
              </Match>
              <Match when={state() === "ready"}>
                {name()} pronta para instalar.
              </Match>
              <Match when={state() === "error"}>
                A última tentativa de atualizar falhou.
              </Match>
              <Match when={web.stale()}>
                Tem uma interface nova. Atualizar recarrega o app.
              </Match>
            </Switch>
          }
        >
          Atualizações
        </CategoryButton>
      </CategoryButton.Group>
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

const Action = styled("button", {
  base: {
    border: 0,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
    padding: "6px 12px",
    borderRadius: "var(--borderRadius-full)",
    color: "#141210",
    background: "#e85a2a",
    "&:disabled": {
      opacity: 0.45,
      cursor: "default",
    },
  },
});
