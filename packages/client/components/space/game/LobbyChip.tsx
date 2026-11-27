import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type RpgLobbyView,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { gameChip } from "./gameTheme";
import { type GameLink, useCommands } from "./gameUi";
import {
  dungeonName,
  loopStopText,
  myLobby,
  partyState,
} from "./partyUi";

/**
 * A faixa do meu grupo no topo do Espaço: a DG, quantos, o estado em palavras (sem contagem,
 * D21) e os botões de quem lidera (começar, loop) e de sair. O motivo de o loop ter parado fica
 * escrito até alguém ligar de novo.
 */
export default function LobbyChip(props: {
  link: GameLink;
  lobbies: Record<string, RpgLobbyView>;
  myId: string | null;
  onAct?: () => void;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const l = () => myLobby(props.lobbies, props.myId);
  const send = (type: string, d: Record<string, unknown> = {}) => {
    void cmd.run(type, d);
    props.onAct?.();
  };
  const leader = () => l()?.leader === props.myId;
  const canStart = () => {
    const x = l();
    const d = x ? dungeonById(x.dungeon) : undefined;
    return (
      !!x &&
      !!d &&
      x.state !== "running" &&
      x.members.length >= d.party.min
    );
  };
  return (
    <Show when={l()}>
      {(x) => (
        <Chip style={gameChip} role="status">
          <span aria-hidden="true">⚑</span>
          <Text title={dungeonName(x().dungeon)}>
            {dungeonName(x().dungeon)} · {x().members.length}/{x().max} ·{" "}
            {partyState(x())}
          </Text>
          <Show when={loopStopText(x())}>
            {(s) => <Stop title={s()}>⚠</Stop>}
          </Show>
          <Show when={leader() && x().state !== "running"}>
            <Act
              type="button"
              disabled={cmd.busy() || !canStart()}
              onClick={() => send("rpg.lobby.start")}
            >
              {t`Começar`}
            </Act>
          </Show>
          <Show when={leader()}>
            <Act
              type="button"
              aria-pressed={x().loop}
              disabled={cmd.busy()}
              onClick={() => send("rpg.lobby.loop", { on: !x().loop })}
            >
              {x().loop ? t`Loop ligado` : t`Loop`}
            </Act>
          </Show>
          <Act
            type="button"
            disabled={cmd.busy()}
            onClick={() => send("rpg.lobby.leave")}
          >
            {t`Sair`}
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
    gap: "6px",
    maxWidth: "100%",
    padding: "4px 6px 4px 12px",
    borderRadius: "999px",
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
    fontSize: "0.85em",
  },
});
const Text = styled("span", {
  base: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
});
const Stop = styled("span", { base: { color: "#ffcf8a" } });
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
    "&[aria-pressed=true]": {
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
    },
    "&:disabled": { opacity: 0.5 },
  },
});
