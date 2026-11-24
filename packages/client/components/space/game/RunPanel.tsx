import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import type { DungeonRun, DungeonScene } from "@muchat/space-client/game";
import { defaultPalette } from "@muchat/space-core";
import {
  type RpgHeroView,
  GOLD,
  MONSTER_BASE,
  VOCATIONS,
  dungeonOf,
  expForLevel,
  itemDef,
  monsterDef,
  stageMonsters,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { itemIcon } from "./itemUi";
import { vocationName } from "./rpgUi";
import { type RunXp, RunHud } from "./RunHud";
import {
  clock,
  coins,
  huntLine,
  itemList,
  outcomeLabel,
  stageName,
} from "./runUi";
import { castKey } from "./SkillBar";

/** O ícone de cada classe no retrato (vocação base). */
const CLASS_ICON: Readonly<Record<number, string>> = {
  1: "local_fire_department",
  2: "eco",
  3: "target",
  4: "shield",
};

/** Quanto tempo um aviso da tela (sala nova, loot) fica à vista, em segundos da corrida. */
const TOAST_S = 2;

/**
 * A tela da aventura (docs/espaco/jogo/ot, etapas O5 e O10; tela de jogo desde 24/11/2026): a
 * corrida da dungeon como o servidor manda, um segundo por vez, sem registro de texto. A cena
 * (`DungeonScene`, Pixi próprio, sob demanda) ocupa o painel; por cima dela, nos cantos, o
 * retrato do herói e do grupo, a dungeon com as salas e o relógio; no meio, os avisos que
 * passam (sala nova, chefe, queda, o fim); embaixo, o painel com os cristais, o cinto, as
 * habilidades e a barra de experiência. Não bloqueia o mapa (o teclado segue andando com o
 * avatar). Sem WebGL, as barras de texto do grupo e dos monstros entram no lugar da cena.
 */
export default function RunPanel(props: {
  state: RunState;
  myId: string | null;
  /** O herói de quem olha (a experiência guardada, para a barra). */
  hero?: RpgHeroView | null;
  onClose: () => void;
  /** Paleta do avatar de cada pessoa no mapa (o herói na cena tem a cara dela). */
  paletteOf?: (userId: string) => number;
}) {
  const { t } = useLingui();
  const run = () => props.state.run;
  const frame = () => props.state.frame;
  const end = () => props.state.end;
  const st = () => frame()?.st ?? 0;
  const dungeon = () => dungeonOf(run().dungeon);
  const stages = () => dungeon()?.stages.length ?? 0;
  const total = () =>
    Math.max(1, Math.round((run().ends_at - run().started_at) / 1000));
  const monsters = createMemo(() =>
    stageMonsters(run().dungeon, st(), run().members.length),
  );

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

  // ---- a barra de habilidades (24/11/2026) ----
  // O último segundo em que cada habilidade saiu, por herói. O registro guarda só os últimos
  // eventos: o que já saiu dele fica lembrado aqui até a corrida trocar.
  const [casts, setCasts] = createSignal<Record<string, number>>({});
  let castsRun = "";
  createEffect(
    on(
      () => [runM().id, props.state.feed] as const,
      ([id, items]) => {
        const next = id === castsRun ? { ...untrack(casts) } : {};
        castsRun = id;
        for (const ev of items) {
          const key =
            ev.k === "magia" && ev.a < MONSTER_BASE
              ? castKey(ev.a, ev.s)
              : ev.k === "desafio"
                ? castKey(ev.a, "desafio")
                : null;
          if (key && (next[key] ?? -1) < ev.at) next[key] = ev.at;
        }
        setCasts(next);
      },
    ),
  );

  /** O herói em foco: a própria pessoa, ou o primeiro de quem ela assiste. */
  const barIndex = () =>
    Math.max(
      0,
      run().members.findIndex((m) => m.user_id === props.myId),
    );
  const focus = () => run().members[barIndex()];
  const watching = () => focus()?.user_id !== props.myId;
  const hpOf = (i: number) => frame()?.h[i] ?? 0;
  const focusDead = () => !!frame() && hpOf(barIndex()) <= 0;
  const lowLife = () => {
    const m = focus();
    const hp = hpOf(barIndex());
    return !!m && !!frame() && hp > 0 && hp / m.health_max < 0.3;
  };

  /** O que o herói em foco bebeu no segundo de agora (acende no cinto). */
  const drunk = () => {
    const s = frame()?.s;
    const i = barIndex();
    return props.state.feed.flatMap((ev) =>
      ev.k === "pocao" && ev.a === i && ev.at === s ? [ev.item] : [],
    );
  };

  // ---- a experiência: a guardada e a da corrida (só entra no fim; quem cai perde) ----
  const pending = () => {
    const m = focus();
    const raw = props.state.exp?.[barIndex()];
    if (!m || raw === undefined || m.exp_rate === undefined) return null;
    return Math.floor(raw * m.exp_rate);
  };
  const lost = () =>
    focusDead() ||
    end()?.outcome === "derrota" ||
    !!end()?.members.find((x) => x.user_id === focus()?.user_id)?.dead;
  const xp = createMemo((): RunXp | null => {
    const m = focus();
    const h = props.hero;
    if (!m || !h || m.user_id !== props.myId) return null;
    // A recompensa já entrou (o herói saiu da corrida): só a guardada, que já tem ela.
    const credited = !h.run || h.run.id !== run().id;
    const banked = h.experience;
    const gain = credited ? 0 : (pending() ?? 0);
    const from = expForLevel(h.level);
    const to = expForLevel(h.level + 1);
    const pct = clampPct(((banked - from) * 100) / Math.max(1, to - from));
    let level = h.level;
    const gone = !credited && lost();
    if (!gone) while (expForLevel(level + 1) <= banked + gain) level++;
    const pendingPct =
      level > h.level
        ? 100 - pct
        : clampPct((gain * 100) / Math.max(1, to - from));
    return {
      level: h.level,
      next: level,
      pct,
      pendingPct,
      pending: gain,
      lost: gone,
    };
  });

  // ---- os avisos da tela (derivados do registro: nada de relógio próprio) ----
  const now = () => frame()?.s ?? 0;
  /** A sala acabou de trocar: o nome dela no meio da tela por um instante. */
  const roomBanner = () => {
    if (!frame() || end()) return null;
    const ev = props.state.feed.findLast((e) => e.k === "sala");
    if (!ev || now() - ev.at > TOAST_S) return null;
    return ev.at;
  };
  const bossRoom = () =>
    monsters().some((x) => monsterDef(x.id)?.boss) ? monsters() : null;
  const bossName = () => {
    const b = monsters().find((x) => monsterDef(x.id)?.boss);
    return b ? (monsterDef(b.id)?.name ?? b.id) : "";
  };
  /** O loot que o herói em foco acabou de pegar (some sozinho). */
  const loot = () =>
    end()
      ? []
      : props.state.feed
          .filter(
            (ev) =>
              ev.k === "loot" &&
              ev.a === barIndex() &&
              now() - ev.at <= TOAST_S,
          )
          .slice(-4);

  const where = () => {
    const n = st() + 1;
    const of = stages();
    const name = stageName(run().dungeon, st());
    return t`Sala ${n} de ${of}: ${name}`;
  };

  return (
    <Panel
      // The space moves its camera off what this covers (SpacePage measureInsets).
      data-covers-map=""
      role="region"
      aria-label={t`Dungeon em andamento: ${dungeon()?.name ?? run().dungeon}`}
    >
      <Screen
        data-low={lowLife() ? "" : undefined}
        data-dead={focusDead() && !end() ? "" : undefined}
        data-failed={sceneFailed() ? "" : undefined}
      >
        <Show when={!sceneFailed()}>
          <Stage ref={host} />
        </Show>
        <Vignette aria-hidden="true" />

        {/* Em cima: o retrato e o grupo à esquerda, a dungeon no meio, o relógio à direita. */}
        <Top>
          <Frames>
            <Show when={focus()}>
              {(m) => {
                const level = () => xp()?.next ?? m().level;
                const up = () => (xp()?.next ?? 0) > (xp()?.level ?? 0);
                return (
                  <Portrait data-dead={focusDead() ? "" : undefined}>
                    <Avatar aria-hidden="true">
                      <Symbol size={22}>
                        {CLASS_ICON[VOCATIONS[m().vocation].base] ?? "person"}
                      </Symbol>
                      <LevelBadge
                        data-up={up() ? "" : undefined}
                        title={
                          up()
                            ? t`Sobe para o nível ${level()} quando a corrida acabar`
                            : undefined
                        }
                      >
                        {level()}
                      </LevelBadge>
                    </Avatar>
                    <div>
                      <strong>
                        {watching() ? t`Assistindo ${m().name}` : m().name}
                      </strong>
                      <small>
                        {t`${vocationName(m().vocation)} · nível ${m().level}`}
                      </small>
                      <Show when={!xp() && (pending() ?? 0) > 0}>
                        <Gain data-lost={lost() ? "" : undefined}>
                          {lost()
                            ? t`${(pending() ?? 0).toLocaleString()} de experiência perdida`
                            : t`+${(pending() ?? 0).toLocaleString()} de experiência`}
                        </Gain>
                      </Show>
                    </div>
                  </Portrait>
                );
              }}
            </Show>
            <For each={run().members}>
              {(m, i) => (
                <Show when={i() !== barIndex() && frame()}>
                  {(f) => {
                    const hp = () => f().h[i()] ?? 0;
                    const mp = () => f().m[i()] ?? 0;
                    return (
                      <Mate
                        data-dead={hp() <= 0 ? "" : undefined}
                        title={`${m.name} · ${vocationName(m.vocation)}`}
                      >
                        <span>
                          <b>{m.level}</b> {m.name}
                        </span>
                        <Meter
                          role="meter"
                          aria-label={t`Vida de ${m.name}`}
                          aria-valuemin={0}
                          aria-valuemax={m.health_max}
                          aria-valuenow={hp()}
                          data-low={hp() / m.health_max < 0.3 ? "" : undefined}
                        >
                          <span
                            style={{ width: `${pct(hp(), m.health_max)}%` }}
                          />
                        </Meter>
                        <Show when={m.mana_max > 0}>
                          <Meter
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
                          </Meter>
                        </Show>
                      </Mate>
                    );
                  }}
                </Show>
              )}
            </For>
          </Frames>

          <Title data-title="">
            <strong>{dungeon()?.name ?? run().dungeon}</strong>
            <Pips aria-label={frame() ? where() : t`Em andamento`}>
              <For each={dungeon()?.stages ?? []}>
                {(_, i) => (
                  <span
                    data-done={
                      i() < st() || (end() && end()!.outcome === "vitoria")
                        ? ""
                        : undefined
                    }
                    data-now={i() === st() && !end() ? "" : undefined}
                    data-boss={i() === stages() - 1 ? "" : undefined}
                  />
                )}
              </For>
            </Pips>
            <small>{stageName(run().dungeon, st())}</small>
          </Title>

          <Corner>
            <Show when={frame()}>
              {(f) => (
                <Clock aria-hidden="true">
                  {clock(f().s)} / {clock(total())}
                </Clock>
              )}
            </Show>
            <Close type="button" aria-label={t`Fechar`} onClick={props.onClose}>
              <Symbol size={20}>close</Symbol>
            </Close>
          </Corner>
        </Top>

        {/* Sem WebGL: as barras de texto no lugar da cena. */}
        <Show when={sceneFailed()}>
          <Fallback>
            <p role="status">
              {t`A vista da dungeon não abriu neste aparelho; segue o resumo em barras.`}
            </p>
            <For each={monsters()}>
              {(x, i) => {
                const hp = () => frame()?.x[i()] ?? 0;
                const def = monsterDef(x.id);
                return (
                  <Mate data-dead={hp() <= 0 ? "" : undefined}>
                    <span>
                      {def?.name ?? x.id}
                      {def?.boss ? ` ${t`(chefe)`}` : ""}
                    </span>
                    <Meter data-foe="">
                      <span style={{ width: `${pct(hp(), x.health)}%` }} />
                    </Meter>
                  </Mate>
                );
              }}
            </For>
          </Fallback>
        </Show>

        {/* Os avisos do meio: um por vez, do mais importante (o fim) ao mais comum (sala). */}
        <Center aria-hidden="true">
          <Show
            when={!end() && focusDead()}
            fallback={
              <For each={roomBanner() !== null ? [roomBanner()!] : []}>
                {() => (
                  <Banner data-boss={bossRoom() ? "" : undefined}>
                    <small>
                      {bossRoom()
                        ? t`Chefe`
                        : t`Sala ${st() + 1} de ${stages()}`}
                    </small>
                    <strong>
                      {bossRoom() ? bossName() : stageName(run().dungeon, st())}
                    </strong>
                  </Banner>
                )}
              </For>
            }
          >
            <Banner data-dead="">
              <strong>
                {watching() ? t`${focus()!.name} caiu` : t`Você caiu`}
              </strong>
              <small>
                {t`O grupo segue; a recompensa desta dungeon se perdeu.`}
              </small>
            </Banner>
          </Show>
        </Center>

        {/* O loot que acabou de cair (sobe e some). */}
        <Loot aria-hidden="true">
          <For each={loot()}>
            {(ev) =>
              ev.k === "loot" ? (
                <LootItem>
                  <Show
                    when={ev.item !== GOLD}
                    fallback={
                      <>
                        <Symbol size={16}>toll</Symbol>
                        {t`+${coins(ev.n)}`}
                      </>
                    }
                  >
                    <Symbol size={16}>{itemIcon(itemDef(ev.item))}</Symbol>
                    {ev.n > 1
                      ? `${ev.n}× ${itemDef(ev.item)?.name ?? ev.item}`
                      : (itemDef(ev.item)?.name ?? ev.item)}
                  </Show>
                </LootItem>
              ) : null
            }
          </For>
        </Loot>

        {/* O fim: o resultado e o que cada um levou, por cima da cena. */}
        <Show when={end()}>
          {(e) => (
            <Outcome role="dialog" aria-label={outcomeLabel(e().outcome)}>
              <Card data-outcome={e().outcome}>
                <h3>{outcomeLabel(e().outcome)}</h3>
                <ul>
                  <For each={e().members}>
                    {(m) => {
                      const name =
                        run().members.find((x) => x.user_id === m.user_id)
                          ?.name ?? "";
                      const r = m.reward;
                      const spent = itemList(m.spent ?? []);
                      const left = itemList(m.left ?? []);
                      const hunt = huntLine(run(), m);
                      const items = r
                        ? r.loot
                            .map((l) =>
                              l.count > 1
                                ? `${l.count}× ${itemDef(l.item)?.name ?? l.item}`
                                : (itemDef(l.item)?.name ?? l.item),
                            )
                            .join(", ")
                        : "";
                      return (
                        <li>
                          <strong>{name}</strong>
                          <Show
                            when={r}
                            fallback={
                              <span>
                                {t`Caiu e perdeu a recompensa desta dungeon.`}
                              </span>
                            }
                          >
                            {(rw) => (
                              <Rewards>
                                <span>
                                  <Symbol size={16}>star</Symbol>
                                  {t`+${rw().exp.toLocaleString()} de experiência`}
                                </span>
                                <span>
                                  <Symbol size={16}>toll</Symbol>
                                  {coins(rw().gold)}
                                </span>
                                <Show when={items}>
                                  <span>
                                    <Symbol size={16}>inventory_2</Symbol>
                                    {items}
                                  </span>
                                </Show>
                              </Rewards>
                            )}
                          </Show>
                          <small>{hunt}</small>
                          <Show when={spent}>
                            <small>{t`Gastou: ${spent}.`}</small>
                          </Show>
                          <Show when={left}>
                            <small>{t`Ficou no corpo (sem espaço): ${left}.`}</small>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
                <Button size="sm" variant="filled" onPress={props.onClose}>
                  {t`Fechar`}
                </Button>
              </Card>
            </Outcome>
          )}
        </Show>
      </Screen>

      <Show when={frame() && focus() ? frame() : null}>
        {(f) => (
          <RunHud
            member={focus()!}
            index={barIndex()}
            frame={f()}
            casts={casts()}
            potions={props.state.potions?.[barIndex()] ?? null}
            drankAt={props.state.potionAt?.[barIndex()] ?? -1}
            drunk={drunk()}
            xp={xp()}
          />
        )}
      </Show>

      {/* Para leitor de tela: o grupo e os monstros em texto (a tela é visual). */}
      <Hidden>
        <section aria-label={t`Grupo`}>
          <For each={run().members}>
            {(m, i) => (
              <p>
                {t`${m.name}, ${vocationName(m.vocation)} nível ${m.level}: vida ${hpOf(i())} de ${m.health_max}`}
              </p>
            )}
          </For>
        </section>
        <section aria-label={t`Monstros`}>
          <For each={monsters()}>
            {(x, i) => (
              <p>
                {`${monsterDef(x.id)?.name ?? x.id}: ${frame()?.x[i()] ?? 0} / ${x.health}`}
              </p>
            )}
          </For>
        </section>
      </Hidden>

      {/* Só o que muda de sala e o fim, para leitor de tela (a tela corre rápido). */}
      <Hidden role="status">
        {end() ? outcomeLabel(end()!.outcome) : frame() ? where() : ""}
      </Hidden>
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

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** O quadro do jogo: escuro, sem cromo, a cena em cima e o painel embaixo. */
const Panel = styled("div", {
  base: {
    position: "absolute",
    right: "12px",
    bottom: "12px",
    width: "min(1000px, calc(100% - 24px))",
    // Lays itself out by its own width (container queries), not the window's.
    containerType: "inline-size",
    maxHeight: "calc(100% - 24px)",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "8px",
    borderRadius: "var(--borderRadius-lg, 16px)",
    background: "#0d0c0b",
    color: "#f3efe6",
    boxShadow:
      "0 8px 28px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(122, 100, 64, 0.45)",
    zIndex: 5,
    fontSize: "0.9em",
  },
});

/** A tela: a cena e tudo o que fica por cima dela. */
const Screen = styled("div", {
  base: {
    position: "relative",
    flexShrink: 0,
    borderRadius: "10px",
    overflow: "hidden",
    background: "#0f1015",
    "&[data-failed]": { minHeight: "240px", paddingTop: "64px" },
  },
});

const Stage = styled("div", {
  base: {
    width: "100%",
    aspectRatio: "15 / 9",
    // A tela inteira cabe na janela: a cena se enquadra (faixas nas bordas) se faltar altura.
    maxHeight: "calc(100dvh - 300px)",
    minHeight: "220px",
    "[data-dead] > &": { filter: "grayscale(0.85) brightness(0.7)" },
    transition: "filter 0.6s ease",
  },
});

/** Vida baixa: a borda da tela fica vermelha (sem piscar). */
const Vignette = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    opacity: 0,
    transition: "opacity 0.4s ease",
    boxShadow: "inset 0 0 70px 14px rgba(200, 16, 24, 0.55)",
    "[data-low] > &": { opacity: 1 },
  },
});

const Top = styled("div", {
  base: {
    position: "absolute",
    // Acima do cartão do fim: o × do canto segue fechando a tela.
    zIndex: 2,
    top: 0,
    left: 0,
    right: 0,
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "start",
    gap: "8px",
    padding: "8px",
    pointerEvents: "none",
    background:
      "linear-gradient(to bottom, rgba(8, 8, 10, 0.7), rgba(8, 8, 10, 0))",
    "@container (max-width: 560px)": {
      gridTemplateColumns: "1fr auto",
      "& > [data-title]": { display: "none" },
    },
  },
});

const Frames = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "6px",
    minWidth: 0,
    // Os retratos aceitam o mouse (o título explica a subida de nível); o resto deixa passar.
    "& > *": { pointerEvents: "auto" },
  },
});

/** O retrato: classe, nível (com a subida prevista) e a experiência desta corrida. */
const Portrait = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 10px 4px 4px",
    borderRadius: "999px",
    background: "rgba(14, 12, 10, 0.78)",
    boxShadow: "0 0 0 1px rgba(122, 100, 64, 0.55)",
    maxWidth: "100%",
    "& > div": {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      lineHeight: 1.2,
    },
    "& strong": {
      fontSize: "0.9rem",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    "& small": { fontSize: "0.72rem", opacity: 0.8, whiteSpace: "nowrap" },
    "&[data-dead]": { filter: "grayscale(1)", opacity: 0.7 },
    // Tela estreita (celular): só o nome e o nível, para a cena ficar à vista.
    "@container (max-width: 560px)": {
      padding: "2px 8px 2px 2px",
      "& small": { display: "none" },
      "& strong": { fontSize: "0.8rem" },
    },
  },
});

const Avatar = styled("span", {
  base: {
    position: "relative",
    flexShrink: 0,
    width: "40px",
    height: "40px",
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    background: "radial-gradient(circle at 40% 30%, #3a3128, #15110d)",
    boxShadow: "0 0 0 2px #7a6440",
    color: "#e9d7ad",
    "@container (max-width: 560px)": { width: "30px", height: "30px" },
  },
});

const LevelBadge = styled("span", {
  base: {
    position: "absolute",
    right: "-6px",
    bottom: "-4px",
    minWidth: "20px",
    height: "18px",
    padding: "0 4px",
    borderRadius: "999px",
    background: "#d9b45a",
    color: "#1b140b",
    fontSize: "0.7rem",
    fontWeight: 800,
    lineHeight: "18px",
    textAlign: "center",
    boxShadow: "0 0 0 2px #15110d",
    fontVariantNumeric: "tabular-nums",
    // A subida prevista: o nível novo brilha (entra no fim da corrida).
    "&[data-up]": {
      background: "#ffe08a",
      boxShadow: "0 0 0 2px #15110d, 0 0 10px 2px rgba(255, 214, 102, 0.85)",
    },
  },
});

const Gain = styled("span", {
  base: {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#ffd66b",
    whiteSpace: "nowrap",
    "&[data-lost]": {
      color: "#b9b2a6",
      textDecoration: "line-through",
      fontWeight: 600,
    },
  },
});

/** Um companheiro do grupo: nível, nome, vida e mana. */
const Mate = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    width: "150px",
    padding: "4px 8px 6px",
    borderRadius: "8px",
    background: "rgba(14, 12, 10, 0.72)",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.08)",
    fontSize: "0.75rem",
    "& > span": {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    "& b": { color: "#d9b45a", marginRight: "2px" },
    "&[data-dead]": { opacity: 0.45, filter: "grayscale(1)" },
    "@container (max-width: 560px)": { width: "108px", fontSize: "0.68rem" },
  },
});

const Meter = styled("div", {
  base: {
    height: "5px",
    borderRadius: "999px",
    background: "rgba(255, 255, 255, 0.12)",
    overflow: "hidden",
    "& > span": {
      display: "block",
      height: "100%",
      borderRadius: "inherit",
      background: "#d3242f",
      transition: "width 0.35s ease",
    },
    "&[data-low] > span": { background: "#ff5a3c" },
    "&[data-mana] > span": { background: "#3d6bff" },
    "&[data-foe] > span": { background: "#c4161f" },
    "@media (prefers-reduced-motion: reduce)": {
      "& > span": { transition: "none" },
    },
  },
});

const Title = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    paddingTop: "2px",
    textAlign: "center",
    textShadow: "0 1px 3px rgba(0, 0, 0, 0.9)",
    "& strong": { fontSize: "0.95rem", letterSpacing: "0.02em" },
    "& small": { fontSize: "0.72rem", opacity: 0.85 },
  },
});

/** As salas da dungeon: as que passaram, a de agora e a do chefe (a última). */
const Pips = styled("div", {
  base: {
    display: "flex",
    gap: "5px",
    "& > span": {
      width: "9px",
      height: "9px",
      borderRadius: "50%",
      background: "rgba(255, 255, 255, 0.18)",
      boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.25)",
    },
    "& > span[data-boss]": { borderRadius: "2px", transform: "rotate(45deg)" },
    "& > span[data-done]": { background: "#d9b45a" },
    "& > span[data-now]": {
      background: "#fff",
      boxShadow: "0 0 0 2px rgba(217, 180, 90, 0.9)",
    },
  },
});

const Corner = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "6px",
  },
});

const Clock = styled("span", {
  base: {
    padding: "2px 8px",
    borderRadius: "999px",
    background: "rgba(14, 12, 10, 0.72)",
    fontSize: "0.75rem",
    fontVariantNumeric: "tabular-nums",
  },
});

const Close = styled("button", {
  base: {
    pointerEvents: "auto",
    display: "inline-grid",
    placeItems: "center",
    width: "32px",
    height: "32px",
    border: "none",
    borderRadius: "50%",
    background: "rgba(14, 12, 10, 0.78)",
    color: "inherit",
    cursor: "pointer",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.12)",
    "&:hover": { background: "rgba(40, 34, 28, 0.9)" },
    "&:focus-visible": { outline: "2px solid #d9b45a", outlineOffset: "2px" },
    // A finger needs room: 44 px on touch screens.
    "@media (pointer: coarse)": { width: "44px", height: "44px" },
  },
});

const Fallback = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "0 12px 12px",
    "& p": { margin: 0, opacity: 0.8 },
    "& > div": { width: "100%" },
  },
});

/** Os avisos ficam no terço de cima: o herói e a luta, no meio da cena, seguem à vista. */
const Center = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    display: "grid",
    justifyItems: "center",
    alignItems: "start",
    paddingTop: "clamp(56px, 20%, 140px)",
    pointerEvents: "none",
  },
});

/** O aviso do meio: entra, fica um instante e some (sem movimento: só aparece e some). */
const Banner = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    padding: "10px 28px",
    borderRadius: "12px",
    background:
      "linear-gradient(90deg, rgba(10, 9, 8, 0), rgba(10, 9, 8, 0.82) 20%, rgba(10, 9, 8, 0.82) 80%, rgba(10, 9, 8, 0))",
    textAlign: "center",
    textShadow: "0 2px 4px rgba(0, 0, 0, 0.9)",
    animation: "spacePop 0.3s ease",
    "& small": {
      fontSize: "0.75rem",
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "#d9b45a",
    },
    "& strong": { fontSize: "1.35rem", fontWeight: 700 },
    "&[data-boss] small": { color: "#ff6b5e" },
    "&[data-boss] strong": { color: "#ffd2c8" },
    "&[data-dead] strong": { color: "#ff8a7a" },
    "&[data-dead] small": {
      textTransform: "none",
      letterSpacing: 0,
      color: "#e6dccb",
    },
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  },
});

const Loot = styled("div", {
  base: {
    position: "absolute",
    right: "10px",
    bottom: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "4px",
    pointerEvents: "none",
  },
});

const LootItem = styled("div", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "3px 10px 3px 7px",
    borderRadius: "999px",
    background: "rgba(14, 12, 10, 0.82)",
    boxShadow: "0 0 0 1px rgba(217, 180, 90, 0.45)",
    color: "#f6e7bf",
    fontSize: "0.78rem",
    whiteSpace: "nowrap",
    animation: "spacePop 0.25s ease",
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  },
});

const Outcome = styled("div", {
  base: {
    position: "absolute",
    zIndex: 1,
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: "12px",
    background: "rgba(5, 5, 7, 0.6)",
    overflow: "auto",
  },
});

const Card = styled("div", {
  base: {
    width: "min(460px, 100%)",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "16px 18px",
    borderRadius: "14px",
    background: "rgba(18, 16, 13, 0.96)",
    boxShadow:
      "0 0 0 1px rgba(122, 100, 64, 0.6), 0 10px 30px rgba(0, 0, 0, 0.6)",
    animation: "spacePop 0.3s ease",
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    "& h3": {
      margin: 0,
      textAlign: "center",
      fontSize: "1.4rem",
      letterSpacing: "0.04em",
    },
    "&[data-outcome=vitoria] h3": { color: "#ffd66b" },
    "&[data-outcome=derrota] h3": { color: "#ff8a7a" },
    "& ul": {
      margin: 0,
      padding: 0,
      listStyle: "none",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    },
    "& li": { display: "flex", flexDirection: "column", gap: "3px" },
    "& small": { opacity: 0.75, fontSize: "0.78rem" },
    "& > button": { alignSelf: "center" },
  },
});

const Rewards = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 12px",
    "& > span": { display: "inline-flex", alignItems: "center", gap: "4px" },
  },
});

const Hidden = styled("div", {
  base: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});
