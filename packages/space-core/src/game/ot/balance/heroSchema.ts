import { z } from "zod";

import { validAllocation } from "./attributes.ts";
import {
  AFFIX_IDS,
  ARMOR_SLOTS,
  ARMOR_WEIGHTS,
  CLASS_IDS,
  FAMILY_IDS,
  OFFHAND_IDS,
  RARITY_IDS,
} from "./content.ts";
import { cannotEquip } from "./equipment.ts";
import { type Balance, balance as gameBalance } from "./formulas.ts";
import {
  BAG_SLOTS,
  HERO_VERSION,
  type HeroV5,
  type OwnedItem,
  balanceHero,
  fitItemRules,
  fitWornGear,
} from "./hero.ts";
import { MATERIALS } from "./items/generate.ts";
import { LEGENDARIES } from "./items/legendary.ts";
import { PERKS } from "./items/perks.ts";
import { skillPoints, skillPointsSpent } from "./skills/tree.ts";

/**
 * Validação do herói v5 lido do banco (Fase 8). Um documento que não passa NÃO é consertado em
 * silêncio (o erro do `normalizeHero` antigo, que zerava atributos e mochila): volta o motivo, e o
 * servidor recusa e registra.
 */

const count = z.number().int().min(0).max(1e12);
const common = {
  uid: z.string().min(1).max(64),
  ilvl: z.number().int().min(1).max(500),
  rarity: z.enum(RARITY_IDS),
  refine: z.number().int().min(0).max(10),
  affixes: z
    .array(z.object({ id: z.enum(AFFIX_IDS), value: z.number().finite() }))
    .max(6),
  legendary: z
    .string()
    .refine((x) => LEGENDARIES.some((l) => l.id === x))
    .optional(),
  // Os perks rolados no Ferreiro (27/11/2026): até 2 (o 2º só vale na Arma Suprema, D68).
  perks: z
    .array(
      z.object({
        skill: z.string().refine((x) => Object.hasOwn(PERKS, x)),
        value: z.number().finite().min(0).max(1e4),
      }),
    )
    .max(2)
    .optional(),
};
const item = z.union([
  z.object({
    ...common,
    slot: z.literal("arma"),
    family: z.enum(FAMILY_IDS),
    // D68 Arma Suprema: o a mais no dano base (0,10–0,20 hoje; o teto do schema é folga).
    supreme: z.object({ power: z.number().min(0).max(1) }).strict().optional(),
  }),
  z.object({
    ...common,
    slot: z.literal("secundaria"),
    offhand: z.enum(OFFHAND_IDS),
  }),
  z.object({
    ...common,
    slot: z.enum(ARMOR_SLOTS),
    weight: z.enum(ARMOR_WEIGHTS),
  }),
  z.object({ ...common, slot: z.enum(["colar", "anel"]) }),
]);
const itemList = z.array(item);
/** Confere uma lista de itens lida do banco com o esquema do herói (o baú compartilhado, 28/11/2026). */
export function checkItems(
  raw: unknown,
): { ok: true; items: OwnedItem[] } | { ok: false; reason: string } {
  const p = itemList.safeParse(raw);
  return p.success
    ? { ok: true, items: p.data as unknown as OwnedItem[] }
    : { ok: false, reason: `item ${p.error.issues[0]?.path.join(".") ?? "?"}` };
}
const stats = z.object({
  FOR: z.number().int().min(1),
  AGI: z.number().int().min(1),
  VIT: z.number().int().min(1),
  INT: z.number().int().min(1),
  DES: z.number().int().min(1),
  SOR: z.number().int().min(1),
});
const materials = z.partialRecord(z.enum(MATERIALS), count);

export const heroV5Schema = z.object({
  v: z.literal(HERO_VERSION),
  cls: z.enum(CLASS_IDS),
  level: z.number().int().min(1).max(500),
  xp: count,
  job: z.number().int().min(1).max(150),
  jobXp: count,
  proficiency: z.number().int().min(1).max(5000),
  proficiencyXp: z.number().min(0).finite(),
  attrs: stats,
  attrResets: z.number().int().min(0),
  skills: z.object({
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    builds: z.record(
      z.string(),
      z.object({
        potency: z.number().int().min(1).max(20),
        efficiency: z.number().int().min(0).max(5),
        mechanics: z.record(z.string(), z.number().int().min(0).max(5)),
      }),
    ),
    slots: z.array(z.string()).max(4),
    ai: z.record(z.string(), z.array(z.any()).min(1).max(3)),
    resets: z.number().int().min(0),
  }),
  equipment: z.record(z.string(), item),
  bag: z.array(item).max(BAG_SLOTS),
  gold: count,
  potions: z.object({
    hp: z.object({ pequena: count, media: count, grande: count }),
    mp: z.object({ pequena: count, media: count, grande: count }),
  }),
  belt: z.object({
    hp: z.enum(["pequena", "media", "grande"]),
    mp: z.enum(["pequena", "media", "grande"]),
  }),
  ammo: z.partialRecord(z.enum(["comum", "afiada", "runica"]), count),
  ores: materials,
  essence: count,
  stones: count,
  vault: z.object({
    gold: count,
    // Sem teto desde 27/11/2026 (o Banqueiro guarda tudo): um teto aqui tornaria o herói ilegível
    // no dia em que o cofre passasse dele. O limite físico é o do documento no Mongo.
    items: z.array(item),
    expansions: z.number().int().min(0).max(100),
  }),
  supplies: z.object({
    hp: z.number().min(0).max(1),
    mp: z.number().min(0).max(1),
  }),
  autoEquip: z.boolean(),
  dojo: z.object({ since: z.number().int().min(0) }).nullable(),
  itemRules: z.number().int().min(0).optional(),
});

export type HeroCheck =
  | {
      ok: true;
      hero: HeroV5;
      /** Peças tiradas por `fitGear` (regra de item que mudou). */
      gearMoved: number;
      /** Itens levados para a faixa de afixo de agora por `fitGear` (D64). */
      itemsRescaled: number;
    }
  | { ok: false; reason: string };

/** Confere forma e coerência (pontos, slots, cofre, ids únicos, o que está vestido cabe). */
export function checkHero(
  doc: unknown,
  B: Balance = gameBalance,
  opts: {
    /**
     * Antes de conferir o que está vestido, tira o que a regra de item de agora não deixa vestir
     * (`fitWornGear`, 27/11/2026). É o que a leitura do servidor usa; sem isso, a regra que mudou
     * recusaria o herói inteiro.
     */
    fitGear?: boolean;
  } = {},
): HeroCheck {
  const p = heroV5Schema.safeParse(doc);
  if (!p.success)
    return { ok: false, reason: `forma: ${p.error.issues[0]?.path.join(".")}` };
  const rules = opts.fitGear
    ? fitItemRules(p.data as unknown as HeroV5, B)
    : { hero: p.data as unknown as HeroV5, rescaled: 0 };
  const fit = opts.fitGear
    ? fitWornGear(rules.hero, B)
    : { hero: rules.hero, moved: [] };
  const h = fit.hero;
  if (!validAllocation(h.level, h.attrs, B))
    return { ok: false, reason: "atributos acima dos pontos do nível" };
  if (skillPointsSpent(h.skills) > skillPoints(h.job, B))
    return { ok: false, reason: "skills acima dos pontos do job" };
  const uids = [
    ...Object.values(h.equipment).map((x) => x!.uid),
    ...h.bag.map((x) => x.uid),
    ...h.vault.items.map((x) => x.uid),
  ];
  if (new Set(uids).size !== uids.length)
    return { ok: false, reason: "item repetido" };
  for (const [slot, it] of Object.entries(h.equipment)) {
    if (!it || it.slot !== slot) return { ok: false, reason: `slot ${slot}` };
    const others = { ...h.equipment } as Record<string, unknown>;
    delete others[slot];
    const err = cannotEquip(
      balanceHero({ ...h, equipment: others as HeroV5["equipment"] }),
      it,
      B,
    );
    // O requisito de nível vale para vestir, não para continuar vestido.
    if (err && err !== "nivel-baixo")
      return { ok: false, reason: `${slot}: ${err}` };
  }
  return {
    ok: true,
    hero: h,
    gearMoved: fit.moved.length,
    itemsRescaled: rules.rescaled,
  };
}
