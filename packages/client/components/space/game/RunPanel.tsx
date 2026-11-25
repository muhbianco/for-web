import { For, Index, Show, createMemo } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import {
  type OwnedItem,
  type RpgHeroState,
  type RpgLobbyView,
  type RpgRunMemberEnd,
  CLASSES,
  FOE_BASE,
  dungeonById,
  skillOf,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { kindName, mechanicHint, mechanicName, sizeName } from "./gameText";
import { BAR } from "./gameTheme";
import {
  type GameLink,
  Bar,
  Btn,
  Confirm,
  GameDialog,
  Gold,
  ItemIcon,
  Muted,
  Notice,
  Row,
  useCommands,
} from "./gameUi";
import { BOSS_ARCHETYPES, bagMarks, gold, num } from "./heroModel";
import { dungeonName, loopStopText, outcomeText } from "./partyUi";
import { RunScene } from "./RunScene";
import { type FeedTone, feedLine, runCast } from "./runUi";

const ROOMS = 4;

/**
 * A tela da corrida (Idle Hunt v5): um quadro por segundo vindo do servidor. No alto, as 4 salas
 * como marcos (sem relógio: D21); os inimigos da sala com a vida, o chefe com os buffs — o
 * Cataclismo é um buff que cresce a cada pulso (D24) — e o aviso da mecânica anunciada; o grupo
 * com vida, mana, poções que sobram e o XP de cada um, com os números do segundo subindo no
 * cartão; a minha barra de skills acendendo quando sai; o registro. No fim, o que cada um levou.
 */
export default function RunPanel(props: {
  state: RunState;
  myId: string | null;
  hero: RpgHeroState | null;
  link: GameLink;
  lobby: RpgLobbyView | null;
  /** Paleta do avatar de cada pessoa no Espaço (a cena desenha o herói como no mapa). */
  paletteOf?: (userId: string) => number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const st = () => props.state;
  const cast = createMemo(() => runCast(st()));
  const frame = () => st().frame;
  const room = () => frame()?.st ?? 0;
  const resting = () =>
    !!frame()?.e.some((e) => e.k === "descanso") ||
    (frame()?.x.length ?? 1) === 0;
  const me = () => st().run.members.findIndex((m) => m.user_id === props.myId);
  const dg = () => dungeonById(st().run.dungeon);
  const mine = () => me() >= 0;

  /** Dano e cura que cada herói levou neste segundo (os números que sobem no cartão). */
  const floats = createMemo(() => {
    const f = frame();
    const out = st().run.members.map(() => ({ dmg: 0, heal: 0, s: f?.s ?? 0 }));
    for (const e of f?.e ?? []) {
      if (
        (e.k === "golpe" || e.k === "magia") &&
        e.b < FOE_BASE &&
        !("bl" in e && e.bl)
      ) {
        if (e.k === "magia" && e.cura) out[e.b]!.heal += e.v;
        else if (e.a >= FOE_BASE) out[e.b]!.dmg += e.v;
      }
      if (e.k === "pocao") out[e.a]!.heal += e.v;
    }
    return out;
  });

  const feed = createMemo(() => {
    const lines: { key: string; text: string; tone: FeedTone }[] = [];
    const list = st().feed;
    for (let i = list.length - 1; i >= 0 && lines.length < 14; i--) {
      const ev = list[i]!;
      if (ev.k === "lanca") continue;
      const l = feedLine(st(), cast(), ev);
      if (l) lines.push({ key: `${ev.at}-${i}`, ...l });
    }
    return lines;
  });
  /** Só o que importa vai para o leitor de tela (uma linha por evento grande, não por golpe). */
  const announce = createMemo(() => {
    const f = frame();
    const big = f?.e.find(
      (e) => e.k === "queda" || e.k === "mecanica" || e.k === "sala",
    );
    return big
      ? (feedLine(st(), cast(), { ...big, at: f!.s, st: f!.st } as never)
          ?.text ?? "")
      : "";
  });

  const mechanicNow = () => {
    const m = st().mechanic;
    const f = frame();
    return m && f && f.s - m.at <= 2 ? m : null;
  };

  return (
    <GameDialog
      id="rpg-run"
      wide
      title={dungeonName(st().run.dungeon)}
      subtitle={
        <>
          {dg() ? `${kindName(dg()!.kind)} · ` : ""}
          {st().end
            ? outcomeText(st().end!.outcome)
            : resting()
              ? t`descansando`
              : room() >= 3
                ? t`o chefe`
                : t`sala ${room() + 1} de 4`}
        </>
      }
      onClose={props.onClose}
      footer={
        <Show
          when={!st().end && mine()}
          fallback={
            <Btn type="button" onClick={props.onClose}>{t`Fechar`}</Btn>
          }
        >
          <Confirm
            size="sm"
            disabled={cmd.busy()}
            label={t`Sair da corrida`}
            confirm={t`Sair agora? Você perde a recompensa desta corrida`}
            onConfirm={() => void cmd.run("rpg.run.leave")}
          />
          <Btn type="button" data-tone="quiet" onClick={props.onClose}>
            {t`Voltar ao Espaço (a corrida continua)`}
          </Btn>
        </Show>
      }
    >
      <Steps aria-label={t`Salas`}>
        <Index each={Array.from({ length: ROOMS })}>
          {(_, i) => (
            <Step
              data-state={
                st().end
                  ? i <= room()
                    ? "done"
                    : "todo"
                  : i < room()
                    ? "done"
                    : i === room()
                      ? "now"
                      : "todo"
              }
              aria-current={!st().end && i === room() ? "step" : undefined}
            >
              {i === ROOMS - 1 ? t`Chefe` : t`Sala ${i + 1}`}
            </Step>
          )}
        </Index>
      </Steps>
      <Notice error={cmd.error()} />
      <Live aria-live="polite">{announce()}</Live>

      <RunScene state={st()} myId={props.myId} paletteOf={props.paletteOf} />

      <Show when={!st().frame && !st().end}>
        <Muted>{t`A corrida está começando…`}</Muted>
      </Show>

      <Show when={st().end}>
        {(end) => (
          <EndSummary
            state={st()}
            hero={props.hero}
            myId={props.myId}
            lobby={props.lobby}
            members={end().members}
            outcome={end().outcome}
          />
        )}
      </Show>

      <Show when={!st().end && st().frame}>
        <Arena>
          <Foes aria-label={t`Inimigos`}>
            <Show when={mechanicNow()}>
              {(m) => (
                <Warn role="alert">
                  <strong>⚠ {mechanicName(m().s)}</strong>
                  <span>
                    {mechanicHint(m().s)}
                    {m().b !== undefined && m().b! < FOE_BASE
                      ? ` ${t`Alvo`}: ${cast().heroName(m().b!)}.`
                      : ""}
                  </span>
                </Warn>
              )}
            </Show>
            <Show
              when={!resting()}
              fallback={
                <Muted>{t`Descansando: vida e mana voltam antes da próxima sala.`}</Muted>
              }
            >
              <For each={frame()!.x}>
                {(hp, i) => {
                  const e = () => cast().enemyOf(room(), i());
                  const boss = () =>
                    !!e() && BOSS_ARCHETYPES.has(e()!.archetype);
                  const max = () => e()?.hp ?? Math.max(hp, 1);
                  return (
                    <Foe
                      data-boss={boss() ? "" : undefined}
                      data-dead={hp <= 0 ? "" : undefined}
                    >
                      <Row>
                        <strong>
                          {hp <= 0 ? "✝ " : ""}
                          {cast().enemyName(room(), i())}
                        </strong>
                        <Muted>
                          {t`Nv ${e()?.level ?? "?"}`}
                          {e()?.magicAuto ? ` · ${t`mágico`}` : ""}
                        </Muted>
                      </Row>
                      <Bar
                        label={cast().enemyName(room(), i())}
                        thin={!boss()}
                        color={BAR.enemy}
                        frac={hp / max()}
                        text={`${num(hp)} / ${num(max())}`}
                      />
                      <Show when={boss()}>
                        <Buffs>
                          <Show when={st().cataclysm > 0}>
                            <Buff
                              data-kind="cataclismo"
                              style={{
                                "--n": String(Math.min(10, st().cataclysm)),
                              }}
                              title={t`Cataclismo: a cada pulso o chefe tira 40% da vida máxima de cada herói. Só acaba quando o chefe cai.`}
                            >
                              ☠ {t`Cataclismo`} ×{st().cataclysm}
                            </Buff>
                          </Show>
                          <Show
                            when={st().feed.some(
                              (f) =>
                                f.k === "mecanica" &&
                                f.s === "fase" &&
                                f.st === room(),
                            )}
                          >
                            <Buff data-kind="fase">▲ {t`Fase nova`}</Buff>
                          </Show>
                          <Show when={st().cataclysm === 0}>
                            <Muted>{t`Sem buffs. Se a luta demorar, o Cataclismo começa.`}</Muted>
                          </Show>
                        </Buffs>
                      </Show>
                    </Foe>
                  );
                }}
              </For>
            </Show>
          </Foes>

          <Party aria-label={t`Grupo`}>
            <Index each={st().run.members}>
              {(m, i) => {
                const hp = () => frame()!.h[i] ?? 0;
                const mp = () => frame()!.m[i] ?? 0;
                const dead = () => hp() <= 0;
                const f = () => floats()[i]!;
                return (
                  <Hero
                    data-me={i === me() ? "" : undefined}
                    data-dead={dead() ? "" : undefined}
                  >
                    <Row>
                      <strong>{m().name}</strong>
                      <Muted>
                        {CLASSES[m().cls].titles[1]} {m().level}
                      </Muted>
                      <Show when={dead()}>
                        <Dead>{t`caiu`}</Dead>
                      </Show>
                    </Row>
                    <Floats aria-hidden="true">
                      {/* keyed: um nó novo a cada segundo, para a animação recomeçar. */}
                      <Show when={f().dmg > 0 ? `d${f().s}` : null} keyed>
                        {(_k) => <Float data-kind="dmg">−{num(f().dmg)}</Float>}
                      </Show>
                      <Show when={f().heal > 0 ? `h${f().s}` : null} keyed>
                        {(_k) => (
                          <Float data-kind="heal">+{num(f().heal)}</Float>
                        )}
                      </Show>
                    </Floats>
                    <Bar
                      label={t`Vida`}
                      color="hp"
                      frac={hp() / m().hp_max}
                      text={`${num(hp())} / ${num(m().hp_max)}`}
                    />
                    <Bar
                      label={t`Mana`}
                      color="mp"
                      thin
                      frac={mp() / m().mp_max}
                    />
                    <Small>
                      <span
                        title={t`Poções de vida no cinto (${sizeName(m().belt.hp)})`}
                      >
                        ♥ {st().potions[i]?.hp ?? 0}
                      </span>
                      <span
                        title={t`Poções de mana no cinto (${sizeName(m().belt.mp)})`}
                      >
                        ✦ {st().potions[i]?.mp ?? 0}
                      </span>
                      <span
                        title={
                          st().xpFromStart
                            ? t`XP desta corrida até agora`
                            : t`XP desde que você abriu a tela`
                        }
                      >
                        {num(st().xp[i] ?? 0)} XP
                      </span>
                    </Small>
                    <Show when={i === me()}>
                      <Skills aria-label={t`Suas skills`}>
                        <For each={m().skills}>
                          {(s) => (
                            <SkillPip
                              data-lit={
                                st().casts[i]?.[s.id] === frame()!.s
                                  ? ""
                                  : undefined
                              }
                            >
                              {skillOf(m().cls, s.id)?.name ?? s.id}
                            </SkillPip>
                          )}
                        </For>
                      </Skills>
                    </Show>
                  </Hero>
                );
              }}
            </Index>
          </Party>
        </Arena>
      </Show>

      <FeedBox aria-label={t`Registro da corrida`}>
        <For each={feed()}>
          {(l) => <FeedLine data-tone={l.tone}>{l.text}</FeedLine>}
        </For>
      </FeedBox>
    </GameDialog>
  );
}

/** O fim: o resultado, e o que cada um levou (D4: quem caiu leva até cair, sem o bônus de fim). */
function EndSummary(props: {
  state: RunState;
  hero: RpgHeroState | null;
  myId: string | null;
  lobby: RpgLobbyView | null;
  members: RpgRunMemberEnd[];
  outcome: string;
}) {
  const { t } = useLingui();
  const nameOf = (id: string) =>
    props.state.run.members.find((m) => m.user_id === id)?.name ?? "?";
  const marks = createMemo(() => (props.hero ? bagMarks(props.hero.hero) : {}));
  const win = () => props.outcome === "vitoria";
  return (
    <EndBox data-win={win() ? "" : undefined}>
      <Headline>
        {win()
          ? t`Vitória!`
          : props.outcome === "derrota"
            ? t`O grupo caiu`
            : t`A corrida acabou: ${outcomeText(props.outcome)}`}
      </Headline>
      <Show when={!win()}>
        <Muted>
          {t`Ninguém perde XP ao cair. Quem caiu leva o que rendeu até cair; sem o bônus de fim e com as poções gastas.`}
        </Muted>
      </Show>
      <For each={props.members}>
        {(m) => (
          <Reward data-me={m.user_id === props.myId ? "" : undefined}>
            <Row>
              <strong>{nameOf(m.user_id)}</strong>
              <Show when={m.dead}>
                <Muted>{t`caiu`}</Muted>
              </Show>
              <Show when={m.retreated}>
                <Muted>{t`saiu antes (sem recompensa)`}</Muted>
              </Show>
              <Show when={m.levels_gained > 0}>
                <Up>{t`+${m.levels_gained} nível!`}</Up>
              </Show>
              <Show when={m.jobs_gained > 0}>
                <Up>{t`+${m.jobs_gained} job`}</Up>
              </Show>
            </Row>
            <Show when={m.reward}>
              {(r) => (
                <>
                  <Row>
                    <span>{num(r().xp)} XP</span>
                    <span>{t`${num(r().job_xp)} de job`}</span>
                    <Gold n={gold(r().gold)} />
                    <Show when={r().stones > 0}>
                      <span>{t`${r().stones} Pedra de Proteção`}</span>
                    </Show>
                    <For each={Object.entries(r().ores)}>
                      {([mat, n]) => (
                        <span>{t`${n ?? 0} minério de ${mat}`}</span>
                      )}
                    </For>
                  </Row>
                  <Show when={r().items.length > 0}>
                    <Row>
                      <For each={r().items}>
                        {(it: OwnedItem) => (
                          <ItemIcon
                            item={it}
                            mark={
                              m.user_id === props.myId
                                ? marks()[it.uid]?.mark
                                : undefined
                            }
                          />
                        )}
                      </For>
                    </Row>
                  </Show>
                </>
              )}
            </Show>
            <Show when={m.left.length > 0}>
              <Muted role="note">
                ⚠{" "}
                {t`${m.left.length} itens ficaram na dungeon: a mochila estava cheia.`}
              </Muted>
            </Show>
            <Muted>
              {t`Gastou ${m.potions_used.hp} poções de vida e ${m.potions_used.mp} de mana`}
              {m.ammo_used > 0 ? ` · ${t`${m.ammo_used} flechas`}` : ""}
            </Muted>
          </Reward>
        )}
      </For>
      <Show when={props.lobby && loopStopText(props.lobby)}>
        {(s) => <Muted role="note">⚠ {s()}</Muted>}
      </Show>
      <Show when={props.lobby?.loop}>
        <Muted>{t`Loop ligado: a próxima corrida começa sozinha.`}</Muted>
      </Show>
    </EndBox>
  );
}

const Steps = styled("ol", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "4px",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
});
const Step = styled("li", {
  base: {
    textAlign: "center",
    fontSize: "0.78rem",
    fontWeight: 700,
    padding: "6px 2px",
    borderRadius: "8px",
    background: "rgba(255,255,255,0.05)",
    color: "var(--md-sys-color-on-surface-variant)",
    "&[data-state=done]": {
      background: "rgba(126,224,138,0.14)",
      color: "#cdf5d3",
    },
    "&[data-state=done]::before": { content: '"✓ "' },
    "&[data-state=now]": {
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
    },
  },
});
const Live = styled("div", {
  base: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
  },
});
const Arena = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
    gap: "12px",
    "@container (max-width: 640px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});
const Foes = styled("section", {
  base: { display: "flex", flexDirection: "column", gap: "6px" },
});
const Foe = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "6px 10px",
    borderRadius: "10px",
    background: "rgba(200, 69, 59, 0.08)",
    border: "1px solid rgba(200, 69, 59, 0.25)",
    "&[data-boss]": {
      padding: "10px 12px",
      borderColor: "rgba(255, 138, 122, 0.6)",
      background: "rgba(200, 69, 59, 0.14)",
    },
    "&[data-dead]": { opacity: 0.4 },
  },
});
const Buffs = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "6px" },
});
const Buff = styled("span", {
  base: {
    fontSize: "0.8rem",
    fontWeight: 800,
    padding: "2px 8px",
    borderRadius: "6px",
    border: "1px solid currentColor",
    "&[data-kind=cataclismo]": {
      color: "#ffd0c8",
      background: "rgba(255, 60, 40, calc(0.12 + var(--n) * 0.06))",
      "@media (prefers-reduced-motion: no-preference)": {
        animation: "gamePulse 1.2s ease-in-out infinite",
      },
    },
    "&[data-kind=fase]": { color: "#ffcf8a" },
  },
});
const Warn = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 12px",
    borderRadius: "10px",
    background: "rgba(255, 166, 77, 0.16)",
    border: "1px solid #ffa64d",
    color: "#ffe2c2",
    "@media (prefers-reduced-motion: no-preference)": {
      animation: "gamePop 300ms ease-out",
    },
  },
});
const Party = styled("section", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "8px",
    alignContent: "start",
  },
});
const Hero = styled("div", {
  base: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    "&[data-me]": { borderColor: "var(--md-sys-color-primary)" },
    "&[data-dead]": { filter: "grayscale(0.8)", opacity: 0.7 },
  },
});
const Dead = styled("span", { base: { color: "#ff8a7a", fontWeight: 800 } });
const Floats = styled("div", {
  base: {
    position: "absolute",
    right: "8px",
    top: "4px",
    display: "flex",
    gap: "6px",
    pointerEvents: "none",
  },
});
const Float = styled("span", {
  base: {
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    textShadow: "0 1px 2px #000",
    "&[data-kind=dmg]": { color: "#ff8a7a" },
    "&[data-kind=heal]": { color: "#7ee08a" },
    "@media (prefers-reduced-motion: no-preference)": {
      animation: "gameFloat 900ms ease-out forwards",
    },
  },
});
const Small = styled("div", {
  base: {
    display: "flex",
    gap: "10px",
    fontSize: "0.78rem",
    color: "var(--md-sys-color-on-surface-variant)",
    fontVariantNumeric: "tabular-nums",
  },
});
const Skills = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "4px" },
});
const SkillPip = styled("span", {
  base: {
    fontSize: "0.72rem",
    padding: "2px 6px",
    borderRadius: "6px",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    "&[data-lit]": {
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
      borderColor: "transparent",
    },
  },
});
const FeedBox = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    maxHeight: "180px",
    overflow: "auto",
    fontSize: "0.82rem",
    padding: "6px 8px",
    borderRadius: "10px",
    background: "rgba(0,0,0,0.3)",
    fontVariantNumeric: "tabular-nums",
  },
});
const FeedLine = styled("div", {
  base: {
    "&[data-tone=bad]": { color: "#ffb4a8" },
    "&[data-tone=heal]": { color: "#bdf0c5" },
    "&[data-tone=good]": { color: "#ffe7a8" },
    "&[data-tone=warn]": { color: "#ffc27a", fontWeight: 700 },
    "&[data-tone=info]": { color: "var(--md-sys-color-on-surface-variant)" },
  },
});
const EndBox = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid rgba(255, 138, 122, 0.5)",
    background: "rgba(255, 138, 122, 0.06)",
    "&[data-win]": {
      borderColor: "rgba(217, 180, 90, 0.7)",
      background: "rgba(217, 180, 90, 0.08)",
    },
    "@media (prefers-reduced-motion: no-preference)": {
      animation: "gamePop 420ms ease-out",
    },
  },
});
const Headline = styled("strong", { base: { fontSize: "1.4rem" } });
const Reward = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    "&[data-me]": { outline: "1px solid var(--md-sys-color-primary)" },
  },
});
const Up = styled("strong", { base: { color: "#7ee08a" } });
