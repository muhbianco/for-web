import { Show, createSignal, onCleanup, onMount } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RpgHeroState } from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { gameChip } from "./gameTheme";
import type { GameLink } from "./gameUi";
import { dojoNow, num, serverClock } from "./heroModel";

/**
 * A faixa "treinando" no topo do Espaço: a Proficiência subindo ao vivo (projetada pelo relógio do
 * servidor), uma barra fina até a próxima e o botão de parar. Sem relógio (D21).
 */
export default function TrainingChip(props: {
  link: GameLink;
  rpg: { hero: RpgHeroState | null; serverNow: number; at: number };
}) {
  const { t } = useLingui();
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const id = setInterval(() => setTick((n) => n + 1), 2_000);
    onCleanup(() => clearInterval(id));
  });
  const d = () => {
    tick();
    const s = props.rpg.hero;
    return s?.dojo
      ? dojoNow({ hero: s.hero, dojo: s.dojo }, serverClock(props.rpg))
      : null;
  };
  return (
    <Show when={d()}>
      {(v) => (
        <Chip style={gameChip} role="status">
          <span aria-hidden="true">⚔</span>
          <span>
            {t`Proficiência ${num(v().stored)}`}
            <Show when={v().gained > 0}>
              <Up> +{v().gained}</Up>
            </Show>
          </span>
          <Track aria-hidden="true">
            <i
              style={{
                width: `${Math.min(100, (v().into / v().need) * 100)}%`,
              }}
            />
          </Track>
          <Stop
            type="button"
            onClick={() => props.link.gameSend("rpg.dojo.stop", {})}
          >
            {t`Parar`}
          </Stop>
        </Chip>
      )}
    </Show>
  );
}

const Chip = styled("div", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 6px 4px 12px",
    borderRadius: "999px",
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
    fontSize: "0.85em",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
});
const Up = styled("span", { base: { color: "#7ee08a", fontWeight: 700 } });
const Track = styled("span", {
  base: {
    width: "48px",
    height: "5px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.12)",
    overflow: "hidden",
    "& > i": { display: "block", height: "100%", background: "#5fbf8f" },
  },
});
const Stop = styled("button", {
  base: {
    "@media (pointer: coarse)": { minHeight: "40px", paddingInline: "12px" },
    padding: "2px 10px",
    borderRadius: "999px",
    border: "none",
    background: "var(--md-sys-color-surface)",
    color: "var(--md-sys-color-on-surface)",
    cursor: "pointer",
    fontSize: "inherit",
  },
});
