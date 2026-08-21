import { Match, Show, Switch, createSignal, onMount } from "solid-js";

import { styled } from "styled-system/jsx";

import type { AppUpdatePayload } from "@revolt/app/interface/settings/user/Native";

import { CategoryButton } from "../../design/CategoryButton";
import { Symbol } from "../../utils/Symbol";

const IDLE: AppUpdatePayload = { state: "idle" };

const [update, setUpdate] = createSignal<AppUpdatePayload>(IDLE);
let listening = false;

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

/**
 * Banner offering the pending desktop update.
 *
 * Hidden when the custom titlebar already shows the same notice.
 */
export function DesktopUpdateBanner() {
  const { state, name, percent, pending, install } = useDesktopUpdate();

  return (
    <Show when={pending() && !window.native?.hasCustomFrame?.()}>
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

  return (
    <Show when={window.native?.onAppUpdate}>
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>system_update</Symbol>}
          action={
            <Show when={pending() && state() !== "downloading"}>
              <Action type="button" onClick={install}>
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
