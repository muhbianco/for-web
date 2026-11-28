import type { ArchetypeKey } from "../combat/types.ts";
import {
  type ClassId,
  type RarityId,
  ARMOR_SLOTS,
  ARMOR_WEIGHTS,
  CLASSES,
  FAMILY_IDS,
  OFFHAND_IDS,
} from "../content.ts";
import { type DungeonDef, dungeonType } from "../dungeons/catalog.ts";
import type { ItemInstance } from "../equipment.ts";
import {
  type Balance,
  type DungeonType,
  balance as gameBalance,
} from "../formulas.ts";
import {
  type ItemBase,
  type Material,
  type RandomSource,
  generateItem,
  materialOf,
} from "../items/generate.ts";
import { type LegendaryDef, LEGENDARIES } from "../items/legendary.ts";
import { perkClass, rollPerk } from "../items/perks.ts";
import type { RewardKill } from "./rewards.ts";
import type { RunResult } from "./simulate.ts";

/**
 * Drops da corrida (spec §13, P69). Lacaio e elite rolam uma vez por criatura e o item vai para um
 * herói vivo sorteado; chefe menor dá 1 item, chefe de masmorra e de região dão 1 para cada vivo no
 * abate. O item sai do nível do monstro, numa base que a classe de quem recebe usa. Minério da região
 * a cada sala vencida, para cada vivo no fim dela; Pedra de Proteção do chefe de masmorra.
 */

export interface LootDrop {
  hero: number;
  item: ItemInstance;
}

export interface RunLoot {
  items: LootDrop[];
  /** Minério de cada herói, por material. */
  ores: Partial<Record<Material, number>>[];
  protectionStones: number[];
}

const GEAR_SLOTS = [
  "arma",
  "secundaria",
  ...ARMOR_SLOTS,
  "colar",
  "anel",
] as const;

function pick<T>(list: readonly T[], rng: RandomSource): T {
  return list[Math.min(list.length - 1, Math.floor(rng.next() * list.length))]!;
}

/** Raridade pelos pesos da fonte (a ordem dos pesos é a da tabela). */
export function rollRarity(
  weights: Partial<Record<RarityId, number>>,
  rng: RandomSource,
): RarityId {
  const entries = Object.entries(weights) as [RarityId, number][];
  let x = rng.next() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [id, w] of entries) {
    x -= w;
    if (x < 0) return id;
  }
  return entries[entries.length - 1]![0];
}

export type LootSlot = (typeof GEAR_SLOTS)[number];

/** Os lugares que podem cair para a classe, todos com a mesma chance (sem mão secundária, sem ela). */
export function lootSlots(cls: ClassId): LootSlot[] {
  const c = CLASSES[cls];
  return GEAR_SLOTS.filter((s) => s !== "secundaria" || c.offhands.length > 0);
}

/** Uma base que a classe usa: a arma e a mão secundária dela; a armadura no peso dela. */
export function rollBase(cls: ClassId, rng: RandomSource): ItemBase {
  const c = CLASSES[cls];
  const slot = pick(lootSlots(cls), rng);
  if (slot === "arma") return { slot, family: pick(c.weapons, rng) };
  if (slot === "secundaria") return { slot, offhand: pick(c.offhands, rng) };
  if (slot === "colar" || slot === "anel") return { slot };
  return { slot, weight: c.armor };
}

/** Uma base qualquer do jogo, de qualquer classe: o lugar com a mesma chance, depois a família, a mão secundária ou o peso. */
export function rollAnyBase(rng: RandomSource): ItemBase {
  const slot = pick(GEAR_SLOTS, rng);
  if (slot === "arma") return { slot, family: pick(FAMILY_IDS, rng) };
  if (slot === "secundaria") return { slot, offhand: pick(OFFHAND_IDS, rng) };
  if (slot === "colar" || slot === "anel") return { slot };
  return { slot, weight: pick(ARMOR_WEIGHTS, rng) };
}

/** Os lendários com nome que podem cair (todos, para qualquer classe; a lista da TV). */
export function namedLegendaries(): LegendaryDef[] {
  return LEGENDARIES;
}

/**
 * O Lendário que cai (27/11/2026, pedido do dono: "todo herói consegue dropar qualquer item; se o amigo
 * quiser, trocam pelo Banqueiro; o perk sempre vem para a classe que dropou"). Uma rolagem:
 * - `loot.sharedLegendaryShare`: um de qualquer classe (a Coroa do Mentor), com o perk dele;
 * - `loot.namedLegendaryShare`: um dos lendários com nome, de qualquer classe; o perk de origem só se a
 *   skill dele for da classe de quem dropou, senão um perk rolado para ela;
 * - o resto: uma base qualquer do jogo, com um perk rolado para a classe de quem dropou.
 */
export function rollLegendary(
  cls: ClassId,
  ilvl: number,
  rng: RandomSource,
  B: Balance = gameBalance,
): ItemInstance {
  const loot = B.cfg.loot;
  const x = rng.next();
  const shared = LEGENDARIES.filter((l) => l.cls === null);
  const named = LEGENDARIES.filter((l) => l.cls !== null);
  if (shared.length > 0 && x < loot.sharedLegendaryShare) {
    const l = pick(shared, rng);
    return {
      ...generateItem(l.base, ilvl, "lendario", rng, B),
      legendary: l.id,
    };
  }
  if (
    named.length > 0 &&
    x < loot.sharedLegendaryShare + loot.namedLegendaryShare
  ) {
    const l = pick(named, rng);
    const item = {
      ...generateItem(l.base, ilvl, "lendario", rng, B),
      legendary: l.id,
    };
    return perkClass(l.perk) === cls
      ? item
      : { ...item, perks: [rollPerk(cls, [], rng)] };
  }
  return {
    ...generateItem(rollAnyBase(rng), ilvl, "lendario", rng, B),
    perks: [rollPerk(cls, [], rng)],
  };
}

/**
 * Um item para a classe: de Comum a Épico, numa base que ela usa; Lendário, qualquer item do jogo
 * (`rollLegendary`).
 */
export function rollItem(
  cls: ClassId,
  ilvl: number,
  rarity: RarityId,
  rng: RandomSource,
  B: Balance = gameBalance,
): ItemInstance {
  if (rarity === "lendario") return rollLegendary(cls, ilvl, rng, B);
  return generateItem(rollBase(cls, rng), ilvl, rarity, rng, B);
}

/** Uma fonte de drop para um grupo: itens por abate (passa de 1 na Caçada de 4 e 5), para quem, e a raridade. */
export interface GroupLootSource {
  /** Itens esperados por abate: a parte inteira sai sempre, a fração por sorteio. Com `perPlayer`, ≤ 1. */
  chance: number;
  perPlayer: boolean;
  rarity: Partial<Record<RarityId, number>>;
}

/**
 * A fonte de drop de um abate para um grupo de `members` heróis. Na Caçada com 4 ou 5 (27/11/2026,
 * pedido do dono), o drop cresce na proporção do grupo sobre o trio e cada item tem a chance a mais
 * de sair Lendário do config (`loot.huntLegendary`); no resto, a fonte do config como está.
 */
export function lootSource(
  archetype: ArchetypeKey,
  type: DungeonType | undefined,
  members: number,
  B: Balance = gameBalance,
): GroupLootSource {
  const loot = B.cfg.loot;
  const src: GroupLootSource = loot.sources[archetype];
  if (type === "masmorra") {
    // Masmorra de 4 e 5: o Lendário do chefe sobe (`loot.masmorraLegendary`); o resto encolhe junto.
    const target = loot.masmorraLegendary[members];
    if (target === undefined || src.rarity.lendario === undefined) return src;
    const others = (Object.entries(src.rarity) as [RarityId, number][]).filter(([id]) => id !== "lendario");
    const sum = others.reduce((a, [, w]) => a + w, 0);
    const rarity: Partial<Record<RarityId, number>> = {};
    for (const [id, w] of others) rarity[id] = (w / sum) * (1 - target);
    rarity.lendario = target;
    return { ...src, rarity };
  }
  if (type !== "cacada" || members < loot.huntGroupFrom) return src;
  const legendary = Math.min(1, loot.huntLegendary[members] ?? 0);
  const weights = Object.entries(src.rarity) as [RarityId, number][];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const rarity: Partial<Record<RarityId, number>> = {};
  for (const [id, w] of weights) rarity[id] = (w / total) * (1 - legendary);
  if (legendary > 0) rarity.lendario = (rarity.lendario ?? 0) + legendary;
  return {
    chance: src.perPlayer
      ? src.chance
      : (src.chance * members) / loot.huntDropBase,
    perPlayer: src.perPlayer,
    rarity,
  };
}

/**
 * Quem leva os itens de uma fonte de grupo: um vivo sorteado por item. Até 1 item por abate, um
 * sorteio só (o caminho de sempre, que a semente das corridas gravadas conhece); acima, a parte
 * inteira sai sempre e a fração por sorteio.
 */
function groupReceivers(
  chance: number,
  alive: number[],
  rng: RandomSource,
): number[] {
  if (chance <= 1) return rng.next() < chance ? [pick(alive, rng)] : [];
  const whole = Math.floor(chance);
  const out = Array.from({ length: whole }, () => pick(alive, rng));
  if (rng.next() < chance - whole) out.push(pick(alive, rng));
  return out;
}

/**
 * Os drops de uma lista de abates. `classes` na ordem dos heróis (o grupo inteiro, vivos e caídos);
 * `type` é o da DG (sem ele, as fontes do config sem o crescimento da Caçada de 4 e 5).
 */
export function lootFor(
  kills: RewardKill[],
  classes: ClassId[],
  rng: RandomSource,
  B: Balance = gameBalance,
  type?: DungeonType,
): { items: LootDrop[]; protectionStones: number[] } {
  const loot = B.cfg.loot;
  const items: LootDrop[] = [];
  const stones = classes.map(() => 0);
  for (const k of kills) {
    if (k.summoned) continue;
    const alive = k.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
    if (alive.length === 0) continue;
    const src = lootSource(k.archetype, type, classes.length, B);
    const receivers = src.perPlayer
      ? alive
      : groupReceivers(src.chance, alive, rng);
    for (const i of receivers)
      items.push({
        hero: i,
        // O item nunca passa do teto do herói (o fim de jogo, 501–600, não deixa ninguém mais forte).
        item: rollItem(
          classes[i]!,
          Math.min(B.cfg.levels.maxLevel, k.level),
          rollRarity(src.rarity, rng),
          rng,
          B,
        ),
      });
    if (k.archetype === "chefe")
      for (const i of alive)
        if (rng.next() < loot.protectionStoneChance) stones[i]!++;
  }
  return { items, protectionStones: stones };
}

/** Os drops da corrida simulada: itens dos abates e minério das salas vencidas. */
export function runLoot(
  d: DungeonDef,
  classes: ClassId[],
  run: RunResult,
  rng: RandomSource,
  B: Balance = gameBalance,
): RunLoot {
  const kills = run.rooms.flatMap((r) => r.kills);
  const { items, protectionStones } = lootFor(
    kills,
    classes,
    rng,
    B,
    dungeonType(d),
  );
  const material = materialOf(d.level);
  const ores = classes.map(() => ({}) as Partial<Record<Material, number>>);
  for (const room of run.rooms) {
    if (!room.win) continue;
    room.heroes.forEach((h, i) => {
      if (h.alive)
        ores[i]![material] = (ores[i]![material] ?? 0) + B.cfg.loot.oresPerRoom;
    });
  }
  return { items, ores, protectionStones };
}
