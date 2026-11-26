import {
  type FrameAggro,
  balance as B,
} from "@muchat/space-core/game/ot/balance";

/**
 * A ameaça na tela (26/11/2026, pedido do dono: "não tem feedback visual de quanto os bichos estão
 * provocados"). O quadro traz, por monstro, quem ele mira e a ameaça de cada herói em % da do alvo;
 * aqui vira o que o jogador lê: o alvo, quem está mais perto de puxar e o quanto falta.
 *
 * O monstro troca de alvo quando alguém passa de `cfg.threat.switchAt` (110%) da ameaça do alvo.
 * Seguro abaixo de 80%; alerta de 80% até 100%; perigo de 100% em diante (a um passo de puxar).
 */
export type AggroLevel = "seguro" | "alerta" | "perigo";

export const AGGRO_SWITCH_PCT = Math.round(B.cfg.threat.switchAt * 100);

export function aggroLevel(pct: number): AggroLevel {
  if (pct >= 100) return "perigo";
  if (pct >= 80) return "alerta";
  return "seguro";
}

/** A barra até o ponto em que o monstro troca de alvo (cheia = puxou). */
export function aggroFill(pct: number): number {
  return Math.max(0, Math.min(1, pct / AGGRO_SWITCH_PCT));
}

export interface AggroView {
  /** O monstro (índice na sala). */
  i: number;
  /** O herói que ele mira (−1: ninguém). */
  target: number;
  /** Quem está mais perto de puxar (fora do alvo); null: só o alvo tem ameaça. */
  rival: { i: number; pct: number } | null;
  level: AggroLevel;
  /** Todos os heróis com ameaça, do maior para o menor (o alvo primeiro, com 100%). */
  all: { i: number; pct: number }[];
}

/** Os monstros vivos do quadro com a ameaça de cada um (os caídos ficam de fora). */
export function aggroViews(
  g: readonly (FrameAggro | null)[] | undefined,
  hp: readonly number[],
): AggroView[] {
  const out: AggroView[] = [];
  for (const [i, x] of (g ?? []).entries()) {
    if (!x || (hp[i] ?? 0) <= 0) continue;
    const all = x.p
      .map((pct, h) => ({ i: h, pct }))
      .filter((r) => r.i === x.a || r.pct > 0)
      .sort(
        (a, b) => b.pct - a.pct || Number(b.i === x.a) - Number(a.i === x.a),
      );
    let rival: AggroView["rival"] = null;
    for (const r of all)
      if (r.i !== x.a && (!rival || r.pct > rival.pct)) rival = r;
    out.push({
      i,
      target: x.a,
      rival,
      level: aggroLevel(rival?.pct ?? 0),
      all,
    });
  }
  return out;
}
