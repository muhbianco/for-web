import type { AvatarGear } from "@muchat/space-core";

import { type FxArt, ELEMENT_COLOR, heroGear } from "./heroArt.ts";

/**
 * O ataque do treino no mapa (pedido do dono, 23/11/2026): o herói que treina lança um tiro
 * até o dummy no ritmo de ataque da vocação [TFS vocations.xml attackspeed]. É só desenho: o
 * treino corre no servidor e não depende disto. Puro, para os testes em node.
 */

/** Quanto o tiro leva do herói ao dummy, e quanto o brilho do acerto dura. */
export const SHOT_FLIGHT_MS = 380;
export const SHOT_HIT_MS = 160;
/** O tiro anda a 30 quadros por segundo, no máximo (o resto do mapa segue sob demanda). */
export const SHOT_FRAME_MS = 33;

export interface TrainShot {
  art: FxArt;
  tint: number;
  /** O escudo gira no ar; o resto aponta para o dummy. */
  spin: boolean;
}

/** O ritmo do ataque no boneco: o mesmo para todas as classes (é só desenho). */
export function attackPeriod(_vocation: number | undefined): number {
  return 2000;
}

/**
 * O que sai do herói no `n`-ésimo ataque: o arco atira a flecha (ou o virote, se é a munição),
 * a besta o virote, a varinha e o cajado um orbe da cor do elemento; quem luta corpo a corpo
 * corta o ar e, a cada quatro golpes, arremessa o escudo (se tiver).
 */
export function shotFor(gear: AvatarGear, n: number): TrainShot {
  const g = heroGear(gear.weapon, gear.shield);
  switch (g.look) {
    case "arco":
      return {
        art: gear.ammo === "virote" ? "virote" : "flecha",
        tint: 0xffffff,
        spin: false,
      };
    case "besta":
      return { art: "virote", tint: 0xffffff, spin: false };
    case "varinha":
    case "cajado":
      return { art: "orbe", tint: ELEMENT_COLOR[g.element], spin: false };
    default:
      return g.shield && n % 4 === 3
        ? { art: "escudo", tint: 0xffffff, spin: true }
        : { art: "corte", tint: 0xe8f4ff, spin: false };
  }
}

/** Em que ataque e em que ponto dele estamos (`seed` espalha os heróis no tempo). */
export function shotPhase(nowMs: number, seed: number, periodMs: number): { n: number; phase: number } {
  const t = nowMs + seed;
  return { n: Math.floor(t / periodMs), phase: ((t % periodMs) + periodMs) % periodMs };
}

/** Semente estável por pessoa (FNV-1a), para dois heróis lado a lado não atirarem juntos. */
export function seedOf(userId: string): number {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) h = Math.imul(h ^ userId.charCodeAt(i), 16777619);
  return (h >>> 0) % 10_000;
}

/** Onde o tiro está: voando (0 a 1), no brilho do acerto, ou guardado. */
export function shotStage(phase: number): { kind: "flying"; t: number } | { kind: "hit" } | { kind: "idle" } {
  if (phase < SHOT_FLIGHT_MS) return { kind: "flying", t: phase / SHOT_FLIGHT_MS };
  if (phase < SHOT_FLIGHT_MS + SHOT_HIT_MS) return { kind: "hit" };
  return { kind: "idle" };
}
