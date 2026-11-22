import { RULES } from "./data.ts";

/**
 * Curvas de progressão como tabelas inteiras, montadas uma vez com BigInt.
 * `**` e `Math.pow` com resultado fracionário não têm garantia de dar o mesmo
 * bit em todo motor JS (ADR 0009, decisão 4); multiplicar e dividir inteiros tem.
 *
 * Skill: tentativas de L para L+1 = 60 × 1,15^(L−1) × custo da classe.
 * Nível: experiência de L para L+1 = 100 × L^1,5 × 1,06^(L−1).
 */

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Tentativas de L para L+1 em milésimos, antes do custo da classe (índice = L). */
const SKILL_MILLI: readonly bigint[] = (() => {
  const out: bigint[] = [0n, 60_000n];
  for (let l = 2; l <= RULES.maxSkill + 1; l++) out.push((out[l - 1]! * 115n) / 100n);
  return out;
})();

const XP_TABLE: readonly number[] = (() => {
  const out: number[] = [0];
  let growth = 1_000_000n; // 1,06^(L−1) em milionésimos
  for (let l = 1; l <= RULES.maxLevel; l++) {
    const L = BigInt(l);
    const pow15Milli = isqrt(L * L * L * 1_000_000n); // L^1,5 × 1000
    out.push(Number((100n * pow15Milli * growth + 500_000_000n) / 1_000_000_000n));
    growth = (growth * 106n) / 100n;
  }
  return out;
})();

/** Tentativas para subir a skill de `level` para `level + 1` (custo da classe em décimos). */
export function skillTriesToNext(level: number, cost10: number): number {
  const base = SKILL_MILLI[Math.min(Math.max(1, level), RULES.maxSkill)]!;
  return Number((base * BigInt(cost10) + 5_000n) / 10_000n);
}

/** Experiência para subir de `level` para `level + 1`. */
export function xpToNext(level: number): number {
  return XP_TABLE[Math.min(Math.max(1, level), RULES.maxLevel)]!;
}

/** Aplica tentativas a uma skill: novo nível e progresso. Laço limitado pelo teto da skill. */
export function addSkillTries(level: number, progress: number, tries: number, cost10: number): { level: number; progress: number } {
  let l = level;
  let p = progress + Math.max(0, Math.floor(tries));
  while (l < RULES.maxSkill) {
    const need = skillTriesToNext(l, cost10);
    if (p < need) break;
    p -= need;
    l++;
  }
  if (l >= RULES.maxSkill) p = 0;
  return { level: l, progress: p };
}

/** Aplica experiência: novo nível e experiência dentro do nível. Laço limitado pelo teto do nível. */
export function addXp(level: number, xp: number, gained: number): { level: number; xp: number } {
  let l = level;
  let x = xp + Math.max(0, Math.floor(gained));
  while (l < RULES.maxLevel) {
    const need = xpToNext(l);
    if (x < need) break;
    x -= need;
    l++;
  }
  if (l >= RULES.maxLevel) x = 0;
  return { level: l, xp: x };
}
