import { Match, Show, Switch, createSignal, onMount } from "solid-js";
import { Motion, Presence } from "solid-motionone";

import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { useClientLifecycle } from "@revolt/client";
import { State, TransitionType } from "@revolt/client/Controller";
import { Button, Ripple, symbolSize, typography } from "@revolt/ui";
import { MuchatWordmark } from "@revolt/ui/components/features/branding/MuchatWordmark";
import {
  useDesktopUpdate,
  useWebClientStale,
} from "@revolt/ui/components/features/desktop/DesktopUpdate";

import MdBuild from "@material-symbols/svg-400/outlined/build.svg?component-solid";
import MdClose from "@material-symbols/svg-400/outlined/close.svg?component-solid";
import MdCollapseContent from "@material-symbols/svg-400/outlined/collapse_content.svg?component-solid";
import MdExpandContent from "@material-symbols/svg-400/outlined/expand_content.svg?component-solid";
import MdMinimize from "@material-symbols/svg-400/outlined/minimize.svg?component-solid";

import { pendingUpdate } from "../../../../src/serviceWorkerInterface";

const isMacOS = navigator.platform.startsWith("Mac");
const isNative = !!window.native;

/** Whether the shell handed window decoration over to the app. */
const hasCustomFrame = () => !!window.native?.hasCustomFrame?.();

export function Titlebar() {
  const [isMaximised, setIsMaximised] = createSignal(false);
  const { lifecycle } = useClientLifecycle();
  const desktopUpdate = useDesktopUpdate();
  const webClient = useWebClientStale();

  onMount(() => {
    const native = window.native;
    if (!native?.hasCustomFrame?.()) return;

    native.onWindowState?.((state) => {
      setIsMaximised(Boolean(state?.maximised));
    });
    void native
      .getWindowState?.()
      .then((state) => setIsMaximised(Boolean(state?.maximised)))
      .catch(() => {
        /* an older shell may not expose this yet */
      });
  });

  function isDisconnected() {
    return [
      State.Connecting,
      State.Disconnected,
      State.Reconnecting,
      State.Offline,
    ].includes(lifecycle.state());
  }

  return (
    <Presence>
      <Show when={(isNative && hasCustomFrame()) || isDisconnected()}>
        <Motion.div
          initial={{ height: 0 }}
          animate={{ height: "29px" }}
          exit={{ height: 0 }}
        >
          <Base disconnected={isDisconnected()}>
            <Title
              macos={isMacOS}
              style={{
                "-webkit-user-select": "none",
                "-webkit-app-region": "drag",
              }}
            >
              <MuchatWordmark
                class={css({
                  height: "18px",
                  fontSize: "15px",
                  marginBlockStart: "1px",
                })}
              />{" "}
              <Show when={import.meta.env.DEV}>
                <MdBuild {...symbolSize(16)} />
              </Show>
            </Title>
            <DragHandle
              macos={isMacOS && isNative}
              style={{
                "-webkit-user-select": "none",
                "-webkit-app-region": "drag",
              }}
            >
              <Switch>
                <Match when={lifecycle.state() === State.Connecting}>
                  Connecting
                </Match>
                <Match when={lifecycle.state() === State.Disconnected}>
                  Disconnected
                  <a
                    onClick={() =>
                      lifecycle.transition({
                        type: TransitionType.Retry,
                      })
                    }
                    style={{
                      "-webkit-app-region": "no-drag",
                    }}
                  >
                    <strong> (reconnect now)</strong>
                  </a>
                </Match>
                <Match when={lifecycle.state() === State.Reconnecting}>
                  Reconnecting
                </Match>
                <Match when={lifecycle.state() === State.Offline}>
                  Device is offline
                  <a
                    onClick={() =>
                      lifecycle.transition({
                        type: TransitionType.Retry,
                      })
                    }
                    style={{
                      "-webkit-app-region": "no-drag",
                    }}
                  >
                    <strong> (reconnect now)</strong>
                  </a>
                </Match>
              </Switch>
              <Show when={desktopUpdate.pending() || webClient.stale()}>
                <UpdateNotice
                  type="button"
                  disabled={desktopUpdate.state() === "downloading"}
                  onClick={() =>
                    desktopUpdate.pending()
                      ? desktopUpdate.install()
                      : webClient.apply()
                  }
                  style={{
                    "-webkit-app-region": "no-drag",
                  }}
                >
                  {desktopUpdate.pending()
                    ? desktopUpdate.state() === "downloading"
                      ? `Update disponível ${desktopUpdate.percent()}%`
                      : "Update disponível"
                    : "Nova interface"}
                </UpdateNotice>
              </Show>
              <Show when={pendingUpdate() && !isNative}>
                {" "}
                <div
                  style={{
                    "-webkit-app-region": "no-drag",
                  }}
                >
                  <Button size="sm" onPress={pendingUpdate()}>
                    Update
                  </Button>
                </div>
              </Show>
            </DragHandle>
            <Show when={isNative && !isMacOS && hasCustomFrame()}>
              <Action
                onClick={() => window.native?.minimise()}
                style={{ "-webkit-app-region": "no-drag" }}
              >
                <Ripple />
                <MdMinimize {...symbolSize(20)} />
              </Action>
              <Action
                onClick={() => window.native?.maximise()}
                style={{ "-webkit-app-region": "no-drag" }}
              >
                <Ripple />
                <Show
                  when={isMaximised()}
                  fallback={<MdExpandContent {...symbolSize(20)} />}
                >
                  <MdCollapseContent {...symbolSize(20)} />
                </Show>
              </Action>
              <Action
                onClick={() => window.native?.close()}
                style={{ "-webkit-app-region": "no-drag" }}
              >
                <Ripple />
                <MdClose {...symbolSize(20)} />
              </Action>
            </Show>
          </Base>
        </Motion.div>
      </Show>
    </Presence>
  );
}

const Base = styled("div", {
  base: {
    flexShrink: 0,
    height: "29px",
    userSelect: "none",

    display: "flex",
    alignItems: "center",

    fill: "var(--md-sys-color-on-surface)",
  },
  variants: {
    disconnected: {
      true: {
        color: "var(--md-sys-color-on-primary-container)",
        background: "var(--md-sys-color-primary-container)",
      },
      false: {
        color: "var(--md-sys-color-outline)",
        background: "var(--md-sys-color-surface-container-high)",
      },
    },
  },
});

const Title = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-md)",
    alignItems: "center",
    paddingInlineStart: "var(--gap-md)",

    color: "var(--md-sys-color-on-surface)",
    ...typography.raw({ class: "title", size: "small" }),
  },
  variants: {
    macos: {
      true: {
        order: 1,
        paddingInlineEnd: "var(--gap-md)",
      },
    },
  },
});

const DragHandle = styled("div", {
  base: {
    flexGrow: 1,
    height: "100%",

    display: "flex",
    gap: "var(--gap-md)",
    alignItems: "center",
    paddingInlineStart: "var(--gap-md)",

    ...typography.raw({ class: "label", size: "large" }),
  },
  variants: {
    macos: {
      true: {
        marginInlineStart: "70px",
      },
    },
  },
});

const Action = styled("a", {
  base: {
    cursor: "pointer",
    position: "relative",

    display: "grid",
    placeItems: "center",

    height: "100%",
    aspectRatio: "3/2",
  },
});

const UpdateNotice = styled("button", {
  base: {
    border: 0,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: "var(--borderRadius-full)",
    color: "#141210",
    background: "#e85a2a",
    "&:disabled": {
      opacity: 0.7,
      cursor: "default",
    },
  },
});
