import type {
  Condition,
  DamagePart,
  Effect,
  SkillHook,
} from "../combat/types.ts";
import type { MechanicDef, MechanicMod } from "./schema.ts";

/** Vocabulário curto para escrever as 42 skills do §8 sem ruído. */

export const SEMPRE: Condition = { kind: "sempre" };
export const SO_EM_CHEFE: Condition = { kind: "soEmChefe" };
export const SENDO_ALVO: Condition = { kind: "sendoAlvo" };
export const CHEFE_PREPARANDO: Condition = { kind: "chefePreparando" };
export const PERDI_AGGRO: Condition = { kind: "perdiAggro" };
export const ALIADO_CAIDO: Condition = { kind: "aliadoCaido" };
export const ALIADO_AMALDICOADO: Condition = { kind: "aliadoAmaldicoado" };
export const PRECISA_CURA: Condition = { kind: "precisaCura" };
export const inimigos = (min: number): Condition => ({ kind: "inimigos", min });
export const aliado = (pct: number): Condition => ({
  kind: "aliadoAbaixo",
  pct,
});
export const aliados = (min: number, pct: number): Condition => ({
  kind: "aliadosAbaixo",
  pct,
  min,
});
export const meuHp = (pct: number): Condition => ({ kind: "meuHpAbaixo", pct });
export const aliadoMp = (pct: number): Condition => ({
  kind: "aliadoComMpAbaixo",
  pct,
});

export const fis = (coef: number): DamagePart => ({ element: "fisico", coef });
export const mag = (coef: number): DamagePart => ({ element: "magico", coef });
export const sag = (coef: number): DamagePart => ({ element: "sagrado", coef });

export const s = (ms: number) => ms * 1000;

export function mech(
  id: string,
  name: string,
  unlockTier: 2 | 3 | 4,
  text: string,
  mods: MechanicMod[],
  atMax?: MechanicMod[],
): MechanicDef {
  return { id, name, unlockTier, text, mods, ...(atMax ? { atMax } : {}) };
}

export const duracao = (effects: number[], perUpMs: number): MechanicMod => ({
  kind: "duracao",
  effects,
  perUpMs,
});
export const valor = (
  effect: number,
  field: string,
  perUp: number,
): MechanicMod => ({
  kind: "valor",
  effect,
  field,
  perUp,
});
export const potencia = (effects: number[], perUp: number): MechanicMod => ({
  kind: "potencia",
  effects,
  perUp,
});
export const recarga = (perUpMs: number): MechanicMod => ({
  kind: "recarga",
  perUpMs,
});
export const efeito = (
  add: Effect,
  fields: string[],
  perUp: number,
): MechanicMod => ({
  kind: "efeito",
  add,
  fields,
  perUp,
});
export const gancho = (
  add: SkillHook,
  field: string,
  perUp: number,
): MechanicMod => ({
  kind: "gancho",
  add,
  field,
  perUp,
});
export const fixo = (o: {
  effects?: Effect[];
  hooks?: SkillHook[];
}): MechanicMod => ({
  kind: "fixo",
  ...o,
});
