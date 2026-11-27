import type { ArchetypeKey } from "../combat/types.ts";
import { type ClassId, type RarityId, RARITY_IDS } from "../content.ts";
import {
  type DungeonDef,
  dungeonRooms,
  dungeonType,
} from "../dungeons/catalog.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { type Material, materialOf } from "../items/generate.ts";
import { type Monsters, createMonsters } from "../monsters/generate.ts";
import {
  type LootSlot,
  lootSlots,
  lootSource,
  namedLegendaries,
} from "./loot.ts";

/**
 * As chances de drop de uma DG, em números para a tela (a TV): saem das mesmas peças que o sorteio
 * do servidor usa (`dungeonRooms` para quem está em cada sala, `cfg.loot` para a chance e a raridade
 * de cada fonte, `lootSlots` e os lendários com nome para o que a classe pode tirar). Nada aqui sorteia.
 *
 * A conta é a de uma corrida vencida com o grupo inteiro vivo até o fim: quem morre não leva o item
 * do abate (`lootFor`), então as chances de verdade só podem ser menores.
 */

export interface LootSourceOdds {
  archetype: ArchetypeKey;
  /** Quantas criaturas dessa fonte a corrida tem (as 4 salas; os invocados não dropam). */
  count: number;
  /** Nível do item que sai: o do monstro. */
  levels: { min: number; max: number };
  /** Itens por criatura (1: sempre um; acima de 1, na Caçada de 4 e 5, a fração é a chance de mais um). */
  chance: number;
  /** Um item para cada herói vivo no abate; senão, um item só, para um vivo sorteado. */
  perPlayer: boolean;
  /** A raridade do item, somando 1. */
  rarity: Record<RarityId, number>;
}

export interface DungeonLootOdds {
  partySize: number;
  sources: LootSourceOdds[];
  /** Para um herói do grupo, numa corrida inteira. */
  perHero: {
    /** Itens esperados. */
    items: number;
    /** Itens esperados de cada raridade. */
    expected: Record<RarityId, number>;
    /** Chance de levar pelo menos um item de cada raridade. */
    atLeastOne: Record<RarityId, number>;
  };
  itemLevels: { min: number; max: number };
  /** O material dos itens (dois quando a faixa de nível cruza a troca de região). */
  materials: Material[];
  /** Minério da região: por herói, uma corrida inteira (as 4 salas vencidas). */
  ore: { material: Material; perHero: number };
  /** Chance de cada herói levar ao menos uma Pedra de Proteção (só o chefe de Masmorra dá). */
  protectionStone: number;
  /** Com `cls`: os lugares que caem para a classe (cada um com a mesma chance). */
  slots: LootSlot[];
  /** Com `cls`: os lendários com nome (desde 27/11/2026 o Lendário é qualquer item do jogo, de qualquer classe). */
  legendaries: string[];
}

let cached: Monsters | null = null;
const monstersFor = (B: Balance) =>
  B === gameBalance ? (cached ??= createMonsters(B)) : createMonsters(B);

const zero = (): Record<RarityId, number> =>
  Object.fromEntries(RARITY_IDS.map((r) => [r, 0])) as Record<RarityId, number>;

/** A raridade da fonte somando 1 (todo herói tira Lendário: qualquer item do jogo, `rollLegendary`). */
function rarityOf(
  weights: Partial<Record<RarityId, number>>,
): Record<RarityId, number> {
  const out = zero();
  const total = Object.values(weights).reduce((a, w) => a + (w ?? 0), 0);
  if (total <= 0) return out;
  for (const [id, w] of Object.entries(weights) as [RarityId, number][])
    out[id] += w / total;
  return out;
}

/**
 * As chances de drop da DG para um grupo de `partySize` heróis. Com `cls`, os lugares são os da
 * classe (sem mão secundária, ela não cai); o Lendário é qualquer item do jogo.
 */
export function dungeonLootOdds(
  d: DungeonDef,
  partySize: number,
  cls?: ClassId,
  B: Balance = gameBalance,
): DungeonLootOdds {
  const n = Math.max(1, Math.floor(partySize));
  const loot = B.cfg.loot;
  const rooms = dungeonRooms(d, n, monstersFor(B));
  const byArch = new Map<
    ArchetypeKey,
    { count: number; min: number; max: number }
  >();
  let roomCount = 0;
  for (const room of rooms) {
    roomCount++;
    for (const e of room) {
      const s = byArch.get(e.archetype);
      if (s) {
        s.count++;
        s.min = Math.min(s.min, e.level);
        s.max = Math.max(s.max, e.level);
      } else byArch.set(e.archetype, { count: 1, min: e.level, max: e.level });
    }
  }

  const type = dungeonType(d);
  const sources: LootSourceOdds[] = [...byArch].map(([archetype, s]) => {
    const src = lootSource(archetype, type, n, B);
    return {
      archetype,
      count: s.count,
      levels: { min: s.min, max: s.max },
      chance: src.chance,
      perPlayer: src.perPlayer,
      rarity: rarityOf(src.rarity),
    };
  });

  const expected = zero();
  const missAll = Object.fromEntries(RARITY_IDS.map((r) => [r, 1])) as Record<
    RarityId,
    number
  >;
  let items = 0;
  let stoneMiss = 1;
  for (const s of sources) {
    // O item de uma fonte de grupo vai para um vivo sorteado: 1/n para cada um. Acima de 1 item por
    // abate (Caçada de 4 e 5), a parte inteira sai sempre e a fração por sorteio (`groupReceivers`).
    const share = s.perPlayer ? 1 : 1 / n;
    const whole = Math.floor(s.chance);
    const frac = s.chance - whole;
    items += s.count * s.chance * share;
    for (const r of RARITY_IDS) {
      const q = share * s.rarity[r];
      expected[r] += s.count * s.chance * q;
      missAll[r] *= ((1 - q) ** whole * (1 - frac * q)) ** s.count;
    }
    if (s.archetype === "chefe")
      stoneMiss *= (1 - loot.protectionStoneChance) ** s.count;
  }
  const atLeastOne = zero();
  for (const r of RARITY_IDS) atLeastOne[r] = 1 - missAll[r];

  const levels = sources.flatMap((s) => [s.levels.min, s.levels.max]);
  const itemLevels = { min: Math.min(...levels), max: Math.max(...levels) };
  const materials = [
    ...new Set([materialOf(itemLevels.min), materialOf(itemLevels.max)]),
  ];

  return {
    partySize: n,
    sources,
    perHero: { items, expected, atLeastOne },
    itemLevels,
    materials,
    ore: {
      material: materialOf(d.level),
      perHero: roomCount * loot.oresPerRoom,
    },
    protectionStone: 1 - stoneMiss,
    slots: cls ? lootSlots(cls) : [],
    legendaries: cls ? namedLegendaries().map((l) => l.id) : [],
  };
}
