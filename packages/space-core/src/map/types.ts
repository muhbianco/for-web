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
  templateVersion: 1;
  wings: WingInput[];
}

export interface WingInput {
  /** Stable index (append-only). */
  index: number;
  title: string;
  /** Sparse: a missing or null slot is a free (archived) slot. */
  slots: Array<SlotInput | null | undefined>;
}

export interface SlotInput {
  roomId: string;
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
  formatVersion: 1;
  templateVersion: 1;
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
  lobby: TileRect;
  spawns: TilePos[];
  /** Non-cryptographic fingerprint of the generated content (cache key, change detection). */
  fingerprint: string;
}

export type { TileKind };
