import type { RoomSize, TileKind } from "./constants.ts";

/** Integer tile coordinates. Signed: north wings grow into negative y. */
export interface TilePos {
  tx: number;
  ty: number;
}

/** Inclusive tile rectangle. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What the layout generator needs; slot/wing indexes are persisted by the server. */
export interface LayoutInput {
  templateVersion: 2;
  wings: WingInput[];
}

export interface WingInput {
  /** Stable index (append-only). */
  index: number;
  title: string;
  /**
   * Sparse, append-only. A slot whose room was archived keeps its size with
   * `roomId: null`, so the rooms after it never move (ADR 0005). A bare
   * `null` is a legacy free slot of unknown size and counts as "L".
   */
  slots: Array<SlotInput | null | undefined>;
}

export interface SlotInput {
  /** null = free slot (archived room): walled, no door, keeps its footprint. */
  roomId: string | null;
  label: string;
  size: RoomSize;
}

export interface CompiledRoom {
  roomId: string;
  label: string;
  size: RoomSize;
  wingIndex: number;
  slotIndex: number;
  /** Walkable interior. */
  interior: TileRect;
  /** Outer footprint including walls. */
  outer: TileRect;
  /** The door tile in the wall: a neutral threshold that belongs to no room. */
  door: TilePos;
  /** Corridor tile in front of the door. */
  outside: TilePos;
  /** First interior tile past the door; also where list navigation places you. */
  inside: TilePos;
  labelAnchor: TilePos;
}

export interface CompiledWing {
  index: number;
  title: string;
  north: boolean;
  /** Corridor interior (walkable). */
  corridor: TileRect;
}

export interface CompiledMap {
  format: "muchat.space.map";
  formatVersion: 2;
  templateVersion: 2;
  tileSize: number;
  /** Grid covers [originTx, originTx + width) × [originTy, originTy + height). */
  originTx: number;
  originTy: number;
  width: number;
  height: number;
  /** Row-major TileKind per cell. */
  tiles: Uint8Array;
  rooms: CompiledRoom[];
  wings: CompiledWing[];
  /** Entrance hall, outer rectangle (walls included). */
  lobby: TileRect;
  /** Walkable interior of the hall. */
  hall: TileRect;
  /** Walkable main corridor east of the hall. */
  spine: TileRect;
  spawns: TilePos[];
  /** Non-cryptographic fingerprint of the generated content (cache key, change detection). */
  fingerprint: string;
}

export type { TileKind };
