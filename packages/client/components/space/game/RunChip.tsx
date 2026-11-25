import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import { styled } from "styled-system/jsx";

import { gameChip } from "./gameTheme";
import { dungeonName, outcomeText, runToShow } from "./partyUi";

/**
 * A faixa da corrida no topo do Espaço: quem, onde e a sala (1 a 4), e "Ver" abre a tela da
 * corrida. Sem relógio (D21).
 */
export default function RunChip(props: {
  link: { watchRun(id: string): void };
  runs: Record<string, RunState>;
  myId: string | null;
  onAct?: () => void;
}) {
  const { t } = useLingui();
  const label = (r: RunState) => {
    const d = dungeonName(r.run.dungeon);
    if (r.end) return `${d}: ${outcomeText(r.end.outcome)}`;
    const names = r.run.members.map((m) => m.name).join(", ");
    return t`${names} · ${d} · sala ${(r.frame?.st ?? 0) + 1} de 4`;
  };
  return (
    <Show when={runToShow(props.runs, props.myId)}>
      {(r) => (
        <Chip
          style={gameChip}
          role="status"
          data-end={r().end ? "" : undefined}
        >
          <span aria-hidden="true">⚔</span>
          <Text title={label(r())}>{label(r())}</Text>
          <Act
            type="button"
            onClick={() => {
              props.link.watchRun(r().run.id);
              props.onAct?.();
            }}
          >
            {t`Ver`}
          </Act>
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
    maxWidth: "min(420px, 100%)",
    padding: "4px 6px 4px 12px",
    borderRadius: "999px",
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
    fontSize: "0.85em",
  },
});
const Text = styled("span", {
  base: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});
const Act = styled("button", {
  base: {
    "@media (pointer: coarse)": { minHeight: "40px", paddingInline: "12px" },
    padding: "2px 10px",
    borderRadius: "999px",
    border: "none",
    background: "var(--md-sys-color-surface)",
    color: "var(--md-sys-color-on-surface)",
    cursor: "pointer",
    fontSize: "inherit",
    flex: "0 0 auto",
  },
});
