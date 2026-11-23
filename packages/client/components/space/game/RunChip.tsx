import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState, SpaceView } from "@muchat/space-client";
import { dungeonOf } from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { outcomeLabel } from "./runUi";

/**
 * A corrida na barra (etapa O5): a nossa primeiro, senão a da sala. "Ver" abre a tela da
 * aventura; quando acaba, mostra o resultado até alguém fechar.
 */
export default function RunChip(props: {
  view: SpaceView;
  runs: Record<string, RunState>;
  myId: string | null;
  onAct?: () => void;
}) {
  const { t } = useLingui();
  // A nossa em andamento, depois qualquer uma em andamento, depois as que acabaram.
  const pick = () => {
    const all = Object.values(props.runs);
    const mine = (r: RunState) =>
      r.run.members.some((m) => m.user_id === props.myId);
    return (
      all.find((r) => !r.end && mine(r)) ??
      all.find((r) => !r.end) ??
      all.find(mine) ??
      all[0] ??
      null
    );
  };
  const label = (r: RunState) => {
    const dungeon = dungeonOf(r.run.dungeon)?.name ?? r.run.dungeon;
    if (r.end) return `${dungeon}: ${outcomeLabel(r.end.outcome)}`;
    const names = r.run.members.map((m) => m.name).join(", ");
    const n = (r.frame?.st ?? 0) + 1;
    const of = dungeonOf(r.run.dungeon)?.stages.length ?? 0;
    return t`${names} na ${dungeon} · sala ${n} de ${of}`;
  };
  return (
    <Show when={pick()}>
      {(r) => (
        <Chip role="status" data-end={r().end ? "" : undefined}>
          <span aria-hidden="true">⚔</span>
          <Text title={label(r())}>{label(r())}</Text>
          <Act
            type="button"
            onClick={() => {
              props.view.watchRun(r().run.id);
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
    padding: "4px 6px 4px 12px",
    borderRadius: "999px",
    background: "var(--md-sys-color-tertiary-container)",
    color: "var(--md-sys-color-on-tertiary-container)",
    fontSize: "0.85em",
    whiteSpace: "nowrap",
    "&[data-end]": {
      background: "var(--md-sys-color-surface-container-highest)",
      color: "var(--md-sys-color-on-surface)",
    },
  },
});

const Text = styled("span", {
  base: {
    minWidth: 0,
    maxWidth: "30ch",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

const Act = styled("button", {
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
