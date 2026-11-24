import { For, Show } from "solid-js";

import { styled } from "styled-system/jsx";

import { GAME_DOWN, GAME_UP } from "./gameTheme";
import type { ItemDelta } from "./itemUi";

/**
 * A comparação com o vestido, como nos RPGs (24/11/2026): "▲ 2 armadura ▼ 1 FOR", em verde o que
 * melhora e em vermelho o que piora. `empty` aparece quando nada muda (e só se for pedido).
 */
export function Deltas(props: { list: ItemDelta[]; empty?: string }) {
  return (
    <Show
      when={props.list.length > 0}
      fallback={<Show when={props.empty}>{(e) => <Same>{e()}</Same>}</Show>}
    >
      <Row>
        <For each={props.list}>
          {(d) => (
            <span data-up={d.delta > 0 ? "" : undefined}>
              {d.delta > 0 ? "▲" : "▼"} {Math.abs(d.delta)} {d.label}
            </span>
          )}
        </For>
      </Row>
    </Show>
  );
}

const Row = styled("span", {
  base: {
    display: "inline-flex",
    flexWrap: "wrap",
    gap: "2px 8px",
    fontSize: "0.8em",
    fontVariantNumeric: "tabular-nums",
    "& > span": { color: GAME_DOWN, whiteSpace: "nowrap" },
    "& > span[data-up]": { color: GAME_UP },
  },
});

const Same = styled("span", {
  base: { fontSize: "0.8em", opacity: 0.7 },
});
