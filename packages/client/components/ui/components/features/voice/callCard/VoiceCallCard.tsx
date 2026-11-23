import {
  JSX,
  Match,
  Show,
  Switch,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { Portal } from "solid-js/web";

import { createResizeObserver } from "@solid-primitives/resize-observer";
import { Channel } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";
import { VoiceLayout } from "@revolt/rtc/state";
import { useState } from "@revolt/state";
import { SlideState } from "@revolt/ui/components/navigation/SlideDrawer";

import { VoiceCallCardActiveRoom } from "./VoiceCallCardActiveRoom";
import { VoiceCallCardPreview } from "./VoiceCallCardPreview";

type Info = {
  channel: Channel;
  pos: DOMRect;
  parentRect: DOMRect;
  drawer?: SlideState;
  /** The mount's parent is a stage: the card fills it (the space's media stage). */
  fill?: boolean;
  /**
   * The page shows the call itself (the space's stage on the TV): no card
   * floats over it.
   */
  inline?: boolean;
};

const callCardContext = createContext<(info?: Info) => void>();

/**
 * Voice call card context. The card shows only where a page mounts it (a
 * voice channel, the Espaço's stage) and in fullscreen; with no mount it is
 * parked off screen. [Muchat] The floating mini card in a corner is gone
 * (23/11/2026: dragged around, it always ended up over something): the
 * sidebar's VoiceDock keeps mute, deafen, screen share and hang up within
 * reach, and the call's audio lives in the voice context (RoomAudioManager),
 * not in this card.
 */
export function VoiceCallCardContext(props: { children: JSX.Element }) {
  const voice = useVoice();
  const inCall = () => !!voice.channel();

  const [info, setInfo] = createSignal<Info>();

  let ref: HTMLDivElement | undefined;

  createEffect(() => {
    const inf = info();
    if (!ref) return;
    const sty = ref.style;

    if (inf?.inline) {
      sty.transform = "translate(-10000px, 0)";
      sty.width = "";
      sty.height = "";
      return;
    }

    if (voice.layout() === "fullscreen") {
      sty.transform = ``;
      sty.width = `100%`;
      sty.height = "";
    } else if (
      (voice.layout() === "expanded" ||
        (inf?.fill && voice.layout() !== "collapsed")) &&
      inf?.parentRect &&
      (!inf.drawer || inf.drawer === SlideState.SHOWN)
    ) {
      sty.transform = `translate(${inf.parentRect.x}px, ${inf.parentRect.y}px)`;
      sty.width = `${inf.parentRect.width}px`;
      sty.height = `${inf.parentRect.height}px`;
    } else if (inf?.pos && (!inf.drawer || inf.drawer === SlideState.SHOWN)) {
      sty.transform = `translate(${inf.pos.x}px, ${inf.pos.y}px)`;
      sty.width = `${inf.pos.width}px`;
      sty.height = voice.layout() === "collapsed" ? "56px" : "";
    } else {
      // No mount on screen (in a call or not): parked to the right, from
      // where it slides back when a page mounts it again.
      const y = inf?.pos.y ?? ref.getBoundingClientRect().y;
      sty.transform = `translate(${innerWidth + 50}px, ${y}px)`;
      sty.width = "";
      sty.height = "";
    }
  });

  const channel = () => info()?.channel;

  onMount(() => {
    document
      .getElementById("floating")
      ?.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement) voice.resetLayout();
      });
  });

  createEffect(() => {
    if (voice.layout() === "fullscreen" && inCall()) {
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
        <Float ref={ref} fullscreen={voice.layout() === "fullscreen"}>
          <Switch>
            <Match when={info()?.inline}>{null}</Match>
            <Match when={channel()}>
              <VoiceCallCard
                channel={channel()!}
                inCall={inCall()}
                showCard={voice.showCard(channel()!)}
                layout={voice.layout()}
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
    transition: "all .3s cubic-bezier(1, 0, 0, 1)",
    height: "40vh",
    touchAction: "none",
  },
  variants: {
    fullscreen: {
      true: {
        zIndex: 100,
        height: "100vh",
        top: 0,
        // Width is set by the effect above
      },
    },
  },
});

/**
 * 'Marker' to send position information for mounting the call card.
 * With `fill`, the card takes the whole parent element (the space's stage).
 */
export function VoiceChannelCallCardMount(props: {
  channel: Channel;
  fill?: boolean;
  /**
   * Changes when the page moves the mount without resizing it (the space's
   * stage changing columns): the card is measured again on the next frame.
   */
  layoutKey?: string;
  /** The page shows the call inline: park the floating card (see Info.inline). */
  inline?: boolean;
}) {
  const voice = useVoice();
  const state = useState();
  const setInfo = useContext(callCardContext)!;
  let ref: HTMLDivElement | undefined;

  function updateInfo() {
    const vc = voice.channel();
    setInfo(
      !vc || vc.id === props.channel.id
        ? {
            channel: props.channel,
            pos: ref!.getBoundingClientRect(),
            parentRect: ref!.parentElement!.getBoundingClientRect(),
            drawer: state.appDrawer()?.state,
            fill: props.fill,
            inline: props.inline,
          }
        : undefined,
    );
  }

  createEffect(updateInfo);
  createEffect(
    on(
      () => props.layoutKey,
      () => requestAnimationFrame(() => ref?.isConnected && updateInfo()),
      { defer: true },
    ),
  );

  onMount(() => {
    const target = ref?.parentElement;
    if (!target) return;

    createResizeObserver(target, updateInfo);
  });
  onCleanup(() => {
    setInfo();
  });

  return <div ref={ref!} />;
}

/**
 * Call card
 */
function VoiceCallCard(props: {
  channel: Channel;
  inCall: boolean;
  showCard: boolean;
  layout: VoiceLayout;
}) {
  return (
    <Show when={props.showCard}>
      <Base layout={props.layout as never}>
        <Card active={props.inCall} layout={props.layout}>
          <Show
            when={props.inCall}
            fallback={<VoiceCallCardPreview channel={props.channel} />}
          >
            <VoiceCallCardActiveRoom />
          </Show>
        </Card>
      </Base>
    </Show>
  );
}

const Base = styled("div", {
  base: {
    left: 0,
    top: "var(--gap-md)",
    padding: "var(--gap-md)",

    width: "100%",
    height: "100%",
    position: "absolute",

    zIndex: 2,
    userSelect: "none",
    pointerEvents: "none",

    display: "flex",
    alignItems: "center",
    flexDirection: "column",
    transition: "all var(--transitions-medium)",
  },
  variants: {
    layout: {
      fullscreen: {
        top: 0,
        height: "100%",
        padding: 0,
      },
      expanded: {
        top: 0,
        height: "100%",
        padding: 0,
      },
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
        height: "100%",
      },
      false: {
        width: "360px",
        height: "120px",
        cursor: "pointer",
      },
    },
    layout: {
      fullscreen: {
        borderRadius: 0,
      },
      expanded: {
        borderRadius: "var(--borderRadius-xl)",
      },
      collapsed: {
        background: "none",
      },
    },
  },
});
