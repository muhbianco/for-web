import { z } from "zod";

import { MAX_FRAME_BYTES, PROTOCOL_VERSION } from "../protocol/messages.ts";
import { CLASS_IDS, type ClassId, type SkillId, SKILL_IDS, SLOTS, type Slot } from "./data.ts";
import { MAX_TACTIC_SPELLS, type Tactics } from "./fight.ts";
import type { Item } from "./items.ts";
import type { HeroCombat } from "./stats.ts";

/**
 * Comandos do Refúgio na WS do Espaço (ADR 0009, decisão 5). Ficam fora do
 * `ClientCommand` do mapa para o bundle do app não levar o jogo antes do painel:
 * o gateway tenta `parseGameCommand` antes de `parseCommand`.
 */

/** Aparência do herói: índices nas paletas do jogo (cosmético desbloqueado ou null). */
export const LOOK_LIMITS = { skin: 6, hair: 10, outfit: 8, trim: 8 } as const;

export const GameLookSchema = z
  .object({
    skin: z.number().int().min(0).max(LOOK_LIMITS.skin - 1),
    hair: z.number().int().min(0).max(LOOK_LIMITS.hair - 1),
    outfit: z.number().int().min(0).max(LOOK_LIMITS.outfit - 1),
    trim: z.number().int().min(0).max(LOOK_LIMITS.trim - 1),
    cosmetic: z.string().min(1).max(40).nullable(),
  })
  .strict();
export type GameLook = z.infer<typeof GameLookSchema>;

const env = { v: z.literal(PROTOCOL_VERSION), id: z.string().min(1).max(40) };
const itemId = z.string().min(1).max(16).regex(/^[0-9A-Za-z-]+$/);
const pct = z.number().int().min(10).max(90);

export const GameOpenCmd = z.object({ ...env, t: z.literal("game.open"), d: z.object({}).strict().optional() });
export const GameCreateCmd = z.object({
  ...env,
  t: z.literal("game.create"),
  d: z.object({ cls: z.enum(CLASS_IDS as [ClassId, ...ClassId[]]), look: GameLookSchema }).strict(),
});
export const GameLookCmd = z.object({ ...env, t: z.literal("game.look"), d: z.object({ look: GameLookSchema }).strict() });
export const GameTrainCmd = z.object({
  ...env,
  t: z.literal("game.train"),
  d: z.object({ skill: z.enum(SKILL_IDS as [SkillId, ...SkillId[]]) }).strict(),
});
export const GameEquipCmd = z.object({ ...env, t: z.literal("game.equip"), d: z.object({ item: itemId }).strict() });
export const GameUnequipCmd = z.object({
  ...env,
  t: z.literal("game.unequip"),
  d: z.object({ slot: z.enum(SLOTS as [Slot, ...Slot[]]) }).strict(),
});
export const GameSellCmd = z.object({ ...env, t: z.literal("game.sell"), d: z.object({ items: z.array(itemId).min(1).max(20) }).strict() });
/** Ofertas do Refúgio no MVP: poção e o próximo boneco. A decoração entra com a cena (E4). */
export const GAME_OFFERS = ["potion", "dummy"] as const;
export type GameOffer = (typeof GAME_OFFERS)[number];
export const GameBuyCmd = z.object({
  ...env,
  t: z.literal("game.buy"),
  d: z.object({ offer: z.enum(GAME_OFFERS), qty: z.number().int().min(1).max(10) }).strict(),
});
export const GameTacticsCmd = z.object({
  ...env,
  t: z.literal("game.tactics"),
  d: z
    .object({ order: z.array(z.string().min(1).max(40)).max(MAX_TACTIC_SPELLS), potion_at: pct, heal_at: pct })
    .strict(),
});

export const GameCommand = z.discriminatedUnion("t", [
  GameOpenCmd,
  GameCreateCmd,
  GameLookCmd,
  GameTrainCmd,
  GameEquipCmd,
  GameUnequipCmd,
  GameSellCmd,
  GameBuyCmd,
  GameTacticsCmd,
]);
export type GameCommand = z.infer<typeof GameCommand>;

/**
 * Lê um frame do jogo. `null` = não é comando do jogo (o gateway segue com o
 * parser do mapa); nunca lança.
 */
export function parseGameCommand(raw: string): { ok: true; cmd: GameCommand } | { ok: false; error: string } | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const t = (json as { t?: unknown }).t;
  if (typeof t !== "string" || !t.startsWith("game.")) return null;
  const res = GameCommand.safeParse(json);
  return res.success ? { ok: true, cmd: res.data } : { ok: false, error: "invalid_message" };
}

/** Tática no formato do protocolo (snake_case) ↔ regras. */
export function tacticsFromWire(d: { order: string[]; potion_at: number; heal_at: number }): Tactics {
  return { order: [...d.order], potionAt: d.potion_at, healAt: d.heal_at };
}

// ---- servidor → app ------------------------------------------------------------

export interface SkillView {
  l: number;
  p: number;
  /** Tentativas para o próximo nível. */
  next: number;
}

/** O herói como o app vê (a chave da expedição nunca vem aqui). */
export interface HeroView {
  cls: ClassId;
  look: GameLook;
  level: number;
  xp: number;
  xp_next: number;
  skills: Record<SkillId, SkillView>;
  /** Vida e mana agora (o Refúgio regenera pelo relógio). */
  hp: number;
  mp: number;
  max_hp: number;
  max_mp: number;
  training: { skill: SkillId; tier: number; since: number; cap_ms: number; tries_per_min10: number };
  gold: number;
  potions: number;
  tactics: { order: string[]; potion_at: number; heal_at: number };
  gear: Partial<Record<Slot, Item>>;
  bag: Item[];
  bag_max: number;
  /** Itens que chegaram com a bolsa cheia: guardar ou vender. */
  pending: Item[];
  initiation_done: boolean;
  /** Maior degrau vencido (0 = nenhum, 1 = Normal, 2 = Difícil, 3 = Pesadelo, 3 + N = Abismo N). */
  best: number;
  stats: { runs: number; wins: number; deaths: number; kills: number };
  cosmetics: string[];
  combat: HeroCombat;
}

export interface GameStateEvent {
  v: 1;
  t: "game.state";
  re?: string;
  d: {
    server_now: number;
    rev: number;
    hero: HeroView | null;
    /** Preços no Refúgio agora; null = esgotado (poções no máximo, boneco no último nível). */
    offers: { potion: number | null; dummy: { tier: number; cost: number } | null };
  };
}
