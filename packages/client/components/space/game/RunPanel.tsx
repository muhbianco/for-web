import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import {
  type OwnedItem,
  type RpgHeroState,
  type RpgLobbyView,
  type RpgRunMemberEnd,
  CLASSES,
  FOE_BASE,
  buyBackPrice,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { ItemTip } from "./ItemTip";
import { CLASS_ICON, RunHud } from "./RunHud";
import { RunScene } from "./RunScene";
import { StatusIcons } from "./StatusIcons";
import {
  kindName,
  mechanicHint,
  mechanicName,
  rarityName,
  slotName,
} from "./gameText";
import { type GameLink, Gold, Grip, ItemIcon, useCommands } from "./gameUi";
import { BOSS_ARCHETYPES, bagMarks, gold, num } from "./heroModel";
import {
  dungeonName,
  loopStopText,
  outcomeText,
  prepText,
  startView,
} from "./partyUi";
import { feedLine, runCast } from "./runUi";
import { useWide, useWindowDrag } from "./windowDrag";

/** Quanto um aviso do meio (sala nova, mecânica) fica à vista, em segundos da corrida. */
const TOAST_S = 2;
const ROOMS = 4;

/**
 * A tela da corrida no jeito do Diablo (o arranjo da tela de 24/11/2026, que o dono preferia, agora
 * sobre a engine v5). A cena (Pixi) ocupa o painel; por cima dela, à esquerda, o meu retrato (classe,
 * nível, job e Proficiência) e os companheiros com vida e mana; no meio, a DG e as 4 salas; no
 * chefe, a barra dele com os buffs — o Cataclismo cresce uma marca por pulso (D24); à direita, sair
 * e fechar. No meio da cena, os avisos que passam (sala, mecânica, queda); embaixo, o painel com os
 * cristais, o cinto, as habilidades e as barras de nível e job. Sem relógio da corrida (D21). Não
 * bloqueia o mapa. Sem WebGL, barras de texto no lugar da cena.
 */
export default function RunPanel(props: {
  state: RunState;
  myId: string | null;
  hero: RpgHeroState | null;
  link: GameLink;
  lobby: RpgLobbyView | null;
  paletteOf?: (userId: string) => number;
  /** O relógio do servidor agora (a contagem da largada vem nele). */
  serverNow?: () => number;
  /** O medidor (janela à parte): aberto? e o botão que abre e fecha. */
  meterOpen?: boolean;
  onMeter?: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [sceneFailed, setSceneFailed] = createSignal(false);
  const [confirmLeave, setConfirmLeave] = createSignal(false);
  // O resumo do fim (o loot) fecha sozinho e a tela fica (26/11/2026: fechar o resumo fechava a
  // corrida inteira). Volta pelo botão "Resumo". Corrida nova: o resumo dela aparece de novo.
  const [cardHidden, setCardHidden] = createSignal(false);
  createEffect(on(() => props.state.run.id, () => setCardHidden(false)));
  let stayBtn: HTMLButtonElement | undefined;
  // Arrastável (pedido do dono, 25/11/2026): pelo título ou pela alça; presa à área do mapa.
  // No celular o painel ocupa a largura toda e não arrasta.
  let panel: HTMLDivElement | undefined;
  const wide = useWide(() => panel?.parentElement ?? undefined, 600);
  const drag = useWindowDrag({
    id: "rpg-run",
    win: () => panel,
    bounds: () => panel?.parentElement,
    enabled: wide,
  });

  const st = () => props.state;
  const run = () => st().run;
  const frame = () => st().frame;
  const end = () => st().end;
  const room = () => frame()?.st ?? 0;
  const dg = () => dungeonById(run().dungeon);
  const cast = createMemo(() => runCast(st()));
  const meIndex = () =>
    run().members.findIndex((m) => m.user_id === props.myId);
  const isMember = () => meIndex() >= 0;
  /** Quem o painel de baixo mostra: eu, ou o 1º do grupo para quem assiste. */
  const focus = () => Math.max(0, meIndex());
  const focusMember = () => run().members[focus()]!;
  const hpOf = (i: number) => frame()?.h[i] ?? run().members[i]?.hp_max ?? 0;
  const focusDead = () => !!frame() && hpOf(focus()) <= 0;
  const lowLife = () => {
    const m = focusMember();
    return !!frame() && !focusDead() && hpOf(focus()) / m.hp_max < 0.3;
  };
  const resting = () =>
    !!frame()?.e.some((e) => e.k === "descanso") ||
    (!!frame() && frame()!.x.length === 0);
  const myHero = () => (isMember() ? (props.hero?.hero ?? null) : null);
  /** A largada da próxima (o loop ou o líder) esperando por cima desta corrida que acabou. */
  const pendingHere = () =>
    !!end() &&
    !!props.lobby?.pending &&
    props.lobby.members.some((m) => m.user_id === props.myId);
  // A largada pediu: o resumo sai da frente (ele já ficou à vista enquanto o grupo via o loot).
  createEffect(
    on(pendingHere, (p, was) => {
      if (p && !was) setCardHidden(true);
    }),
  );

  /** O alvo do meu herói (o monstro em que bati por último nesta sala), fora da sala do chefe. */
  const [target, setTarget] = createSignal<{ room: number; i: number } | null>(
    null,
  );
  createEffect(
    on(frame, (f) => {
      if (!f) return;
      const me = focus();
      let hit: number | null = null;
      for (const e of f.e)
        if (
          (e.k === "golpe" || (e.k === "magia" && !e.cura)) &&
          e.a === me &&
          e.b >= FOE_BASE
        ) {
          hit = e.b;
          break;
        }
      const cur = target();
      if (hit !== null) setTarget({ room: f.st, i: hit - FOE_BASE });
      else if (cur && (cur.room !== f.st || (f.x[cur.i] ?? 0) <= 0))
        setTarget(null);
    }),
  );
  const targetView = () => {
    const tg = target();
    const f = frame();
    if (!tg || !f || boss() || tg.room !== f.st) return null;
    const hp = f.x[tg.i] ?? 0;
    if (hp <= 0) return null;
    const e = cast().enemyOf(tg.room, tg.i);
    return {
      name: cast().enemyName(tg.room, tg.i),
      hp,
      max: e?.hp ?? hp,
      level: e?.level ?? 0,
      statuses: f.u?.x[tg.i],
      aim: aimOf(tg.i),
    };
  };
  /** Quem o monstro mira agora (o nome do herói), pela ameaça do quadro (26/11/2026). */
  function aimOf(i: number): string | null {
    const g = frame()?.g?.[i];
    return g && g.a >= 0 ? (run().members[g.a]?.name ?? null) : null;
  }
  const bossIndex = () => {
    if (room() < ROOMS - 1) return -1;
    return (
      cast().rooms[room()]?.findIndex((e) => BOSS_ARCHETYPES.has(e.archetype)) ??
      -1
    );
  };

  // Avisos do meio: a sala nova e a mecânica, por TOAST_S segundos da corrida.
  const lastRoomAt = () => {
    const f = st().feed;
    for (let i = f.length - 1; i >= 0; i--)
      if (f[i]!.k === "sala") return f[i]!.at;
    return -99;
  };
  const roomToast = () => !!frame() && frame()!.s - lastRoomAt() <= TOAST_S;
  const mechanicNow = () => {
    const m = st().mechanic;
    const f = frame();
    return m && f && f.s - m.at <= TOAST_S ? m : null;
  };

  // O chefe: a vida e os buffs (só na última sala).
  const boss = () => {
    const f = frame();
    // Acabou: a barra do chefe (vazia) sai junto com a luta.
    if (!f || end() || room() < ROOMS - 1) return null;
    const i =
      cast().rooms[room()]?.findIndex((e) =>
        BOSS_ARCHETYPES.has(e.archetype),
      ) ?? -1;
    if (i < 0) return null;
    const e = cast().rooms[room()]![i]!;
    return {
      name: cast().enemyName(room(), i),
      hp: f.x[i] ?? 0,
      max: e.hp,
      level: e.level,
    };
  };
  const phased = () =>
    st().feed.some(
      (f) => f.k === "mecanica" && f.s === "fase" && f.st === room(),
    );

  /** Leitor de tela: só o que muda de sala, a mecânica, a queda e o fim. */
  const announce = createMemo(() => {
    if (end()) return outcomeText(end()!.outcome);
    const f = frame();
    const big = f?.e.find(
      (e) => e.k === "queda" || e.k === "mecanica" || e.k === "sala",
    );
    return big
      ? (feedLine(st(), cast(), { ...big, at: f!.s, st: f!.st } as never)
          ?.text ?? "")
      : "";
  });

  /** Os companheiros: classe, nome, níveis, vida, mana e as poções que sobram. */
  const mates = () => (
    <For each={run().members}>
      {(m, i) => (
        <Show when={i() !== focus()}>
          <Mate
            data-dead={frame() && hpOf(i()) <= 0 ? "" : undefined}
            title={`${m.name} · ${CLASSES[m.cls].titles[1]}`}
          >
            <span>
              <Symbol size={14}>{CLASS_ICON[m.cls]}</Symbol> {m.name}
            </span>
            <small>
              {t`Nv ${m.level}`}
              <Show when={m.job}> · {t`Job ${m.job}`}</Show>
              <Show when={m.proficiency}>
                {" "}
                · {t`Prof ${num(m.proficiency ?? 0)}`}
              </Show>
            </small>
            <Meter
              role="meter"
              aria-label={t`Vida de ${m.name}`}
              aria-valuemin={0}
              aria-valuemax={m.hp_max}
              aria-valuenow={Math.round(hpOf(i()))}
              data-low={hpOf(i()) / m.hp_max < 0.3 ? "" : undefined}
            >
              <span style={{ width: `${pctOf(hpOf(i()), m.hp_max)}%` }} />
            </Meter>
            <Meter
              data-mana=""
              role="meter"
              aria-label={t`Mana de ${m.name}`}
              aria-valuemin={0}
              aria-valuemax={m.mp_max}
              aria-valuenow={Math.round(frame()?.m[i()] ?? m.mp_max)}
            >
              <span
                style={{
                  width: `${pctOf(frame()?.m[i()] ?? m.mp_max, m.mp_max)}%`,
                }}
              />
            </Meter>
            <small data-pots="">
              ♥ {st().potions[i()]?.hp ?? 0} · ✦ {st().potions[i()]?.mp ?? 0}
            </small>
            <Show when={!end()}>
              <StatusIcons
                list={frame()?.u?.h[i()]}
                members={run().members}
                own={m.cls}
                label={t`Efeitos em ${m.name}`}
                size="sm"
                max={7}
              />
            </Show>
          </Mate>
        </Show>
      )}
    </For>
  );

  const leave = async () => {
    const r = await cmd.run("rpg.run.leave");
    if (r?.ok) {
      setConfirmLeave(false);
      props.onClose();
    }
  };

  return (
    <Panel
      ref={panel}
      style={drag.style()}
      data-dragging={drag.dragging() ? "" : undefined}
      data-covers-map=""
      role="region"
      aria-label={t`Dungeon em andamento: ${dungeonName(run().dungeon)}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (confirmLeave()) setConfirmLeave(false);
          else props.onClose();
        }
      }}
    >
      <Screen
        data-low={lowLife() ? "" : undefined}
        data-dead={focusDead() && !end() ? "" : undefined}
        data-failed={sceneFailed() ? "" : undefined}
      >
        <RunScene
          state={st()}
          myId={props.myId}
          paletteOf={props.paletteOf}
          onFailed={() => setSceneFailed(true)}
        />
        <Vignette aria-hidden="true" />

        {/* Em cima: retratos à esquerda, a DG e as salas no meio, sair e fechar à direita. */}
        <Top>
          <Frames>
            <Portrait data-dead={focusDead() ? "" : undefined}>
              <Avatar aria-hidden="true">
                <Symbol size={22}>{CLASS_ICON[focusMember().cls]}</Symbol>
                <LevelBadge>{focusMember().level}</LevelBadge>
              </Avatar>
              <div>
                <strong>
                  {isMember()
                    ? focusMember().name
                    : t`Assistindo ${focusMember().name}`}
                </strong>
                <small>{CLASSES[focusMember().cls].titles[1]}</small>
                <Levels>
                  <span data-kind="level">{t`Nv ${focusMember().level}`}</span>
                  <span data-kind="job">{t`Job ${myHero()?.job ?? focusMember().job ?? "?"}`}</span>
                  <span data-kind="prof">{t`Prof ${num(myHero()?.proficiency ?? focusMember().proficiency ?? 0)}`}</span>
                </Levels>
              </div>
            </Portrait>
            <Show when={!end()}>
              <StatusIcons
                list={frame()?.u?.h[focus()]}
                members={run().members}
                own={focusMember().cls}
                label={t`Efeitos em ${focusMember().name}`}
                max={10}
              />
            </Show>
            <Mates data-where="top">{mates()}</Mates>
          </Frames>

          <Title
            data-title=""
            {...drag.handle}
            data-draggable={wide() ? "" : undefined}
          >
            <strong>{dungeonName(run().dungeon)}</strong>
            <Pips
              aria-label={
                end()
                  ? outcomeText(end()!.outcome)
                  : resting()
                    ? t`Descanso`
                    : room() >= ROOMS - 1
                      ? t`Sala do chefe`
                      : t`Sala ${room() + 1} de 4`
              }
            >
              <For each={Array.from({ length: ROOMS })}>
                {(_, i) => (
                  <span
                    data-done={
                      i() < room() || (end() && end()!.outcome === "vitoria")
                        ? ""
                        : undefined
                    }
                    data-now={i() === room() && !end() ? "" : undefined}
                    data-boss={i() === ROOMS - 1 ? "" : undefined}
                  />
                )}
              </For>
            </Pips>
            <small>
              {dg() ? kindName(dg()!.kind) : ""}
              {" · "}
              {end()
                ? outcomeText(end()!.outcome)
                : resting()
                  ? t`descanso`
                  : room() >= ROOMS - 1
                    ? t`o chefe`
                    : t`sala ${room() + 1} de 4`}
            </small>
            <Show when={boss()}>
              {(b) => (
                <BossBar>
                  <div>
                    <strong>{b().name}</strong>
                    <Show when={aimOf(bossIndex())}>
                      {(n) => <Aim>{t`mirando ${n()}`}</Aim>}
                    </Show>
                    <small>{t`Nv ${b().level}`}</small>
                  </div>
                  <Meter
                    data-foe=""
                    data-boss=""
                    role="meter"
                    aria-label={t`Vida de ${b().name}`}
                    aria-valuemin={0}
                    aria-valuemax={b().max}
                    aria-valuenow={b().hp}
                  >
                    <span style={{ width: `${pctOf(b().hp, b().max)}%` }} />
                  </Meter>
                  <Buffs>
                    <Show when={st().cataclysm > 0}>
                      <Buff
                        data-kind="cataclismo"
                        style={{ "--n": String(Math.min(10, st().cataclysm)) }}
                        title={t`Cataclismo: a cada pulso o chefe tira 40% da vida máxima de cada herói, até o fim.`}
                      >
                        ☠ {t`Cataclismo`} ×{st().cataclysm}
                      </Buff>
                    </Show>
                    <Show when={phased()}>
                      <Buff data-kind="fase">▲ {t`Fase nova`}</Buff>
                    </Show>
                  </Buffs>
                  <Centered>
                    <StatusIcons
                      list={frame()?.u?.x[bossIndex()]}
                      members={run().members}
                      own={null}
                      label={t`Efeitos em ${b().name}`}
                      max={10}
                    />
                  </Centered>
                </BossBar>
              )}
            </Show>
            <Show when={!end() && targetView()}>
              {(tg) => (
                <TargetBox aria-label={t`Seu alvo: ${tg().name}`}>
                  <div>
                    <strong>{tg().name}</strong>
                    <Show when={tg().aim}>
                      {(n) => <Aim>{t`mirando ${n()}`}</Aim>}
                    </Show>
                    <small>{t`Nv ${tg().level}`}</small>
                  </div>
                  <Meter
                    data-foe=""
                    role="meter"
                    aria-label={t`Vida de ${tg().name}`}
                    aria-valuemin={0}
                    aria-valuemax={tg().max}
                    aria-valuenow={tg().hp}
                  >
                    <span style={{ width: `${pctOf(tg().hp, tg().max)}%` }} />
                  </Meter>
                  <Centered>
                    <StatusIcons
                      list={tg().statuses}
                      members={run().members}
                      own={null}
                      label={t`Efeitos em ${tg().name}`}
                      size="sm"
                      max={8}
                    />
                  </Centered>
                </TargetBox>
              )}
            </Show>
          </Title>

          <Corner>
            {/* Na confirmação de sair a alça sai da frente (o canto já fica cheio). */}
            <Show when={wide() && !confirmLeave()}>
              <Grip onKey={drag.onGripKey} />
            </Show>
            <Show when={end() && cardHidden()}>
              <Pill
                type="button"
                title={t`Ver o resumo e o loot desta corrida`}
                onClick={() => setCardHidden(false)}
              >
                <Symbol size={18}>inventory_2</Symbol>
                <span>{t`Resumo`}</span>
              </Pill>
            </Show>
            <Show when={props.onMeter && !confirmLeave()}>
              <Pill
                type="button"
                data-round=""
                aria-pressed={!!props.meterOpen}
                aria-label={t`Medidor: dano, dano recebido e cura`}
                title={t`Medidor: dano, dano recebido e cura`}
                onClick={() => props.onMeter?.()}
              >
                <Symbol size={20}>bar_chart</Symbol>
              </Pill>
            </Show>
            <Show when={isMember() && !end()}>
              <Show
                when={confirmLeave()}
                fallback={
                  <Pill
                    type="button"
                    title={t`Sair da corrida e abrir mão da recompensa`}
                    onClick={() => {
                      setConfirmLeave(true);
                      queueMicrotask(() => stayBtn?.focus());
                    }}
                  >
                    <Symbol size={18}>logout</Symbol>
                    <span>{t`Sair`}</span>
                  </Pill>
                }
              >
                <ConfirmBox role="alertdialog" aria-label={t`Sair da corrida?`}>
                  <span>{t`Sair e perder a recompensa desta corrida?`}</span>
                  <Pill
                    type="button"
                    data-danger=""
                    disabled={cmd.busy()}
                    onClick={leave}
                  >
                    {t`Sair`}
                  </Pill>
                  <Pill
                    type="button"
                    ref={stayBtn}
                    onClick={() => setConfirmLeave(false)}
                  >
                    {t`Ficar`}
                  </Pill>
                </ConfirmBox>
              </Show>
            </Show>
            <Pill
              type="button"
              data-round=""
              aria-label={t`Fechar`}
              onClick={props.onClose}
            >
              <Symbol size={20}>close</Symbol>
            </Pill>
          </Corner>
          <Show when={cmd.error()}>
            {(msg) => <ErrorLine role="alert">{msg()}</ErrorLine>}
          </Show>
        </Top>

        {/* Sem WebGL: as barras de texto no lugar da cena. */}
        <Show when={sceneFailed()}>
          <Fallback>
            <p role="status">{t`A vista da dungeon não abriu neste aparelho; segue o resumo em barras.`}</p>
            <For each={frame()?.x ?? []}>
              {(hp, i) => (
                <Mate data-dead={hp <= 0 ? "" : undefined}>
                  <span>{cast().enemyName(room(), i())}</span>
                  <Meter data-foe="">
                    <span
                      style={{
                        width: `${pctOf(hp, cast().enemyOf(room(), i())?.hp ?? hp)}%`,
                      }}
                    />
                  </Meter>
                </Mate>
              )}
            </For>
          </Fallback>
        </Show>

        {/* Os avisos do meio: um por vez, do mais importante ao mais comum. */}
        <Center aria-hidden="true">
          <Show when={!end()}>
            <Show
              when={focusDead()}
              fallback={
                <Show
                  when={mechanicNow()}
                  fallback={
                    <For each={roomToast() ? [lastRoomAt()] : []}>
                      {() => (
                        <Banner
                          data-boss={room() >= ROOMS - 1 ? "" : undefined}
                        >
                          <small>
                            {room() >= ROOMS - 1
                              ? t`Chefe`
                              : t`Sala ${room() + 1} de 4`}
                          </small>
                          <strong>
                            {room() >= ROOMS - 1
                              ? (boss()?.name ?? t`Chefe`)
                              : (dg()?.region.name ?? "")}
                          </strong>
                        </Banner>
                      )}
                    </For>
                  }
                >
                  {(m) => (
                    <For each={[m().at]}>
                      {() => (
                        <Banner data-warn="">
                          <small>{t`O chefe prepara`}</small>
                          <strong>⚠ {mechanicName(m().s)}</strong>
                          <em>
                            {mechanicHint(m().s)}
                            {m().b !== undefined && m().b! < FOE_BASE
                              ? ` ${t`Alvo`}: ${cast().heroName(m().b!)}.`
                              : ""}
                          </em>
                        </Banner>
                      )}
                    </For>
                  )}
                </Show>
              }
            >
              <Banner data-dead="">
                <strong>
                  {isMember() ? t`Você caiu` : t`${focusMember().name} caiu`}
                </strong>
                <em>{t`Leva o que rendeu até cair; o grupo segue.`}</em>
              </Banner>
            </Show>
          </Show>
        </Center>

        <Show when={pendingHere() && props.lobby}>
          {(l) => (
            <StartOverlay
              lobby={l()}
              myId={props.myId}
              link={props.link}
              serverNow={props.serverNow ?? Date.now}
            />
          )}
        </Show>
        <Show when={end() && !cardHidden()}>
          <Outcome role="dialog" aria-label={outcomeText(end()!.outcome)}>
            <EndCard
              outcome={end()!.outcome}
              members={end()!.members}
              state={st()}
              myId={props.myId}
              hero={props.hero}
              lobby={props.lobby}
              link={props.link}
              onClose={() => setCardHidden(true)}
            />
          </Outcome>
        </Show>
      </Screen>

      <Show when={run().members.length > 1}>
        <Mates data-where="strip">{mates()}</Mates>
      </Show>

      <Show when={frame()}>
        {(f) => (
          <RunHud
            member={focusMember()}
            index={focus()}
            frame={f()}
            state={st()}
            hero={myHero()}
          />
        )}
      </Show>

      {/* Para leitor de tela: o grupo e os monstros em texto (a tela é visual). */}
      <Hidden>
        <section aria-label={t`Grupo`}>
          <For each={run().members}>
            {(m, i) => (
              <p>{t`${m.name}, ${CLASSES[m.cls].titles[1]} nível ${m.level}: vida ${num(hpOf(i()))} de ${num(m.hp_max)}`}</p>
            )}
          </For>
        </section>
        <section aria-label={t`Monstros`}>
          <For each={frame()?.x ?? []}>
            {(hp, i) => <p>{`${cast().enemyName(room(), i())}: ${num(hp)}`}</p>}
          </For>
        </section>
      </Hidden>
      <Hidden role="status">{announce()}</Hidden>
    </Panel>
  );
}

/** O item em texto, para quem ouve a tela (o ícone sozinho é só desenho). */
const itemLabel = (it: OwnedItem) =>
  `${rarityName(it.rarity)} ${slotName(it.slot as never)} +${it.refine}`;

/** O fim por cima da cena: o resultado, o que cada um levou e o grupo (jogar de novo, repetir). */
function EndCard(props: {
  outcome: string;
  members: RpgRunMemberEnd[];
  state: RunState;
  myId: string | null;
  hero: RpgHeroState | null;
  lobby: RpgLobbyView | null;
  link: GameLink;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const nameOf = (id: string) =>
    props.state.run.members.find((m) => m.user_id === id)?.name ?? "?";
  const marks = createMemo(() => (props.hero ? bagMarks(props.hero.hero) : {}));
  const win = () => props.outcome === "vitoria";
  // O grupo depois desta corrida (não a corrida dele que ainda está fechando).
  const party = () => {
    const l = props.lobby;
    if (!l || !l.members.some((m) => m.user_id === props.myId)) return null;
    if (l.state === "running" && l.run_id === props.state.run.id) return null;
    return l;
  };
  const leader = () => party()?.leader === props.myId;
  return (
    <Card data-outcome={props.outcome}>
      <h3>
        {win()
          ? t`Vitória!`
          : props.outcome === "derrota"
            ? t`O grupo caiu`
            : outcomeText(props.outcome)}
      </h3>
      <Show when={!win()}>
        <small>{t`Ninguém perde XP ao cair: leva o que rendeu até cair, sem o bônus de fim.`}</small>
      </Show>
      <ul>
        <For each={props.members}>
          {(m) => (
            <li data-me={m.user_id === props.myId ? "" : undefined}>
              <div>
                <strong>{nameOf(m.user_id)}</strong>
                <Show when={m.levels_gained > 0}>
                  <Up>{t`+${m.levels_gained} nível!`}</Up>
                </Show>
                <Show when={m.jobs_gained > 0}>
                  <Up>{t`+${m.jobs_gained} job`}</Up>
                </Show>
                <Show when={m.dead}>
                  <small>{t`caiu`}</small>
                </Show>
              </div>
              <Show
                when={m.reward}
                fallback={
                  <small>
                    {m.retreated
                      ? t`Saiu antes e abriu mão da recompensa.`
                      : t`Sem recompensa.`}
                  </small>
                }
              >
                {(r) => (
                  <>
                    <Rewards>
                      <span>
                        <Symbol size={16}>star</Symbol>
                        {t`${num(r().xp)} XP`}
                      </span>
                      <span>{t`${num(r().job_xp)} de job`}</span>
                      <Gold n={gold(r().gold)} />
                      <For each={Object.entries(r().ores)}>
                        {([mat, n]) => (
                          <span>{t`${n ?? 0} minério de ${mat}`}</span>
                        )}
                      </For>
                      <Show when={r().stones > 0}>
                        <span>{t`${r().stones} Pedra de Proteção`}</span>
                      </Show>
                    </Rewards>
                    <Show when={r().items.length > 0}>
                      <Items>
                        <For each={r().items}>
                          {(it: OwnedItem) => {
                            const mine = m.user_id === props.myId;
                            return (
                              <ItemTip
                                item={it}
                                hero={mine ? (props.hero?.hero ?? null) : null}
                                price={mine ? buyBackPrice(it) : undefined}
                              >
                                {(bind) => (
                                  <ItemIcon
                                    {...bind}
                                    tabIndex={0}
                                    role="img"
                                    aria-label={itemLabel(it)}
                                    item={it}
                                    mark={
                                      mine ? marks()[it.uid]?.mark : undefined
                                    }
                                  />
                                )}
                              </ItemTip>
                            );
                          }}
                        </For>
                      </Items>
                    </Show>
                  </>
                )}
              </Show>
              <Show when={m.left.length > 0}>
                <small>
                  ⚠{" "}
                  {t`${m.left.length} itens ficaram na dungeon: a mochila estava cheia.`}
                </small>
              </Show>
              <small>
                {t`Gastou ${m.potions_used.hp} poções de vida e ${m.potions_used.mp} de mana`}
                {m.ammo_used > 0 ? ` · ${t`${num(m.ammo_used)} flechas`}` : ""}
              </small>
            </li>
          )}
        </For>
      </ul>
      <Show when={party()}>
        {(l) => (
          <PartyBox role="group" aria-label={t`Grupo`}>
            <Show when={loopStopText(l())}>
              {(msg) => <p role="status">⚠ {msg()}</p>}
            </Show>
            <Show
              when={leader()}
              fallback={
                <p>
                  {l().loop
                    ? t`Repetir ligado: a próxima começa sozinha.`
                    : t`Aguardando quem lidera começar a próxima.`}
                </p>
              }
            >
              <PartyRow>
                <Pill
                  type="button"
                  data-primary=""
                  disabled={cmd.busy()}
                  onClick={() => void cmd.run("rpg.lobby.start")}
                >
                  {t`Jogar de novo`}
                </Pill>
                <LoopToggle>
                  <input
                    id="rpg-outcome-loop"
                    type="checkbox"
                    role="switch"
                    checked={!!l().loop}
                    disabled={cmd.busy()}
                    onChange={(e) =>
                      void cmd.run("rpg.lobby.loop", {
                        on: e.currentTarget.checked,
                      })
                    }
                  />
                  <label for="rpg-outcome-loop">{t`Repetir sem parar`}</label>
                </LoopToggle>
              </PartyRow>
            </Show>
          </PartyBox>
        )}
      </Show>
      <Show when={cmd.error()}>
        {(msg) => <ErrorLine role="alert">{msg()}</ErrorLine>}
      </Show>
      <Pill type="button" data-primary="" onClick={props.onClose}>
        {t`Fechar o resumo`}
      </Pill>
    </Card>
  );
}

/**
 * A largada esperando (26/11/2026), num quadro esmaecido no meio da tela da corrida: quem ainda
 * está na ficha ou num NPC (a corrida não sai enquanto alguém se equipa), depois a contagem de
 * 3 s. Quem lidera pode desistir. Serve à tela da corrida que acabou (o loop) e à largada sem
 * corrida ainda (grupo novo).
 */
export function StartOverlay(props: {
  lobby: RpgLobbyView;
  myId: string | null;
  link: GameLink;
  serverNow: () => number;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [now, setNow] = createSignal(props.serverNow());
  const timer = setInterval(() => setNow(props.serverNow()), 200);
  onCleanup(() => clearInterval(timer));
  const view = () => startView(props.lobby, now());
  const mine = () => view()?.waiting.find((w) => w.name === myName());
  const myName = () =>
    props.lobby.members.find((m) => m.user_id === props.myId)?.name ?? "";
  const leader = () => props.lobby.leader === props.myId;
  return (
    <Show when={view()}>
      {(v) => (
        <Dim role="status" aria-live="polite">
          <Box>
            <Show
              when={v().waiting.length > 0}
              fallback={
                <>
                  <small>{t`A corrida começa em`}</small>
                  <Count data-zero={v().secs === 0 ? "" : undefined}>
                    {v().secs && v().secs! > 0 ? v().secs : "⚔"}
                  </Count>
                  <small>{dungeonName(props.lobby.dungeon)}</small>
                </>
              }
            >
              <Symbol size={28}>hourglass_top</Symbol>
              <strong>{t`Aguardando os heróis se equiparem`}</strong>
              <em>{t`Ficar mais forte vale a espera: a corrida sai 3 s depois que todos fecharem.`}</em>
              <ul>
                <For each={v().waiting}>
                  {(w) => (
                    <li>
                      <Symbol size={14}>edit</Symbol> {w.name} {prepText(w.what)}
                    </li>
                  )}
                </For>
              </ul>
              <Show when={mine()}>
                <small>{t`Você está com a janela aberta: feche quando terminar.`}</small>
              </Show>
            </Show>
            <Show when={leader()}>
              <Pill
                type="button"
                disabled={cmd.busy()}
                onClick={() =>
                  void cmd.run("rpg.lobby.start", { cancel: true })
                }
              >
                {t`Cancelar largada`}
              </Pill>
            </Show>
            <Show when={cmd.error()}>
              {(msg) => <ErrorLine role="alert">{msg()}</ErrorLine>}
            </Show>
          </Box>
        </Dim>
      )}
    </Show>
  );
}

/**
 * A largada de um grupo sem corrida ainda (o 1º começo, ou quem reabriu pelo quadro do grupo): a
 * mesma janela da corrida, com o grupo em cima e o quadro da espera no meio.
 */
export function RunStage(props: {
  lobby: RpgLobbyView;
  myId: string | null;
  link: GameLink;
  serverNow: () => number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  let panel: HTMLDivElement | undefined;
  const wide = useWide(() => panel?.parentElement ?? undefined, 600);
  const drag = useWindowDrag({
    id: "rpg-run",
    win: () => panel,
    bounds: () => panel?.parentElement,
    enabled: wide,
  });
  const dg = () => dungeonById(props.lobby.dungeon);
  return (
    <Panel
      ref={panel}
      style={drag.style()}
      data-dragging={drag.dragging() ? "" : undefined}
      data-covers-map=""
      role="region"
      aria-label={t`Largada: ${dungeonName(props.lobby.dungeon)}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <Screen data-stage="">
        <Top>
          <Frames>
            <Mates data-where="top">
              <For each={props.lobby.members}>
                {(m) => (
                  <Mate title={`${m.name} · ${CLASSES[m.cls].titles[1]}`}>
                    <span>
                      <Symbol size={14}>{CLASS_ICON[m.cls]}</Symbol> {m.name}
                    </span>
                    <small>{t`Nv ${m.level}`}</small>
                  </Mate>
                )}
              </For>
            </Mates>
          </Frames>
          <Title data-title="" {...drag.handle} data-draggable={wide() ? "" : undefined}>
            <strong>{dungeonName(props.lobby.dungeon)}</strong>
            <small>{dg() ? kindName(dg()!.kind) : ""}</small>
          </Title>
          <Corner>
            <Show when={wide()}>
              <Grip onKey={drag.onGripKey} />
            </Show>
            <Pill
              type="button"
              data-round=""
              aria-label={t`Fechar`}
              onClick={props.onClose}
            >
              <Symbol size={20}>close</Symbol>
            </Pill>
          </Corner>
        </Top>
        <StartOverlay
          lobby={props.lobby}
          myId={props.myId}
          link={props.link}
          serverNow={props.serverNow}
        />
      </Screen>
    </Panel>
  );
}

function pctOf(v: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (v * 100) / max)) : 0;
}

/** O quadro do jogo: escuro, sem cromo, a cena em cima e o painel embaixo. */
const Panel = styled("div", {
  base: {
    position: "absolute",
    right: "12px",
    bottom: "12px",
    width: "min(1000px, calc(100% - 24px))",
    containerType: "inline-size",
    maxHeight: "calc(100% - 24px)",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "8px",
    borderRadius: "16px",
    background: "#0d0c0b",
    color: "#f3efe6",
    boxShadow:
      "0 8px 28px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(122, 100, 64, 0.45)",
    zIndex: 5,
    fontSize: "0.9em",
    "@media (max-width: 600px)": {
      right: "0",
      bottom: "0",
      width: "100%",
      borderRadius: "16px 16px 0 0",
    },
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
    minHeight: "220px",
    "&[data-failed]": { paddingTop: "84px" },
    // A largada sem corrida ainda: a altura da cena, para o quadro da espera caber.
    "&[data-stage]": {
      minHeight: "min(360px, calc(100dvh - 160px))",
      background:
        "radial-gradient(ellipse at 50% 40%, #1d1a15 0%, #0f1015 70%)",
    },
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
      "linear-gradient(to bottom, rgba(8, 8, 10, 0.72), rgba(8, 8, 10, 0))",
    "@container (max-width: 560px)": {
      gridTemplateColumns: "1fr auto",
      "& > [data-title]": { gridColumn: "1 / -1", gridRow: 2 },
      "& > [data-title] > strong, & > [data-title] > small": {
        display: "none",
      },
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
    "& > *": { pointerEvents: "auto" },
    "@container (max-width: 560px)": { flexDirection: "row", flexWrap: "wrap" },
  },
});

/** O retrato: classe, nome e os três níveis (herói, job e Proficiência). */
const Portrait = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 12px 4px 4px",
    borderRadius: "999px",
    background: "rgba(14, 12, 10, 0.82)",
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
    "@container (max-width: 560px)": { "& > div > small": { display: "none" } },
  },
});

const Avatar = styled("span", {
  base: {
    position: "relative",
    flexShrink: 0,
    width: "42px",
    height: "42px",
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    background: "radial-gradient(circle at 40% 30%, #3a3128, #15110d)",
    boxShadow: "0 0 0 2px #7a6440",
    color: "#e9d7ad",
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
  },
});

/** Os três níveis em pílulas com a cor de cada barra (nível dourado, job roxo, Proficiência verde). */
const Levels = styled("span", {
  base: {
    display: "flex",
    gap: "4px",
    marginTop: "2px",
    "& > span": {
      fontSize: "0.66rem",
      fontWeight: 800,
      padding: "0 6px",
      borderRadius: "999px",
      whiteSpace: "nowrap",
      fontVariantNumeric: "tabular-nums",
    },
    "& > [data-kind=level]": { background: "#d9b45a", color: "#1b140b" },
    "& > [data-kind=job]": { background: "#9b7bd8", color: "#120c1e" },
    "& > [data-kind=prof]": { background: "#5fbf8f", color: "#08180f" },
  },
});

/** Os companheiros: por cima da cena (largo) ou numa faixa embaixo dela (celular). */
const Mates = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    "&[data-where=strip]": { display: "none" },
    "@container (max-width: 560px)": {
      "&[data-where=top]": { display: "none" },
      "&[data-where=strip]": {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
        gap: "6px",
      },
    },
  },
});

/** Um companheiro: classe, nome, níveis, vida, mana e as poções que sobram. */
const Mate = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    width: "160px",
    padding: "4px 8px 6px",
    borderRadius: "8px",
    background: "rgba(14, 12, 10, 0.78)",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.08)",
    fontSize: "0.75rem",
    "& > span": {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      fontWeight: 700,
    },
    "& > small": {
      fontSize: "0.66rem",
      opacity: 0.8,
      whiteSpace: "nowrap",
      fontVariantNumeric: "tabular-nums",
    },
    "&[data-dead]": { opacity: 0.45, filter: "grayscale(1)" },
    "@container (max-width: 560px)": { width: "auto", fontSize: "0.7rem" },
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
    "&[data-boss]": {
      height: "9px",
      boxShadow: "0 0 0 1px rgba(255, 138, 122, 0.6)",
    },
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
    pointerEvents: "auto",
    "&[data-draggable]": {
      cursor: "grab",
      userSelect: "none",
      touchAction: "none",
    },
    "[data-dragging] &": { cursor: "grabbing" },
    "& > strong": { fontSize: "0.95rem", letterSpacing: "0.02em" },
    "& > small": { fontSize: "0.72rem", opacity: 0.85 },
  },
});

/** As salas: as que passaram, a de agora e a do chefe (a última, em losango). */
const Pips = styled("div", {
  base: {
    display: "flex",
    gap: "6px",
    "& > span": {
      width: "10px",
      height: "10px",
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

/** A barra do chefe (como nos RPGs, no alto): nome, vida e os buffs. */
const BossBar = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    width: "min(360px, 70vw)",
    marginTop: "4px",
    padding: "6px 10px",
    borderRadius: "10px",
    background: "rgba(30, 8, 6, 0.82)",
    boxShadow: "0 0 0 1px rgba(255, 138, 122, 0.45)",
    "& > div": { display: "flex", justifyContent: "space-between", gap: "8px" },
    "& strong": { color: "#ffd2c8", fontSize: "0.85rem" },
    "& small": { fontSize: "0.7rem", opacity: 0.85 },
  },
});

/** "mirando Fulano": quem o monstro bate agora (a ameaça do quadro; 26/11/2026). */
const Aim = styled("span", {
  base: {
    fontSize: "0.7rem",
    color: "#ffb4a6",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
});

const Buffs = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "6px",
  },
});
const Buff = styled("span", {
  base: {
    fontSize: "0.75rem",
    fontWeight: 800,
    padding: "1px 8px",
    borderRadius: "6px",
    border: "1px solid currentColor",
    "&[data-kind=cataclismo]": {
      color: "#ffd0c8",
      background: "rgba(255, 60, 40, calc(0.12 + var(--n) * 0.07))",
      "@media (prefers-reduced-motion: no-preference)": {
        animation: "gamePulse 1.2s ease-in-out infinite",
      },
    },
    "&[data-kind=fase]": { color: "#ffcf8a" },
  },
});

const Centered = styled("div", {
  base: { display: "flex", justifyContent: "center" },
});

/** O alvo do meu herói (vida e efeitos), embaixo do nome da DG. */
const TargetBox = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    width: "min(200px, 46vw)",
    marginTop: "4px",
    padding: "4px 8px 5px",
    borderRadius: "8px",
    background: "rgba(14, 12, 10, 0.78)",
    boxShadow: "0 0 0 1px rgba(196, 22, 31, 0.45)",
    pointerEvents: "auto",
    "& > div:first-child": {
      display: "flex",
      justifyContent: "space-between",
      gap: "6px",
      fontSize: "0.75rem",
    },
    "& small": { opacity: 0.8 },
  },
});

/** O quadro esmaecido da largada: por cima da cena, embaixo da faixa de cima (os botões seguem). */
const Dim = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    display: "grid",
    placeItems: "center",
    padding: "16px",
    background: "rgba(6, 6, 8, 0.66)",
    backdropFilter: "grayscale(0.6)",
  },
});
const Box = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    maxWidth: "380px",
    padding: "14px 18px",
    borderRadius: "14px",
    textAlign: "center",
    background: "rgba(20, 18, 15, 0.94)",
    boxShadow: "0 0 0 1px rgba(122, 100, 64, 0.7), 0 10px 30px rgba(0,0,0,0.6)",
    "& > strong": { fontSize: "1rem" },
    "& > em": { fontStyle: "normal", fontSize: "0.8rem", color: "#d8ceb9" },
    "& > small": { fontSize: "0.78rem", color: "#c4b8a2" },
    "& > ul": {
      listStyle: "none",
      margin: "2px 0",
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      color: "#ffd28a",
      fontSize: "0.85rem",
    },
  },
});
const Count = styled("strong", {
  base: {
    fontSize: "3rem !important",
    lineHeight: 1,
    color: "#ffe7a8",
    fontVariantNumeric: "tabular-nums",
    textShadow: "0 2px 10px rgba(217, 180, 90, 0.45)",
  },
});

const Corner = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "6px",
    "& > *": { pointerEvents: "auto" },
    // A alça no escuro da cena: um botão redondo como os outros do canto.
    "& > [data-grip]": {
      width: "34px",
      height: "34px",
      marginLeft: 0,
      borderRadius: "999px",
      background: "rgba(14, 12, 10, 0.82)",
      boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.14)",
      color: "#e9d7ad",
    },
  },
});

const Pill = styled("button", {
  base: {
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    height: "34px",
    padding: "0 12px",
    border: "none",
    borderRadius: "999px",
    background: "rgba(14, 12, 10, 0.82)",
    color: "inherit",
    cursor: "pointer",
    fontSize: "0.85em",
    fontWeight: 600,
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.14)",
    "&:hover:not(:disabled)": { background: "rgba(40, 34, 28, 0.92)" },
    "&:focus-visible": { outline: "2px solid #d9b45a", outlineOffset: "2px" },
    "&[data-danger]": { background: "#8a2a22", color: "#fff" },
    "&[data-primary]": {
      background: "#d9b45a",
      color: "#1b140b",
      boxShadow: "none",
    },
    "&[data-round]": { width: "34px", padding: 0 },
    "&:disabled": { opacity: 0.6, cursor: "default" },
    "@media (pointer: coarse)": {
      height: "44px",
      paddingInline: "14px",
      "&[data-round]": { width: "44px", paddingInline: 0 },
    },
  },
});

const ConfirmBox = styled("div", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
    padding: "4px 4px 4px 12px",
    borderRadius: "999px",
    background: "rgba(14, 12, 10, 0.92)",
    boxShadow: "0 0 0 1px rgba(217, 180, 90, 0.5)",
    fontSize: "0.85em",
  },
});

const ErrorLine = styled("p", {
  base: {
    pointerEvents: "auto",
    justifySelf: "end",
    gridColumn: "1 / -1",
    margin: 0,
    padding: "4px 10px",
    borderRadius: "8px",
    background: "#8a2a22",
    color: "#fff",
    fontSize: "0.8em",
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
    paddingTop: "clamp(96px, 26%, 170px)",
    pointerEvents: "none",
    "@container (max-width: 560px)": { paddingTop: "46%" },
  },
});

const Banner = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    maxWidth: "90%",
    padding: "10px 28px",
    borderRadius: "12px",
    background:
      "linear-gradient(90deg, rgba(10, 9, 8, 0), rgba(10, 9, 8, 0.85) 20%, rgba(10, 9, 8, 0.85) 80%, rgba(10, 9, 8, 0))",
    textAlign: "center",
    textShadow: "0 2px 4px rgba(0, 0, 0, 0.9)",
    "@media (prefers-reduced-motion: no-preference)": {
      animation: "gamePop 0.3s ease",
    },
    "& small": {
      fontSize: "0.75rem",
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "#d9b45a",
    },
    "& strong": { fontSize: "1.35rem", fontWeight: 700 },
    "& em": { fontStyle: "normal", fontSize: "0.82rem", color: "#e6dccb" },
    "@container (max-width: 560px)": {
      padding: "6px 16px",
      "& strong": { fontSize: "1.05rem" },
      "& em": { display: "none" },
    },
    "&[data-boss] small": { color: "#ff6b5e" },
    "&[data-boss] strong": { color: "#ffd2c8" },
    "&[data-warn] small": { color: "#ffa64d" },
    "&[data-warn] strong": { color: "#ffd49a" },
    "&[data-dead] strong": { color: "#ff8a7a" },
  },
});

const Outcome = styled("div", {
  base: {
    position: "absolute",
    zIndex: 3,
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: "12px",
    background: "rgba(5, 5, 7, 0.62)",
    overflow: "auto",
  },
});

const Card = styled("div", {
  base: {
    width: "min(480px, 100%)",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "16px 18px",
    borderRadius: "14px",
    background: "rgba(18, 16, 13, 0.97)",
    boxShadow:
      "0 0 0 1px rgba(122, 100, 64, 0.6), 0 10px 30px rgba(0, 0, 0, 0.6)",
    "@media (prefers-reduced-motion: no-preference)": {
      animation: "gamePop 0.3s ease",
    },
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
    "& li": { display: "flex", flexDirection: "column", gap: "4px" },
    "& li > div": {
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      alignItems: "baseline",
    },
    "& li[data-me]": {
      padding: "6px 8px",
      borderRadius: "8px",
      boxShadow: "0 0 0 1px rgba(217, 180, 90, 0.45)",
    },
    "& small": { opacity: 0.75, fontSize: "0.78rem" },
    "& > button": { alignSelf: "center" },
  },
});

const Up = styled("strong", { base: { color: "#7ee08a" } });

const Rewards = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 12px",
    fontVariantNumeric: "tabular-nums",
    "& > span": { display: "inline-flex", alignItems: "center", gap: "4px" },
  },
});

const Items = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "4px" },
});

const PartyBox = styled("div", {
  base: {
    display: "grid",
    gap: "6px",
    padding: "8px 10px",
    borderRadius: "8px",
    background: "rgba(255, 255, 255, 0.05)",
    boxShadow: "0 0 0 1px rgba(217, 180, 90, 0.25)",
    "& p": { margin: 0 },
  },
});

const PartyRow = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
  },
});

const LoopToggle = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minHeight: "44px",
    "& input": {
      width: "20px",
      height: "20px",
      accentColor: "#d9b45a",
      cursor: "pointer",
    },
    "& label": { cursor: "pointer" },
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
