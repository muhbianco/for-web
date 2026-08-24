import {
  Show,
  createContext,
  createSignal,
  onCleanup,
  useContext,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { Channel, ServerMember } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useDevice } from "@revolt/common";
import { useModals } from "@revolt/modal";

type DragState = {
  member: ServerMember;
  fromChannel: Channel;
  username: string;
  avatar?: string;
  x: number;
  y: number;
  dropChannelId?: string;
};

const VoiceMemberDragContext = createContext<{
  drag: () => DragState | undefined;
  canDragMembers: (channel: Channel) => boolean;
  beginUserDrag: (
    event: PointerEvent,
    member: ServerMember,
    fromChannel: Channel,
    username: string,
    avatar?: string,
  ) => void;
  isDropTarget: (channelId: string) => boolean;
}>();

/**
 * Pointer-based drag of voice members between channels.
 * Kept separate from channel reorder (solid-dnd-directive).
 */
export function VoiceMemberDragProvider(props: { children: JSX.Element }) {
  const { isMobile } = useDevice();
  const { showError } = useModals();
  const [drag, setDrag] = createSignal<DragState>();

  function canDragMembers(channel: Channel) {
    if (isMobile) return false;
    return !!channel.server?.havePermission("MoveMembers");
  }

  function dropChannelAt(x: number, y: number): string | undefined {
    const el = document
      .elementFromPoint(x, y)
      ?.closest("[data-voice-drop]") as HTMLElement | null;
    return el?.dataset.voiceDrop;
  }

  function beginUserDrag(
    event: PointerEvent,
    member: ServerMember,
    fromChannel: Channel,
    username: string,
    avatar?: string,
  ) {
    if (event.button !== 0) return;
    if (!canDragMembers(fromChannel)) return;
    if (member.user?.self) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        started = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      setDrag({
        member,
        fromChannel,
        username,
        avatar,
        x: ev.clientX,
        y: ev.clientY,
        dropChannelId: dropChannelAt(ev.clientX, ev.clientY),
      });
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const current = drag();
      const targetId = started
        ? (current?.dropChannelId ?? dropChannelAt(ev.clientX, ev.clientY))
        : undefined;
      setDrag(undefined);
      if (!started || !targetId || targetId === fromChannel.id) return;
      const target = fromChannel.server?.channels.find((c) => c.id === targetId);
      if (!target?.isVoice) return;
      void member.edit({ voice_channel: target.id }).catch(showError);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  onCleanup(() => {
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  });

  return (
    <VoiceMemberDragContext.Provider
      value={{
        drag,
        canDragMembers,
        beginUserDrag,
        isDropTarget: (channelId) => {
          const current = drag();
          return (
            !!current &&
            current.fromChannel.id !== channelId &&
            current.dropChannelId === channelId
          );
        },
      }}
    >
      {props.children}
      <Show when={drag()}>
        {(state) => (
          <Portal>
            <Ghost
              style={{
                left: `${state().x + 12}px`,
                top: `${state().y + 12}px`,
              }}
            >
              <Show when={state().avatar}>
                <img src={state().avatar} alt="" />
              </Show>
              {state().username}
            </Ghost>
          </Portal>
        )}
      </Show>
    </VoiceMemberDragContext.Provider>
  );
}

export function useVoiceMemberDrag() {
  return useContext(VoiceMemberDragContext);
}

const Ghost = styled("div", {
  base: {
    position: "fixed",
    zIndex: 10000,
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 10px",
    borderRadius: "8px",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    fontSize: "13px",
    "& img": {
      width: "24px",
      height: "24px",
      borderRadius: "50%",
      objectFit: "cover",
    },
  },
});
