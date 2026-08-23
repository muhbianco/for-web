import { css } from "styled-system/css";

import mark from "./muchat-mark.svg";

/**
 * Muchat logotype. Optional mark for the home screen; titlebar uses text only.
 */
export function MuchatWordmark(props: { class?: string; withMark?: boolean }) {
  return (
    <span
      class={`${css({
        display: "inline-flex",
        alignItems: "center",
        gap: "0.45em",
        fontWeight: "800",
        letterSpacing: "-0.04em",
        lineHeight: "1",
        color: "inherit",
      })} ${props.class ?? ""}`}
    >
      {props.withMark ? (
        <img
          src={mark}
          alt=""
          width={40}
          height={40}
          class={css({
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            flexShrink: "0",
          })}
        />
      ) : null}
      Muchat
    </span>
  );
}
