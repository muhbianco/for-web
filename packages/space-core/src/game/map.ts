import { type Degree, type EnemyId, RULES } from "./data.ts";
import type { Rng } from "./rng.ts";

export type NodeType = "combate" | "elite" | "tesouro" | "evento" | "loja" | "descanso" | "chefe";

/** Uma sala; `next` são as trilhas da linha seguinte que ela alcança. */
export interface MapNode {
  type: NodeType;
  next: number[];
}

/** Linhas da expedição (a última é o chefe, com uma sala só). */
export type RunMap = MapNode[][];

const NODE_WEIGHTS: Record<Exclude<NodeType, "chefe">, number> = { combate: 45, evento: 15, tesouro: 10, loja: 10, descanso: 10, elite: 10 };

/**
 * Sete linhas de três trilhas e o chefe na oitava. A linha 1 é sempre combate,
 * elite só a partir da linha 4 e a trilha do meio da linha 7 é descanso. Cada
 * sala liga à mesma trilha e, metade das vezes, a uma vizinha.
 */
export function generateMap(rng: Rng): RunMap {
  const rows: RunMap = [];
  for (let r = 1; r < RULES.rows; r++) {
    const row: MapNode[] = [];
    for (let lane = 0; lane < RULES.lanes; lane++) {
      let type: NodeType = r === 1 ? "combate" : rng.weighted(NODE_WEIGHTS);
      if (type === "elite" && r < 4) type = "combate";
      if (r === RULES.rows - 1 && lane === 1) type = "descanso";
      row.push({ type, next: [] });
    }
    rows.push(row);
  }
  rows.push([{ type: "chefe", next: [] }]);
  for (let r = 0; r < rows.length - 1; r++) {
    for (const [lane, n] of rows[r]!.entries()) {
      if (r === rows.length - 2) n.next = [0];
      else {
        n.next = [lane];
        const side = lane + (rng.bp(5000) ? 1 : -1);
        if (side >= 0 && side < RULES.lanes) n.next.push(side);
      }
    }
  }
  return rows;
}

/** Iniciação: a primeira expedição de todo herói, fixa e curta (combate, tesouro, combate, descanso, chefe). */
export function initiationMap(): RunMap {
  const types: NodeType[] = ["combate", "tesouro", "combate", "descanso"];
  const rows: RunMap = types.map((type, r) =>
    Array.from({ length: RULES.lanes }, (_, lane) => ({ type, next: r === types.length - 1 ? [0] : [lane] })),
  );
  rows.push([{ type: "chefe", next: [] }]);
  return rows;
}

/** Inimigos de uma sala de luta (linha contada a partir de 1). */
export function encounter(rng: Rng, row: number, type: NodeType, degree: Degree): EnemyId[] {
  if (type === "chefe") return ["matriarca"];
  if (type === "elite") return ["ossario", "esqueleto"];
  const extra = degree === "normal" ? 0 : 1;
  const n = row <= 1 ? 2 : row <= 5 ? rng.int(2, 2 + extra) : rng.int(2 + extra, 3 + extra);
  const pool: EnemyId[] = row <= 2 ? ["rato", "rato", "fungo", "esqueleto"] : ["rato", "esqueleto", "fungo"];
  return Array.from({ length: n }, () => rng.pick(pool));
}
