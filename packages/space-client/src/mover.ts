import {
  type Direction,
  findPath,
  MAX_SPEED,
  MOVE_SEND_HZ,
  nextRoom,
  regionAt,
  slide,
  TILE,
  tileCenter,
  type TilePos,
} from "@muchat/space-core";

import type { World } from "./world.ts";

export interface MoveCommand {
  v: 1;
  t: "avatar.move";
  seq: number;
  d: { x: number; y: number; dir: Direction; moving: boolean };
}

/**
 * Local movement: predicts our own position with the same collision and door
 * rules the server uses (space-core), and sends at most MOVE_SEND_HZ moves.
 * The server answers only when it disagrees (avatar.correction).
 */
export class Mover {
  private readonly world: World;
  private readonly send: (cmd: MoveCommand) => void;
  private keys = { up: false, down: false, left: false, right: false };
  private path: TilePos[] = [];
  private lastSentAt = -Infinity;
  private lastSent: { x: number; y: number; moving: boolean } | null = null;
  /** Speed slightly under the server's limit so jitter never trips it. */
  private readonly speed = MAX_SPEED * 0.95;

  constructor(world: World, send: (cmd: MoveCommand) => void) {
    this.world = world;
    this.send = send;
  }

  setKey(key: keyof Mover["keys"], down: boolean) {
    this.keys[key] = down;
    if (down) this.path = [];
  }

  clearKeys() {
    this.keys = { up: false, down: false, left: false, right: false };
  }

  /** Click/tap to walk; false when the target is not reachable (locked door, wall). */
  walkTo(worldX: number, worldY: number): boolean {
    const { me, ix } = this.world;
    if (!me || !ix) return false;
    const path = findPath(
      ix,
      { tx: Math.floor(me.x / TILE), ty: Math.floor(me.y / TILE) },
      { tx: Math.floor(worldX / TILE), ty: Math.floor(worldY / TILE) },
      this.world.doorRule,
    );
    if (!path) return false;
    this.path = path.slice(1);
    return true;
  }

  cancelPath() {
    this.path = [];
  }

  get walkingPath(): boolean {
    return this.path.length > 0;
  }

  /** One frame. */
  step(dtMs: number, nowMs: number) {
    const { me, ix } = this.world;
    if (!me || !ix) return;
    const dt = Math.min(dtMs, 100) / 1000;
    let vx = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    let vy = (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0);
    if (vx === 0 && vy === 0 && this.path.length > 0) {
      const goal = tileCenter(this.path[0]!);
      const dx = goal.x - me.x;
      const dy = goal.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5) {
        me.x = goal.x;
        me.y = goal.y;
        this.path.shift();
      } else {
        vx = dx / d;
        vy = dy / d;
        const maxStep = this.speed * dt;
        if (maxStep > d) {
          vx = (vx * d) / maxStep;
          vy = (vy * d) / maxStep;
        }
      }
    }
    const len = Math.hypot(vx, vy);
    const moving = len > 0;
    if (moving) {
      const nx = (vx / Math.max(1, len)) * this.speed * dt;
      const ny = (vy / Math.max(1, len)) * this.speed * dt;
      const next = slide(ix, { x: me.x, y: me.y }, nx, ny, this.world.doorRule);
      if (next.x === me.x && next.y === me.y) this.path = []; // stuck: stop following
      me.x = next.x;
      me.y = next.y;
      me.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? "right" : "left") : vy > 0 ? "down" : "up";
      this.world.setMyRoom(nextRoom(me.room, regionAt(ix, me.x, me.y)));
    }
    me.moving = moving;
    this.maybeSend(nowMs);
  }

  private maybeSend(nowMs: number) {
    const me = this.world.me;
    if (!me) return;
    const x = Math.round(me.x);
    const y = Math.round(me.y);
    const last = this.lastSent;
    const changed = !last || last.x !== x || last.y !== y || last.moving !== me.moving;
    if (!changed) return;
    // A stop is sent right away; movement at most MOVE_SEND_HZ.
    const stopping = last?.moving === true && !me.moving;
    if (!stopping && nowMs - this.lastSentAt < 1000 / MOVE_SEND_HZ) return;
    me.seq += 1;
    this.send({ v: 1, t: "avatar.move", seq: me.seq, d: { x, y, dir: me.dir, moving: me.moving } });
    this.lastSentAt = nowMs;
    this.lastSent = { x, y, moving: me.moving };
  }

  /** After a correction or snapshot: forget what we sent, keep the seq. */
  resync() {
    this.path = [];
    const me = this.world.me;
    this.lastSent = me ? { x: Math.round(me.x), y: Math.round(me.y), moving: false } : null;
  }
}
