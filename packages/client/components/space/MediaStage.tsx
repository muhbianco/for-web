import { For, type JSX, Match, Show, Switch, createMemo } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { Track } from "livekit-client";
import type { TrackReferenceOrPlaceholder } from "solid-livekit-components";
import type { Channel } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useVoice } from "@revolt/rtc";
import { participantUserId } from "@revolt/rtc/identity";
import { IconButton } from "@revolt/ui";
import { VoiceChannelCallCardMount } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

export type StageTab = "call" | "tv";
export type StageMode = "side" | "focus";

/** A screen someone shares in the room's call, as the stage lists it. */
export interface StageShare {
  key: string;
  userId: string;
  name: string;
  local: boolean;
  track: TrackReferenceOrPlaceholder;
}

/** Screens shared in the current call (remote and our own), oldest first. */
export function useStageShares() {
  const voice = useVoice();
  const client = useClient();
  return createMemo<StageShare[]>(() => {
    // vidTracks is replaced on every connect: track the room to follow it.
    voice.room();
    return voice
      .vidTracks()
      .filter((t) => t.source === Track.Source.ScreenShare && t.publication)
      .map((t) => {
        const userId = participantUserId(t.participant.identity);
        const user = client().users.get(userId);
        return {
          key: voice.trackId(t),
          userId,
          name: user?.displayName ?? user?.username ?? t.participant.name ?? "",
          local: t.participant.isLocal,
          track: t,
        };
      });
  });
}

/**
 * Media stage of the space (docs/espaco ADR 0008): a panel next to the map
 * that shows what the room is looking at, without hiding the map.
 *
 * - "Chamada": the room's call card, the same one Stoat shows on a voice
 *   channel (participants, a shared screen in focus, expand, fullscreen,
 *   mic/deafen/camera/screen/hang up). It is mounted here with `fill`, so the
 *   call's whole stage lives in this panel; nothing new is transmitted.
 * - "Smart TV": the room's TV (step 6).
 *
 * Closing the stage leaves the call in the floating mini card over the map
 * (compact mode): you keep walking and talking.
 */
export function MediaStage(props: {
  channel: Channel | undefined;
  connected: boolean;
  tab: StageTab;
  onTab: (tab: StageTab) => void;
  mode: StageMode;
  onMode: (mode: StageMode) => void;
  onClose: () => void;
  /** Room audio problem as text and its action ("Tentar de novo"), when not connected. */
  mediaText: string | null;
  mediaAction: { label: string; run: () => void } | null;
  hasTv: boolean;
  tv?: JSX.Element;
  /** MuteMembers in this room (Stoat): may end someone else's screen share. */
  canModerate?: boolean;
  onStopShare?: (userId: string) => void;
}) {
  const { t } = useLingui();
  const voice = useVoice();
  const shares = useStageShares();
  const focused = () => {
    const f = voice.focusTrack();
    return f ? shares().find((s) => s.key === voice.trackId(f)) : undefined;
  };
  const presenter = () => {
    const list = shares();
    if (list.length === 0) return null;
    const f = focused();
    const who = f ?? list[list.length - 1]!;
    return who.local ? t`Você está apresentando` : t`${who.name} está apresentando`;
  };

  return (
    <Stage
      aria-label={t`Palco de mídia`}
      data-mode={props.mode}
      onKeyDown={(e) => {
        if (e.key === "Escape" && voice.layout() !== "fullscreen") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <Head>
        <Tabs role="tablist">
          <Tab
            role="tab"
            type="button"
            aria-selected={props.tab === "call"}
            onClick={() => props.onTab("call")}
          >
            <Symbol size={18}>
              {shares().length ? "screen_share" : "groups"}
            </Symbol>
            {shares().length ? t`Telas` : t`Chamada`}
            <Show when={shares().length > 1}>
              <Badge>{shares().length}</Badge>
            </Show>
          </Tab>
          <Show when={props.hasTv}>
            <Tab
              role="tab"
              type="button"
              aria-selected={props.tab === "tv"}
              onClick={() => props.onTab("tv")}
            >
              <Symbol size={18}>tv</Symbol>
              {t`Smart TV`}
            </Tab>
          </Show>
        </Tabs>
        <span style={{ flex: 1 }} />
        <IconButton
          size="sm"
          variant="standard"
          aria-label={
            props.mode === "focus" ? t`Restaurar o mapa` : t`Ampliar o palco`
          }
          use:floating={{
            tooltip: {
              placement: "bottom",
              content:
                props.mode === "focus"
                  ? t`Restaurar o mapa (F)`
                  : t`Ampliar o palco (F)`,
            },
          }}
          onPress={() => props.onMode(props.mode === "focus" ? "side" : "focus")}
        >
          <Symbol>
            {props.mode === "focus" ? "close_fullscreen" : "open_in_full"}
          </Symbol>
        </IconButton>
        <IconButton
          size="sm"
          variant="standard"
          aria-label={t`Fechar o palco`}
          use:floating={{
            tooltip: {
              placement: "bottom",
              content: t`Fechar o palco (Esc): a chamada segue no card flutuante`,
            },
          }}
          onPress={props.onClose}
        >
          <Symbol>close</Symbol>
        </IconButton>
      </Head>

      <Switch>
        <Match when={props.tab === "tv" && props.hasTv}>
          <Body>{props.tv}</Body>
        </Match>
        <Match when={props.connected && props.channel}>
          <Show when={presenter()}>
            {(text) => (
              <Presenters>
                <Symbol size={16}>present_to_all</Symbol>
                <span role="status">{text()}</span>
                <Show when={shares().length > 1}>
                  <For each={shares()}>
                    {(s) => (
                      <ShareChip
                        type="button"
                        aria-pressed={focused()?.key === s.key}
                        onClick={() => voice.focus(s.track)}
                      >
                        {s.local ? t`Sua tela` : s.name}
                      </ShareChip>
                    )}
                  </For>
                </Show>
                <Show when={shares().some((s) => s.local)}>
                  <ShareChip
                    type="button"
                    data-stop=""
                    onClick={() => voice.toggleScreenshare()}
                  >
                    <Symbol size={14}>stop_screen_share</Symbol>
                    {t`Parar de compartilhar`}
                  </ShareChip>
                </Show>
                <Show when={props.canModerate && props.onStopShare}>
                  <For each={shares().filter((s) => !s.local)}>
                    {(s) => (
                      <ShareChip
                        type="button"
                        data-stop=""
                        title={t`Moderação: encerra a tela de ${s.name} nesta sala`}
                        onClick={() => props.onStopShare?.(s.userId)}
                      >
                        <Symbol size={14}>cancel_presentation</Symbol>
                        {t`Encerrar tela de ${s.name}`}
                      </ShareChip>
                    )}
                  </For>
                </Show>
              </Presenters>
            )}
          </Show>
          {/* The call card is positioned over this element (fill). */}
          <Body data-call="">
            <VoiceChannelCallCardMount channel={props.channel!} fill />
          </Body>
        </Match>
        <Match when={true}>
          <Empty>
            <Symbol size={32}>volume_off</Symbol>
            <p>{props.mediaText ?? t`Entre numa sala para ver a chamada.`}</p>
            <Show when={props.mediaAction}>
              {(a) => (
                <ShareChip type="button" onClick={() => a().run()}>
                  {a().label}
                </ShareChip>
              )}
            </Show>
          </Empty>
        </Match>
      </Switch>
    </Stage>
  );
}

const Stage = styled("section", {
  base: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    background: "var(--md-sys-color-surface-container-low)",
    borderInlineStart: "1px solid var(--md-sys-color-outline-variant)",
  },
});

const Head = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-sm)",
    padding: "var(--gap-sm) var(--gap-md)",
    minHeight: "44px",
  },
});

const Tabs = styled("div", {
  base: { display: "flex", gap: "4px" },
});

const Tab = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 12px",
    border: "none",
    borderRadius: "999px",
    background: "transparent",
    color: "var(--md-sys-color-on-surface-variant)",
    font: "inherit",
    fontSize: "0.9em",
    cursor: "pointer",
    "&[aria-selected=true]": {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
      fontWeight: 600,
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Badge = styled("span", {
  base: {
    minWidth: "18px",
    padding: "0 5px",
    borderRadius: "999px",
    background: "var(--md-sys-color-primary)",
    color: "var(--md-sys-color-on-primary)",
    fontSize: "0.75em",
    textAlign: "center",
  },
});

const Presenters = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
    padding: "0 var(--gap-md) var(--gap-sm)",
    fontSize: "0.85em",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const ShareChip = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 10px",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    "&[aria-pressed=true]": {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },
    "&[data-stop]": {
      background: "var(--md-sys-color-error-container)",
      color: "var(--md-sys-color-on-error-container)",
      borderColor: "transparent",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Body = styled("div", {
  base: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
});

const Empty = styled("div", {
  base: {
    flex: 1,
    display: "grid",
    placeItems: "center",
    alignContent: "center",
    gap: "var(--gap-sm)",
    padding: "var(--gap-lg)",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
