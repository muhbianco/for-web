import type { Rng } from "../rng.ts";
import type { Vocation } from "./data.ts";

/**
 * Fórmulas de combate do TFS (commit 1561fa91). Cada função cita o original. Os sorteios
 * usam o `Rng` do jogo (sfc32) no lugar do gerador do servidor do OT; as distribuições são
 * as mesmas.
 */

/** Modo de luta [TFS player.cpp:409-435]. */
export type FightMode = "ataque" | "equilibrado" | "defesa";

/** Divisor do dano por modo [TFS player.cpp:409-421]. */
export const ATTACK_FACTOR: Readonly<Record<FightMode, number>> = {
  ataque: 1.0,
  equilibrado: 1.2,
  defesa: 2.0,
};

/**
 * Fator da defesa [TFS player.cpp:423-435]: logo depois de atacar (dentro da velocidade
 * de ataque), o modo ataque defende pela metade e o equilibrado por 3/4.
 */
export function defenseFactor(
  mode: FightMode,
  attackedRecently: boolean,
): number {
  if (!attackedRecently) return 1.0;
  return mode === "ataque" ? 0.5 : mode === "equilibrado" ? 0.75 : 1.0;
}

/** Inteiro uniforme em [a, b] [TFS tools.cpp uniform_random]. */
export function uniformRandom(rng: Rng, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return rng.int(lo, hi);
}

/** Uniforme em (0, 1] a partir de 32 bits do `Rng`. */
function unit(rng: Rng): number {
  return (rng.u32() + 1) / 4_294_967_296;
}

/**
 * Inteiro "normal" em [a, b] [TFS tools.cpp:190-201]: v ~ N(0,5; 0,25) sorteado de novo
 * até cair em [0, 1], e `a + round(v·(b − a))`. A normal vem de Box–Muller.
 */
export function normalRandom(rng: Rng, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let v: number;
  do {
    const z =
      Math.sqrt(-2 * Math.log(unit(rng))) * Math.cos(2 * Math.PI * unit(rng));
    v = 0.5 + 0.25 * z;
  } while (v < 0 || v > 1);
  return lo + Math.round(v * (hi - lo));
}

/**
 * Dano máximo de um golpe de arma do jogador [TFS weapons.cpp:123-127]:
 * `round(level/5 + ((skill/4 + 1) · (ataque/3) · 1,03) / fatorDeAtaque)`, com a divisão
 * inteira do level do original.
 */
export function maxWeaponDamage(
  level: number,
  skill: number,
  attack: number,
  attackFactor: number,
): number {
  return Math.round(
    Math.floor(level / 5) +
      ((skill / 4 + 1) * (attack / 3) * 1.03) / attackFactor,
  );
}

export interface Striker {
  level: number;
  /** Skill da arma (ou punhos sem arma). */
  skill: number;
  /** Ataque da arma; 7 de punhos [TFS weapons.cpp:349-362]. */
  attack: number;
  mode: FightMode;
  voc: Vocation;
}

/** Golpe corpo a corpo [TFS weapons.cpp:613-628]: normal entre 0 e o máximo × multiplicador da vocação. */
export function meleeDamage(rng: Rng, s: Striker): number {
  const max = Math.trunc(
    maxWeaponDamage(s.level, s.skill, s.attack, ATTACK_FACTOR[s.mode]) *
      s.voc.meleeDamage,
  );
  return normalRandom(rng, 0, max);
}

/**
 * Golpe à distância [TFS weapons.cpp:827-836]: mínimo `ceil(level × 0,2)` contra monstro
 * (`× 0,1` contra jogador), máximo × multiplicador de distância da vocação.
 */
export function distanceDamage(rng: Rng, s: Striker, vsPlayer = false): number {
  const min = Math.ceil(s.level * (vsPlayer ? 0.1 : 0.2));
  const max = Math.trunc(
    maxWeaponDamage(s.level, s.skill, s.attack, ATTACK_FACTOR[s.mode]) *
      s.voc.distDamage,
  );
  return normalRandom(rng, min, max);
}

/** Teto de acerto à distância conforme a arma [TFS weapons.cpp:681-690]. */
export type HitCap = 75 | 90 | 100;

/**
 * Chance de acerto à distância, em % [TFS weapons.cpp:673-769], pela distância até o alvo
 * (1 a 7 tiles) e pela skill. Fora das tabelas vale a chance própria do item (`itemHitChance`).
 */
export function distanceHitChance(
  skill: number,
  distance: number,
  cap: HitCap,
  itemHitChance = 0,
): number {
  const m = (limit: number) => Math.min(skill, limit);
  const t = (x: number) => Math.trunc(Math.fround(x));
  if (cap === 75) {
    switch (distance) {
      case 1:
      case 5:
        return m(74) + 1;
      case 2:
        return t(m(28) * Math.fround(2.4)) + 8;
      case 3:
        return t(m(45) * Math.fround(1.55)) + 6;
      case 4:
        return t(m(58) * Math.fround(1.25)) + 3;
      case 6:
        return t(m(90) * Math.fround(0.8)) + 3;
      case 7:
        return t(m(104) * Math.fround(0.7)) + 2;
      default:
        return itemHitChance;
    }
  }
  if (cap === 90) {
    switch (distance) {
      case 1:
      case 5:
        return t(m(74) * Math.fround(1.2)) + 1;
      case 2:
        return t(m(28) * Math.fround(3.2));
      case 3:
        return m(45) * 2;
      case 4:
        return t(m(58) * Math.fround(1.55));
      case 6:
      case 7:
        return m(90);
      default:
        return itemHitChance;
    }
  }
  switch (distance) {
    case 1:
    case 5:
      return t(m(73) * Math.fround(1.35)) + 1;
    case 2:
      return t(m(30) * Math.fround(3.2)) + 4;
    case 3:
      return t(m(48) * Math.fround(2.05)) + 2;
    case 4:
      return t(m(65) * Math.fround(1.5)) + 2;
    case 6:
      return t(m(87) * Math.fround(1.2)) - 4;
    case 7:
      return t(m(90) * Math.fround(1.1)) + 1;
    default:
      return itemHitChance;
  }
}

/**
 * Chance de acerto do tiro com munição [TFS weapons.cpp:673-776]: teto 75, 90 ou 100 usa a
 * tabela; outro teto vale como chance fixa (a flecha, 91); o acerto do arco soma por cima.
 */
export function ammoHitChance(
  skill: number,
  distance: number,
  maxHitChance: number,
  bowHitChance = 0,
): number {
  const base =
    maxHitChance === 75 || maxHitChance === 90 || maxHitChance === 100
      ? distanceHitChance(skill, distance, maxHitChance)
      : maxHitChance;
  return base + bowHitChance;
}

/** O golpe à distância acerta? `chance >= uniforme(1, 100)` [TFS weapons.cpp:780]. */
export function distanceHits(rng: Rng, chance: number): boolean {
  return chance >= uniformRandom(rng, 1, 100);
}

/** Máximo do golpe de um monstro dado por skill e ataque [TFS weapons.cpp:117-120]. */
export function monsterMeleeMax(skill: number, attack: number): number {
  return Math.ceil(skill * (attack * 0.05) + attack * 0.5);
}

/**
 * Defesa do jogador [TFS player.cpp:367-396]:
 * `(skillDeDefesa/4 + 2,23) × valorDeDefesa × 0,15 × fatorDeDefesa × multiplicador da vocação`.
 * Com skill de defesa 0: 1 no ataque e no equilibrado, 2 na defesa.
 */
export function playerDefense(
  defenseSkill: number,
  defenseValue: number,
  mode: FightMode,
  factor: number,
  voc: Vocation,
): number {
  if (defenseSkill === 0) return mode === "defesa" ? 2 : 1;
  return Math.trunc(
    (defenseSkill / 4 + 2.23) * defenseValue * 0.15 * factor * voc.defense,
  );
}

/** Armadura do jogador: a soma das peças × multiplicador da vocação [TFS player.cpp:321-334]. */
export function playerArmor(pieces: readonly number[], voc: Vocation): number {
  let sum = 0;
  for (const p of pieces) sum += p;
  return Math.trunc(sum * voc.armor);
}

/** Como o golpe foi segurado [TFS enums.h BlockType_t]. */
export type BlockType = "none" | "defense" | "armor" | "immunity";

export interface BlockInput {
  /** Dano positivo antes de segurar. */
  damage: number;
  defense: number;
  armor: number;
  /** O golpe passa pela defesa (escudo/arma) e pela armadura. */
  checkDefense: boolean;
  checkArmor: boolean;
  /** Bloqueios que sobram neste segundo (até 2) [TFS creature.cpp:132-135]. */
  blocks: number;
  immune?: boolean;
}

/**
 * Segura o golpe [TFS creature.cpp:633-672]. A defesa tira `uniforme(def/2, def)` e só
 * entra se houver bloqueio disponível; a armadura tira `uniforme(arm/2, arm − (arm%2 + 1))`
 * (com armadura até 3, só 1).
 */
export function blockHit(
  rng: Rng,
  b: BlockInput,
): { damage: number; type: BlockType; blocks: number } {
  if (b.immune) return { damage: 0, type: "immunity", blocks: b.blocks };
  let damage = b.damage;
  let type: BlockType = "none";
  let blocks = b.blocks;
  let checkArmor = b.checkArmor;
  if (b.checkDefense || b.checkArmor) {
    let hasDefense = false;
    if (blocks > 0) {
      blocks--;
      hasDefense = true;
    }
    if (b.checkDefense && hasDefense) {
      damage -= uniformRandom(rng, Math.trunc(b.defense / 2), b.defense);
      if (damage <= 0) {
        damage = 0;
        type = "defense";
        checkArmor = false;
      }
    }
    if (checkArmor) {
      if (b.armor > 3)
        damage -= uniformRandom(
          rng,
          Math.trunc(b.armor / 2),
          b.armor - ((b.armor % 2) + 1),
        );
      else if (b.armor > 0) damage -= 1;
      if (damage <= 0) {
        damage = 0;
        type = "armor";
      }
    }
  }
  return { damage, type, blocks };
}

/** Bloqueios recuperados: +1 por segundo, até 2 [TFS creature.cpp:132-135]. */
export function regainBlocks(blocks: number, elapsedMs: number): number {
  return Math.min(2, blocks + Math.floor(elapsedMs / 1000));
}

/**
 * A "regra do sangue" de quem ataca [TFS player.cpp:1932-1958]: um golpe só dá tentativa
 * se feriu o alvo, ou se feriu nos últimos 30 golpes; e o escudo de quem ataca só sobe
 * enquanto ele está ferindo o próprio alvo.
 */
export interface BloodState {
  lastBlock: BlockType;
  addAttackSkill: boolean;
  bloodHitCount: number;
  shieldBlockCount: number;
}

export function freshBlood(): BloodState {
  return {
    lastBlock: "none",
    addAttackSkill: false,
    bloodHitCount: 0,
    shieldBlockCount: 0,
  };
}

/** Atualiza a regra do sangue com o resultado do golpe no alvo [TFS player.cpp:1932-1958]. */
export function onTargetBlock(s: BloodState, type: BlockType): BloodState {
  switch (type) {
    case "none":
      return {
        lastBlock: type,
        addAttackSkill: true,
        bloodHitCount: 30,
        shieldBlockCount: 30,
      };
    case "defense":
    case "armor":
      return s.bloodHitCount > 0
        ? {
            ...s,
            lastBlock: type,
            addAttackSkill: true,
            bloodHitCount: s.bloodHitCount - 1,
          }
        : { ...s, lastBlock: type, addAttackSkill: false };
    default:
      return { ...s, lastBlock: type, addAttackSkill: false };
  }
}

/** Tentativas de um golpe corpo a corpo [TFS weapons.cpp:568-574]. */
export function meleeSkillPoint(s: BloodState): number {
  return s.addAttackSkill && s.lastBlock !== "immunity" ? 1 : 0;
}

/** Tentativas de um golpe à distância [TFS weapons.cpp:874-899]: 2 se acertou em cheio, 1 se segurado. */
export function distanceSkillPoint(s: BloodState): number {
  if (!s.addAttackSkill) return 0;
  if (s.lastBlock === "none") return 2;
  if (s.lastBlock === "defense" || s.lastBlock === "armor") return 1;
  return 0;
}

/**
 * Quem defende com o escudo ganha uma tentativa por golpe segurado, enquanto estiver
 * ferindo o próprio alvo [TFS player.cpp:1921-1929].
 */
export function onOwnBlock(
  s: BloodState,
  hasShield: boolean,
): { state: BloodState; shieldTries: number } {
  if (s.shieldBlockCount <= 0) return { state: s, shieldTries: 0 };
  return {
    state: { ...s, shieldBlockCount: s.shieldBlockCount - 1 },
    shieldTries: hasShield ? 1 : 0,
  };
}

/**
 * Faixa de uma magia de ataque ou cura no formato das magias do TFS
 * (data/scripts/spells, data/scripts/runes): `level/5 + magicLevel·a + b`, com a divisão
 * do Lua (sem truncar o level) e o corte para inteiro de quem recebe o valor.
 */
export function magicRange(
  level: number,
  magicLevel: number,
  min: readonly [number, number],
  max: readonly [number, number],
): [number, number] {
  return [
    Math.trunc(level / 5 + magicLevel * min[0] + min[1]),
    Math.trunc(level / 5 + magicLevel * max[0] + max[1]),
  ];
}

/** Faixa de uma magia de arma: `level/5 + skill·ataque·k + b` (spells/attack/berserk.lua:9-10). */
export function weaponSpellRange(
  level: number,
  skill: number,
  attack: number,
  min: readonly [number, number],
  max: readonly [number, number],
): [number, number] {
  return [
    Math.trunc(level / 5 + skill * attack * min[0] + min[1]),
    Math.trunc(level / 5 + skill * attack * max[0] + max[1]),
  ];
}

/** Dano ou cura de uma magia: normal na faixa [TFS combat.cpp:73]. */
export function spellValue(rng: Rng, range: readonly [number, number]): number {
  return normalRandom(rng, range[0], range[1]);
}
