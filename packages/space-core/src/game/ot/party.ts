import type { VocationId } from "./data.ts";
import { VOCATIONS } from "./data.ts";

/**
 * Grupo (party) do TFS, usado no grupo da dungeon. [nosso] No OT, quem não cumpre uma
 * condição desliga a divisão para todos; aqui, como todos estão na mesma dungeon, a
 * distância de 30 tiles e a atividade recente já valem por estar lá.
 */

/** Level mínimo para dividir: `ceil(maior level × 2/3)` [TFS party.cpp:401-410]. */
export function minShareLevel(highestLevel: number): number {
  return Math.ceil((highestLevel * 2) / 3);
}

/** Todos podem dividir? [TFS party.cpp:433-447]. */
export function canShare(levels: readonly number[]): boolean {
  if (levels.length < 2) return false;
  const min = minShareLevel(Math.max(...levels));
  return levels.every((l) => l >= min);
}

/**
 * Multiplicador da experiência dividida [TFS data/events/scripts/party.lua:43-63]:
 * 1,20 com uma vocação; com k vocações base diferentes, `1 + k·(5(k−1) + 10)/100`.
 */
export function sharedMultiplier(vocations: readonly VocationId[]): number {
  const bases = new Set<VocationId>();
  for (const v of vocations) {
    const base = VOCATIONS[v].base;
    if (base !== 0) bases.add(base);
  }
  const k = bases.size;
  return k > 1 ? 1 + (k * (5 * (k - 1) + 10)) / 100 : 1.2;
}

/** A parte de cada membro: `ceil(exp × multiplicador / membros)` [TFS party.lua:65]. */
export function sharedExperience(
  exp: number,
  vocations: readonly VocationId[],
): number {
  if (vocations.length === 0) return 0;
  return Math.ceil((exp * sharedMultiplier(vocations)) / vocations.length);
}

/**
 * Sem divisão, cada um recebe a experiência do monstro × a fração do dano que causou
 * [TFS creature.cpp:887-910].
 */
export function damageShare(
  exp: number,
  damageByMember: readonly number[],
): number[] {
  const total = damageByMember.reduce((a, b) => a + b, 0);
  return damageByMember.map((d) =>
    total === 0 ? 0 : Math.floor((d / total) * exp),
  );
}
