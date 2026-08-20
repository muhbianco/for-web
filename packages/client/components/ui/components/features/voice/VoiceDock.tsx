import { useNavigate } from "@solidjs/router";
import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";

import { IconButton } from "../../design/IconButton";
import { OverflowingText } from "../../utils/OverflowingText";
import { Symbol } from "../../utils/Symbol";

/**
 * Persistent voice controls pinned to the bottom of the channel sidebar.
 *
 * Mirrors the in-call actions so mute, deafen, screen share and hang up stay
 * reachable from any channel.
 */
export function VoiceDock() {
  const voice = useVoice();
  const navigate = useNavigate();
  const { t } = useLingui();

  const connected = () => voice.state() === "CONNECTED";
  const channel = () => voice.channel();

  return (
    <Show when={connected() && channel()}>
      {(current) => (
        <Base aria-label={t`Voice controls`}>
          <Status>
            <Live>
              <Symbol size={14}>graphic_eq</Symbol>
              <span>{t`Voz conectada`}</span>
            </Live>
            <ChannelName
              onClick={() => navigate(current().path ?? "")}
              title={current().name ?? ""}
            >
              <OverflowingText>{current().name}</OverflowingText>
            </ChannelName>
          </Status>

          <Actions>
            <IconButton
              size="xs"
              variant={voice.microphone() ? "filled" : "tonal"}
              onPress={() => voice.toggleMute()}
              isDisabled={!voice.speakingPermission}
              aria-label={voice.microphone() ? t`Mute` : t`Unmute`}
            >
              <Show
                when={voice.microphone()}
                fallback={<Symbol>mic_off</Symbol>}
              >
                <Symbol>mic</Symbol>
              </Show>
            </IconButton>

            <IconButton
              size="xs"
              variant={
                voice.deafen() || !voice.listenPermission ? "tonal" : "filled"
              }
              onPress={() => voice.toggleDeafen()}
              isDisabled={!voice.listenPermission}
              aria-label={voice.deafen() ? t`Undeafen` : t`Deafen`}
            >
              <Show
                when={voice.deafen() || !voice.listenPermission}
                fallback={<Symbol>headset</Symbol>}
              >
                <Symbol>headset_off</Symbol>
              </Show>
            </IconButton>

            <IconButton
              size="xs"
              variant={voice.screenshare() ? "filled" : "tonal"}
              onPress={() => voice.toggleScreenshare()}
              aria-label={
                voice.screenshare() ? t`Stop sharing` : t`Share screen`
              }
            >
              <Show
                when={voice.screenshare()}
                fallback={<Symbol>screen_share</Symbol>}
              >
                <Symbol>stop_screen_share</Symbol>
              </Show>
            </IconButton>

            <IconButton
              size="xs"
              variant="tonal"
              onPress={() => voice.disconnect()}
              aria-label={t`End call`}
            >
              <Symbol color="var(--md-sys-color-error)">call_end</Symbol>
            </IconButton>
          </Actions>
        </Base>
      )}
    </Show>
  );
}

const Base = styled("aside", {
  base: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",

    padding: "var(--gap-md)",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
  },
});

const Status = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
});

const Live = styled("div", {
  base: {
    display: "flex",
    gap: "4px",
    alignItems: "center",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--md-sys-color-primary)",
  },
});

const ChannelName = styled("a", {
  base: {
    minWidth: 0,
    cursor: "pointer",
    fontSize: "12px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const Actions = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-sm)",
    "& > *": {
      flexGrow: 1,
    },
  },
});
