import {
  JSX,
  Match,
  Show,
  Switch,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { Portal } from "solid-js/web";

import { createResizeObserver } from "@solid-primitives/resize-observer";
import { Channel } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { VOICE_STAGE_MIN_HEIGHT } from "@revolt/state/stores/Layout";
import { SlideState } from "@revolt/ui/components/navigation/SlideDrawer";

import { VoiceCallCardActiveRoom } from "./VoiceCallCardActiveRoom";
import { VoiceCallCardPiP } from "./VoiceCallCardPiP";
import { VoiceCallCardPreview } from "./VoiceCallCardPreview";

type Mode = "floating" | "moving";
type FloatType = "tl" | "tr" | "bl" | "br";

type Info = {
  channel: Channel;
  pos: DOMRect;
  /** Height the mount reserved in the channel column, in pixels. */
  height: number;
  drawer?: SlideState;
};

const PAD = 16,
  PAD_X = `${PAD}px`,
  PAD_Y = `${PAD + 56}px`;

/** Space the join preview needs, including the card padding around it. */
const PREVIEW_STAGE_HEIGHT = 152;

/** Room left for the channel header, composer and a sliver of messages. */
const STAGE_VIEWPORT_RESERVE = 240;

const callCardContext = createContext<(info?: Info) => void>();

/** Voice call card context */
export function VoiceCallCardContext(props: { children: JSX.Element }) {
  const voice = useVoice();
  const inCall = () => !!voice.channel();

  const [mode, setMode] = createSignal<Mode>();
  const [info, setInfo] = createSignal<Info>();

  let ref: HTMLDivElement | undefined,
    events: AbortController | null,
    pid = 0,
    ofsX = 0,
    ofsY = 0;

  function mouseDown(e: PointerEvent) {
    pid = e.pointerId;
    if (mode() === "floating") {
      const pos = ref!.getBoundingClientRect();
      ofsX = e.clientX - pos.x;
      ofsY = e.clientY - pos.y;
      setMode("moving");
      addEvents();
    }
  }

  function mouseMove(e: PointerEvent) {
    if (e.pointerId !== pid) return;
    e.preventDefault();
    const x = e.clientX - ofsX,
      y = e.clientY - ofsY;
    ref!.style.transform = `translate(${x}px, ${y}px)`;
  }

  function mouseUp(e: PointerEvent) {
    if (e.pointerId !== pid) return;
    const sty = ref!.style,
      pos = ref!.getBoundingClientRect(),
      left = e.clientX - ofsX + pos.width / 2 < innerWidth / 2,
      top = e.clientY - ofsY + pos.height / 2 < innerHeight / 2;

    sty.transition = "all .2s cubic-bezier(0, 1.5, 0.85, 0.8)";
    setFloat(left ? (top ? "tl" : "bl") : top ? "tr" : "br");
    //Reset CSS transition on next render pass
    setTimeout(() => (sty.transition = ""), 1);
    resetEvents();
  }

  function addEvents() {
    if (events) return;
    events = new AbortController();
    const opt = { passive: false, signal: events.signal };
    document.addEventListener("pointermove", mouseMove, opt);
    document.addEventListener("pointerup", mouseUp, opt);
  }

  function resetEvents() {
    events?.abort();
    events = null;
  }

  createEffect(() => {
    const inf = info();
    if (!ref) return;
    const sty = ref.style;
    resetEvents();

    //Set mode based on state
    if (voice.fullscreen()) {
      sty.transform = ``;
      sty.width = `100%`;
      sty.height = ``;
      setMode();
    } else if (inf?.pos && (!inf.drawer || inf.drawer === SlideState.SHOWN)) {
      sty.transform = `translate(${inf.pos.x}px, ${inf.pos.y}px)`;
      sty.width = `${inf.pos.width}px`;
      // Match the space the mount reserved so the card fills it exactly
      // instead of overlapping the message list.
      sty.height = `${inf.height}px`;
      setMode();
    } else if (!inCall()) {
      const y = inf?.pos.y ?? ref.getBoundingClientRect().y;
      sty.transform = `translate(${innerWidth + 50}px, ${y}px)`;
      setMode();
    } else if (!mode()) setFloat("tr");
  });

  const channel = () => info()?.channel;

  function setFloat(float: FloatType) {
    const sty = ref!.style,
      x = float[1] === "l" ? PAD_X : `calc(100vw - var(--flt-w) - ${PAD_X})`,
      y = float[0] === "t" ? PAD_Y : `calc(100vh - var(--flt-h) - ${PAD_Y})`;
    sty.transform = `translate(${x}, ${y})`;
    sty.width = "";
    sty.height = "";
    setMode("floating");
  }

  onCleanup(resetEvents);

  onMount(() => {
    document
      .getElementById("floating")
      ?.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement) {
          voice.toggleFullscreen(false);
        }
      });
  });

  createEffect(() => {
    if (voice.fullscreen() && inCall()) {
      if (
        !document
          .getElementById("floating")
          ?.isSameNode(document.fullscreenElement)
      ) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        }
        document.getElementById("floating")?.requestFullscreen();
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  });

  return (
    <callCardContext.Provider value={setInfo}>
      {props.children}
      <Portal mount={document.getElementById("floating")! as HTMLDivElement}>
        <Float
          ref={ref}
          mode={mode()}
          onPointerDown={mouseDown}
          fullscreen={voice.fullscreen()}
        >
          <Switch>
            <Match when={mode() && inCall()}>
              <VoiceCallCardPiP />
            </Match>
            <Match when={channel()}>
              <VoiceCallCard
                channel={channel()!}
                inCall={inCall()}
                showCard={voice.showCard(channel()!)}
                fullscreen={voice.fullscreen()}
              />
            </Match>
          </Switch>
        </Float>
      </Portal>
    </callCardContext.Provider>
  );
}

const Float = styled("div", {
  base: {
    position: "fixed",
    zIndex: 10,
    pointerEvents: "none",
    // Height is driven inline by the space the mount reserved and must track
    // the drag frame by frame, so it is deliberately left out of the transition.
    transition:
      "transform .3s cubic-bezier(1, 0, 0, 1), width .3s cubic-bezier(1, 0, 0, 1)",
    touchAction: "none",
  },
  variants: {
    mode: {
      floating: { cursor: "grab" },
      moving: {
        cursor: "grabbing",
        transition: "none",
      },
    },
    fullscreen: {
      true: {
        zIndex: 100,
        height: "100vh",
        top: 0,
        // Width is set by floating logic in effect above
      },
      false: {},
    },
  },
  compoundVariants: [
    {
      mode: ["floating", "moving"],
      css: {
        "--flt-w": "300px",
        "--flt-h": "170px",
        width: "var(--flt-w)",
        height: "var(--flt-h)",
      },
    },
  ],
});

/**
 * 'Marker' that reserves the call card's space in the channel column and
 * reports its position for mounting the floating card.
 *
 * Reserving real height here is what keeps the message list and the composer
 * out of the way: they are siblings below this marker, so growing the stage
 * only ever eats into the (flex-grow) message list.
 */
export function VoiceChannelCallCardMount(props: { channel: Channel }) {
  const voice = useVoice();
  const state = useState();
  const setInfo = useContext(callCardContext)!;
  let ref: HTMLDivElement | undefined;

  const inThisCall = () => voice.channel()?.id === props.channel.id;

  const height = () => {
    if (!voice.showCard(props.channel)) return 0;
    return inThisCall()
      ? state.layout.getVoiceStageHeight()
      : PREVIEW_STAGE_HEIGHT;
  };

  function updateInfo() {
    const vc = voice.channel();
    setInfo(
      !vc || vc.id === props.channel.id
        ? {
            channel: props.channel,
            pos: ref!.getBoundingClientRect(),
            height: height(),
            drawer: state.appDrawer()?.state,
          }
        : undefined,
    );
  }

  createEffect(updateInfo);

  onMount(() => {
    const target = ref?.parentElement;
    if (!target) return;

    createResizeObserver(target, updateInfo);
  });
  onCleanup(() => {
    setInfo();
  });

  return (
    <div
      ref={ref!}
      style={{ height: `${height()}px`, "flex-shrink": "0" }}
      aria-hidden="true"
    />
  );
}

/**
 * Call card
 */
function VoiceCallCard(props: {
  channel: Channel;
  inCall: boolean;
  showCard: boolean;
  fullscreen: boolean;
}) {
  return (
    <Show when={props.showCard}>
      <Base fullscreen={props.fullscreen}>
        <Card active={props.inCall} fullscreen={props.fullscreen}>
          <Show
            when={props.inCall}
            fallback={<VoiceCallCardPreview channel={props.channel} />}
          >
            <VoiceCallCardActiveRoom />
          </Show>
        </Card>
        <Show when={props.inCall && !props.fullscreen}>
          <VoiceStageResizeHandle />
        </Show>
      </Base>
    </Show>
  );
}

/**
 * Drag handle along the bottom edge of the call card.
 *
 * Resizes only the stage; the message list absorbs the difference and the
 * composer, which neither grows nor shrinks, stays put.
 */
function VoiceStageResizeHandle() {
  const state = useState();
  let startY = 0,
    startHeight = 0;

  function maxHeight() {
    return Math.max(
      VOICE_STAGE_MIN_HEIGHT,
      window.innerHeight - STAGE_VIEWPORT_RESERVE,
    );
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    startY = event.clientY;
    startHeight = state.layout.getVoiceStageHeight();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    if (!target.hasPointerCapture(event.pointerId)) return;
    state.layout.setVoiceStageHeight(
      Math.min(maxHeight(), startHeight + (event.clientY - startY)),
    );
  }

  function onPointerUp(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }

  /** Keyboard resizing, since a drag handle alone is not accessible. */
  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.layout.setVoiceStageHeight(
        state.layout.getVoiceStageHeight() - step,
      );
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      state.layout.setVoiceStageHeight(
        Math.min(maxHeight(), state.layout.getVoiceStageHeight() + step),
      );
    }
  }

  return (
    <ResizeHandle
      role="separator"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label="Redimensionar a área de voz"
      aria-valuenow={state.layout.getVoiceStageHeight()}
      aria-valuemin={VOICE_STAGE_MIN_HEIGHT}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}

const Base = styled("div", {
  base: {
    left: 0,
    top: 0,
    padding: "var(--gap-md)",

    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    position: "absolute",

    zIndex: 2,
    userSelect: "none",

    display: "flex",
    alignItems: "center",
    flexDirection: "column",
  },
  variants: {
    fullscreen: {
      true: {
        padding: 0,
      },
    },
  },
});

/**
 * Grab area along the bottom edge of the stage
 */
const ResizeHandle = styled("div", {
  base: {
    flexShrink: 0,
    width: "100%",
    height: "10px",
    marginBlockStart: "-4px",

    cursor: "ns-resize",
    touchAction: "none",
    pointerEvents: "all",

    display: "grid",
    placeItems: "center",

    "&::after": {
      content: '""',
      width: "56px",
      height: "4px",
      borderRadius: "var(--borderRadius-full)",
      background: "var(--md-sys-color-outline-variant)",
      transition: "var(--transitions-fast) background",
    },
    "&:hover::after, &:focus-visible::after": {
      background: "var(--md-sys-color-primary)",
    },
  },
});

const Card = styled("div", {
  base: {
    pointerEvents: "all",

    maxWidth: "100%",
    transition: "var(--transitions-fast) all",
    transitionTimingFunction: "ease-in-out",

    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-secondary-container)",
  },
  variants: {
    active: {
      true: {
        width: "100%",
      },
      false: {
        width: "360px",
        height: "120px",
        cursor: "pointer",
      },
    },
    fullscreen: {
      true: {
        height: "100%",
        borderRadius: 0,
      },
      false: {},
    },
  },
  compoundVariants: [
    {
      active: [true],
      fullscreen: [false],
      css: {
        // Fills the height the mount reserved, which the user can drag.
        flexGrow: 1,
        minHeight: 0,
      },
    },
  ],
  defaultVariants: {
    active: false,
    fullscreen: false,
  },
});
