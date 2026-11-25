import type { ClassId } from "../content.ts";
import type { HeroStats } from "../formulas.ts";

/**
 * Tipos do combate da engine nova (spec §5): elementos de dano, efeitos de skill como dado (§0.3) e o
 * que entra e sai de uma luta. A engine interpreta efeitos por tipo; as skills são conteúdo.
 */

/**
 * Físico: ATQ contra DEF, pode errar e criticar. Mágico: MATQ contra MDEF, nunca erra (e no gabarito
 * não critica). Sagrado (paladino): ATQ contra MDEF, não erra nem critica. Verdadeiro: só mecânica de
 * chefe, ignora tudo.
 */
export type Element = "fisico" | "magico" | "sagrado";

export interface DamagePart {
  element: Element;
  /** Multiplicador sobre ATQ (físico e sagrado) ou MATQ (mágico). */
  coef: number;
}

/** Atributos que um buff mexe no herói ou no grupo. */
export type BuffStat =
  /** Dano recebido −x (todo tipo). */
  | "reducao"
  | "reducaoFisica"
  | "reducaoMagica"
  /** Dano causado +x. */
  | "dano"
  /** Crítico plano +x e multiplicador de crítico +x. */
  | "critico"
  | "multCritico"
  /** Regeneração de x% da MP máxima por segundo. */
  | "regenManaPct";

/** Atributos que um debuff mexe no inimigo. */
export type DebuffStat =
  /** O inimigo causa −x de dano. */
  | "danoCausado"
  /** O inimigo recebe +x de dano de todas as fontes (Marca do Caçador). */
  | "danoRecebido";

export type Effect =
  | {
      type: "dano";
      parts: DamagePart[];
      /** Golpes iguais em sequência (cada um rola erro e crítico). */
      hits?: number;
      critFlat?: number;
      /** Ignora esta fração da defesa do alvo (soma com a da arma). */
      penetration?: number;
      /** Crítico garantido se o alvo não estiver atacando o herói (no gabarito, limitado ao teto de 70%). */
      ambush?: boolean;
      /** Acerta todos os inimigos vivos. */
      area?: boolean;
    }
  | { type: "dot"; element: Element; coefPerSec: number; durationMs: number }
  | {
      type: "cura";
      target: "aliado" | "grupo" | "proprio";
      coefMatk?: number;
      pctMaxHp?: number;
      /** Cura sem os bônus de cura de quem conjura (Imposição de Mãos, Última Resistência). */
      noBonus?: boolean;
    }
  | {
      type: "hot";
      target: "aliado" | "grupo";
      coefMatkPerSec: number;
      durationMs: number;
      /** Quantas vezes acumula no mesmo alvo (Rejuvenescer: 2). */
      stacks?: number;
    }
  | {
      type: "escudo";
      target: "proprio" | "alvo-do-chefe";
      pctMaxHp?: number;
      coefMatk?: number;
      durationMs: number;
    }
  | { type: "escudoDeMana"; pct: number; durationMs: number }
  | {
      type: "buff";
      target: "proprio" | "grupo";
      stat: BuffStat;
      value: number;
      durationMs: number;
      /** Buffs do mesmo grupo se sobrescrevem; sem grupo, cada skill tem o seu e eles multiplicam. */
      group?: string;
    }
  | {
      type: "debuff";
      stat: DebuffStat;
      value: number;
      durationMs: number;
      group?: string;
    }
  | { type: "provocar"; durationMs: number; scope: "alvo" | "sala" };

/** As condições da IA (spec §5): o herói só usa a skill quando a condição vale. */
export type Condition =
  | { kind: "sempre" }
  | { kind: "soEmChefe" }
  | { kind: "inimigos"; min: number }
  | { kind: "aliadoAbaixo"; pct: number }
  | { kind: "meuHpAbaixo"; pct: number }
  | { kind: "chefePreparando" }
  | { kind: "perdiAggro" }
  | { kind: "sendoAlvo" };

export interface SkillDef {
  id: string;
  name: string;
  cooldownMs: number;
  /** Custo em fração da mana-base da classe. */
  manaPct: number;
  /** Multiplicador extra de ameaça sobre o dano desta skill (Golpe Provocador ×2). */
  threatMult?: number;
  condition: Condition;
  effects: Effect[];
}

/** Um herói na luta: os derivados já calculados, o kit na ordem de prioridade e as poções. */
export interface FighterInput {
  cls: ClassId;
  stats: HeroStats;
  role: "tanque" | "suporte" | "dps";
  skills: SkillDef[];
  /** Rank de Potência das skills (+5% por rank acima do 1). */
  potencyRank: number;
  /** Traço da classe (§6). */
  lifesteal?: number;
  blockBonus?: number;
  healBonus?: number;
  hotBonus?: number;
  /** Auto-ataque mágico (fração do MATQ) para armas mágicas. */
  magicAutoAttack?: number;
  potions: { hp: number; mp: number; stock: number };
  /** Limiares de poção (fração): vida antes de mana. */
  potionAt?: { hp: number; mp: number };
}

export type ArchetypeKey =
  | "lacaio"
  | "elite"
  | "chefeMenor"
  | "chefe"
  | "regional";

/** Um inimigo: os números já gerados (Fase 6 gera; aqui chegam prontos). */
export interface EnemyInput {
  archetype: ArchetypeKey;
  level: number;
  hp: number;
  /** Golpe bruto (antes da defesa do herói) e ataques por segundo. */
  autoRaw: number;
  attacksPerSecond: number;
  /** Auto-ataque mágico (lacaios mágicos a partir da região 2). */
  magicAuto?: boolean;
  /** Golpe Pesado: múltiplo do golpe, certeiro, no alvo. */
  buster?: { everySeconds: number; mult: number };
  /** Pulso Sombrio: mágico, em todos. */
  pulse?: { everySeconds: number; raw: number };
  /** Cataclismo: fração do HP máximo de cada herói, dano verdadeiro. */
  cataclysm?: { atSeconds: number; pct: number; everySeconds: number };
}

export interface FightOptions {
  /** Teto da luta em segundos. */
  maxSeconds: number;
  /** "esperado" = valor médio de cada rolagem (calibragem e paridade); "aleatorio" = rolagens de verdade. */
  mode: "esperado" | "aleatorio";
  /** Fonte de números em [0, 1) para o modo aleatório. */
  random?: { next(): number };
}

export interface FighterResult {
  cls: ClassId;
  damage: number;
  autoDamage: number;
  healed: number;
  hpPct: number;
  potionsUsed: number;
  /** Poções bebidas de cada tipo (o total é `potionsUsed`). */
  hpPotions: number;
  mpPotions: number;
  alive: boolean;
}

export interface FightResult {
  win: boolean;
  seconds: number;
  deaths: number;
  firstDeath: {
    seconds: number;
    cls: ClassId;
    cause: "golpe" | "cataclismo";
  } | null;
  damage: number;
  /** Fração de HP que sobrou em cada inimigo. */
  enemiesLeft: number[];
  heroes: FighterResult[];
}
