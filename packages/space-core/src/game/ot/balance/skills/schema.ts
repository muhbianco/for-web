import { z } from "zod";

import type { Condition, Effect, SkillHook } from "../combat/types.ts";
import { type ClassId, CLASS_IDS } from "../content.ts";

/**
 * Skill como conteúdo (spec §7 e §8): os efeitos no rank 1, a IA padrão e os adereços. O que o jogador
 * escolhe (Potência, Eficiência e os ups de cada Mecânica) é aplicado por skills/compile.ts, que
 * entrega ao motor de luta a skill com os números já somados.
 */

export type TierNumber = 1 | 2 | 3 | 4;

/** Campo numérico de um efeito, em caminho simples (`value`, `durationMs`, `parts.0.coef`). */
export type FieldPath = string;

/**
 * O que um up de Mecânica faz:
 * - `duracao`: +ms na duração dos efeitos indicados;
 * - `valor`: + no campo do efeito (somado);
 * - `potencia`: × (1 + x) no número principal dos efeitos indicados (dano, cura, escudo);
 * - `recarga`: −ms na recarga da skill;
 * - `efeito`: acrescenta um efeito cujo(s) campo(s) vale(m) x por up;
 * - `gancho`: acrescenta um gancho de luta cujo campo vale x por up;
 * - `fixo` (só no 5/5): acrescenta efeitos/ganchos como estão.
 */
export type MechanicMod =
  | { kind: "duracao"; effects: number[]; perUpMs: number }
  | { kind: "valor"; effect: number; field: FieldPath; perUp: number }
  | { kind: "potencia"; effects: number[]; perUp: number }
  | { kind: "recarga"; perUpMs: number }
  | { kind: "efeito"; add: Effect; fields: FieldPath[]; perUp: number }
  | { kind: "gancho"; add: SkillHook; field: FieldPath; perUp: number }
  | { kind: "fixo"; effects?: Effect[]; hooks?: SkillHook[] }
  /** Corte percentual da recarga da própria skill (Arco do Vendaval: −20%). */
  | { kind: "corte"; pct: number };

export interface MechanicDef {
  id: string;
  name: string;
  /** Tier do herói que libera o adereço (§7). */
  unlockTier: 2 | 3 | 4;
  /** O texto do spec, para a UI e para quem lê. */
  text: string;
  /** O que cada up faz (pode ser mais de uma coisa: Renascer dá HP e tira recarga). */
  mods: MechanicMod[];
  /** O extra do 5/5, quando existe. */
  atMax?: MechanicMod[];
}

export interface SkillContent {
  id: string;
  name: string;
  cls: ClassId;
  tier: TierNumber;
  /** Rótulo do alvo para a UI (o motor lê o alvo de cada efeito). */
  target: string;
  cooldownMs: number;
  /** Custo em fração da mana-base da classe. */
  manaPct: number;
  threatMult?: number;
  castMs?: number;
  /** IA padrão (basta uma valer). */
  ai: Condition[];
  effects: Effect[];
  hooks?: SkillHook[];
  mechanics: MechanicDef[];
}

/**
 * Apoio puro (§7): só buff, debuff e provocação. A Potência dá −1% de recarga por rank e o valor do
 * buff não escala.
 */
export function isSupportSkill(s: Pick<SkillContent, "effects">): boolean {
  return s.effects.every((e) =>
    [
      "buff",
      "debuff",
      "provocar",
      "atordoar",
      "cortaAmeaca",
      "purificar",
      "escudoDeMana",
      "devocao",
    ].includes(e.type),
  );
}

const tierNumber = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
const anyObject = z.record(z.string(), z.unknown());

const MechanicModSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("duracao"),
    effects: z.array(z.number().int().min(0)).min(1),
    perUpMs: z.number().positive(),
  }),
  z.object({
    kind: z.literal("valor"),
    effect: z.number().int().min(0),
    field: z.string(),
    perUp: z.number().positive(),
  }),
  z.object({
    kind: z.literal("potencia"),
    effects: z.array(z.number().int().min(0)).min(1),
    perUp: z.number().positive(),
  }),
  z.object({ kind: z.literal("recarga"), perUpMs: z.number().positive() }),
  z.object({
    kind: z.literal("efeito"),
    add: anyObject,
    fields: z.array(z.string()).min(1),
    perUp: z.number().positive(),
  }),
  z.object({
    kind: z.literal("gancho"),
    add: anyObject,
    field: z.string(),
    perUp: z.number().positive(),
  }),
  z.object({
    kind: z.literal("fixo"),
    effects: z.array(anyObject).optional(),
    hooks: z.array(anyObject).optional(),
  }),
  z.object({ kind: z.literal("corte"), pct: z.number().positive() }),
]);

export const MechanicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unlockTier: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: z.string().min(1),
  mods: z.array(MechanicModSchema).min(1),
  atMax: z.array(MechanicModSchema).optional(),
});

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cls: z.enum(CLASS_IDS),
  tier: tierNumber,
  target: z.string().min(1),
  cooldownMs: z.number().positive(),
  manaPct: z.number().min(0).max(1),
  threatMult: z.number().positive().optional(),
  castMs: z.number().positive().optional(),
  ai: z.array(z.object({ kind: z.string() }).passthrough()).min(1),
  effects: z.array(z.object({ type: z.string() }).passthrough()).min(1),
  hooks: z.array(z.object({ on: z.string() }).passthrough()).optional(),
  mechanics: z.array(MechanicSchema),
});
