import { Show, onCleanup, onMount } from "solid-js";

import { Trans } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useVoice } from "@revolt/rtc";
import { Avatar, Button } from "@revolt/ui/components/design";

/**
 * Global incoming/outgoing private-call chrome. Lives outside the DM view
 * so a call still rings on Friends, a server, or the desktop tray.
 */
export function IncomingCallOverlay() {
  const voice = useVoice();
  const client = useClient();
  const ring = () => voice.ring();
  const peer = () => {
    const current = ring();
    if (!current) return undefined;
    return (
      client().users.get(current.userId) ??
      (current.channel.type === "DirectMessage"
        ? current.channel.recipient
        : undefined)
    );
  };

  return (
    <Show when={ring()}>
      <Scrim>
        <Card>
          <Avatar
            size={88}
            src={peer()?.avatarURL}
            fallback={peer()?.displayName ?? peer()?.username}
          />
          <Title>
            <Show
              when={ring()!.direction === "incoming"}
              fallback={<Trans>Calling…</Trans>}
            >
              <Trans>Incoming call</Trans>
            </Show>
          </Title>
          <Name>{peer()?.displayName ?? peer()?.username ?? "Muchat"}</Name>
          <Actions>
            <Show when={ring()!.direction === "incoming"}>
              <Button
                variant="filled"
                onPress={() => void voice.acceptIncoming()}
              >
                <Trans>Accept</Trans>
              </Button>
            </Show>
            <Button
              variant="tonal"
              onPress={() =>
                ring()!.direction === "incoming"
                  ? voice.declineIncoming()
                  : voice.disconnect()
              }
            >
              <Show
                when={ring()!.direction === "incoming"}
                fallback={<Trans>Cancel</Trans>}
              >
                <Trans>Decline</Trans>
              </Show>
            </Button>
          </Actions>
        </Card>
      </Scrim>
    </Show>
  );
}

/**
 * Maps Stoat voice events + native intents onto {@link Voice} ring state.
 */
export function CallRingListener() {
  const client = useClient();
  const voice = useVoice();

  onMount(() => {
    const c = client();

    const onJoin = (channel: Parameters<typeof voice.beginIncomingRing>[0], userId: string) => {
      const me = c.user?.id;
      if (!me) return;
      if (channel.type !== "DirectMessage" && channel.type !== "Group") return;
      if (userId === me) return;
      if (voice.channel()?.id === channel.id) {
        voice.clearRing();
        return;
      }
      if (c.user?.presence === "Busy") return;
      voice.beginIncomingRing(channel, userId);
    };

    const onLeave = (channel: Parameters<typeof voice.beginIncomingRing>[0], userId: string) => {
      const incoming = voice.ring();
      if (!incoming) return;
      if (incoming.channel.id !== channel.id) return;
      if (incoming.userId === userId || channel.voiceParticipants.size === 0) {
        voice.clearRing();
      }
    };

    const onCallUpdate = (event: {
      initiatorId: string;
      channelId: string;
      ended: boolean;
    }) => {
      if (event.ended) {
        if (voice.ring()?.channel.id === event.channelId) voice.clearRing();
        return;
      }
      const channel = c.channels.get(event.channelId);
      if (!channel) return;
      if (event.initiatorId === c.user?.id) return;
      voice.beginIncomingRing(channel, event.initiatorId);
    };

    c.addListener("voiceChannelJoin", onJoin);
    c.addListener("voiceChannelLeave", onLeave);
    c.addListener("voiceCallUpdate", onCallUpdate);

    const resolveChannel = (id: string) =>
      Promise.resolve(
        c.channels.get(id) ?? c.channels.fetch(id).catch(() => undefined),
      );

    const handleNative = (action: string, channelId?: string) => {
      void (async () => {
        if (action === "ring" && channelId) {
          const channel = await resolveChannel(channelId);
          if (!channel) return;
          const caller =
            channel.type === "DirectMessage"
              ? (channel.recipient?.id ?? "")
              : "";
          voice.beginIncomingRing(channel, caller);
          return;
        }
        if (action === "accept" && channelId) {
          const channel = await resolveChannel(channelId);
          if (channel) void voice.connect(channel);
          return;
        }
        if (action === "decline") voice.declineIncoming();
      })();
    };

    window.__muchatIncomingCall = handleNative;
    const pending = window.__muchatPendingIncoming;
    if (pending) {
      delete window.__muchatPendingIncoming;
      handleNative(pending.action, pending.channelId);
    }

    window.__muchatVoiceCommand = (command) => {
      if (command === "leave") voice.disconnect();
      if (command === "mute" || command === "unmute") void voice.toggleMute();
    };

    onCleanup(() => {
      c.removeListener("voiceChannelJoin", onJoin);
      c.removeListener("voiceChannelLeave", onLeave);
      c.removeListener("voiceCallUpdate", onCallUpdate);
      delete window.__muchatIncomingCall;
      delete window.__muchatVoiceCommand;
    });
  });

  return null;
}

const Scrim = styled("div", {
  base: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(10, 8, 6, 0.72)",
    padding: "var(--gap-lg)",
  },
});

const Card = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--gap-md)",
    minWidth: "280px",
    padding: "var(--gap-xl)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
  },
});

const Title = styled("div", {
  base: {
    fontSize: "0.9rem",
    opacity: 0.8,
  },
});

const Name = styled("div", {
  base: {
    fontSize: "1.25rem",
    fontWeight: 600,
  },
});

const Actions = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-md)",
    marginTop: "var(--gap-sm)",
  },
});
