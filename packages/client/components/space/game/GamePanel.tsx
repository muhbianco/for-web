import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { GameWireEvent, SpaceView } from "@muchat/space-client";
import {
  type LobbyLook,
  type ReplaySpeed,
  GameScene,
  HAIRS,
  OUTFITS,
  SKINS,
  TRIMS,
} from "@muchat/space-client/game";
import type { Rotation } from "@muchat/space-core";
import {
  type ClassId,
  type FightInput,
  type FightResult,
  type GameLook,
  type HeroView,
  type Item,
  CLASSES,
  CLASS_IDS,
  RULES,
  SKILL_IDS,
  SLOTS,
  SPELLS,
  WEAPONS,
  degreeUnlocked,
  equipError,
  itemScore,
  lobbyCatalog,
  lobbyItemOf,
  lobbyPlacementError,
  lobbyPrice,
  placedCount,
  sellValue,
} from "@muchat/space-core/game";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { Button, IconButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { Thumb } from "../DecorPanel";
import { RARITY_COLOR, gameLabels } from "./labels";

/**
 * Painel do Refúgio, o RPG idle do Espaço (ADR 0009, etapa E5). Fala com o
 * servidor pela conexão do mapa (`view.gameSend`, nunca uma segunda), desenha
 * a cena numa Application própria (sob demanda, até 30 quadros/s) e mostra em
 * texto tudo o que a cena mostra. Sem som, sem nada da chamada (ESLint e a
 * varredura do space-core barram).
 */

type Tab = "aventura" | "heroi" | "mochila" | "quarto";
type Offers = {
  potion: number | null;
  dummy: { tier: number; cost: number } | null;
};

const SPEED_KEY = "muchat.refugio.speed";

function storedSpeed(): ReplaySpeed {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v === 2 || v === 4 ? v : 1;
  } catch {
    return 1;
  }
}

export default function GamePanel(props: {
  view: SpaceView;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const L = createMemo(() => gameLabels());
  const [hero, setHero] = createSignal<HeroView | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [offers, setOffers] = createSignal<Offers>({
    potion: null,
    dummy: null,
  });
  const [message, setMessage] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<Tab>("aventura");
  const [speed, setSpeedSignal] = createSignal<ReplaySpeed>(storedSpeed());
  const [fighting, setFighting] = createSignal(false);
  const [lastFight, setLastFight] = createSignal<string | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const [placing, setPlacing] = createSignal<{
    item: string;
    rot: Rotation;
    moveId?: string;
  } | null>(null);
  // Herói novo: classe e aparência escolhidas antes de criar.
  const [newCls, setNewCls] = createSignal<ClassId>("cavaleiro");
  const [newLook, setNewLook] = createSignal<GameLook>({
    skin: 1,
    hair: 1,
    outfit: 0,
    trim: 0,
    cosmetic: null,
  });
  /** Diferença entre o relógio do servidor e o daqui (o que vem no game.state). */
  let clockSkew = 0;
  let sceneHost: HTMLDivElement | undefined;
  let scene: GameScene | null = null;
  let disposed = false;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const serverNow = () => now() + clockSkew;
  const send = (tName: string, d?: Record<string, unknown>) => {
    setMessage(null);
    props.view.gameSend(tName, d);
  };

  const lobbyOf = (h: HeroView): LobbyLook => ({
    look: h.look,
    weapon: h.combat.weapon,
    tier: h.training.tier,
    items: h.lobby,
  });

  function showLobby() {
    const h = hero();
    if (!scene) return;
    if (h) scene.showLobby(lobbyOf(h));
    else
      scene.showLobby({
        look: newLook(),
        weapon: CLASSES[newCls()].starter,
        tier: 0,
        items: [],
      });
  }

  async function playFight(d: { input: FightInput; result: FightResult }) {
    const l = L();
    const foes = d.input.foes.map((f) => l.enemy[f]).join(", ");
    setLastFight(
      d.result.won
        ? t`Luta contra ${foes}: vitória em ${(d.result.durationMs / 1000).toFixed(1)} s.`
        : t`Luta contra ${foes}: derrota.`,
    );
    if (!scene) return;
    setFighting(true);
    const h = hero();
    await scene.playFight(d.input, {
      speed: speed(),
      result: d.result,
      look: h ? lobbyOf(h) : undefined,
    });
    if (disposed) return;
    setFighting(false);
    if (!hero()?.run) showLobby();
  }

  function onGame(e: GameWireEvent) {
    if (e.t === "error") {
      const d = e.d as {
        code?: string;
        reason?: string;
        retry_after_ms?: number;
      };
      setMessage(L().error(d.code ?? "internal", d.reason, d.retry_after_ms));
      return;
    }
    if (e.t === "game.fight") {
      void playFight(e.d as { input: FightInput; result: FightResult });
      return;
    }
    const d = e.d as {
      hero: HeroView | null;
      offers: Offers;
      server_now: number;
    };
    clockSkew = d.server_now - Date.now();
    setNow(Date.now());
    setHero(d.hero);
    setOffers(d.offers);
    setLoaded(true);
    if (!fighting() && !d.hero?.run) showLobby();
  }

  onMount(() => {
    const off = props.view.onGame(onGame);
    onCleanup(off);
    props.view.gameSend("game.open");
    void GameScene.mount(sceneHost!, {
      reducedMotion,
      labels: { miss: t`esquiva` },
    }).then((s) => {
      if (disposed) return s.destroy();
      scene = s;
      showLobby();
    });
    // O relógio da tela anda só para os contadores (treino, espera da luta).
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });

  onCleanup(() => {
    disposed = true;
    scene?.destroy();
    scene = null;
  });

  function setSpeed(s: ReplaySpeed) {
    setSpeedSignal(s);
    scene?.setSpeed(s);
    try {
      localStorage.setItem(SPEED_KEY, String(s));
    } catch {
      // Sem armazenamento: só não lembra.
    }
  }

  // ---- decoração: prévia e clique na cena ----
  function onScenePointer(ev: PointerEvent) {
    const p = placing();
    const h = hero();
    if (!p || !h || h.run || fighting() || !scene) return scene?.setGhost(null);
    const tile = scene.tileAt(ev.clientX, ev.clientY);
    if (!tile) return scene.setGhost(null);
    const ok =
      lobbyPlacementError(
        h.lobby,
        { item: p.item, x: tile.x, y: tile.y, rot: p.rot },
        p.moveId,
      ) === null;
    scene.setGhost({ item: p.item, rot: p.rot, x: tile.x, y: tile.y, ok });
  }
  function onSceneClick(ev: MouseEvent) {
    const p = placing();
    if (!p || !scene) return;
    const tile = scene.tileAt(ev.clientX, ev.clientY);
    if (!tile) return;
    if (p.moveId)
      send("game.lobby.move", {
        id: p.moveId,
        x: tile.x,
        y: tile.y,
        rot: p.rot,
      });
    else
      send("game.lobby.place", {
        item: p.item,
        x: tile.x,
        y: tile.y,
        rot: p.rot,
      });
    setPlacing(null);
    scene.setGhost(null);
  }

  // ---- derivados ----
  const busyMs = () =>
    Math.max(0, (hero()?.run?.busy_until ?? 0) - serverNow());
  const pendingTries = () => {
    const h = hero();
    if (!h || h.run) return 0;
    const elapsed = Math.max(
      0,
      Math.min(serverNow() - h.training.since, h.training.cap_ms),
    );
    return Math.floor((elapsed * h.training.tries_per_min10) / 600_000);
  };
  const capReached = () => {
    const h = hero();
    return !!h && serverNow() - h.training.since >= h.training.cap_ms;
  };
  const unlockedDegrees = createMemo(() => {
    const h = hero();
    if (!h) return [];
    const out: {
      value: string;
      degree: "normal" | "dificil" | "pesadelo" | "abismo";
      abyss: number;
    }[] = [];
    for (const d of ["normal", "dificil", "pesadelo"] as const)
      if (degreeUnlocked(h.best, d, 1))
        out.push({ value: d, degree: d, abyss: 1 });
    for (let n = 1; degreeUnlocked(h.best, "abismo", n) && n <= 200; n++)
      out.push({ value: `abismo:${n}`, degree: "abismo", abyss: n });
    return out;
  });
  const [degreeChoice, setDegreeChoice] = createSignal("normal");
  const hurt = () => {
    const h = hero();
    return !!h && h.hp * 100 < h.max_hp * RULES.minStartHpPct;
  };

  function startRun() {
    const c =
      unlockedDegrees().find((d) => d.value === degreeChoice()) ??
      unlockedDegrees()[0];
    if (!c) return;
    send("game.run.start", {
      degree: c.degree,
      ...(c.degree === "abismo" ? { abyss: c.abyss } : {}),
    });
  }

  const offer = <
    K extends NonNullable<NonNullable<HeroView["run"]>["offer"]>["kind"],
  >(
    kind: K,
  ) => {
    const o = hero()?.run?.offer;
    return o && o.kind === kind
      ? (o as Extract<
          NonNullable<NonNullable<HeroView["run"]>["offer"]>,
          { kind: K }
        >)
      : undefined;
  };

  const tabs = (): { id: Tab; label: string }[] => [
    { id: "aventura", label: t`Aventura` },
    { id: "heroi", label: t`Herói` },
    { id: "mochila", label: t`Mochila` },
    { id: "quarto", label: t`Quarto` },
  ];

  return (
    <Panel aria-label={t`Refúgio`} onKeyDown={(e) => e.stopPropagation()}>
      <Head>
        <strong>{t`Refúgio`}</strong>
        <Show when={hero()}>
          {(h) => (
            <Muted>
              {L().cls[h().cls].name} · {t`nível ${h().level}`}
            </Muted>
          )}
        </Show>
        <span style={{ flex: 1 }} />
        <IconButton aria-label={t`Fechar o Refúgio`} onPress={props.onClose}>
          <Symbol>close</Symbol>
        </IconButton>
      </Head>

      {/*
        A cena é DOM imperativo (Pixi): elemento nativo sem filhos JSX, senão o
        Solid limpa o canvas quando um filho dinâmico esvazia (o mapa preto de 13/11).
      */}
      <div
        ref={sceneHost}
        class={sceneBox}
        aria-hidden="true"
        data-placing={placing() ? "" : undefined}
        onPointerMove={onScenePointer}
        onPointerLeave={() => scene?.setGhost(null)}
        onClick={onSceneClick}
      />

      <Show when={message()}>
        <Message role="alert">{message()}</Message>
      </Show>

      <Switch>
        <Match when={!loaded()}>
          <Muted role="status">{t`Abrindo o Refúgio…`}</Muted>
        </Match>
        <Match when={!hero()}>
          <Section>
            <strong>{t`Crie o seu herói`}</strong>
            <Muted>{t`Um herói por conta: ele é o mesmo em todo servidor com o Refúgio ligado.`}</Muted>
            <div role="radiogroup" aria-label={t`Classe`} class={stack}>
              <For each={CLASS_IDS}>
                {(c) => (
                  <ClassCard
                    type="button"
                    role="radio"
                    aria-checked={newCls() === c}
                    data-active={newCls() === c ? "" : undefined}
                    onClick={() => {
                      setNewCls(c);
                      showLobby();
                    }}
                  >
                    <strong>{L().cls[c].name}</strong>
                    <span>{L().cls[c].blurb}</span>
                  </ClassCard>
                )}
              </For>
            </div>
            <LookRow
              label={t`Pele`}
              colors={SKINS}
              value={newLook().skin}
              onPick={(v) => {
                setNewLook({ ...newLook(), skin: v });
                showLobby();
              }}
            />
            <LookRow
              label={t`Cabelo`}
              colors={HAIRS}
              value={newLook().hair}
              onPick={(v) => {
                setNewLook({ ...newLook(), hair: v });
                showLobby();
              }}
            />
            <LookRow
              label={t`Roupa`}
              colors={OUTFITS}
              value={newLook().outfit}
              onPick={(v) => {
                setNewLook({ ...newLook(), outfit: v });
                showLobby();
              }}
            />
            <LookRow
              label={t`Detalhe`}
              colors={TRIMS}
              value={newLook().trim}
              onPick={(v) => {
                setNewLook({ ...newLook(), trim: v });
                showLobby();
              }}
            />
            <Row>
              <Button
                variant="filled"
                onPress={() =>
                  send("game.create", { cls: newCls(), look: newLook() })
                }
              >
                {t`Criar ${L().cls[newCls()].name}`}
              </Button>
            </Row>
          </Section>
        </Match>
        <Match when={hero()}>
          {(h) => (
            <>
              <Vitals>
                <Bar
                  label={t`Vida`}
                  value={h().hp}
                  max={h().max_hp}
                  color="#4dd26a"
                />
                <Bar
                  label={t`Mana`}
                  value={h().mp}
                  max={h().max_mp}
                  color="#4a8cff"
                />
                <Bar
                  label={t`Experiência`}
                  value={h().xp}
                  max={h().xp_next}
                  color="#ffb020"
                />
                <Muted>
                  {t`Ouro ${h().gold.toLocaleString()} · poções ${h().potions}/${RULES.maxPotions}`}
                </Muted>
              </Vitals>

              <Tabs role="tablist" aria-label={t`Seções do Refúgio`}>
                <For each={tabs()}>
                  {(tb) => (
                    <TabButton
                      type="button"
                      role="tab"
                      aria-selected={tab() === tb.id}
                      data-active={tab() === tb.id ? "" : undefined}
                      onClick={() => setTab(tb.id)}
                    >
                      {tb.label}
                    </TabButton>
                  )}
                </For>
              </Tabs>

              <Switch>
                {/* ---------------- Aventura ---------------- */}
                <Match when={tab() === "aventura" && h().run}>
                  {(run) => (
                    <Section role="tabpanel">
                      <strong>
                        {run().initiation
                          ? t`Iniciação`
                          : L().degree(run().degree, run().abyss)}
                        {" · "}
                        {run().row < 0
                          ? t`na entrada`
                          : t`sala ${run().row + 1} de ${run().map.length}`}
                      </strong>
                      <Muted>
                        {t`Vida ${run().hp}/${run().max_hp} · poções ${run().potions} · bolsa: ${run().bag_gold} de ouro e ${run().bag_items.length} itens`}
                      </Muted>
                      <Show
                        when={Object.entries(run().boons).some(
                          ([, v]) => v > 0,
                        )}
                      >
                        <Muted>{t`Bênçãos ativas nesta expedição.`}</Muted>
                      </Show>
                      <Show when={lastFight()}>
                        <Muted role="status">{lastFight()}</Muted>
                      </Show>
                      <Row>
                        <Muted>{t`Velocidade`}</Muted>
                        <For each={[1, 2, 4] as const}>
                          {(s) => (
                            <Chip
                              type="button"
                              data-active={speed() === s ? "" : undefined}
                              aria-pressed={speed() === s}
                              onClick={() => setSpeed(s)}
                            >
                              {s}×
                            </Chip>
                          )}
                        </For>
                        <Show when={fighting()}>
                          <Chip
                            type="button"
                            onClick={() => scene?.skip()}
                          >{t`Pular animação`}</Chip>
                        </Show>
                      </Row>
                      <Show when={busyMs() > 0}>
                        <Muted role="status">{t`A luta ainda passa: ${Math.ceil(busyMs() / 1000)} s.`}</Muted>
                      </Show>
                      <Switch>
                        <Match when={offer("bencao")}>
                          {(o) => (
                            <div class={stack}>
                              <strong>{t`Escolha uma bênção`}</strong>
                              <For each={o().boons}>
                                {(b, i) => (
                                  <Button
                                    variant="tonal"
                                    isDisabled={busyMs() > 0}
                                    onPress={() =>
                                      send("game.run.choose", { option: i() })
                                    }
                                  >
                                    {L().boon[b].name}: {L().boon[b].what}
                                  </Button>
                                )}
                              </For>
                              <Button
                                variant="text"
                                isDisabled={busyMs() > 0}
                                onPress={() =>
                                  send("game.run.choose", { option: -1 })
                                }
                              >{t`Recusar`}</Button>
                            </div>
                          )}
                        </Match>
                        <Match when={offer("descanso")}>
                          {(o) => (
                            <div class={stack}>
                              <strong>{t`Descanso`}</strong>
                              <Button
                                variant="tonal"
                                isDisabled={busyMs() > 0}
                                onPress={() =>
                                  send("game.run.choose", { option: 0 })
                                }
                              >{t`Curar ${RULES.restHealPct}% da vida`}</Button>
                              <Button
                                variant="tonal"
                                isDisabled={busyMs() > 0}
                                onPress={() =>
                                  send("game.run.choose", { option: 1 })
                                }
                              >{t`Afiar: +${RULES.sharpenPct}% de dano`}</Button>
                              <Show when={o().retreat}>
                                <Button
                                  variant="text"
                                  isDisabled={busyMs() > 0}
                                  onPress={() => send("game.run.retreat")}
                                >{t`Retirar-se com a bolsa inteira`}</Button>
                              </Show>
                            </div>
                          )}
                        </Match>
                        <Match when={offer("evento")}>
                          {(o) => {
                            const ev = o;
                            return (
                              <div class={stack}>
                                <strong>
                                  {L().event(ev().event, ev().price).title}
                                </strong>
                                <Row>
                                  <Button
                                    variant="tonal"
                                    isDisabled={busyMs() > 0}
                                    onPress={() =>
                                      send("game.run.choose", { option: 0 })
                                    }
                                  >
                                    {L().event(ev().event, ev().price).yes}
                                  </Button>
                                  <Button
                                    variant="text"
                                    isDisabled={busyMs() > 0}
                                    onPress={() =>
                                      send("game.run.choose", { option: 1 })
                                    }
                                  >{t`Seguir`}</Button>
                                </Row>
                              </div>
                            );
                          }}
                        </Match>
                        <Match when={true}>
                          <div class={stack}>
                            <Show when={offer("loja")}>
                              {(o) => {
                                const shop = o;
                                return (
                                  <Row>
                                    <strong>{t`Loja`}</strong>
                                    <Button
                                      size="xs"
                                      variant="tonal"
                                      isDisabled={busyMs() > 0}
                                      onPress={() =>
                                        send("game.run.choose", { option: 0 })
                                      }
                                    >{t`Poção (${shop().potionPrice})`}</Button>
                                    <Button
                                      size="xs"
                                      variant="tonal"
                                      isDisabled={busyMs() > 0}
                                      onPress={() =>
                                        send("game.run.choose", { option: 1 })
                                      }
                                    >{t`Bênção (${shop().boonPrice})`}</Button>
                                  </Row>
                                );
                              }}
                            </Show>
                            <strong>{t`Para onde?`}</strong>
                            <Row>
                              <For each={run().lanes}>
                                {(lane) => (
                                  <Button
                                    variant="tonal"
                                    isDisabled={busyMs() > 0}
                                    onPress={() =>
                                      send("game.run.go", { lane })
                                    }
                                  >
                                    {
                                      L().node[
                                        run().map[run().row + 1]![lane]!.type
                                      ]
                                    }
                                  </Button>
                                )}
                              </For>
                            </Row>
                          </div>
                        </Match>
                      </Switch>
                      <Row>
                        <Button
                          size="xs"
                          variant="text"
                          onPress={() => send("game.run.abandon")}
                        >
                          {t`Abandonar (conta como derrota)`}
                        </Button>
                      </Row>
                    </Section>
                  )}
                </Match>
                <Match when={tab() === "aventura"}>
                  <Section role="tabpanel">
                    <strong>{t`Treino no boneco (${L().dummy[h().training.tier]})`}</strong>
                    <Row>
                      <label class={field}>
                        {t`Skill treinada`}
                        <select
                          value={h().training.skill}
                          onChange={(e) =>
                            send("game.train", { skill: e.currentTarget.value })
                          }
                        >
                          <For each={SKILL_IDS}>
                            {(s) => (
                              <option value={s}>
                                {L().skill[s]} ({h().skills[s].l})
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                    </Row>
                    <Bar
                      label={t`${L().skill[h().training.skill]} ${h().skills[h().training.skill].l}`}
                      value={h().skills[h().training.skill].p}
                      max={h().skills[h().training.skill].next}
                      color="#b062ff"
                    />
                    <Muted>
                      {capReached()
                        ? t`O boneco chegou ao limite: colete para não perder treino.`
                        : t`+${pendingTries()} tentativas acumuladas; o boneco junta até ${h().training.cap_ms / 3_600_000} h.`}
                    </Muted>
                    <Row>
                      <Button
                        size="xs"
                        variant="tonal"
                        onPress={() => send("game.open")}
                      >{t`Coletar`}</Button>
                      <Show when={offers().dummy}>
                        {(d) => (
                          <Button
                            size="xs"
                            variant="tonal"
                            isDisabled={h().gold < d().cost}
                            onPress={() =>
                              send("game.buy", { offer: "dummy", qty: 1 })
                            }
                          >
                            {t`Boneco ${L().dummy[d().tier]} (${d().cost.toLocaleString()})`}
                          </Button>
                        )}
                      </Show>
                      <Show when={offers().potion}>
                        {(p) => (
                          <Button
                            size="xs"
                            variant="tonal"
                            isDisabled={h().gold < p()}
                            onPress={() =>
                              send("game.buy", { offer: "potion", qty: 1 })
                            }
                          >
                            {t`Poção (${p()})`}
                          </Button>
                        )}
                      </Show>
                    </Row>
                    <strong>{t`Expedição`}</strong>
                    <Show when={h().last_run}>
                      {(lr) => (
                        <Muted>
                          {lr().end === "vitoria"
                            ? t`Última: vitória, +${lr().xp} de experiência, +${lr().gold} de ouro, ${lr().items} itens.`
                            : lr().end === "retirada"
                              ? t`Última: retirada, +${lr().xp} de experiência, +${lr().gold} de ouro, ${lr().items} itens.`
                              : t`Última: derrota. Ficaram ${lr().xp} de experiência e ${lr().gold} de ouro.`}
                        </Muted>
                      )}
                    </Show>
                    <Show
                      when={h().initiation_done}
                      fallback={
                        <Muted>{t`A primeira expedição é a iniciação: curta, para conhecer o caminho.`}</Muted>
                      }
                    >
                      <label class={field}>
                        {t`Degrau`}
                        <select
                          value={degreeChoice()}
                          onChange={(e) =>
                            setDegreeChoice(e.currentTarget.value)
                          }
                        >
                          <For each={unlockedDegrees()}>
                            {(d) => (
                              <option value={d.value}>
                                {L().degree(d.degree, d.abyss)}
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                    </Show>
                    <Show when={hurt()}>
                      <Muted>{t`Ferido: a vida volta sozinha em alguns minutos (precisa de ${RULES.minStartHpPct}%).`}</Muted>
                    </Show>
                    <Row>
                      <Button
                        variant="filled"
                        isDisabled={hurt() || fighting()}
                        onPress={startRun}
                      >
                        <Symbol size={18}>swords</Symbol>{" "}
                        {h().initiation_done
                          ? t`Partir`
                          : t`Começar a iniciação`}
                      </Button>
                    </Row>
                  </Section>
                </Match>

                {/* ---------------- Herói ---------------- */}
                <Match when={tab() === "heroi"}>
                  <Section role="tabpanel">
                    <strong>{L().cls[h().cls].name}</strong>
                    <Muted>{L().cls[h().cls].blurb}</Muted>
                    <Muted>
                      {t`Ataque ${h().combat.atk} · armadura ${h().combat.armor} · crítico ${(h().combat.critBp / 100).toFixed(1)}% · esquiva ${(h().combat.dodgeBp / 100).toFixed(1)}% · bloqueio ${(h().combat.blockBp / 100).toFixed(1)}%`}
                    </Muted>
                    <Muted>
                      {t`FOR ${h().combat.attrs.for} · DES ${h().combat.attrs.des} · INT ${h().combat.attrs.int} · VIT ${h().combat.attrs.vit}`}
                    </Muted>
                    <strong>{t`Skills`}</strong>
                    <For each={SKILL_IDS}>
                      {(s) => (
                        <Bar
                          label={`${L().skill[s]} ${h().skills[s].l}`}
                          value={h().skills[s].p}
                          max={h().skills[s].next}
                          color={
                            s === WEAPONS[h().combat.weapon].skill
                              ? "#b062ff"
                              : "#6c7387"
                          }
                        />
                      )}
                    </For>
                    <Tactics
                      hero={h()}
                      labels={L()}
                      onSave={(order, potionAt, healAt) =>
                        send("game.tactics", {
                          order,
                          potion_at: potionAt,
                          heal_at: healAt,
                        })
                      }
                    />
                  </Section>
                </Match>

                {/* ---------------- Mochila ---------------- */}
                <Match when={tab() === "mochila"}>
                  <Section role="tabpanel">
                    <strong>{t`Equipado`}</strong>
                    <For each={SLOTS}>
                      {(slot) => (
                        <ItemRow
                          style={{
                            "border-color": h().gear[slot]
                              ? RARITY_COLOR[h().gear[slot]!.rarity]
                              : "transparent",
                          }}
                        >
                          <span>
                            <Muted>{L().slot[slot]}: </Muted>
                            {h().gear[slot]
                              ? L().itemName(h().gear[slot]!)
                              : t`vazio`}
                            <Show when={h().gear[slot]}>
                              {(it) => <Small>{L().itemStats(it())}</Small>}
                            </Show>
                          </span>
                          <Show when={h().gear[slot] && !h().run}>
                            <Button
                              size="xs"
                              variant="text"
                              onPress={() => send("game.unequip", { slot })}
                            >{t`Tirar`}</Button>
                          </Show>
                        </ItemRow>
                      )}
                    </For>
                    <strong>{t`Mochila (${h().bag.length}/${h().bag_max})`}</strong>
                    <Show when={h().bag.length === 0}>
                      <Muted>{t`Vazia. Os itens das expedições chegam aqui.`}</Muted>
                    </Show>
                    <For each={[...h().bag, ...h().pending]}>
                      {(it) => (
                        <BagItem
                          item={it}
                          hero={h()}
                          labels={L()}
                          send={send}
                        />
                      )}
                    </For>
                  </Section>
                </Match>

                {/* ---------------- Quarto ---------------- */}
                <Match when={tab() === "quarto"}>
                  <Section role="tabpanel">
                    <Show
                      when={placing()}
                      fallback={
                        <Muted>{t`Escolha um item e clique no quarto, acima, para colocar.`}</Muted>
                      }
                    >
                      {(p) => (
                        <Row>
                          <Muted>{t`Colocando ${lobbyItemOf(p().item)?.name ?? p().item}: clique no quarto.`}</Muted>
                          <Button
                            size="xs"
                            variant="text"
                            onPress={() => {
                              const it = lobbyItemOf(p().item);
                              if (it)
                                setPlacing({
                                  ...p(),
                                  rot: ((p().rot + 1) %
                                    it.rotations) as Rotation,
                                });
                            }}
                          >
                            {t`Girar`}
                          </Button>
                          <Button
                            size="xs"
                            variant="text"
                            onPress={() => {
                              setPlacing(null);
                              scene?.setGhost(null);
                            }}
                          >{t`Cancelar`}</Button>
                        </Row>
                      )}
                    </Show>
                    <strong>{t`No quarto (${h().lobby.length})`}</strong>
                    <For each={h().lobby}>
                      {(li) => (
                        <ItemRow>
                          <span>{lobbyItemOf(li.item)?.name ?? li.item}</span>
                          <Row>
                            <Button
                              size="xs"
                              variant="text"
                              isDisabled={!!h().run}
                              onPress={() =>
                                setPlacing({
                                  item: li.item,
                                  rot: li.rot,
                                  moveId: li.id,
                                })
                              }
                            >{t`Mover`}</Button>
                            <Button
                              size="xs"
                              variant="text"
                              isDisabled={!!h().run}
                              onPress={() =>
                                send("game.lobby.remove", { id: li.id })
                              }
                            >{t`Guardar`}</Button>
                          </Row>
                        </ItemRow>
                      )}
                    </For>
                    <strong>{t`Loja de decoração`}</strong>
                    <For each={lobbyCatalog()}>
                      {(it) => {
                        const have = () => h().decor_owned[it.id] ?? 0;
                        const free = () =>
                          have() - placedCount(h().lobby, it.id);
                        return (
                          <ItemRow>
                            <span class={shopLine}>
                              <Thumb item={it} variant={undefined} size={32} />
                              <span>
                                {it.name}
                                <Small>
                                  {have()
                                    ? t`${have()} seus`
                                    : t`${lobbyPrice(it).toLocaleString()} de ouro`}
                                </Small>
                              </span>
                            </span>
                            <Row>
                              <Show when={free() > 0}>
                                <Button
                                  size="xs"
                                  variant="tonal"
                                  isDisabled={!!h().run}
                                  onPress={() =>
                                    setPlacing({ item: it.id, rot: 0 })
                                  }
                                >{t`Colocar`}</Button>
                              </Show>
                              <Button
                                size="xs"
                                variant="text"
                                isDisabled={
                                  !!h().run || h().gold < lobbyPrice(it)
                                }
                                onPress={() =>
                                  send("game.buy", {
                                    offer: "decor",
                                    qty: 1,
                                    item: it.id,
                                  })
                                }
                              >
                                {t`Comprar`}
                              </Button>
                            </Row>
                          </ItemRow>
                        );
                      }}
                    </For>
                  </Section>
                </Match>
              </Switch>
            </>
          )}
        </Match>
      </Switch>
    </Panel>
  );
}

/** Uma barra com o rótulo e o número em texto (o que a cena mostra também está aqui). */
function Bar(props: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = () =>
    props.max > 0
      ? Math.max(0, Math.min(100, (props.value / props.max) * 100))
      : 0;
  return (
    <BarBox>
      <span>
        {props.label}{" "}
        <Small>
          {props.value.toLocaleString()}/{props.max.toLocaleString()}
        </Small>
      </span>
      <BarTrack
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={props.max}
        aria-valuenow={props.value}
      >
        <i style={{ width: `${pct()}%`, background: props.color }} />
      </BarTrack>
    </BarBox>
  );
}

function LookRow(props: {
  label: string;
  colors: readonly string[];
  value: number;
  onPick: (v: number) => void;
}) {
  return (
    <Row role="radiogroup" aria-label={props.label}>
      <Muted style={{ width: "4.5em" }}>{props.label}</Muted>
      <For each={props.colors}>
        {(c, i) => (
          <Swatch
            type="button"
            role="radio"
            aria-checked={props.value === i()}
            aria-label={`${props.label} ${i() + 1}`}
            data-active={props.value === i() ? "" : undefined}
            style={{ background: c }}
            onClick={() => props.onPick(i())}
          />
        )}
      </For>
    </Row>
  );
}

function BagItem(props: {
  item: Item;
  hero: HeroView;
  labels: ReturnType<typeof gameLabels>;
  send: (t: string, d?: Record<string, unknown>) => void;
}) {
  const { t } = useLingui();
  const err = () => equipError(props.hero.cls, props.hero.level, props.item);
  const better = () =>
    !err() &&
    itemScore(props.item, props.hero.cls) >
      itemScore(props.hero.gear[props.item.slot], props.hero.cls);
  return (
    <ItemRow style={{ "border-color": RARITY_COLOR[props.item.rarity] }}>
      <span>
        {props.labels.itemName(props.item)}{" "}
        <Small>{t`nível ${props.item.ilvl}`}</Small>
        <Show when={better()}>
          {" "}
          <Badge>{t`melhor`}</Badge>
        </Show>
        <Small>{props.labels.itemStats(props.item)}</Small>
        <Show when={err() === "level"}>
          <Small>{t`Precisa do nível ${Math.max(1, props.item.ilvl - 2)}.`}</Small>
        </Show>
      </span>
      <Row>
        <Show when={!err()}>
          <Button
            size="xs"
            variant="tonal"
            isDisabled={!!props.hero.run}
            onPress={() => props.send("game.equip", { item: props.item.id })}
          >{t`Equipar`}</Button>
        </Show>
        <Button
          size="xs"
          variant="text"
          onPress={() => props.send("game.sell", { items: [props.item.id] })}
        >
          {t`Vender (${sellValue(props.item)})`}
        </Button>
      </Row>
    </ItemRow>
  );
}

/** Tática: quais magias e em que ordem, e os limites de poção e cura. */
function Tactics(props: {
  hero: HeroView;
  labels: ReturnType<typeof gameLabels>;
  onSave: (order: string[], potionAt: number, healAt: number) => void;
}) {
  const { t } = useLingui();
  const mine = () => SPELLS.filter((s) => s.cls === props.hero.cls);
  const initial = () =>
    props.hero.tactics.order.length
      ? props.hero.tactics.order
      : mine().map((s) => s.id);
  const [order, setOrder] = createSignal<string[]>(initial());
  const [potionAt, setPotionAt] = createSignal(props.hero.tactics.potion_at);
  const [healAt, setHealAt] = createSignal(props.hero.tactics.heal_at);
  const toggle = (id: string) =>
    setOrder(
      order().includes(id) ? order().filter((x) => x !== id) : [...order(), id],
    );
  const up = (id: string) => {
    const o = [...order()];
    const i = o.indexOf(id);
    if (i > 0) [o[i - 1], o[i]] = [o[i]!, o[i - 1]!];
    setOrder(o);
  };
  return (
    <>
      <strong>{t`Tática`}</strong>
      <Muted>{t`A cada ação, o herói usa a primeira magia pronta da lista; sem nenhuma, ataca.`}</Muted>
      <For
        each={[
          ...order(),
          ...mine()
            .map((s) => s.id)
            .filter((id) => !order().includes(id)),
        ]}
      >
        {(id) => {
          const sp = mine().find((s) => s.id === id);
          return (
            <Show when={sp}>
              {(s) => (
                <ItemRow>
                  <label>
                    <input
                      type="checkbox"
                      checked={order().includes(id)}
                      onChange={() => toggle(id)}
                    />{" "}
                    {props.labels.spell[id] ?? id}{" "}
                    <Small>
                      {s().unlock > props.hero.level
                        ? t`(nível ${s().unlock})`
                        : t`${s().mp} de mana`}
                    </Small>
                  </label>
                  <Show when={order().indexOf(id) > 0}>
                    <IconButton
                      aria-label={t`Subir ${props.labels.spell[id] ?? id}`}
                      onPress={() => up(id)}
                    >
                      <Symbol size={18}>arrow_upward</Symbol>
                    </IconButton>
                  </Show>
                </ItemRow>
              )}
            </Show>
          );
        }}
      </For>
      <Row>
        <label class={field}>
          {t`Poção abaixo de (%)`}
          <input
            type="number"
            min={10}
            max={90}
            step={5}
            value={potionAt()}
            onChange={(e) =>
              setPotionAt(
                Math.min(90, Math.max(10, Number(e.currentTarget.value) || 35)),
              )
            }
          />
        </label>
        <label class={field}>
          {t`Cura abaixo de (%)`}
          <input
            type="number"
            min={10}
            max={90}
            step={5}
            value={healAt()}
            onChange={(e) =>
              setHealAt(
                Math.min(90, Math.max(10, Number(e.currentTarget.value) || 60)),
              )
            }
          />
        </label>
      </Row>
      <Row>
        <Button
          size="xs"
          variant="filled"
          onPress={() =>
            props.onSave(order().slice(0, 6), potionAt(), healAt())
          }
        >{t`Salvar tática`}</Button>
      </Row>
    </>
  );
}

// ---- estilos (mesma família do DecorPanel) ----

const Panel = styled("aside", {
  base: {
    gridArea: "panel",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    overflow: "auto",
    minHeight: 0,
    padding: "var(--gap-md)",
    background: "var(--md-sys-color-surface-container-low)",
    color: "var(--md-sys-color-on-surface)",
    fontSize: "0.9rem",
  },
});

const Head = styled("div", {
  base: { display: "flex", alignItems: "center", gap: "var(--gap-xs)" },
});

const sceneBox = css({
  height: "248px",
  flex: "none",
  borderRadius: "10px",
  overflow: "hidden",
  background: "#14151c",
  "&[data-placing]": { cursor: "crosshair" },
  "& > canvas": { display: "block" },
});

const Message = styled("div", {
  base: {
    padding: "6px 10px",
    borderRadius: "8px",
    background: "var(--md-sys-color-error-container)",
    color: "var(--md-sys-color-on-error-container)",
    fontSize: "0.85em",
  },
});

const Section = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-xs)",
    padding: "var(--gap-sm)",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
  },
});

const Row = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});

const Small = styled("small", {
  base: {
    display: "block",
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.78em",
  },
});

const Vitals = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "4px" },
});

const BarBox = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "0.82em",
  },
});

const BarTrack = styled("div", {
  base: {
    height: "6px",
    borderRadius: "3px",
    overflow: "hidden",
    background: "var(--md-sys-color-surface-container-highest)",
    "& > i": { display: "block", height: "100%" },
  },
});

const Tabs = styled("div", {
  base: { display: "flex", gap: "4px", flexWrap: "wrap" },
});

const TabButton = styled("button", {
  base: {
    padding: "5px 12px",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    "&[data-active]": {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
      borderColor: "transparent",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Chip = styled("button", {
  base: {
    padding: "3px 9px",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: "0.8em",
    cursor: "pointer",
    "&[data-active]": {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
      borderColor: "transparent",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const ClassCard = styled("button", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "2px",
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    "& > span": {
      fontSize: "0.82em",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "&[data-active]": {
      outline: "2px solid var(--md-sys-color-primary)",
      borderColor: "transparent",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Swatch = styled("button", {
  base: {
    width: "22px",
    height: "22px",
    borderRadius: "6px",
    border: "2px solid transparent",
    cursor: "pointer",
    "&[data-active]": { borderColor: "var(--md-sys-color-primary)" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const ItemRow = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    padding: "4px 6px",
    borderRadius: "8px",
    borderLeft: "3px solid transparent",
    background: "var(--md-sys-color-surface-container-low)",
  },
});

const Badge = styled("span", {
  base: {
    padding: "0 6px",
    borderRadius: "999px",
    fontSize: "0.75em",
    background: "var(--md-sys-color-tertiary-container)",
    color: "var(--md-sys-color-on-tertiary-container)",
  },
});

const stack = css({ display: "flex", flexDirection: "column", gap: "6px" });

const field = css({
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  fontSize: "0.85em",
  "& select, & input": {
    padding: "4px 6px",
    borderRadius: "6px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-lowest)",
    color: "inherit",
    font: "inherit",
  },
});

const shopLine = css({ display: "flex", alignItems: "center", gap: "8px" });
