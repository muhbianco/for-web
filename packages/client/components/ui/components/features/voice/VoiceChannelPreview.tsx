import { For, Show, splitProps } from "solid-js";

import {
  TrackLoop,
  useEnsureParticipant,
  useIsMuted,
  useIsSpeaking,
  useTracks,
} from "solid-livekit-components";

import { useLingui } from "@lingui/solid/macro";
import { peopleIn } from "@muchat/space-client/presence";
import { Track } from "livekit-client";
import { Channel, VoiceParticipant } from "stoat.js";
import { css, cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { UserContextMenu } from "@revolt/app";
import { useClient } from "@revolt/client";
import { useUser } from "@revolt/markdown/users";
import { InRoom, useIsDeafened } from "@revolt/rtc";
import { isSpaceServer } from "@revolt/space/config";
import { useSpacePresence } from "@revolt/space/presence";

import { Avatar, Ripple, typography } from "../../design";
import { Row } from "../../layout";

import { participantUserId } from "@revolt/rtc/identity";
import { useVoiceMemberDrag } from "./VoiceMemberDrag";
import { VoiceStatefulUserIcons } from "./VoiceStatefulUserIcons";

/**
 * Render a preview of users (or the active participants) for a given channel
 *
 * Designed for the server sidebar to be below channels
 */
export function VoiceChannelPreview(props: { channel: Channel }) {
  // A room of a space server: Stoat's voice states never fill for it (its
  // call is a room of the space), so the space's presence is the source.
  const space = () =>
    !!props.channel.serverId && isSpaceServer(props.channel.serverId);
  return (
    <InRoom
      channelId={props.channel.id}
      fallback={
        <Show
          when={space()}
          fallback={<VariantPreview channel={props.channel} />}
        >
          <VariantSpace channel={props.channel} />
        </Show>
      }
    >
      <VariantLive channel={props.channel} />
    </InRoom>
  );
}

/**
 * Use the space's presence as the source of truth (a room of a space server
 * we are not in): who is inside, who is in its call, muted, deafened, sharing
 * (ADR 0008). Inside the room without its call shows dimmed.
 */
function VariantSpace(props: { channel: Channel }) {
  const client = useClient();
  const { t } = useLingui();
  const presence = useSpacePresence(
    () => client(),
    () => props.channel.serverId,
  );
  const people = () => peopleIn(presence(), props.channel.id);
  return (
    <Show when={people().length}>
      <Base>
        <For each={people()}>
          {(p) => (
            <CommonUser
              channel={props.channel}
              userId={p.user_id}
              speaking={false}
              muted={!!p.voice?.connected && !p.voice.mic}
              deafened={!!p.voice?.deaf}
              camera={!!p.voice?.camera}
              screenshare={!!p.voice?.screen}
              noDrag
              dimmed={p.state === "reconnecting" || !p.voice?.connected}
              note={
                p.state === "reconnecting"
                  ? t`Reconectando…`
                  : !p.voice
                    ? t`Na sala, fora da chamada`
                    : !p.voice.connected
                      ? t`Conectando o áudio…`
                      : undefined
              }
            />
          )}
        </For>
      </Base>
    </Show>
  );
}

/**
 * Use LiveKit as the source of truth (we are in this room)
 */
function VariantLive(props: { channel: Channel }) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );

  return (
    <Base>
      <TrackLoop tracks={tracks}>
        {() => <ParticipantLive channel={props.channel} />}
      </TrackLoop>
    </Base>
  );
}

/**
 * Use API as the source of truth (we are not in this room)
 */
function VariantPreview(props: { channel: Channel }) {
  return (
    <Show when={props.channel.voiceParticipants.size}>
      <Base>
        <For each={[...props.channel.voiceParticipants.values()]}>
          {(participant) => (
            <ParticipantPreview
              channel={props.channel}
              participant={participant}
            />
          )}
        </For>
      </Base>
    </Show>
  );
}

/**
 * Live variant of participant
 */
function ParticipantLive(props: { channel: Channel }) {
  const participant = useEnsureParticipant();

  const isMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });

  const isSpeaking = useIsSpeaking(participant);
  const isDeafened = useIsDeafened(participant);

  return (
    <CommonUser
      channel={props.channel}
      userId={participantUserId(participant.identity)}
      speaking={isSpeaking()}
      muted={isMuted() || isDeafened()}
      deafened={isDeafened()}
      camera={false}
      screenshare={false}
      isLive
    />
  );
}

/**
 * Preview variant of participant
 */
function ParticipantPreview(props: {
  channel: Channel;
  participant: VoiceParticipant;
}) {
  return (
    <CommonUser
      channel={props.channel}
      userId={props.participant.userId}
      speaking={false}
      muted={
        !props.participant.isPublishing() || !props.participant.isReceiving()
      }
      deafened={!props.participant.isReceiving()}
      camera={props.participant.isCamera()}
      screenshare={props.participant.isScreensharing()}
    />
  );
}

/**
 * Component used for both variants
 */
function CommonUser(props: {
  channel: Channel;
  userId: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  screenshare: boolean;
  isLive?: boolean;
  /** No dragging to another channel (rooms of the space are entered by walking). */
  noDrag?: boolean;
  /** Inside the room but not (yet) in its call, or reconnecting. */
  dimmed?: boolean;
  /** Why it is dimmed, for the tooltip and screen readers. */
  note?: string;
}) {
  const [iconProps, rest] = splitProps(props, [
    "muted",
    "deafened",
    "camera",
    "screenshare",
  ]);

  const user = useUser(() => rest.userId);
  const drag = useVoiceMemberDrag();

  return (
    <div
      class={previewUser({ speaking: rest.speaking })}
      title={rest.note}
      style={{
        cursor:
          !rest.noDrag &&
          drag?.canDragMembers(props.channel) &&
          !user().user?.self
            ? "grab"
            : undefined,
        opacity: rest.dimmed ? 0.55 : undefined,
      }}
      onPointerDown={(event) => {
        const member = user().member;
        if (rest.noDrag || !member || !drag) return;
        drag.beginUserDrag(
          event,
          member,
          props.channel,
          user().username,
          user().avatar,
        );
      }}
      use:floating={{
        userCard: {
          user: user().user!,
          member: user().member,
        },
        contextMenu: () => (
          <UserContextMenu user={user().user!} member={user().member} inVoice />
        ),
      }}
    >
      <Ripple />
      <Avatar size={24} src={user().avatar} fallback={user().username} />{" "}
      <PreviewUsername>
        {user().username}
        <Show when={rest.note}>
          <span class={srOnly}> · {rest.note}</span>
        </Show>
      </PreviewUsername>
      <Row gap="sm">
        <VoiceStatefulUserIcons {...iconProps} userId={rest.userId} />
      </Row>
    </div>
  );
}

const Base = styled("div", {
  base: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",

    marginBlock: "var(--gap-sm)",
    marginInlineStart: "var(--gap-xl)",
    marginInlineEnd: "var(--gap-md)",

    color: "var(--md-sys-color-outline)",

    borderRadius: "var(--borderRadius-md)",
  },
});

const previewUser = cva({
  base: {
    padding: "var(--gap-sm)",
    position: "relative", // ... <Ripple />
    display: "flex",
    gap: "var(--gap-md)",
    alignItems: "center",
    borderRadius: "var(--borderRadius-md)",
  },
  variants: {
    speaking: {
      true: {
        color: "var(--md-sys-color-on-surface)",

        "& svg": {
          outlineOffset: "1px",
          outline: "2px solid var(--md-sys-color-primary)",
          borderRadius: "var(--borderRadius-circle)",
        },
      },
    },
  },
});

const srOnly = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
});

const PreviewUsername = styled("span", {
  base: {
    ...typography.raw(),

    flexGrow: 1,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
});
