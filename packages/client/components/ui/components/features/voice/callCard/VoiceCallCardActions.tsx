import { useNavigate } from "@solidjs/router";
import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useInstance } from "@revolt/instance";
import { useVoice } from "@revolt/rtc";
import { isSpaceServer } from "@revolt/space/config";
import { useState } from "@revolt/state";
import { Button, IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { MicSlot, SpeakingWhileMutedHint } from "../SpeakingWhileMutedHint";

export function VoiceCallCardActions(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const state = useState();
  const navigate = useNavigate();
  const { t } = useLingui();
  const { limits } = useInstance();
  // Same Stoat permission the server reads to allow a screen in the token
  // (Video); stopping a share in progress is always allowed.
  const canShare = () =>
    voice.screenshare() || !!voice.channel()?.havePermission("Video");
  /** A room of a space server lives on the map; other calls on their channel page. */
  const callPath = () => {
    const ch = voice.channel();
    if (!ch) return "";
    return ch.serverId && isSpaceServer(ch.serverId)
      ? `/server/${ch.serverId}/space?sala=${ch.id}`
      : ch.path;
  };

  return (
    <Actions>
      <Show when={props.size === "xs"}>
        <IconButton
          variant="standard"
          size={props.size}
          onPress={() => {
            navigate(callPath());
            state.appDrawer()?.setShown(true);
          }}
          use:floating={{
            tooltip: {
              placement: "top",
              content: t`Return to voice channel`,
            },
          }}
        >
          <Symbol>arrow_top_left</Symbol>
        </IconButton>
      </Show>
      <Show when={props.size !== "xs" && voice.layout() === "collapsed"}>
        <IconButton
          variant="standard"
          size={props.size}
          onPress={() => voice.toggleLayout("collapsed")}
          use:floating={{
            tooltip: {
              placement: "top",
              content: t`Restore call window`,
            },
          }}
        >
          <Symbol>unfold_more</Symbol>
        </IconButton>
      </Show>
      <MicSlot>
        <SpeakingWhileMutedHint />
        <IconButton
          size={props.size}
          variant={voice.microphone() ? "filled" : "tonal"}
          onPress={() => voice.toggleMute()}
          use:floating={{
            tooltip: {
              placement: "top",
              content: voice.speakingPermission
                ? voice.micBlocked()
                  ? t`O Windows ou o headset está silenciando o seu microfone: ninguém está te ouvindo`
                  : voice.microphone()
                    ? t`Mute`
                    : t`Unmute`
                : t`Missing permission`,
            },
          }}
          isDisabled={!voice.speakingPermission}
        >
          <Show when={voice.microphone()} fallback={<Symbol>mic_off</Symbol>}>
            <Show when={voice.micBlocked()} fallback={<Symbol>mic</Symbol>}>
              <Symbol>warning</Symbol>
            </Show>
          </Show>
        </IconButton>
      </MicSlot>
      <IconButton
        size={props.size}
        variant={voice.deafen() || !voice.listenPermission ? "tonal" : "filled"}
        onPress={() => voice.toggleDeafen()}
        use:floating={{
          tooltip: {
            placement: "top",
            content: voice.listenPermission
              ? voice.deafen()
                ? t`Undeafen`
                : t`Deafen`
              : t`Missing permission`,
          },
        }}
        isDisabled={!voice.listenPermission}
      >
        <Show
          when={voice.deafen() || !voice.listenPermission}
          fallback={<Symbol>headset</Symbol>}
        >
          <Symbol>headset_off</Symbol>
        </Show>
      </IconButton>
      <IconButton
        size={props.size}
        variant={limits().video && voice.video() ? "filled" : "tonal"}
        onPress={() => {
          if (limits().video) voice.toggleCamera();
        }}
        use:floating={{
          tooltip: {
            placement: "top",
            content: limits().video
              ? voice.video()
                ? t`Stop camera`
                : t`Start camera`
              : t`Coming soon! 👀`,
          },
        }}
        isDisabled={!limits().video}
      >
        <Symbol>camera_video</Symbol>
      </IconButton>
      <IconButton
        size={props.size}
        variant={limits().video && voice.screenshare() ? "filled" : "tonal"}
        onPress={() => {
          if (canShare()) voice.toggleScreenshare();
        }}
        use:floating={{
          tooltip: {
            placement: "top",
            content: !canShare()
              ? t`Sem permissão para compartilhar a tela aqui`
              : voice.screenshare()
                ? t`Stop sharing`
                : t`Share screen`,
          },
        }}
        isDisabled={!canShare()}
      >
        <Show
          when={voice.screenshare()}
          fallback={<Symbol>screen_share</Symbol>}
        >
          <Symbol>stop_screen_share</Symbol>
        </Show>
      </IconButton>
      <Button
        size={props.size}
        variant="_error"
        onPress={() => voice.disconnect()}
        use:floating={{
          tooltip: {
            placement: "top",
            content: t`End call`,
          },
        }}
      >
        <Symbol>call_end</Symbol>
      </Button>
    </Actions>
  );
}

const Actions = styled("div", {
  base: {
    flexShrink: 0,
    gap: "var(--gap-md)",
    padding: "var(--gap-md)",
    zIndex: 2,

    display: "flex",
    width: "fit-content",
    justifyContent: "center",
    alignSelf: "center",

    borderRadius: "var(--borderRadius-full)",
    background: "var(--md-sys-color-surface-container)",
  },
});
