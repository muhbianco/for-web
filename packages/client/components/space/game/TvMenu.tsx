import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { SpaceUiState } from "@muchat/space-client";
import {
  type DungeonDef,
  type RpgHeroState,
  type RpgLobbyView,
  CLASSES,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ClassPicker } from "./ClassPicker";
import DungeonDetail from "./DungeonDetail";
import {
  KindFilter,
  KindLegend,
  Recommended,
  RegionBlock,
} from "./DungeonPicker";
import {
  type DungeonFilter,
  dungeonCatalog,
  dungeonRow,
  membersWithoutRegion,
  partySizeFor,
} from "./dungeonUi";
import { roleName } from "./gameText";
import {
  type GameLink,
  Btn,
  GameDialog,
  Muted,
  Notice,
  Panel,
  Row,
  Section,
  useCommands,
} from "./gameUi";
import {
  belowLevel,
  dungeonName,
  loopStopText,
  outcomeText,
  partyState,
  roles,
} from "./partyUi";
import RankView from "./RankView";

/** O que a TV usa do SpaceView além dos comandos. */
export interface TvLink extends GameLink {
  requestBoard(): void;
  knowsRun(id: string): boolean;
  watchRun(id: string): void;
  watchTv(): void;
}

/**
 * A TV com o Idle Hunt (§12): o meu grupo primeiro (o que importa agora), com os papéis cobertos e
 * o que falta para começar; os grupos desta TV para entrar; as corridas do Espaço para assistir; e
 * a escolha de DG (26/11/2026): as recomendadas para o nível, a legenda dos tipos, o catálogo por
 * região com "Concluída" e a trava do Chefe de Região, e o detalhe de cada DG com o que cai e a
 * chance de cada raridade. Sem relógio em lugar nenhum (D21).
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
  const [app, setApp] = createSignal<"home" | "idle" | "rank">("home");
  const [filter, setFilter] = createSignal<DungeonFilter>("todas");
  const [open, setOpen] = createSignal<number | null>(null);
  const [changing, setChanging] = createSignal(false);
  /** A DG aberta no detalhe (o que cai e as chances). */
  const [detail, setDetail] = createSignal<string | null>(null);
  props.link.requestBoard();
  const timer = setInterval(() => props.link.requestBoard(), 5000);
  onCleanup(() => clearInterval(timer));

  const level = () => props.hero?.hero.level ?? 1;
  const cls = () => props.hero?.hero.cls ?? "guerreiro";
  const cleared = () => props.hero?.cleared ?? [];
  const leader = () => props.mine?.leader === props.myId;
  const joinable = () => props.lobbies.filter((l) => l.id !== props.mine?.id);
  const runs = () => props.board?.runs ?? [];
  const where = (room: string) => props.roomTitle(room) ?? t`outra sala`;
  const groups = createMemo(() => dungeonCatalog(level(), cleared(), filter()));
  const isOpen = (index: number, current: boolean) =>
    open() === index || (open() === null && current);
  /** As chances abrem no tamanho do meu grupo (sozinho, sem grupo). */
  const partyOf = (d: DungeonDef) =>
    partySizeFor(d, props.mine?.members.length);
  const picking = () => !props.mine || (leader() && changing());
  const shown = () => {
    const id = detail();
    return id ? (dungeonById(id) ?? null) : null;
  };

  const choose = (d: DungeonDef) => {
    if (props.mine && leader()) {
      void cmd.run("rpg.lobby.dungeon", { dungeon: d.id }).then((r) => {
        if (!r?.ok) return;
        setChanging(false);
        setDetail(null);
      });
      return;
    }
    void cmd
      .run("rpg.lobby.create", {
        tv: props.request.instance,
        dungeon: d.id,
      })
      .then((r) => r?.ok && setDetail(null));
  };
  /** O botão do detalhe: criar o grupo, levar o meu grupo para ela, ou nada (não sou o líder). */
  const actionFor = (d: DungeonDef) => {
    const row = dungeonRow(d, level(), cleared());
    if (props.mine && !leader())
      return {
        label: t`Só quem lidera o grupo troca a dungeon`,
        disabled: true,
      };
    if (props.mine?.dungeon === d.id)
      return { label: t`O seu grupo já está aqui`, disabled: true };
    return {
      label: props.mine
        ? t`Levar o grupo para esta dungeon`
        : t`Criar um grupo nesta dungeon`,
      disabled: row.lock !== null,
    };
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
      title={
        app() === "idle"
          ? t`Idle Hunt`
          : app() === "rank"
            ? t`Ranking`
            : props.request.title
      }
      subtitle={
        app() === "idle"
          ? t`Dungeons em grupo`
          : app() === "rank"
            ? t`Quem foi mais longe nas dungeons, em todo o Muchat`
            : undefined
      }
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
          <AppTile
            type="button"
            role="listitem"
            data-app="rank"
            onClick={() => setApp("rank")}
          >
            <strong>🏆 {t`Ranking`}</strong>
            <Muted>{t`Quem foi mais longe, sozinho e em grupo`}</Muted>
          </AppTile>
        </Apps>
      </Show>

      <Show when={app() === "rank"}>
        <Row>
          <Btn
            type="button"
            data-size="sm"
            data-tone="quiet"
            onClick={() => setApp("home")}
          >
            ← {t`Apps`}
          </Btn>
        </Row>
        <RankView link={props.link} myId={props.myId} />
      </Show>

      <Show when={app() === "idle"}>
        <Show when={props.hero} fallback={<ClassPicker link={props.link} />}>
          <Show when={shown()}>
            {(d) => {
              const row = () => dungeonRow(d(), level(), cleared());
              return (
                <>
                  <Notice error={cmd.error()} />
                  <DungeonDetail
                    def={d()}
                    cls={cls()}
                    done={row().done}
                    lock={row().lock}
                    recommended={row().recommended}
                    party={partyOf(d())}
                    action={actionFor(d())}
                    busy={cmd.busy()}
                    onAction={() => choose(d())}
                    onBack={() => setDetail(null)}
                  />
                </>
              );
            }}
          </Show>
          <Show when={!shown()}>
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
                  onShow={() => setDetail(l().dungeon)}
                />
              )}
            </Show>

            <Show when={!props.mine && joinable().length > 0}>
              <Section aria-label={t`Grupos nesta TV`}>
                <h3>{t`Grupos nesta TV`}</h3>
                <For each={joinable()}>
                  {(l) => {
                    const d = () => dungeonById(l.dungeon);
                    const lock = () => {
                      const def = d();
                      return def
                        ? dungeonRow(def, level(), cleared()).lock
                        : null;
                    };
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
                            cmd.busy() || !!lock() || l.members.length >= l.max
                          }
                          onClick={() =>
                            void cmd.run("rpg.lobby.join", {
                              tv: props.request.instance,
                              id: l.id,
                            })
                          }
                        >
                          {lock()?.why === "region"
                            ? t`Conclua a região antes`
                            : t`Entrar no grupo`}
                        </Btn>
                        <Show when={d()}>
                          {(def) => (
                            <Btn
                              type="button"
                              data-size="sm"
                              data-tone="quiet"
                              onClick={() => setDetail(def().id)}
                            >
                              {t`Ver o que cai`}
                            </Btn>
                          )}
                        </Show>
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

            <Show when={picking()}>
              <Recommended
                level={level()}
                cls={cls()}
                cleared={cleared()}
                party={partyOf}
                onOpen={(d) => setDetail(d.id)}
              />
              <Section aria-label={t`Todas as dungeons`}>
                <h3>
                  {props.mine
                    ? t`Trocar a dungeon do grupo`
                    : t`Todas as dungeons`}
                </h3>
                <KindFilter value={filter()} onChange={setFilter} />
                <KindLegend filter={filter()} />
                <Muted>{t`Toque numa dungeon para ver o que cai e as chances.`}</Muted>
                <For each={groups()}>
                  {(g) => (
                    <RegionBlock
                      group={g}
                      open={isOpen(g.region.index, g.current)}
                      mineDungeon={props.mine?.dungeon ?? null}
                      onToggle={() =>
                        setOpen(
                          isOpen(g.region.index, g.current)
                            ? -1
                            : g.region.index,
                        )
                      }
                      onOpen={(d) => setDetail(d.id)}
                    />
                  )}
                </For>
              </Section>
            </Show>
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
  onShow: () => void;
}) {
  const { t } = useLingui();
  const d = () => dungeonById(props.lobby.dungeon);
  const r = () => roles(props.lobby.members.map((m) => m.cls));
  const low = () => belowLevel(props.lobby.members, d()?.minLevel ?? 1);
  const noRegion = () => {
    const def = d();
    return def ? membersWithoutRegion(props.lobby.members, def) : [];
  };
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
          <Btn
            type="button"
            data-size="sm"
            data-tone="quiet"
            onClick={() => props.onShow()}
          >
            {t`Ver o que cai`}
          </Btn>
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
            {t`Abaixo do nível recomendado (${d()?.minLevel}): ${low()
              .map((m) => m.name)
              .join(", ")}. Entra, mas a DG vai pesar.`}
          </Muted>
        </Show>
        <Show when={noRegion().length > 0}>
          <Muted role="note">
            ⚠{" "}
            {t`O Chefe de Região pede as Caçadas e Masmorras da região concluídas. Ainda sem: ${noRegion()
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
                noRegion().length > 0 ||
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
