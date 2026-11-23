import { Show, createSignal, onCleanup, onMount } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { SpaceView } from "@muchat/space-client";
import type { RpgHeroView } from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import {
  duration,
  percent,
  projectTraining,
  rpgLabels,
  serverNow,
} from "./rpgUi";

/** Quantas vezes por minuto a faixa recalcula o progresso (texto, nada de canvas). */
const REFRESH_MS = 5_000;

/**
 * A faixa "treinando" no topo do Espaço (docs/espaco/jogo/ot): a skill subindo ao vivo,
 * projetada pelas regras puras com o relógio do servidor, e o botão de parar.
 */
export default function TrainingChip(props: {
  view: SpaceView;
  rpg: { hero: RpgHeroView | null; serverNow: number; at: number };
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const id = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    onCleanup(() => clearInterval(id));
  });
  const view = () => {
    tick();
    const hero = props.rpg.hero;
    if (!hero?.training) return null;
    const p = projectTraining(
      hero,
      serverNow(props.rpg.serverNow, props.rpg.at),
    );
    return p ? { hero, p } : null;
  };

  return (
    <Show when={view()}>
      {(v) => (
        <Chip role="status">
          <span aria-hidden="true">⚔</span>
          <span>
            {t`${L.skill[v().hero.training!.skill]} ${v().p.skill?.level ?? 0} · ${percent(v().p.skill?.tries ?? 0, v().p.skill?.next ?? 0)}%`}
          </span>
          <Muted>
            {v().p.remainingMs > 0
              ? t`restam ${duration(v().p.remainingMs)}`
              : t`saldo esgotado`}
          </Muted>
          <Stop
            type="button"
            onClick={() => props.view.gameSend("rpg.train.stop", {})}
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
  },
});

const Muted = styled("span", { base: { opacity: 0.8 } });

const Stop = styled("button", {
  base: {
    padding: "2px 10px",
    borderRadius: "999px",
    border: "none",
    background: "var(--md-sys-color-surface)",
    color: "var(--md-sys-color-on-surface)",
    cursor: "pointer",
    fontSize: "inherit",
  },
});
