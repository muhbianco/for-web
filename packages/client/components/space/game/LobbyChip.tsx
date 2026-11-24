import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { SpaceView } from "@muchat/space-client";
import { type RpgLobbyView, dungeonOf } from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { gameChip } from "./gameTheme";
import {
  loopSeconds,
  loopStopText,
  myLobby,
  partyState,
  useGameAction,
} from "./partyUi";

/**
 * O grupo da dungeon (docs/espaco/jogo/ot, etapa O4; desde 24/11/2026 ele fica montado entre as
 * corridas). Quem está nele vê o estado de onde estiver (montando, em corrida, pronto, a
 * contagem do loop) e age: o líder começa a próxima, liga ou desliga o loop e para a contagem;
 * todos podem sair. Quem está na sala vê o convite para ir até a TV.
 */
export default function LobbyChip(props: {
  view: SpaceView;
  lobbies: Record<string, RpgLobbyView>;
  myId: string | null;
  /** After a button: the button may be gone, the keyboard goes back to the map. */
  onAct?: () => void;
}) {
  const { t } = useLingui();
  const act = useGameAction(() => props.view);
  const mineLobby = () => myLobby(props.lobbies, props.myId);
  // Convite: um grupo da sala com vaga, montando ou entre corridas.
  const invite = () =>
    Object.values(props.lobbies).find(
      (l) => l.state !== "running" && l.members.length < l.max,
    ) ?? null;
  const lobby = () => mineLobby() ?? invite();
  const mine = () => !!mineLobby();
  const leader = () => mineLobby()?.leader === props.myId;
  const name = (l: RpgLobbyView) => dungeonOf(l.dungeon)?.name ?? l.dungeon;
  const leaderName = (l: RpgLobbyView) =>
    l.members.find((m) => m.user_id === l.leader)?.name ?? "";

  // A contagem do loop anda de segundo em segundo só enquanto existe.
  const [now, setNow] = createSignal(Date.now());
  const counting = createMemo(() => {
    const l = mineLobby();
    return !!l && loopSeconds(l, Date.now()) !== null;
  });
  createEffect(() => {
    if (!counting()) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(id));
  });

  const stateText = () => {
    const l = mineLobby();
    return l ? partyState(l, now()) : "";
  };
  // O que o leitor de tela ouve: só a mudança de estado, não cada segundo da contagem.
  const spoken = createMemo(() => {
    const l = mineLobby();
    if (!l) return "";
    if (l.state === "running") return t`Grupo em corrida na ${name(l)}.`;
    if (l.loop && l.next_at)
      return t`Grupo pronto; a próxima corrida começa sozinha.`;
    return loopStopText(l) ?? (l.state === "ready" ? t`Grupo pronto.` : "");
  });

  const send = (type: string, d: Record<string, unknown> = {}) => {
    act.send(type, d);
    props.onAct?.();
  };

  return (
    <Show when={lobby()}>
      {(l) => (
        <Wrap>
          <Chip
            style={gameChip}
            role="group"
            aria-label={t`Grupo da dungeon`}
            data-mine={mine() ? "" : undefined}
            data-state={l().state ?? "forming"}
          >
            <span aria-hidden="true">🛡</span>
            <Show
              when={mine()}
              fallback={
                <Text
                  title={t`${leaderName(l())} monta um grupo na TV: ${name(l())} · ${l().members.length}/${l().max}`}
                >
                  {t`${leaderName(l())} monta um grupo na TV: ${name(l())} · ${l().members.length}/${l().max}`}
                </Text>
              }
            >
              <Text title={loopStopText(l()) ?? undefined}>
                <strong>{name(l())}</strong>
                {" · "}
                <span aria-hidden="true">{stateText()}</span>
                <Show when={l().state === "forming"}>
                  {` · ${l().members.length}/${l().max}`}
                </Show>
              </Text>
              <Show when={l().stopped && !l().loop}>
                <Symbol size={16} role="img" aria-label={loopStopText(l()) ?? ""}>
                  error
                </Symbol>
              </Show>
              <Show
                when={leader()}
                fallback={
                  <Show when={l().loop}>
                    <Symbol size={16} role="img" aria-label={t`Repetir ligado`}>
                      repeat_on
                    </Symbol>
                  </Show>
                }
              >
                <Act
                  type="button"
                  data-icon=""
                  aria-pressed={l().loop ? "true" : "false"}
                  title={
                    l().loop
                      ? t`Repetir: ligado. A próxima começa sozinha depois de cada vitória.`
                      : t`Repetir: desligado.`
                  }
                  aria-label={t`Repetir`}
                  disabled={act.busy()}
                  onClick={() => send("rpg.lobby.loop", { on: !l().loop })}
                >
                  <Symbol size={18}>{l().loop ? "repeat_on" : "repeat"}</Symbol>
                </Act>
                <Show when={l().state !== "running"}>
                  <Show
                    when={loopSeconds(l(), now()) !== null}
                    fallback={
                      <Act
                        type="button"
                        data-primary=""
                        disabled={act.busy()}
                        onClick={() => send("rpg.lobby.start")}
                      >
                        {(l().runs ?? 0) > 0 ? t`De novo` : t`Começar`}
                      </Act>
                    }
                  >
                    <Act
                      type="button"
                      disabled={act.busy()}
                      onClick={() => send("rpg.lobby.loop", { on: false })}
                    >
                      {t`Parar`}
                    </Act>
                  </Show>
                </Show>
              </Show>
              <Act
                type="button"
                disabled={act.busy()}
                title={
                  leader() && l().members.length > 1
                    ? t`Sair do grupo: a liderança passa para quem entrou depois.`
                    : t`Sair do grupo`
                }
                onClick={() => send("rpg.lobby.leave")}
              >
                {t`Sair`}
              </Act>
            </Show>
          </Chip>
          <Hidden aria-live="polite">{spoken()}</Hidden>
          <Show when={act.error()}>
            {(msg) => <ErrorBubble role="alert">{msg()}</ErrorBubble>}
          </Show>
        </Wrap>
      )}
    </Show>
  );
}

const Wrap = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
});

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
    // The countdown changes width every second: digits of the same width.
    fontVariantNumeric: "tabular-nums",
  },
});

const Act = styled("button", {
  base: {
    // A finger needs room (the chips sit in the dock at the bottom on phones).
    "@media (pointer: coarse)": { minHeight: "40px", paddingInline: "12px" },
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 10px",
    borderRadius: "999px",
    border: "none",
    background: "var(--md-sys-color-surface)",
    color: "var(--md-sys-color-on-surface)",
    cursor: "pointer",
    fontSize: "inherit",
    "&[data-icon]": { paddingInline: "6px" },
    "&[data-primary]": {
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
      fontWeight: 600,
    },
    "&[aria-pressed=true]": {
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
    },
    "&:disabled": { opacity: 0.6, cursor: "default" },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});

const Hidden = styled("span", {
  base: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});

const ErrorBubble = styled("span", {
  base: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "var(--md-sys-color-error-container)",
    color: "var(--md-sys-color-on-error-container)",
    fontSize: "0.8em",
    maxWidth: "40ch",
    whiteSpace: "normal",
  },
});
