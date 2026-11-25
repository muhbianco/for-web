import type { KillEvent } from "../combat/types.ts";
import { type DungeonDef, dungeonType } from "../dungeons/catalog.ts";
import {
  type ArchetypeId,
  type Balance,
  type DungeonType,
  balance as gameBalance,
} from "../formulas.ts";
import type { RunResult } from "./simulate.ts";

/**
 * O que a corrida rende para cada herói (spec §13 e D4): XP, job e ouro de cada criatura divididos
 * entre quem estava vivo no abate; o bônus de fim só com vitória. Loot e minérios entram à parte
 * (`loot.ts`), porque saem do RNG.
 */

export interface HeroReward {
  xp: number;
  jobXp: number;
  gold: number;
}

export interface RunRewards {
  success: boolean;
  heroes: HeroReward[];
}

/** Um abate que rende: os invocados não contam (P65). */
export interface RewardKill {
  archetype: ArchetypeId;
  level: number;
  summoned: boolean;
  alive: boolean[];
}

/**
 * Δ de XP de cada herói contra um monstro de nível `m`: numa PT com até `sharedDeltaSpread` níveis de
 * diferença, todos usam a média da PT; acima disso, cada um usa o próprio nível (§13, P66).
 */
export function xpDeltas(
  levels: number[],
  m: number,
  B: Balance = gameBalance,
): number[] {
  const spread = Math.max(...levels) - Math.min(...levels);
  if (spread > B.cfg.rewards.sharedDeltaSpread) return levels.map((l) => l - m);
  const mean = Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
  return levels.map(() => mean - m);
}

/** XP total de uma criatura (antes de dividir): base × arquétipo × escala(n) × tipo × grupo. */
export function creatureXpTotal(
  m: number,
  arch: ArchetypeId,
  members: number,
  type: DungeonType,
  B: Balance = gameBalance,
): number {
  return B.creatureXpEach(m, arch, members, type) * members;
}

/** Ouro total de uma criatura: ouroLacaio(m) × arquétipo × tipo, com a escala(n) do grupo (P67). */
export function creatureGoldTotal(
  m: number,
  arch: ArchetypeId,
  members: number,
  type: DungeonType,
  B: Balance = gameBalance,
): number {
  const cfg = B.cfg;
  const scale = cfg.rewards.goldPartyScale ? B.partyScale(members, type) : 1;
  return (
    B.lacaioGold(m) * cfg.archetypes[arch].xp * cfg.dungeonType[type] * scale
  );
}

/** Recompensa de uma lista de abates (as salas de uma corrida, em ordem). */
export function rewardsFor(
  kills: RewardKill[],
  levels: number[],
  type: DungeonType,
  success: boolean,
  B: Balance = gameBalance,
): RunRewards {
  const n = levels.length;
  const xp = levels.map(() => 0);
  const gold = levels.map(() => 0);
  for (const k of kills) {
    if (k.summoned) continue;
    const alive = k.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
    if (alive.length === 0) continue;
    const deltas = xpDeltas(levels, k.level, B);
    const xpShare =
      creatureXpTotal(k.level, k.archetype, n, type, B) / alive.length;
    const goldShare =
      creatureGoldTotal(k.level, k.archetype, n, type, B) / alive.length;
    for (const i of alive) {
      xp[i]! += xpShare * B.xpLevelDiffMult(deltas[i]!);
      gold[i]! += goldShare;
    }
  }
  const end = success ? 1 + B.cfg.xp.endBonus : 1;
  return {
    success,
    heroes: levels.map((_, i) => {
      const total = Math.floor(xp[i]! * end);
      return {
        xp: total,
        jobXp: Math.floor(total * B.cfg.xp.jobShare),
        gold: Math.floor(gold[i]!),
      };
    }),
  };
}

/** Recompensa da corrida simulada: os abates de todas as salas; vitória = sucesso. */
export function runRewards(
  d: DungeonDef,
  levels: number[],
  run: RunResult,
  B: Balance = gameBalance,
): RunRewards {
  const kills: RewardKill[] = [];
  for (const room of run.rooms)
    for (const k of room.kills as KillEvent[]) kills.push(k);
  return rewardsFor(
    kills,
    levels,
    dungeonType(d),
    run.outcome === "vitoria",
    B,
  );
}
