import { CATALOG, itemOf } from "../decor/catalog.ts";
import { footprint } from "../decor/placement.ts";
import type { DecorCategory, DecorItem, Rotation } from "../decor/types.ts";

/**
 * A decoração do Refúgio (ADR 0009, GDD §12): o quarto pessoal do herói, com
 * itens do catálogo do Espaço comprados com o ouro do jogo. Regras puras: o
 * servidor valida com elas e o app usa as mesmas para mostrar onde cabe.
 *
 * O quarto tem 12 × 8 tiles: as linhas 0 a 2 são a parede (itens de parede nas
 * linhas 0 e 1) e as linhas 3 a 7 são o piso (tapetes, móveis e luminárias de teto).
 */
export const LOBBY = {
  w: 12,
  h: 8,
  /** Primeira linha do piso. */
  floorTop: 3,
  /** Linhas em que um item de parede pode ficar. */
  wallRows: [0, 1] as readonly number[],
  maxItems: 60,
  /** Tipos de item diferentes que o herói pode ter. */
  maxKinds: 200,
  maxPerItem: 99,
  /** Onde o boneco e o herói ficam: móvel não entra (tapete e luz de teto podem). */
  reserved: [
    { x: 9, y: 5 },
    { x: 6, y: 5 },
  ] as readonly { x: number; y: number }[],
} as const;

export interface LobbyItem {
  id: string;
  item: string;
  x: number;
  y: number;
  rot: Rotation;
  variant?: string;
}

/** Fora do Refúgio no MVP: objetos que precisam de configuração ou só funcionam numa sala (link, nota, TV, portal…). */
export function lobbyAllowed(item: DecorItem): boolean {
  return item.layer !== "floor" && !item.interaction && !item.smartTv;
}

export function lobbyItemOf(id: string): DecorItem | undefined {
  const it = itemOf(CATALOG, id);
  return it && lobbyAllowed(it) ? it : undefined;
}

/** Itens que a loja do Refúgio vende, na ordem do catálogo. */
export function lobbyCatalog(): DecorItem[] {
  return CATALOG.items.filter(lobbyAllowed);
}

const BASE_PRICE: Record<DecorCategory, number> = {
  floor: 0,
  rug: 300,
  furniture: 400,
  gamer: 800,
  decor: 300,
  lighting: 500,
  equipment: 900,
  special: 3000,
};

/** Peças de vitrine (GDD §11.1: luxo de 20 a 50 mil), acima da fórmula. */
const PRICE_OVERRIDE: Record<string, number> = {
  statue: 20_000,
  fountain: 35_000,
  "trophy-shelf": 5_000,
  "vending-machine": 2_000,
  "server-rack": 2_500,
  "drum-kit": 4_000,
};

/**
 * Preço em ouro: base da categoria × (1 + metade da área extra), arredondado a
 * 50. Item comum fica entre 300 e 800 (meio dia do jogador casual, GDD §11).
 */
export function lobbyPrice(item: DecorItem): number {
  const over = PRICE_OVERRIDE[item.id];
  if (over !== undefined) return over;
  const area = item.w * item.h;
  const raw = (BASE_PRICE[item.category] * (2 + (area - 1))) / 2;
  return Math.max(50, Math.round(raw / 50) * 50);
}

export interface TileBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function lobbyBox(item: DecorItem, li: Pick<LobbyItem, "x" | "y" | "rot">): TileBox {
  const { w, h } = footprint(item, li.rot);
  return { x0: li.x, y0: li.y, x1: li.x + w, y1: li.y + h };
}

const overlaps = (a: TileBox, b: TileBox) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export type LobbyError = "unknown_item" | "bad_rotation" | "bad_variant" | "out_of_bounds" | "overlap" | "reserved";

/**
 * Por que este item não pode ficar ali (null = pode). `items` são os já
 * colocados; `ignoreId` é o próprio item quando ele está sendo movido.
 * Cada camada só colide com ela mesma: tapete sob móvel, luz de teto sobre tudo.
 */
export function lobbyPlacementError(items: readonly LobbyItem[], next: Omit<LobbyItem, "id">, ignoreId?: string): LobbyError | null {
  const item = lobbyItemOf(next.item);
  if (!item) return "unknown_item";
  if (!Number.isInteger(next.rot) || next.rot < 0 || next.rot >= item.rotations) return "bad_rotation";
  if (next.variant !== undefined && !(item.variants ?? []).includes(next.variant)) return "bad_variant";
  if (!Number.isInteger(next.x) || !Number.isInteger(next.y)) return "out_of_bounds";
  const box = lobbyBox(item, next);
  if (box.x0 < 0 || box.x1 > LOBBY.w) return "out_of_bounds";
  if (item.layer === "wall") {
    if (!LOBBY.wallRows.includes(box.y0) || box.y1 > LOBBY.floorTop) return "out_of_bounds";
  } else if (box.y0 < LOBBY.floorTop || box.y1 > LOBBY.h) return "out_of_bounds";
  if (item.layer === "furniture") {
    for (const r of LOBBY.reserved) if (r.x >= box.x0 && r.x < box.x1 && r.y >= box.y0 && r.y < box.y1) return "reserved";
  }
  for (const other of items) {
    if (other.id === ignoreId) continue;
    const oi = lobbyItemOf(other.item);
    if (!oi || oi.layer !== item.layer) continue;
    if (overlaps(box, lobbyBox(oi, other))) return "overlap";
  }
  return null;
}

/** Quantos deste item já estão no quarto. */
export function placedCount(items: readonly LobbyItem[], itemId: string): number {
  let n = 0;
  for (const li of items) if (li.item === itemId) n++;
  return n;
}

/** O quarto de todo herói novo: um tapete, uma janela, uma estante, uma planta e uma luminária, já no lugar. */
export const STARTER_LOBBY: { owned: Record<string, number>; items: Omit<LobbyItem, "id">[] } = {
  owned: { "rug-round": 1, window: 1, bookshelf: 1, "plant-small": 1, "floor-lamp": 1 },
  items: [
    { item: "window", x: 2, y: 1, rot: 0 },
    { item: "bookshelf", x: 0, y: 3, rot: 0 },
    { item: "plant-small", x: 11, y: 3, rot: 0 },
    { item: "floor-lamp", x: 2, y: 3, rot: 0 },
    { item: "rug-round", x: 5, y: 5, rot: 0 },
  ],
};
