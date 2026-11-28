import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";

import { Symbol } from "../../utils/Symbol";

/**
 * "Você está mutado" over the mic button, when the person talks with the mic
 * muted (Voice.speakingWhileMuted; Discord's SpeakingWhileMuted tooltip). It
 * answers "am I really muted?" at the moment it matters. Wrap the mic button
 * in `MicSlot` so the bubble has something to sit on.
 */
export function SpeakingWhileMutedHint() {
  const voice = useVoice();
  const { t } = useLingui();
  return (
    <Show when={voice.speakingWhileMuted()}>
      <Bubble role="status" onClick={() => voice.dismissSpeakingWhileMuted()}>
        <Symbol size={16}>mic_off</Symbol>
        <Text>
          <strong>{t`Você está mutado`}</strong>
          <span>{t`Ninguém está te ouvindo.`}</span>
        </Text>
      </Bubble>
    </Show>
  );
}

/** The mic button's box: the bubble is positioned against it. */
export const MicSlot = styled("div", {
  base: {
    position: "relative",
    display: "flex",
    "& > button": {
      flexGrow: 1,
    },
  },
});

const Bubble = styled("div", {
  base: {
    position: "absolute",
    bottom: "calc(100% + 8px)",
    left: 0,
    zIndex: 20,
    display: "flex",
    gap: "6px",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: "var(--borderRadius-md, 8px)",
    background: "var(--md-sys-color-inverse-surface)",
    color: "var(--md-sys-color-inverse-on-surface)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
    whiteSpace: "nowrap",
    cursor: "pointer",
    fontSize: "12px",
    lineHeight: 1.3,
    animation: "spaceBubbleIn 0.14s ease-out",
    "&::after": {
      content: '""',
      position: "absolute",
      top: "100%",
      left: "14px",
      borderWidth: "6px",
      borderStyle: "solid",
      borderColor:
        "var(--md-sys-color-inverse-surface) transparent transparent transparent",
    },
  },
});

const Text = styled("span", {
  base: {
    display: "flex",
    flexDirection: "column",
    "& strong": {
      fontWeight: 700,
    },
  },
});
