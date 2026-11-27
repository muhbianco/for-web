import { css } from "styled-system/css";

/**
 * A carinha falando do TTS (27/11/2026): no balão, no lugar do "/tts". Enquanto a voz da pessoa
 * toca neste aparelho, a boca abre e fecha e as ondinhas pulsam; parada, ela sorri. Desenho em
 * SVG: nítido em qualquer zoom e sem imagem para baixar. Com "reduzir movimento", não anima.
 */
export function TtsFace(props: { speaking: boolean; size?: number }) {
  return (
    <svg
      class={face}
      data-speaking={props.speaking ? "" : undefined}
      viewBox="0 0 22 18"
      width={props.size ?? 20}
      height={((props.size ?? 20) * 18) / 22}
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="9"
        r="7.5"
        fill="#FFD45E"
        stroke="#E2A52C"
        stroke-width="1"
      />
      <ellipse
        cx="4.4"
        cy="10.8"
        rx="1.6"
        ry="1"
        fill="#FF8FA3"
        opacity="0.8"
      />
      <ellipse
        cx="11.6"
        cy="10.8"
        rx="1.6"
        ry="1"
        fill="#FF8FA3"
        opacity="0.8"
      />
      <circle cx="5.6" cy="7.2" r="1.05" fill="#3B2A1C" />
      <circle cx="10.4" cy="7.2" r="1.05" fill="#3B2A1C" />
      <circle cx="5.95" cy="6.85" r="0.35" fill="#FFFFFF" />
      <circle cx="10.75" cy="6.85" r="0.35" fill="#FFFFFF" />
      <ellipse
        class={mouth}
        cx="8"
        cy="11.9"
        rx="2.2"
        ry="1.9"
        fill="#8A2E3B"
      />
      <path
        class={wave}
        d="M17 6.6 q1.7 2.4 0 4.8"
        stroke="#5B7FE0"
        stroke-width="1.5"
        fill="none"
        stroke-linecap="round"
      />
      <path
        class={wave}
        data-far=""
        d="M19.4 4.9 q2.8 4.1 0 8.2"
        stroke="#5B7FE0"
        stroke-width="1.5"
        fill="none"
        stroke-linecap="round"
      />
    </svg>
  );
}

const face = css({
  flexShrink: 0,
  display: "inline-block",
  marginTop: "1px",
  overflow: "visible",
});

/** A boca: sorriso fechado parada; abre e fecha falando (~6 sílabas por segundo). */
const mouth = css({
  transformBox: "fill-box",
  transformOrigin: "center",
  transform: "scaleY(0.42)",
  "[data-speaking] &": {
    animation: "spaceTtsMouth 170ms ease-in-out infinite alternate",
  },
  "@media (prefers-reduced-motion: reduce)": {
    "[data-speaking] &": { animation: "none", transform: "scaleY(0.75)" },
  },
});

const wave = css({
  opacity: 0.35,
  "[data-speaking] &": {
    animation: "spaceTtsWave 900ms ease-in-out infinite",
    "&[data-far]": { animationDelay: "180ms" },
  },
  "@media (prefers-reduced-motion: reduce)": {
    "[data-speaking] &": { animation: "none", opacity: 0.9 },
  },
});
