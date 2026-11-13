import {
  AVATAR_RADIUS,
  MAX_SPEED,
  MOVE_BUDGET_SECONDS,
  MOVE_SLACK_FACTOR,
  MOVE_SLACK_PX,
} from "../map/constants.ts";
import { type MapIndex, nextRoom, regionAt } from "../map/grid.ts";
import { type DoorRule, type Point, sweep } from "./collision.ts";

/**
 * Server-side movement state of one avatar. The client proposes coordinates;
 * the server accepts, or answers with a correction (docs/espaco §F.5).
 */
export interface MoveState {
  pos: Point;
  room: string | null;
  /** Last accepted client sequence number. */
  seq: number;
  /** Distance budget (px) and when it was last refilled (ms). */
  budget: number;
  budgetAt: number;
}

export const BUDGET_RATE = (MAX_SPEED * MOVE_SLACK_FACTOR) / 1000; // px per ms
export const BUDGET_CAP = MAX_SPEED * MOVE_SLACK_FACTOR * MOVE_BUDGET_SECONDS;

export function initialMoveState(pos: Point, room: string | null, nowMs: number): MoveState {
  return { pos, room, seq: 0, budget: BUDGET_CAP, budgetAt: nowMs };
}

export type MoveOutcome =
  | { kind: "stale" } // duplicate or out of order: ignore silently
  | { kind: "accepted"; state: MoveState; roomChange: { from: string | null; to: string | null } | null }
  | { kind: "corrected"; state: MoveState; reason: "speed" | "collision" | "invalid" };

/**
 * Validates one proposed position.
 *
 * Speed uses a refilling distance budget instead of "distance / time since the
 * last message": network jitter delivers bursts of legitimate moves almost at
 * once, and a per-message ratio would correct them. The budget still caps a
 * teleport at BUDGET_CAP px. Collision is checked along the whole segment, and
 * door tiles count as walls unless `door(roomId)` allows this person through.
 */
export function applyMove(
  ix: MapIndex,
  state: MoveState,
  proposal: { x: number; y: number; seq: number },
  nowMs: number,
  doorRule: DoorRule,
): MoveOutcome {
  if (!Number.isSafeInteger(proposal.seq) || proposal.seq <= state.seq) return { kind: "stale" };
  // Product rule baked in, not left to callers: whoever is inside a room can
  // always cross its door to leave, locked or not.
  const door: DoorRule = (roomId) => roomId === state.room || doorRule(roomId);
  const elapsed = Math.max(0, nowMs - state.budgetAt);
  const budget = Math.min(BUDGET_CAP, state.budget + elapsed * BUDGET_RATE);
  const base: MoveState = { ...state, seq: proposal.seq, budget, budgetAt: nowMs };

  if (!Number.isFinite(proposal.x) || !Number.isFinite(proposal.y)) {
    return { kind: "corrected", state: base, reason: "invalid" };
  }
  const to = { x: Math.round(proposal.x), y: Math.round(proposal.y) };
  const dist = Math.hypot(to.x - state.pos.x, to.y - state.pos.y);
  if (dist > budget + MOVE_SLACK_PX) {
    return { kind: "corrected", state: base, reason: "speed" };
  }
  const swept = sweep(ix, state.pos, to, door, AVATAR_RADIUS);
  if (swept.blocked) {
    const pos = { x: Math.round(swept.pos.x), y: Math.round(swept.pos.y) };
    const travelled = Math.hypot(pos.x - state.pos.x, pos.y - state.pos.y);
    const room = nextRoom(state.room, regionAt(ix, pos.x, pos.y));
    if (room !== null && room !== state.room && !door(room)) {
      return { kind: "corrected", state: base, reason: "collision" };
    }
    return {
      kind: "corrected",
      state: { ...base, pos, room, budget: Math.max(0, budget - travelled) },
      reason: "collision",
    };
  }
  const room = nextRoom(state.room, regionAt(ix, to.x, to.y));
  // Defense in depth, independent of geometry: entering a room always needs
  // permission to cross its door right now.
  if (room !== null && room !== state.room && !door(room)) {
    return { kind: "corrected", state: base, reason: "collision" };
  }
  const next: MoveState = { ...base, pos: to, room, budget: Math.max(0, budget - dist) };
  return {
    kind: "accepted",
    state: next,
    roomChange: room === state.room ? null : { from: state.room, to: room },
  };
}
