/** World units are pixels at 1× zoom; the grid is square tiles. */
export const TILE = 32;

/** Avatar collision circle radius (px). Doors are one tile (32 px) wide. */
export const AVATAR_RADIUS = 10;

/** Movement limits (docs/espaco/README.md §F.5). */
export const MAX_SPEED = 160; // px/s, 5 tiles/s
export const MOVE_SEND_HZ = 15;
export const TICK_HZ = 10;
/** Distance budget refills at MAX_SPEED × factor and holds at most this many seconds. */
export const MOVE_SLACK_FACTOR = 1.25;
export const MOVE_BUDGET_SECONDS = 0.5;
export const MOVE_SLACK_PX = 4;

/** Layout limits (ADR 0005). */
export const MAX_WINGS = 30;
export const MAX_SLOTS_PER_WING = 60;

/** Tile kinds in the collision grid. */
export const Tile = {
  Void: 0,
  Floor: 1,
  Wall: 2,
  Door: 3,
} as const;
export type TileKind = (typeof Tile)[keyof typeof Tile];

export type RoomSize = "S" | "M" | "L";

/** Interior size (tiles) per room size; walls add one tile on each side. */
export const ROOM_INTERIOR: Record<RoomSize, { w: number; h: number }> = {
  S: { w: 6, h: 5 },
  M: { w: 8, h: 7 },
  L: { w: 12, h: 9 },
};

/** Size class from the Stoat channel capacity (`voice.max_users`), fixed at creation. */
export function roomSizeFor(capacity: number | null | undefined): RoomSize {
  if (capacity == null || capacity <= 0) return "M";
  if (capacity <= 4) return "S";
  if (capacity <= 10) return "M";
  return "L";
}
