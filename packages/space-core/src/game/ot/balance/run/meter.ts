import { FOE_BASE } from "../combat/types.ts";
import type { RunFrame } from "./simulate.ts";

/**
 * O medidor da corrida (26/11/2026, o "Details" do jogo): o dano que cada herói causou, o que
 * recebeu e o que curou, somados dos eventos dos quadros (golpes, skills, DoTs, curas e poções).
 * Puro: o servidor manda o total até agora para quem chega no meio, e o app soma os quadros que
 * chegam depois. O divisor do DPS e do HPS é o segundo da corrida (desde a D40 não há descanso
 * entre as salas).
 */
export interface RunMeter {
  /** O último segundo da corrida somado. */
  s: number;
  dmg: number[];
  taken: number[];
  heal: number[];
  /** O dano de cada herói por origem: o id da skill, ou "auto" (ataque básico). */
  dmgBy: Record<string, number>[];
  /** A cura de cada herói por origem: o id da skill, ou "pocao". */
  healBy: Record<string, number>[];
}

export function emptyMeter(heroes: number): RunMeter {
  return {
    s: 0,
    dmg: Array.from({ length: heroes }, () => 0),
    taken: Array.from({ length: heroes }, () => 0),
    heal: Array.from({ length: heroes }, () => 0),
    dmgBy: Array.from({ length: heroes }, () => ({})),
    healBy: Array.from({ length: heroes }, () => ({})),
  };
}

const bump = (m: Record<string, number> | undefined, k: string, v: number) => {
  if (m) m[k] = (m[k] ?? 0) + v;
};

/**
 * Soma um segundo ao medidor (muda `m`). Um quadro já somado (`f.s <= m.s`) fica de fora, então
 * repetir um envio não conta duas vezes.
 */
export function addFrame(m: RunMeter, f: RunFrame): void {
  if (f.s <= m.s) return;
  m.s = f.s;
  const n = m.dmg.length;
  for (const ev of f.e) {
    if (ev.k !== "golpe" && ev.k !== "magia") continue;
    if (!(ev.v > 0)) continue;
    if (ev.k === "magia" && ev.cura) {
      // Cura de herói (skills, HoTs, roubo de vida e poção: a poção vem como cura de "pocao").
      if (ev.a < n) {
        m.heal[ev.a]! += ev.v;
        bump(m.healBy[ev.a], ev.s, ev.v);
      }
      continue;
    }
    if (ev.a < FOE_BASE && ev.b >= FOE_BASE) {
      if (ev.a < n) {
        m.dmg[ev.a]! += ev.v;
        bump(m.dmgBy[ev.a], ev.k === "golpe" ? "auto" : ev.s, ev.v);
      }
    } else if (ev.a >= FOE_BASE && ev.b < n) m.taken[ev.b]! += ev.v;
  }
}

/** O medidor dos primeiros `upTo` segundos (o servidor, para quem chega no meio). */
export function meterOf(
  frames: readonly RunFrame[],
  heroes: number,
  upTo: number = frames.length,
): RunMeter {
  const m = emptyMeter(heroes);
  for (let i = 0; i < Math.min(upTo, frames.length); i++)
    addFrame(m, frames[i]!);
  return m;
}

/** Uma cópia que dá para somar sem mexer na original (o estado do app é imutável). */
export function cloneMeter(m: RunMeter): RunMeter {
  return {
    s: m.s,
    dmg: [...m.dmg],
    taken: [...m.taken],
    heal: [...m.heal],
    dmgBy: m.dmgBy.map((x) => ({ ...x })),
    healBy: m.healBy.map((x) => ({ ...x })),
  };
}
