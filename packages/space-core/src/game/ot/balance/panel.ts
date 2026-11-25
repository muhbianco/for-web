import {
  nextPointCost,
  pointsFree,
  pointsSpent,
  raiseStats,
} from "./attributes.ts";
import { type Stat, type Stats, CLASSES, STATS } from "./content.ts";
import { type BalanceHero, affixTotals, heroDerived } from "./equipment.ts";
import {
  type ArchetypeId,
  type Balance,
  type HeroStats,
  type Tier,
  balance as gameBalance,
} from "./formulas.ts";

/**
 * O painel de atributos como dado (spec §16, Fase 2; e o resumo de build do Mestre da evolução,
 * §10): pontos, custo do próximo ponto, derivados e os % efetivos contra os monstros do nível. A tela
 * só desenha isto; nenhuma conta fica no componente (§0.2).
 */

export interface AttributeRow {
  stat: Stat;
  /** Valor dos pontos (começa em 1). */
  points: number;
  /** O que os afixos somam. */
  gear: number;
  total: number;
  /** Pontos para subir mais 1. */
  nextCost: number;
  canRaise: boolean;
}

/** Como o herói se sai contra um arquétipo no nível `monsterLevel`. */
export interface VersusRow {
  archetype: ArchetypeId;
  monsterLevel: number;
  /** Chance de crítico do herói (sem os bônus planos de skill). */
  crit: number;
  /** Evasão total contra 1 atacante e cercado por 4 (golpes não certeiros). */
  avoid: number;
  avoidSurrounded: number;
  /** Erro do herói (0 com arma mágica). */
  miss: number;
  /** Quanto o herói tira do dano físico e mágico desse atacante. */
  physicalReduction: number;
  magicReduction: number;
  /** Δ = herói − monstro, em dano causado (o recebido é o oposto). */
  levelDiff: number;
}

export interface AttributePanel {
  /** Nome da linha (o título do T2) e o título do tier atual. */
  className: string;
  title: string;
  level: number;
  job: number;
  tier: Tier;
  points: { total: number; spent: number; free: number };
  rows: AttributeRow[];
  derived: HeroStats;
  proficiency: {
    stored: number;
    effective: number;
    recommended: number;
    /** O que está guardado acima do teto do nível (liberado ao subir). */
    held: number;
  };
  versus: VersusRow[];
}

const VERSUS: ArchetypeId[] = ["lacaio", "elite", "chefe"];

/** Atacantes na linha "cercado" do painel. */
export const SURROUNDED_BY = 4;

export function attributePanel(
  hero: BalanceHero,
  opts: { monsterLevel?: number } = {},
  B: Balance = gameBalance,
): AttributePanel {
  const cls = CLASSES[hero.cls];
  const tier = B.tierFor(hero.level, hero.job);
  const d = heroDerived(hero, B);
  const gear = affixTotals(hero.equipment).attrs;
  const free = pointsFree(hero.level, hero.attrs, B);

  const rows: AttributeRow[] = STATS.map((stat) => {
    const cost = nextPointCost(hero.attrs, stat, B);
    return {
      stat,
      points: hero.attrs[stat],
      gear: gear[stat],
      total: hero.attrs[stat] + gear[stat],
      nextCost: cost,
      canRaise: cost <= free,
    };
  });

  const m = opts.monsterLevel ?? hero.level;
  const magic = d.kind === "magic";
  const versus = VERSUS.map((archetype): VersusRow => {
    const mon = B.monsterStats(archetype, m);
    return {
      archetype,
      monsterLevel: m,
      crit: B.critChance(d.critRating, mon.critRes),
      avoid: B.avoidChance(d.flee, d.luck, mon.hit, m),
      avoidSurrounded: B.avoidChance(d.flee, d.luck, mon.hit, m, {
        attackers: SURROUNDED_BY,
      }),
      miss: B.heroMissChance(d.hit, mon.flee, magic),
      physicalReduction: B.heroPhysicalReduction(d.def, m),
      magicReduction: B.magicReduction(d.mdef, m),
      levelDiff: B.levelDiffMod(hero.level - m),
    };
  });

  const recommended = B.recommendedProficiency(hero.level);
  return {
    // O título do T2 é o nome da linha (Guerreiro, Mago, Caçador...).
    className: cls.titles[1],
    title: cls.titles[tier - 1]!,
    level: hero.level,
    job: hero.job,
    tier,
    points: {
      total: B.attributePoints(hero.level),
      spent: pointsSpent(hero.attrs, B),
      free,
    },
    rows,
    derived: d,
    proficiency: {
      stored: hero.proficiency,
      effective: d.proficiencyEffective,
      recommended,
      held: Math.max(0, hero.proficiency - d.proficiencyEffective),
    },
    versus,
  };
}

/**
 * O painel com os pontos marcados e ainda não confirmados: a UI mostra o "antes e depois" de cada %
 * antes de gastar. Recusa com o mesmo motivo do servidor.
 */
export function previewRaise(
  hero: BalanceHero,
  add: Partial<Record<Stat, number>>,
  opts: { monsterLevel?: number } = {},
  B: Balance = gameBalance,
):
  | { ok: true; panel: AttributePanel; spent: number }
  | { ok: false; error: string } {
  const r = raiseStats(hero.level, hero.attrs, add, B);
  if (!r.ok) return r;
  const next: BalanceHero = { ...hero, attrs: r.stats as Stats };
  return { ok: true, panel: attributePanel(next, opts, B), spent: r.spent };
}
