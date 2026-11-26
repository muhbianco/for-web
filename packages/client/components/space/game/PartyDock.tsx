import { For, Show, createSignal, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import {
  type RpgLobbyView,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { CLASS_ICON } from "./RunHud";
import { gameChip } from "./gameTheme";
import { type GameLink, useCommands } from "./gameUi";
import {
  belowLevel,
  dungeonName,
  loopStopText,
  outcomeText,
  prepShort,
  prepText,
  startView,
} from "./partyUi";

const COLLAPSE_KEY = "muchat.rpg.dock.collapsed";
const loadCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
};
const saveCollapsed = (v: boolean) => {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    // Sem armazenamento (aba privada): só não lembra.
  }
};

/**
 * O quadro do meu grupo no canto do mapa (26/11/2026), no lugar das faixas "grupo" e "corrida" do
 * topo, que ficavam poluídas e escondiam a volta para a corrida. É o "party frame" dos MMOs: quem
 * está no grupo com a vida ao vivo durante a corrida, quem está se preparando (segura a largada),
 * a sala em que estão, a contagem da largada e, para quem lidera, começar, desistir e o loop.
 * Clicar no quadro abre a corrida (ou a largada); dá para recolher numa linha só.
 */
export default function PartyDock(props: {
  link: GameLink;
  lobby: RpgLobbyView;
  /** A corrida do grupo que o app acompanha (a em andamento ou a última, que acabou). */
  run: RunState | null;
  myId: string | null;
  /** O relógio do servidor agora (a contagem vem nele). */
  serverNow: () => number;
  /** Abre a corrida ou a largada (sem nada para abrir, o quadro só mostra o estado). */
  onOpen?: () => void;
  /** A tela da corrida está aberta: o quadro fica numa linha só (ela já mostra o grupo). */
  compact?: boolean;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [collapsed, setCollapsed] = createSignal(loadCollapsed());
  const [now, setNow] = createSignal(props.serverNow());
  const timer = setInterval(() => setNow(props.serverNow()), 250);
  onCleanup(() => clearInterval(timer));

  const l = () => props.lobby;
  const leader = () => l().leader === props.myId;
  const running = () =>
    l().state === "running" && props.run && !props.run.end ? props.run : null;
  const start = () => startView(l(), now());
  const dg = () => dungeonById(l().dungeon);
  const canStart = () => {
    const d = dg();
    return (
      !!d &&
      l().state !== "running" &&
      !l().pending &&
      l().members.length >= d.party.min &&
      belowLevel(l().members, d.minLevel).length === 0
    );
  };
  const prepOf = (id: string) => l().prep?.find((p) => p.user_id === id);
  const runIndex = (id: string) =>
    running()?.run.members.findIndex((m) => m.user_id === id) ?? -1;
  const hpFrac = (id: string) => {
    const r = running();
    const i = runIndex(id);
    if (!r || i < 0) return null;
    const max = r.run.members[i]!.hp_max;
    const hp = r.frame?.h[i] ?? max;
    return max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  };

  /** A linha de estado: a sala, a largada (quem falta, a contagem), o fim, o loop. */
  const status = () => {
    const r = running();
    if (r) {
      const st = r.frame?.st ?? 0;
      return st >= 3 ? t`chefe` : t`sala ${st + 1} de 4`;
    }
    const s = start();
    if (s) {
      if (s.waiting.length > 0)
        return t`esperando ${s.waiting.map((w) => w.name).join(", ")}`;
      return s.secs !== null && s.secs > 0
        ? t`começa em ${s.secs}`
        : t`largando`;
    }
    if (l().state === "ready" && l().loop) return t`loop: a próxima já vem`;
    if (l().state === "ready" && l().last)
      return `${outcomeText(l().last!)} · ${t`pronto`}`;
    if (l().state === "ready") return t`pronto`;
    return t`montando · ${l().members.length}/${l().max}`;
  };
  const send = (type: string, d: Record<string, unknown> = {}) =>
    void cmd.run(type, d);

  return (
    <Dock
      style={gameChip}
      role="region"
      aria-label={t`Meu grupo: ${dungeonName(l().dungeon)}`}
      data-collapsed={collapsed() || props.compact ? "" : undefined}
      data-covers-map=""
    >
      <Head>
        <Main
          type="button"
          onClick={() => props.onOpen?.()}
          disabled={!props.onOpen}
          title={props.onOpen ? t`Abrir a corrida` : undefined}
          aria-label={`${dungeonName(l().dungeon)}, ${status()}`}
        >
          <Symbol size={16}>swords</Symbol>
          <span data-text="">
            <strong>{dungeonName(l().dungeon)}</strong>
            <small data-live={start() ? "" : undefined}>{status()}</small>
          </span>
          <Show when={props.onOpen}>
            <Symbol size={16}>open_in_full</Symbol>
          </Show>
        </Main>
        <Show when={!props.compact}>
          <Small
            type="button"
            aria-expanded={!collapsed()}
            aria-label={collapsed() ? t`Mostrar o grupo` : t`Recolher o grupo`}
            onClick={() => {
              const v = !collapsed();
              setCollapsed(v);
              saveCollapsed(v);
            }}
          >
            <Symbol size={16}>
              {collapsed() ? "expand_more" : "expand_less"}
            </Symbol>
          </Small>
        </Show>
      </Head>
      <Show when={!collapsed() && !props.compact}>
        <Members role="list" aria-label={t`Quem está no grupo`}>
          <For each={l().members}>
            {(m) => (
              <li
                data-me={m.user_id === props.myId ? "" : undefined}
                data-dead={hpFrac(m.user_id) === 0 ? "" : undefined}
              >
                <span data-who="">
                  <Symbol size={13}>{CLASS_ICON[m.cls]}</Symbol>
                  <span>{m.name}</span>
                  <small>{t`Nv ${m.level}`}</small>
                  <Show when={m.user_id === l().leader}>
                    <Symbol size={12} aria-label={t`lidera`}>
                      star
                    </Symbol>
                  </Show>
                </span>
                <Show
                  when={prepOf(m.user_id)}
                  fallback={
                    <Show when={hpFrac(m.user_id) !== null}>
                      <Hp
                        role="meter"
                        aria-label={t`Vida de ${m.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(hpFrac(m.user_id)! * 100)}
                        data-low={hpFrac(m.user_id)! < 0.3 ? "" : undefined}
                      >
                        <span
                          style={{
                            width: `${Math.round(hpFrac(m.user_id)! * 100)}%`,
                          }}
                        />
                      </Hp>
                    </Show>
                  }
                >
                  {(p) => (
                    <Prep title={prepText(p().what)}>
                      <Symbol size={12}>edit</Symbol>
                      {prepShort(p().what)}
                    </Prep>
                  )}
                </Show>
              </li>
            )}
          </For>
        </Members>
        <Show when={loopStopText(l())}>
          {(msg) => <Warn role="status">⚠ {msg()}</Warn>}
        </Show>
        <Actions>
          <Show when={leader() && canStart()}>
            <Act
              type="button"
              data-primary=""
              disabled={cmd.busy()}
              onClick={() => send("rpg.lobby.start")}
            >
              {l().runs > 0 ? t`Jogar de novo` : t`Começar`}
            </Act>
          </Show>
          <Show when={leader() && l().pending}>
            <Act
              type="button"
              disabled={cmd.busy()}
              onClick={() => send("rpg.lobby.start", { cancel: true })}
            >
              {t`Cancelar largada`}
            </Act>
          </Show>
          <Show when={leader()}>
            <Act
              type="button"
              aria-pressed={l().loop}
              disabled={cmd.busy()}
              onClick={() => send("rpg.lobby.loop", { on: !l().loop })}
            >
              <Symbol size={14}>repeat</Symbol>
              {l().loop ? t`Loop ligado` : t`Loop`}
            </Act>
          </Show>
          <Act
            type="button"
            disabled={cmd.busy()}
            onClick={() => send("rpg.lobby.leave")}
          >
            {t`Sair do grupo`}
          </Act>
        </Actions>
        <Show when={cmd.error()}>
          {(msg) => <Warn role="alert">{msg()}</Warn>}
        </Show>
      </Show>
    </Dock>
  );
}

const Dock = styled("div", {
  base: {
    position: "absolute",
    left: "12px",
    top: "12px",
    zIndex: 4,
    width: "min(260px, calc(100% - 24px))",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "6px",
    borderRadius: "12px",
    background: "rgba(20, 18, 15, 0.92)",
    color: "#f3efe6",
    fontSize: "0.82em",
    backdropFilter: "blur(2px)",
    "@media (max-width: 600px)": {
      top: "8px",
      left: "8px",
      width: "min(240px, calc(100% - 16px))",
    },
  },
});
const Head = styled("div", {
  base: { display: "flex", alignItems: "stretch", gap: "4px" },
});
const Main = styled("button", {
  base: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 6px",
    border: "none",
    borderRadius: "8px",
    background: "rgba(255,255,255,0.05)",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    minHeight: "36px",
    "&:hover:not(:disabled)": { background: "rgba(217,180,90,0.16)" },
    "&:disabled": { cursor: "default", opacity: 1 },
    "& [data-text]": {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      lineHeight: 1.2,
    },
    "& strong, & small": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    "& small": { color: "#d8ceb9" },
    "& small[data-live]": { color: "#ffe7a8", fontWeight: 700 },
  },
});
const Small = styled("button", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "30px",
    border: "none",
    borderRadius: "8px",
    background: "rgba(255,255,255,0.05)",
    color: "inherit",
    cursor: "pointer",
    "@media (pointer: coarse)": { width: "40px" },
  },
});
const Members = styled("ul", {
  base: {
    listStyle: "none",
    margin: 0,
    padding: "0 2px",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    "& li": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) 72px",
      alignItems: "center",
      gap: "6px",
    },
    "& li[data-me] [data-who] > span": { color: "#ffe7a8" },
    "& li[data-dead]": { opacity: 0.55 },
    "& [data-who]": {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      minWidth: 0,
      "& > span": {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      "& small": { color: "#c4b8a2", flexShrink: 0 },
    },
  },
});
const Hp = styled("div", {
  base: {
    height: "6px",
    borderRadius: "3px",
    background: "rgba(255,255,255,0.12)",
    overflow: "hidden",
    "& > span": {
      display: "block",
      height: "100%",
      background: "#4dd26a",
      transition: "width 0.4s ease",
    },
    "&[data-low] > span": { background: "#e0574f" },
  },
});
const Prep = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    fontSize: "0.85em",
    color: "#ffd28a",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});
const Warn = styled("p", {
  base: { margin: 0, color: "#ffcf8a", fontSize: "0.92em", lineHeight: 1.3 },
});
const Actions = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "4px" },
});
const Act = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "3px 9px",
    minHeight: "28px",
    borderRadius: "999px",
    border: "1px solid rgba(122,100,64,0.6)",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    "&[data-primary]": {
      background: "#d9b45a",
      color: "#1b140b",
      border: "none",
      fontWeight: 700,
    },
    "&[aria-pressed=true]": { background: "rgba(217,180,90,0.22)" },
    "&:disabled": { opacity: 0.5, cursor: "default" },
    "@media (pointer: coarse)": { minHeight: "40px" },
  },
});
