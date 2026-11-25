import { type Stat, type Stats, STATS } from "./content.ts";
import { type Balance, balance as gameBalance } from "./formulas.ts";

/**
 * Regras de distribuição de atributos (spec §3): todos começam em 1, 5 pontos por nível acima do 1,
 * e a escada de custo sobe a cada 10 a partir do 51. Valem para o servidor (validar o pedido), para a
 * UI (custo do próximo ponto, pontos livres) e para a redistribuição no Mestre da evolução.
 */

export type AllocationError =
  | "atributo-invalido"
  | "valor-invalido"
  | "sem-pontos"
  | "pedido-vazio";

/** Pontos já gastos para chegar nestes valores. */
export function pointsSpent(stats: Stats, B: Balance = gameBalance): number {
  let total = 0;
  for (const s of STATS) total += B.statCostTo(stats[s]);
  return total;
}

/** Pontos livres no nível. Negativo quer dizer distribuição inválida para o nível. */
export function pointsFree(
  level: number,
  stats: Stats,
  B: Balance = gameBalance,
): number {
  return B.attributePoints(level) - pointsSpent(stats, B);
}

/** Custo para subir `stat` mais um ponto. */
export function nextPointCost(
  stats: Stats,
  stat: Stat,
  B: Balance = gameBalance,
): number {
  return B.statRaiseCost(stats[stat] + 1);
}

/** A distribuição é válida: inteiros, nenhum abaixo do inicial, e cabe nos pontos do nível. */
export function validAllocation(
  level: number,
  stats: Stats,
  B: Balance = gameBalance,
): boolean {
  const start = B.cfg.attributes.start;
  for (const s of STATS) {
    const v = stats[s];
    if (!Number.isInteger(v) || v < start) return false;
  }
  return pointsFree(level, stats, B) >= 0;
}

/** A distribuição de quem acabou de redistribuir: todos no inicial. */
export function resetAllocation(B: Balance = gameBalance): Stats {
  const start = B.cfg.attributes.start;
  return {
    FOR: start,
    AGI: start,
    VIT: start,
    INT: start,
    DES: start,
    SOR: start,
  };
}

/**
 * Aplica um pedido de "+N em cada atributo" (o que a UI marca antes de confirmar). Ou aplica tudo, ou
 * nada: a resposta diz por que recusou.
 */
export function raiseStats(
  level: number,
  stats: Stats,
  add: Partial<Record<Stat, number>>,
  B: Balance = gameBalance,
):
  | { ok: true; stats: Stats; spent: number }
  | { ok: false; error: AllocationError } {
  if (!validAllocation(level, stats, B))
    return { ok: false, error: "valor-invalido" };
  const next = { ...stats };
  let spent = 0;
  let any = false;
  for (const [k, n] of Object.entries(add)) {
    if (!(STATS as readonly string[]).includes(k))
      return { ok: false, error: "atributo-invalido" };
    if (n === undefined || n === 0) continue;
    if (!Number.isInteger(n) || n < 0)
      return { ok: false, error: "valor-invalido" };
    any = true;
    const s = k as Stat;
    for (let i = 0; i < n; i++) {
      spent += B.statRaiseCost(next[s] + 1);
      next[s] += 1;
    }
  }
  if (!any) return { ok: false, error: "pedido-vazio" };
  if (spent > pointsFree(level, stats, B))
    return { ok: false, error: "sem-pontos" };
  return { ok: true, stats: next, spent };
}
