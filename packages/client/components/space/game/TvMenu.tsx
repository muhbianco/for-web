import { For, Show, createSignal, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { SpaceUiState } from "@muchat/space-client";
import {
  type DungeonDef,
  type DungeonKind,
  type RpgHeroState,
  type RpgLobbyView,
  CLASSES,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ClassPicker } from "./ClassPicker";
import { kindBlurb, kindName, roleName } from "./gameText";
import {
  type GameLink,
  Badge,
  Btn,
  GameDialog,
  Muted,
  Notice,
  Panel,
  Row,
  Section,
  useCommands,
} from "./gameUi";
import { dungeonGroups } from "./heroModel";
import {
  belowLevel,
  dungeonName,
  loopStopText,
  outcomeText,
  partyState,
  roles,
} from "./partyUi";

/** O que a TV usa do SpaceView além dos comandos. */
export interface TvLink extends GameLink {
  requestBoard(): void;
  knowsRun(id: string): boolean;
  watchRun(id: string): void;
  watchTv(): void;
}

type Filter = DungeonKind | "todas";

/**
 * A TV com o Idle Hunt (§12): o meu grupo primeiro (o que importa agora), com os papéis cobertos e
 * o que falta para começar; os grupos desta TV para entrar; as corridas do Espaço para assistir; e
 * o catálogo por região — a faixa do herói aberta, as outras fechadas, a "sua" DG de cada tipo
 * marcada e as trancadas visíveis com o nível que falta. Sem relógio em lugar nenhum (D21).
 */
export default function TvMenu(props: {
  link: TvLink;
  request: { instance: string; title: string };
  hero: RpgHeroState | null;
  lobbies: RpgLobbyView[];
  mine: RpgLobbyView | null;
  board: SpaceUiState["board"];
  roomTitle: (roomId: string) => string | null;
  myId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [app, setApp] = createSignal<"home" | "idle">("home");
  const [filter, setFilter] = createSignal<Filter>("todas");
  const [open, setOpen] = createSignal<number | null>(null);
  const [changing, setChanging] = createSignal(false);
  props.link.requestBoard();
  const timer = setInterval(() => props.link.requestBoard(), 5000);
  onCleanup(() => clearInterval(timer));

  const level = () => props.hero?.hero.level ?? 1;
  const leader = () => props.mine?.leader === props.myId;
  const joinable = () => props.lobbies.filter((l) => l.id !== props.mine?.id);
  const runs = () => props.board?.runs ?? [];
  const where = (room: string) => props.roomTitle(room) ?? t`outra sala`;
  const groups = () => dungeonGroups(level(), filter());
  const isOpen = (index: number, current: boolean) =>
    open() === index || (open() === null && current);

  const choose = (d: DungeonDef) => {
    if (props.mine && leader()) {
      void cmd
        .run("rpg.lobby.dungeon", { dungeon: d.id })
        .then((r) => r?.ok && setChanging(false));
      return;
    }
    void cmd.run("rpg.lobby.create", {
      tv: props.request.instance,
      dungeon: d.id,
    });
  };
  const watch = (id: string) => {
    if (props.link.knowsRun(id)) return props.link.watchRun(id);
    void cmd
      .run("rpg.run.watch", { id })
      .then((r) => r?.ok && props.link.watchRun(id));
  };

  return (
    <GameDialog
      id="rpg-tv"
      title={app() === "idle" ? t`Idle Hunt` : props.request.title}
      subtitle={app() === "idle" ? t`Dungeons em grupo` : undefined}
      onClose={props.onClose}
    >
      <Show when={app() === "home"}>
        <Apps role="list" aria-label={t`Apps da TV`}>
          <AppTile
            type="button"
            role="listitem"
            onClick={() => props.link.watchTv()}
          >
            <strong>♪ {t`Music`}</strong>
            <Muted>{t`O vídeo ou a música da sala, para todos`}</Muted>
          </AppTile>
          <AppTile
            type="button"
            role="listitem"
            data-app="idle"
            onClick={() => setApp("idle")}
          >
            <strong>⚔ {t`Idle Hunt`}</strong>
            <Muted>
              {props.mine
                ? t`Seu grupo: ${dungeonName(props.mine.dungeon)}`
                : runs().length > 0
                  ? t`${runs().length} corridas rolando`
                  : t`Dungeons em grupo`}
            </Muted>
          </AppTile>
        </Apps>
      </Show>

      <Show when={app() === "idle"}>
        <Show when={props.hero} fallback={<ClassPicker link={props.link} />}>
          <Row>
            <Btn
              type="button"
              data-size="sm"
              data-tone="quiet"
              onClick={() => setApp("home")}
            >
              ← {t`Apps`}
            </Btn>
            <Muted>{t`Seu herói: nível ${level()}`}</Muted>
          </Row>
          <Notice error={cmd.error()} />

          <Show when={props.mine}>
            {(l) => (
              <MyGroup
                lobby={l()}
                myId={props.myId}
                leader={leader()}
                busy={cmd.busy()}
                onStart={() =>
                  void cmd
                    .run("rpg.lobby.start", {})
                    .then((r) => r?.ok && props.onClose())
                }
                onLoop={(on) => void cmd.run("rpg.lobby.loop", { on })}
                onLeave={(disband) =>
                  void cmd.run(
                    "rpg.lobby.leave",
                    disband ? { disband: true } : {},
                  )
                }
                onChange={() => setChanging(!changing())}
                changing={changing()}
              />
            )}
          </Show>

          <Show when={!props.mine && joinable().length > 0}>
            <Section aria-label={t`Grupos nesta TV`}>
              <h3>{t`Grupos nesta TV`}</h3>
              <For each={joinable()}>
                {(l) => {
                  const d = () => dungeonById(l.dungeon);
                  const low = () => level() < (d()?.minLevel ?? 1);
                  return (
                    <Panel>
                      <Row>
                        <strong>{dungeonName(l.dungeon)}</strong>
                        <Muted>
                          {l.members.length}/{l.max} · {partyState(l)}
                        </Muted>
                      </Row>
                      <Muted>
                        {l.members
                          .map(
                            (m) =>
                              `${m.name} (${CLASSES[m.cls].titles[1]} ${m.level})`,
                          )
                          .join(", ")}
                      </Muted>
                      <Btn
                        type="button"
                        data-tone="primary"
                        disabled={
                          cmd.busy() || low() || l.members.length >= l.max
                        }
                        onClick={() =>
                          void cmd.run("rpg.lobby.join", {
                            tv: props.request.instance,
                            id: l.id,
                          })
                        }
                      >
                        {low()
                          ? t`Entra a partir do nível ${d()?.minLevel}`
                          : t`Entrar no grupo`}
                      </Btn>
                    </Panel>
                  );
                }}
              </For>
            </Section>
          </Show>

          <Show when={runs().length > 0}>
            <Section aria-label={t`Corridas rolando`}>
              <h3>{t`Corridas rolando`}</h3>
              <For each={runs()}>
                {(r) => (
                  <Line>
                    <span>
                      <strong>{dungeonName(r.dungeon)}</strong>{" "}
                      <Muted>{where(r.room)}</Muted>
                      <br />
                      <Muted>{r.members.map((m) => m.name).join(", ")}</Muted>
                    </span>
                    <Btn
                      type="button"
                      data-size="sm"
                      disabled={cmd.busy()}
                      onClick={() => watch(r.id)}
                    >
                      {t`Assistir`}
                    </Btn>
                  </Line>
                )}
              </For>
            </Section>
          </Show>

          <Show when={!props.mine || (leader() && changing())}>
            <Section aria-label={t`Escolher a dungeon`}>
              <h3>
                {props.mine ? t`Trocar a dungeon do grupo` : t`Montar um grupo`}
              </h3>
              <Chips role="radiogroup" aria-label={t`Tipo de dungeon`}>
                <For
                  each={["todas", "cacada", "masmorra", "regional"] as Filter[]}
                >
                  {(k) => (
                    <Btn
                      type="button"
                      data-size="sm"
                      role="radio"
                      aria-checked={filter() === k}
                      aria-pressed={filter() === k}
                      onClick={() => setFilter(k)}
                    >
                      {k === "todas" ? t`Todas` : kindName(k)}
                    </Btn>
                  )}
                </For>
              </Chips>
              <Show when={filter() !== "todas"}>
                <Muted>{kindBlurb(filter() as DungeonKind)}</Muted>
              </Show>
              <Show when={level() < 40 && filter() !== "cacada"}>
                <Muted role="note">{t`A primeira Masmorra é a do nível 40 (entra a partir do 35) e o primeiro Chefe de Região, o do 50. Até lá, Caçadas.`}</Muted>
              </Show>
              <For each={groups()}>
                {(g) => (
                  <Region data-current={g.current ? "" : undefined}>
                    <RegionHead
                      type="button"
                      aria-expanded={isOpen(g.region.index, g.current)}
                      onClick={() =>
                        setOpen(
                          isOpen(g.region.index, g.current)
                            ? -1
                            : g.region.index,
                        )
                      }
                    >
                      <span>
                        <strong>{g.region.name}</strong>{" "}
                        <Muted>
                          {t`níveis ${g.region.from}–${g.region.to} · ${g.region.material}`}
                        </Muted>
                      </span>
                      <span aria-hidden="true">
                        {isOpen(g.region.index, g.current) ? "▾" : "▸"}
                      </span>
                    </RegionHead>
                    <Show when={isOpen(g.region.index, g.current)}>
                      <For each={g.rows}>
                        {(row) => (
                          <DgRow
                            data-locked={row.locked ? "" : undefined}
                            data-best={row.best ? "" : undefined}
                          >
                            <Kind data-kind={row.def.kind}>
                              {kindName(row.def.kind)}
                            </Kind>
                            <span>
                              <strong>
                                {row.def.kind === "regional"
                                  ? row.def.name
                                  : t`Nível ${row.def.level}`}
                              </strong>
                              <Show when={row.best}>
                                {" "}
                                <Badge>{t`a sua`}</Badge>
                              </Show>
                              <br />
                              <Muted>
                                {row.locked
                                  ? t`🔒 entra a partir do nível ${row.def.minLevel}`
                                  : t`${row.def.party.min}–${row.def.party.max} heróis · entra do nível ${row.def.minLevel}`}
                              </Muted>
                            </span>
                            <Btn
                              type="button"
                              data-size="sm"
                              data-tone={row.best ? "primary" : undefined}
                              disabled={
                                cmd.busy() ||
                                row.locked ||
                                props.mine?.dungeon === row.def.id
                              }
                              onClick={() => choose(row.def)}
                            >
                              {props.mine ? t`Trocar` : t`Montar`}
                            </Btn>
                          </DgRow>
                        )}
                      </For>
                    </Show>
                  </Region>
                )}
              </For>
            </Section>
          </Show>
        </Show>
      </Show>
    </GameDialog>
  );
}

function MyGroup(props: {
  lobby: RpgLobbyView;
  myId: string | null;
  leader: boolean;
  busy: boolean;
  changing: boolean;
  onStart: () => void;
  onLoop: (on: boolean) => void;
  onLeave: (disband: boolean) => void;
  onChange: () => void;
}) {
  const { t } = useLingui();
  const d = () => dungeonById(props.lobby.dungeon);
  const r = () => roles(props.lobby.members.map((m) => m.cls));
  const low = () => belowLevel(props.lobby.members, d()?.minLevel ?? 1);
  const few = () => props.lobby.members.length < (d()?.party.min ?? 1);
  const needsRoles = () => d()?.kind !== "cacada";
  return (
    <Section aria-label={t`Seu grupo`}>
      <h3>{t`Seu grupo`}</h3>
      <Panel data-mine="">
        <Row>
          <strong>{dungeonName(props.lobby.dungeon)}</strong>
          <Muted>
            {props.lobby.members.length}/{props.lobby.max} ·{" "}
            {partyState(props.lobby)}
          </Muted>
        </Row>
        <Members>
          <For each={props.lobby.members}>
            {(m) => (
              <li data-low={m.level < (d()?.minLevel ?? 1) ? "" : undefined}>
                <strong>{m.name}</strong> {CLASSES[m.cls].titles[1]} {m.level}
                <Muted> · {roleName(CLASSES[m.cls].role)}</Muted>
                <Show when={m.user_id === props.lobby.leader}> ⚑</Show>
              </li>
            )}
          </For>
        </Members>
        <Show when={needsRoles()}>
          <RolesRow aria-label={t`Papéis no grupo`}>
            <span data-ok={r().tanque ? "" : undefined}>
              {r().tanque ? "✓" : "✗"} {t`Tanque`}
            </span>
            <span data-ok={r().suporte ? "" : undefined}>
              {r().suporte ? "✓" : "✗"} {t`Suporte`}
            </span>
            <span data-ok={r().dps ? "" : undefined}>
              {r().dps ? "✓" : "✗"} {t`Dano`}
            </span>
          </RolesRow>
          <Show when={!r().tanque || !r().suporte || !r().dps}>
            <Muted role="note">
              {t`Sem tanque o dano morre; sem suporte o tanque cai; sem dano chega o Cataclismo do chefe. Uns 10 a 20 níveis acima compensam um papel que falta.`}
            </Muted>
          </Show>
        </Show>
        <Show when={low().length > 0}>
          <Muted role="note">
            ⚠{" "}
            {t`Ainda sem o nível ${d()?.minLevel}: ${low()
              .map((m) => m.name)
              .join(", ")}.`}
          </Muted>
        </Show>
        <Show when={few()}>
          <Muted role="note">{t`Esta dungeon pede pelo menos ${d()?.party.min} heróis.`}</Muted>
        </Show>
        <Show when={props.lobby.last}>
          {(last) => (
            <Muted>{t`Última: ${outcomeText(last())} · ${props.lobby.runs} corridas`}</Muted>
          )}
        </Show>
        <Show when={loopStopText(props.lobby)}>
          {(s) => <Muted role="note">⚠ {s()}</Muted>}
        </Show>
        <Row>
          <Show when={props.leader}>
            <Btn
              type="button"
              data-tone="primary"
              disabled={
                props.busy ||
                props.lobby.state === "running" ||
                low().length > 0 ||
                few()
              }
              onClick={props.onStart}
            >
              {t`Começar`}
            </Btn>
            <Btn
              type="button"
              aria-pressed={props.lobby.loop}
              disabled={props.busy}
              onClick={() => props.onLoop(!props.lobby.loop)}
            >
              {props.lobby.loop ? t`Loop ligado` : t`Ligar o loop`}
            </Btn>
            <Btn
              type="button"
              aria-pressed={props.changing}
              disabled={props.busy}
              onClick={props.onChange}
            >
              {t`Trocar a dungeon`}
            </Btn>
          </Show>
          <Btn
            type="button"
            disabled={props.busy}
            onClick={() => props.onLeave(false)}
          >
            {t`Sair do grupo`}
          </Btn>
          <Show when={props.leader && props.lobby.members.length > 1}>
            <Btn
              type="button"
              data-tone="quiet"
              disabled={props.busy}
              onClick={() => props.onLeave(true)}
            >
              {t`Desfazer o grupo`}
            </Btn>
          </Show>
        </Row>
        <Show when={props.lobby.loop}>
          <Muted>{t`No loop, a próxima corrida começa sozinha quando a anterior acaba; para se o grupo cair.`}</Muted>
        </Show>
      </Panel>
    </Section>
  );
}

const Apps = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "10px",
  },
});
const AppTile = styled("button", {
  base: {
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minHeight: "96px",
    padding: "14px",
    borderRadius: "14px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    font: "inherit",
    fontSize: "1.05em",
    cursor: "pointer",
    "&[data-app=idle]": {
      background:
        "linear-gradient(135deg, rgba(217,180,90,0.2), rgba(0,0,0,0.2))",
      borderColor: "var(--md-sys-color-outline)",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});
const Line = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
  },
});
const Chips = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "6px" },
});
const Region = styled("div", {
  base: {
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    overflow: "hidden",
    "&[data-current]": { borderColor: "var(--md-sys-color-outline)" },
  },
});
const RegionHead = styled("button", {
  base: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    minHeight: "48px",
    padding: "8px 12px",
    border: "none",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});
const DgRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "6.5em 1fr auto",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
    "&[data-locked]": { opacity: 0.55 },
    "&[data-best]": { background: "rgba(217,180,90,0.08)" },
    "@container (max-width: 440px)": {
      gridTemplateColumns: "1fr auto",
      "& > :first-child": { gridColumn: "1 / -1" },
    },
  },
});
const Kind = styled("span", {
  base: {
    justifySelf: "start",
    fontSize: "0.72rem",
    fontWeight: 800,
    letterSpacing: "0.04em",
    padding: "2px 8px",
    borderRadius: "6px",
    border: "1px solid currentColor",
    "&[data-kind=cacada]": { color: "#9fd18a" },
    "&[data-kind=masmorra]": { color: "#9fc3ff" },
    "&[data-kind=regional]": { color: "#ffb36b" },
  },
});
const Members = styled("ul", {
  base: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    "& > li[data-low]": { color: "#ff8a7a" },
  },
});
const RolesRow = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 14px",
    fontWeight: 700,
    "& > span": { color: "#ff8a7a" },
    "& > span[data-ok]": { color: "#7ee08a" },
  },
});
