import { For, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type JobTier,
  type RpgHeroView,
  abilitiesOf,
  cannotLearn,
  EVOLUTION,
  JOB_NAMES,
  MASTERY_PCT,
  isShapeNode,
  masteryFactor,
  treeOf,
  treePointsSpent,
  VOCATIONS,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import {
  abilityKind,
  abilityView,
  effectText,
  learnError,
  num,
} from "./heroUi";

const TIERS: readonly JobTier[] = [1, 2, 3];

/**
 * A árvore de habilidades (24/11/2026): as 4 habilidades fixas da classe e os adereços de cada
 * uma, em três partes (uma por classe; a 2ª e a 3ª abrem com a evolução no Mestre). Os pontos
 * vêm do dummy de habilidade. Cada "+" manda um ponto; o servidor confere tudo de novo.
 */
export function SkillTree(props: {
  hero: RpgHeroView;
  /** Pontos ganhos contando o treino de habilidade aberto (o servidor credita ao aprender). */
  earned?: number;
  busy: boolean;
  locked: boolean;
  send: (type: string, d: Record<string, unknown>) => void;
}) {
  const { t } = useLingui();
  const base = () => VOCATIONS[props.hero.vocation].base;
  const names = () =>
    base() >= 1 && base() <= 4 ? JOB_NAMES[base() as 1 | 2 | 3 | 4] : null;
  const sp = () => {
    const s = props.hero.skill_points;
    const extra = Math.max(0, (props.earned ?? s.earned) - s.earned);
    return { ...s, earned: s.earned + extra, free: s.free + extra };
  };

  return (
    <Wrap>
      <Head>
        <strong>{t`Pontos de habilidade: ${sp().free}`}</strong>
        <Muted>
          {t`Ganhos no dummy de habilidade: ${sp().earned} (o próximo em ${Math.max(0, sp().next - sp().tries)} tentativas). Postos na árvore: ${treePointsSpent(props.hero.tree)}.`}
        </Muted>
      </Head>
      <Show
        when={names()}
        fallback={
          <Muted>{t`Escolha a vocação num dummy para ver a árvore.`}</Muted>
        }
      >
        <For each={abilitiesOf(base())}>
          {(def) => {
            const view = () => abilityView(props.hero, def);
            const heal = def.kind === "cura" || def.kind === "cura-outro";
            return (
              <Ability aria-label={def.name}>
                <AbilityHead>
                  <div>
                    <strong>{view().now.name}</strong>
                    <Muted>
                      {" · "}
                      {abilityKind(def)}
                    </Muted>
                  </div>
                  <Numbers>
                    <Show when={view().range}>
                      {(r) => (
                        <span>
                          {heal
                            ? t`Cura ${r()[0]}–${r()[1]}`
                            : t`Dano ${r()[0]}–${r()[1]}`}
                        </span>
                      )}
                    </Show>
                    <span>{t`${view().now.mana} de mana`}</span>
                    <span>{t`recarga ${num(view().cooldownS)} s`}</span>
                  </Numbers>
                </AbilityHead>
                <Muted>{def.blurb}</Muted>
                <For each={TIERS}>
                  {(tier) => {
                    const open = () => tier <= props.hero.job;
                    const nodes = () =>
                      treeOf(def.id).filter((n) => n.tier === tier);
                    const evolve = tier === 1 ? null : EVOLUTION[tier as 2 | 3];
                    return (
                      <Show when={nodes().length > 0}>
                        <Tier data-locked={open() ? undefined : ""}>
                          <TierHead>
                            {t`${tier}ª classe: ${names()![tier - 1]}`}
                            <Show when={!open() && evolve}>
                              <Muted>
                                {" · "}
                                {t`abre no Mestre (level ${evolve!.level} e ${evolve!.points} pontos na árvore)`}
                              </Muted>
                            </Show>
                          </TierHead>
                          <For each={nodes()}>
                            {(node) => {
                              const rank = () => props.hero.tree[node.id] ?? 0;
                              const why = () =>
                                cannotLearn(
                                  props.hero.tree,
                                  node.id,
                                  base(),
                                  props.hero.job,
                                  sp().free,
                                );
                              return (
                                <Node data-has={rank() > 0 ? "" : undefined}>
                                  <div>
                                    <strong>{node.name}</strong>{" "}
                                    <Rank>
                                      {rank()}/{node.ranks}
                                    </Rank>
                                    {/* A maestria do renascimento da árvore (24/11/2026). */}
                                    <Show when={props.hero.mastery?.[node.id]}>
                                      {(m) => (
                                        <Mastery
                                          title={t`Maestria ${m()}: cada ponto rende ${num(m() * MASTERY_PCT)}% a mais`}
                                        >
                                          ★{m()}
                                        </Mastery>
                                      )}
                                    </Show>
                                    <NodeText>
                                      {/* Com a maestria, o efeito já cresce (24/11/2026). */}
                                      {rank() > 0
                                        ? effectText(
                                            node.effect,
                                            isShapeNode(node.id)
                                              ? rank()
                                              : rank() *
                                                  masteryFactor(
                                                    props.hero.mastery,
                                                    node.id,
                                                  ),
                                            heal,
                                          )
                                        : effectText(node.effect, 1, heal)}
                                      <Show when={props.hero.mastery?.[node.id]}>
                                        {(m) => (
                                          <MasteryNote>
                                            {isShapeNode(node.id)
                                              ? t` · maestria: +${num(m() * MASTERY_PCT)}% de poder na habilidade`
                                              : t` · maestria: +${num(m() * MASTERY_PCT)}% em cada ponto`}
                                          </MasteryNote>
                                        )}
                                      </Show>
                                      <Show
                                        when={
                                          node.ranks > 1 && rank() < node.ranks
                                        }
                                      >
                                        <Muted>
                                          {" · "}
                                          {t`no máximo: ${effectText(node.effect, node.ranks, heal)}`}
                                        </Muted>
                                      </Show>
                                    </NodeText>
                                  </div>
                                  <Learn
                                    type="button"
                                    disabled={
                                      props.busy ||
                                      props.locked ||
                                      why() !== null
                                    }
                                    title={learnError(why()) ?? t`Pôr um ponto`}
                                    aria-label={t`Pôr um ponto em ${node.name}`}
                                    onClick={() =>
                                      props.send("rpg.learn", { node: node.id })
                                    }
                                  >
                                    +
                                  </Learn>
                                </Node>
                              );
                            }}
                          </For>
                        </Tier>
                      </Show>
                    );
                  }}
                </For>
              </Ability>
            );
          }}
        </For>
      </Show>
      <Show when={props.locked}>
        <Muted>{t`Na dungeon: a árvore volta quando a corrida acabar.`}</Muted>
      </Show>
    </Wrap>
  );
}

const Wrap = styled("div", {
  base: {
    containerType: "inline-size",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-md)",
  },
});

const Head = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "2px" },
});

const Ability = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
  },
});

const AbilityHead = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "4px 12px",
  },
});

const Numbers = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 10px",
    fontSize: "0.85em",
    fontVariantNumeric: "tabular-nums",
  },
});

const Tier = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingTop: "6px",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
    "&[data-locked]": { opacity: 0.55 },
  },
});

const TierHead = styled("div", {
  base: { fontSize: "0.8em", fontWeight: 600, letterSpacing: "0.02em" },
});

const Node = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: "8px",
    background: "var(--md-sys-color-surface-container-high)",
    "&[data-has]": {
      boxShadow: "inset 3px 0 0 var(--md-sys-color-primary)",
    },
  },
});

const MasteryNote = styled("span", {
  base: { color: "#ffd66b" },
});

const Mastery = styled("span", {
  base: {
    marginLeft: "6px",
    padding: "0 5px",
    borderRadius: "999px",
    background: "rgba(217, 180, 90, 0.2)",
    color: "#ffd66b",
    fontSize: "0.75em",
    fontWeight: 700,
  },
});

const Rank = styled("span", {
  base: {
    fontSize: "0.8em",
    fontVariantNumeric: "tabular-nums",
    color: "var(--md-sys-color-primary)",
  },
});

const NodeText = styled("div", {
  base: { fontSize: "0.82em", lineHeight: 1.35 },
});

const Learn = styled("button", {
  base: {
    width: "32px",
    height: "32px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    fontSize: "1.1rem",
    background: "var(--md-sys-color-primary)",
    color: "var(--md-sys-color-on-primary)",
    "&:disabled": {
      opacity: 0.3,
      cursor: "default",
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },
    "@media (pointer: coarse)": { width: "44px", height: "44px" },
  },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});
