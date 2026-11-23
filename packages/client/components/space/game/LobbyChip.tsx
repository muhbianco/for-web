import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { SpaceView } from "@muchat/space-client";
import { type RpgLobbyView, dungeonOf } from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

/**
 * O grupo da dungeon na sala (docs/espaco/jogo/ot, etapa O4): quem está nele vê e age (líder
 * começa, todos podem sair); quem está na sala vê o convite para ir até a TV.
 */
export default function LobbyChip(props: {
  view: SpaceView;
  lobbies: Record<string, RpgLobbyView>;
  myId: string | null;
  /** After a button: the button may be gone, the keyboard goes back to the map. */
  onAct?: () => void;
}) {
  const { t } = useLingui();
  const lobby = () => {
    const all = Object.values(props.lobbies);
    return (
      all.find((l) => l.members.some((m) => m.user_id === props.myId)) ??
      all[0] ??
      null
    );
  };
  const mine = () =>
    lobby()?.members.some((m) => m.user_id === props.myId) ?? false;
  const leaderName = () =>
    lobby()?.members.find((m) => m.user_id === lobby()?.leader)?.name ?? "";
  const invite = () => {
    const l = lobby();
    if (!l) return "";
    return t`${leaderName()} monta um grupo na TV: ${dungeonOf(l.dungeon)?.name ?? l.dungeon} · ${l.members.length}/${l.max}`;
  };

  return (
    <Show when={lobby()}>
      {(l) => (
        <Chip role="status" data-mine={mine() ? "" : undefined}>
          <span aria-hidden="true">🛡</span>
          <Show
            when={mine()}
            fallback={<Text title={invite()}>{invite()}</Text>}
          >
            <Text>
              {t`Grupo: ${dungeonOf(l().dungeon)?.name ?? l().dungeon} · ${l().members.length}/${l().max}`}
            </Text>
            <Show when={l().leader === props.myId}>
              <Act
                type="button"
                onClick={() => {
                  props.view.gameSend("rpg.lobby.start", {});
                  props.onAct?.();
                }}
              >
                {t`Começar`}
              </Act>
            </Show>
            <Act
              type="button"
              onClick={() => {
                props.view.gameSend("rpg.lobby.leave", {});
                props.onAct?.();
              }}
            >
              {t`Sair`}
            </Act>
          </Show>
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
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface)",
    fontSize: "0.85em",
    whiteSpace: "nowrap",
    "&[data-mine]": {
      background: "var(--md-sys-color-tertiary-container)",
      color: "var(--md-sys-color-on-tertiary-container)",
    },
  },
});

// The invitation is long; cut so the bar stays on one line (the full text in the title).
const Text = styled("span", {
  base: {
    minWidth: 0,
    maxWidth: "26ch",
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
