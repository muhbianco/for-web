import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import type { DungeonRun, DungeonScene } from "@muchat/space-client/game";
import { defaultPalette } from "@muchat/space-core";
import {
  dungeonOf,
  itemDef,
  monsterDef,
  stageMonsters,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { rpgLabels, vocationName } from "./rpgUi";
import {
  clock,
  coins,
  feedLine,
  huntLine,
  isMajor,
  itemList,
  outcomeLabel,
  stageName,
} from "./runUi";

/** Linhas do registro à vista. */
const FEED_SHOWN = 12;

/**
 * A tela da aventura (docs/espaco/jogo/ot, etapas O5 e O10): a corrida da dungeon como o
 * servidor manda, um segundo por vez. Não bloqueia o mapa (o teclado segue andando com o
 * avatar). A dungeon aparece vista de cima (`DungeonScene`, Pixi próprio, sob demanda), com
 * o grupo e o registro ao lado; sem WebGL, volta às barras de texto. A cena anima cada
 * segundo e para: nada roda por quadro com a corrida parada, o painel fechado ou a aba
 * escondida.
 */
export default function RunPanel(props: {
  state: RunState;
  myId: string | null;
  onClose: () => void;
  /** Paleta do avatar de cada pessoa no mapa (o herói na cena tem a cara dela). */
  paletteOf?: (userId: string) => number;
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const run = () => props.state.run;
  const frame = () => props.state.frame;
  const end = () => props.state.end;
  const st = () => frame()?.st ?? 0;
  const stages = () => dungeonOf(run().dungeon)?.stages.length ?? 0;
  const total = () =>
    Math.max(1, Math.round((run().ends_at - run().started_at) / 1000));
  const monsters = createMemo(() =>
    stageMonsters(run().dungeon, st(), run().members.length),
  );
  const feed = () => props.state.feed.slice(-FEED_SHOWN);

  // ---- a cena ----
  let host: HTMLDivElement | undefined;
  const [scene, setScene] = createSignal<DungeonScene | null>(null);
  const [sceneFailed, setSceneFailed] = createSignal(false);
  onMount(() => {
    let alive = true;
    let mounted: DungeonScene | null = null;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      if (mounted) mounted.reducedMotion = !!motion?.matches;
    };
    motion?.addEventListener?.("change", onMotion);
    const me = props.myId;
    // Cada passo numa tarefa própria. No começo da corrida o painel abre junto com o resto da
    // mensagem do servidor; o import, o init do Pixi e a primeira corrida resolvem em
    // microtarefas e caíam na mesma tarefa, que passava de 50 ms no laboratório (59–71 ms).
    nextTask()
      .then(() => import("@muchat/space-client/game"))
      .then(async ({ DungeonScene }) => {
        if (!alive) return null;
        const s = await DungeonScene.mount(host!, {
          reducedMotion: !!motion?.matches,
          me,
        });
        await nextTask();
        return s;
      })
      .then(
        (s) => {
          if (!s) return;
          if (!alive) return s.destroy();
          mounted = s;
          setScene(s);
        },
        (err: unknown) => {
          // Sem WebGL (ou o módulo não carregou): o painel segue com as barras de texto.
          console.warn("[espaço] cena da dungeon indisponível", err);
          if (alive) setSceneFailed(true);
        },
      );
    onCleanup(() => {
      alive = false;
      motion?.removeEventListener?.("change", onMotion);
      mounted?.destroy();
      setScene(null);
    });
  });
  // Memos antes do efeito: `props.state` muda a cada atualização do mapa, o quadro só por segundo.
  const runM = createMemo(() => props.state.run);
  const frameM = createMemo(() => props.state.frame);
  const outcomeM = createMemo(() => props.state.end?.outcome ?? null);
  createEffect(() => {
    const s = scene();
    if (!s) return;
    const r = runM();
    const sceneRun: DungeonRun = {
      id: r.id,
      dungeon: r.dungeon,
      members: r.members.map((m) => ({
        userId: m.user_id,
        name: m.name,
        vocation: m.vocation,
        healthMax: m.health_max,
        palette: props.paletteOf?.(m.user_id) ?? defaultPalette(m.user_id),
        weapon: m.gear?.weapon ?? null,
        shield: m.gear?.shield ?? null,
        armor: m.gear?.armor ?? {},
      })),
    };
    s.show(sceneRun, frameM(), outcomeM());
  });
  const where = () => {
    const n = st() + 1;
    const of = stages();
    const name = stageName(run().dungeon, st());
    return t`Sala ${n} de ${of}: ${name}`;
  };

  return (
    <Panel
      role="region"
      aria-label={t`Dungeon em andamento`}
      data-scene={sceneFailed() ? undefined : ""}
    >
      <Head>
        <div>
          <strong>{dungeonOf(run().dungeon)?.name ?? run().dungeon}</strong>
          <Muted>
            {end()
              ? outcomeLabel(end()!.outcome)
              : frame()
                ? where()
                : t`Em andamento`}
          </Muted>
        </div>
        <Show when={frame()}>
          {(f) => (
            <Muted aria-hidden="true">
              {clock(f().s)} / {clock(total())}
            </Muted>
          )}
        </Show>
        <Close type="button" aria-label={t`Fechar`} onClick={props.onClose}>
          ×
        </Close>
      </Head>

      <Body>
        <Show when={!sceneFailed()}>
          <Stage ref={host} />
        </Show>
        <Side>
          <Show when={sceneFailed()}>
            <Muted role="status">
              {t`A vista da dungeon não abriu neste aparelho; segue o resumo em texto.`}
            </Muted>
          </Show>
          <Show
            when={frame()}
            fallback={
              <Muted>{t`A corrida segue no servidor; o resultado chega no fim.`}</Muted>
            }
          >
            {(f) => (
              <Cols>
                <section aria-label={t`Grupo`}>
                  <For each={run().members}>
                    {(m, i) => {
                      const hp = () => f().h[i()] ?? 0;
                      const mp = () => f().m[i()] ?? 0;
                      return (
                        <Unit data-dead={hp() <= 0 ? "" : undefined}>
                          <span>
                            {m.name}
                            {m.user_id === props.myId
                              ? ` ${t`(você)`}`
                              : ""}{" "}
                            <Muted>
                              {vocationName(m.vocation)} · Nv {m.level}
                            </Muted>
                          </span>
                          <Bar
                            role="meter"
                            aria-label={t`Vida de ${m.name}`}
                            aria-valuemin={0}
                            aria-valuemax={m.health_max}
                            aria-valuenow={hp()}
                            data-low={
                              hp() / m.health_max < 0.3 ? "" : undefined
                            }
                          >
                            <span
                              style={{ width: `${pct(hp(), m.health_max)}%` }}
                            />
                          </Bar>
                          <Show when={m.mana_max > 0}>
                            <Bar
                              data-mana=""
                              role="meter"
                              aria-label={t`Mana de ${m.name}`}
                              aria-valuemin={0}
                              aria-valuemax={m.mana_max}
                              aria-valuenow={mp()}
                            >
                              <span
                                style={{ width: `${pct(mp(), m.mana_max)}%` }}
                              />
                            </Bar>
                          </Show>
                        </Unit>
                      );
                    }}
                  </For>
                </section>
                <section
                  aria-label={t`Monstros`}
                  data-hidden={sceneFailed() ? undefined : ""}
                >
                  <For each={monsters()}>
                    {(x, i) => {
                      const hp = () => f().x[i()] ?? 0;
                      const def = monsterDef(x.id);
                      return (
                        <Unit data-dead={hp() <= 0 ? "" : undefined}>
                          <span>
                            {def?.name ?? x.id}
                            {def?.boss ? ` ${t`(chefe)`}` : ""}
                          </span>
                          <Bar
                            data-foe=""
                            role="meter"
                            aria-label={t`Vida de ${def?.name ?? x.id}`}
                            aria-valuemin={0}
                            aria-valuemax={x.health}
                            aria-valuenow={hp()}
                          >
                            <span
                              style={{ width: `${pct(hp(), x.health)}%` }}
                            />
                          </Bar>
                        </Unit>
                      );
                    }}
                  </For>
                </section>
              </Cols>
            )}
          </Show>

          <Feed>
            <For each={feed()}>
              {(ev) => (
                <li data-major={isMajor(ev) ? "" : undefined}>
                  <Muted>{clock(ev.at)}</Muted> {feedLine(run(), ev)}
                </li>
              )}
            </For>
          </Feed>
        </Side>
      </Body>

      <Show when={end()}>
        {(e) => (
          <Summary>
            <For each={e().members}>
              {(m) => {
                const name =
                  run().members.find((x) => x.user_id === m.user_id)?.name ??
                  "";
                const r = m.reward;
                // Etapa O7: o que gastou (até quem caiu) e o que ficou no corpo.
                const spent = itemList(m.spent ?? []);
                const left = itemList(m.left ?? []);
                const hunt = huntLine(run(), m);
                const extra = (
                  <>
                    <Muted style={{ display: "block" }}>{hunt}</Muted>
                    <Show when={spent}>
                      <Muted style={{ display: "block" }}>
                        {t`Gastou: ${spent}.`}
                      </Muted>
                    </Show>
                    <Show when={left}>
                      <Muted style={{ display: "block" }}>
                        {t`Ficou no corpo (sem espaço): ${left}.`}
                      </Muted>
                    </Show>
                  </>
                );
                if (!r)
                  return (
                    <li>
                      {t`${name}: caiu e perdeu a recompensa desta dungeon.`}
                      {extra}
                    </li>
                  );
                const items = r.loot
                  .map((l) =>
                    l.count > 1
                      ? `${l.count}× ${itemDef(l.item)?.name ?? l.item}`
                      : (itemDef(l.item)?.name ?? l.item),
                  )
                  .join(", ");
                const exp = r.exp.toLocaleString();
                const gold = coins(r.gold);
                return (
                  <li>
                    {items
                      ? t`${name}: +${exp} de experiência, ${gold}, ${items}.`
                      : t`${name}: +${exp} de experiência, ${gold}.`}
                    {extra}
                  </li>
                );
              }}
            </For>
          </Summary>
        )}
      </Show>

      {/* Só o que muda de sala e o fim, para leitor de tela (o registro corre rápido). */}
      <Live role="status">
        {end() ? outcomeLabel(end()!.outcome) : frame() ? where() : ""}
      </Live>
    </Panel>
  );
}

/** Cede ao laço de eventos: o que vem depois roda numa tarefa nova. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function pct(v: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (v * 100) / max)) : 0;
}

const Panel = styled("div", {
  base: {
    position: "absolute",
    right: "12px",
    bottom: "12px",
    width: "min(400px, calc(100% - 24px))",
    "&[data-scene]": { width: "min(780px, calc(100% - 24px))" },
    maxHeight: "calc(100% - 24px)",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "12px 14px",
    borderRadius: "var(--borderRadius-lg, 16px)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
    zIndex: 5,
    fontSize: "0.9em",
  },
});

const Head = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    alignItems: "start",
    gap: "8px",
    "& > div": { display: "flex", flexDirection: "column", gap: "2px" },
  },
});

const Close = styled("button", {
  base: {
    // A finger needs room: 44 px on touch screens.
    "@media (pointer: coarse)": {
      minWidth: "44px",
      minHeight: "44px",
      display: "inline-grid",
      placeItems: "center",
    },
    border: "none",
    background: "transparent",
    color: "inherit",
    fontSize: "1.3em",
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 4px",
  },
});

/** Cena à esquerda, grupo e registro à direita; empilha em tela estreita. */
const Body = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "12px",
    "[data-scene] > &": {
      gridTemplateColumns: "minmax(0, 1fr) 230px",
      alignItems: "start",
    },
    "@media (max-width: 760px)": {
      "[data-scene] > &": { gridTemplateColumns: "minmax(0, 1fr)" },
    },
  },
});

const Stage = styled("div", {
  base: {
    width: "100%",
    aspectRatio: "15 / 9",
    borderRadius: "var(--borderRadius-md, 10px)",
    overflow: "hidden",
    background: "#0f1015",
  },
});

/** O lado da cena: o grupo em cima e o registro, menor, embaixo (o mais novo fica à vista). */
const Side = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    minWidth: 0,
    "[data-scene] &": { fontSize: "0.92em" },
  },
});

const Cols = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "& section": { display: "flex", flexDirection: "column", gap: "6px" },
    "[data-scene] &": { gridTemplateColumns: "minmax(0, 1fr)" },
    // Com a cena, os monstros ficam só para o leitor de tela (a cena mostra nome e vida).
    "& section[data-hidden]": {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      whiteSpace: "nowrap",
    },
  },
});

const Unit = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    "&[data-dead]": { opacity: 0.45 },
  },
});

const Bar = styled("div", {
  base: {
    height: "6px",
    borderRadius: "999px",
    background: "var(--md-sys-color-surface-container-highest)",
    overflow: "hidden",
    "& > span": {
      display: "block",
      height: "100%",
      borderRadius: "inherit",
      background: "var(--md-sys-color-tertiary)",
      transition: "width 0.35s ease",
    },
    "&[data-low] > span": { background: "var(--md-sys-color-error)" },
    "&[data-mana] > span": { background: "var(--md-sys-color-primary)" },
    "&[data-foe] > span": { background: "var(--md-sys-color-error)" },
    "@media (prefers-reduced-motion: reduce)": {
      "& > span": { transition: "none" },
    },
  },
});

const Feed = styled("ol", {
  base: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    fontSize: "0.92em",
    "& li[data-major]": { fontWeight: 600 },
    "[data-scene] &": {
      maxHeight: "150px",
      overflow: "hidden",
      justifyContent: "flex-end",
      maskImage: "linear-gradient(to bottom, transparent, black 28px)",
    },
  },
});

const Summary = styled("ul", {
  base: {
    margin: 0,
    paddingInlineStart: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.88em" },
});

const Live = styled("div", {
  base: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});
