import { type Direction, TILE } from "@muchat/space-core";
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";

import { roomTitle } from "../list.ts";
import type { World } from "../world.ts";
import { characterSheet, DIRS, FRAMES, palette, SPRITE } from "./sprites.ts";
import { CHUNK, chunksIn, drawChunk } from "./tiles.ts";

const AVATAR_SCALE = 2; // 16 px art drawn at 32 px, one tile
const STEP_MS = 140;

interface AvatarSprite {
  palette: number;
  root: Container;
  body: Sprite;
  name: Text;
  frames: Texture[];
}

/**
 * PixiJS view of the world. Holds no game state: every frame reads World.
 * Only chunks near the camera exist on the GPU (a 1 800-room map would need
 * hundreds of 1024² textures otherwise).
 */
export class Renderer {
  readonly app = new Application();
  private readonly stage = new Container();
  private readonly floor = new Container();
  private readonly doors = new Graphics();
  private readonly labels = new Container();
  private readonly avatarLayer = new Container();
  private readonly chunks = new Map<string, Sprite>();
  private readonly avatars = new Map<string, AvatarSprite>();
  private readonly paletteFrames = new Map<number, Texture[]>();
  private cam = { x: 0, y: 0, ready: false };
  zoom = 2;
  reducedMotion = false;
  private mapFingerprint = "";

  async init(el: HTMLElement) {
    await this.app.init({
      resizeTo: el,
      background: "#14151c",
      antialias: false,
      autoDensity: true,
      resolution: globalThis.devicePixelRatio || 1,
      roundPixels: true,
    });
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.canvas.style.display = "block";
    el.appendChild(this.app.canvas);
    this.stage.addChild(this.floor, this.doors, this.labels, this.avatarLayer);
    this.avatarLayer.sortableChildren = true;
    this.app.stage.addChild(this.stage);
  }

  /** Moves the canvas to another host (the page was reopened); drawing resumes. */
  attach(el: HTMLElement) {
    this.app.resizeTo = el;
    el.appendChild(this.app.canvas);
    this.app.ticker.start();
  }

  /** Takes the canvas off the page and stops drawing; the world keeps updating. */
  detach() {
    this.app.ticker.stop();
    this.app.canvas.remove();
  }

  setZoom(z: number) {
    this.zoom = Math.max(1, Math.min(3, Math.round(z)));
  }

  /** Screen (CSS px relative to the canvas) → world px. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.stage.position.x) / this.zoom, y: (sy - this.stage.position.y) / this.zoom };
  }

  private framesFor(idx: number): Texture[] {
    let frames = this.paletteFrames.get(idx);
    if (!frames) {
      const base = Texture.from(characterSheet(palette(idx)));
      base.source.scaleMode = "nearest";
      frames = [];
      for (let i = 0; i < DIRS.length * FRAMES; i++) {
        frames.push(new Texture({ source: base.source, frame: new Rectangle(i * SPRITE, 0, SPRITE, SPRITE) }));
      }
      this.paletteFrames.set(idx, frames);
    }
    return frames;
  }

  /** Map geometry or room views changed: rebuild doors and labels (chunks if geometry changed). */
  rebuildStatic(world: World) {
    const { map, ix } = world;
    if (!map || !ix) return;
    if (map.fingerprint !== this.mapFingerprint) {
      for (const s of this.chunks.values()) s.destroy({ texture: true, textureSource: true });
      this.chunks.clear();
      this.mapFingerprint = map.fingerprint;
    }
    this.doors.clear();
    for (const t of this.labels.removeChildren()) t.destroy();
    for (const r of map.rooms) {
      const view = world.rooms.get(r.roomId);
      const open = world.doorRule(r.roomId);
      const x = r.door.tx * TILE;
      const y = r.door.ty * TILE;
      if (open) {
        this.doors.rect(x + 4, y, TILE - 8, TILE).fill({ color: 0x9a6b3f });
        this.doors.rect(x + 6, y + 2, TILE - 12, TILE - 4).fill({ color: 0xc48f5a });
      } else {
        this.doors.rect(x, y, TILE, TILE).fill({ color: 0x5a2f2a });
        // Lock glyph: shackle + body (shape, not only colour).
        this.doors.rect(x + 12, y + 8, 8, 2).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 11, y + 9, 2, 6).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 19, y + 9, 2, 6).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 9, y + 14, 14, 10).fill({ color: 0xe9d7a8 });
      }
      const title = view?.label ? view.label : `🔒 ${roomTitle(world, r.roomId)}`;
      const label = new Text({
        text: title,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fill: 0x2a2730, fontWeight: "600" },
        resolution: 3,
      });
      label.anchor.set(0.5);
      label.position.set(r.labelAnchor.tx * TILE + TILE / 2, r.interior.y0 * TILE + 12);
      this.labels.addChild(label);
    }
    for (const w of map.wings) {
      const title = world.wings.get(w.index)?.title;
      if (!title) continue;
      const t = new Text({
        text: `Ala ${title}`,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fill: 0x4b5163, fontWeight: "700" },
        resolution: 3,
      });
      t.anchor.set(0.5);
      const near = w.north ? w.corridor.y1 : w.corridor.y0;
      t.position.set(((w.corridor.x0 + w.corridor.x1 + 1) / 2) * TILE, near * TILE + TILE / 2);
      this.labels.addChild(t);
    }
  }

  private ensureChunks(world: World) {
    const { ix } = world;
    if (!ix) return;
    const w = this.app.screen.width / this.zoom;
    const h = this.app.screen.height / this.zoom;
    const x0 = -this.stage.position.x / this.zoom;
    const y0 = -this.stage.position.y / this.zoom;
    const margin = CHUNK * TILE * 0.5;
    const need = new Set<string>();
    for (const [cx, cy] of chunksIn(x0 - margin, y0 - margin, x0 + w + margin, y0 + h + margin)) {
      const key = `${cx},${cy}`;
      need.add(key);
      if (this.chunks.has(key)) continue;
      const tex = Texture.from(drawChunk(ix, cx, cy));
      tex.source.scaleMode = "nearest";
      const s = new Sprite(tex);
      s.position.set(cx * CHUNK * TILE, cy * CHUNK * TILE);
      this.floor.addChild(s);
      this.chunks.set(key, s);
    }
    for (const [key, s] of this.chunks) {
      if (need.has(key)) continue;
      s.destroy({ texture: true, textureSource: true });
      this.chunks.delete(key);
    }
  }

  private avatarFor(userId: string, name: string, paletteIndex: number): AvatarSprite {
    let a = this.avatars.get(userId);
    if (a && a.palette !== paletteIndex) {
      a.palette = paletteIndex;
      a.frames = this.framesFor(paletteIndex);
    }
    if (!a) {
      const frames = this.framesFor(paletteIndex);
      const body = new Sprite(frames[0]);
      body.anchor.set(0.5, 1);
      body.scale.set(AVATAR_SCALE);
      const tag = new Text({
        text: name,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fill: 0xffffff, stroke: { color: 0x15131a, width: 3 } },
        resolution: 3,
      });
      tag.anchor.set(0.5, 1);
      tag.position.set(0, -SPRITE * AVATAR_SCALE - 2);
      const root = new Container();
      root.addChild(body, tag);
      this.avatarLayer.addChild(root);
      a = { palette: paletteIndex, root, body, name: tag, frames };
      this.avatars.set(userId, a);
    }
    if (a.name.text !== name) a.name.text = name;
    return a;
  }

  private pose(a: AvatarSprite, dir: Direction, moving: boolean, nowMs: number) {
    const d = DIRS.indexOf(dir);
    const f = moving ? 1 + (Math.floor(nowMs / STEP_MS) % 2) : 0;
    a.body.texture = a.frames[d * FRAMES + f] ?? a.frames[0]!;
  }

  frame(world: World, nowMs: number, dtMs: number) {
    const me = world.me;
    if (!me || !world.map) return;
    // Camera follows us; smoothing off with reduced motion.
    if (!this.cam.ready || this.reducedMotion) {
      this.cam = { x: me.x, y: me.y, ready: true };
    } else {
      const k = Math.min(1, (dtMs / 1000) * 10);
      this.cam.x += (me.x - this.cam.x) * k;
      this.cam.y += (me.y - this.cam.y) * k;
    }
    this.stage.scale.set(this.zoom);
    this.stage.position.set(
      Math.round(this.app.screen.width / 2 - this.cam.x * this.zoom),
      Math.round(this.app.screen.height / 2 - this.cam.y * this.zoom),
    );
    this.ensureChunks(world);

    const seen = new Set<string>([me.userId]);
    const mine = this.avatarFor(me.userId, me.name, me.palette);
    mine.root.position.set(Math.round(me.x), Math.round(me.y + 6));
    mine.root.zIndex = me.y;
    mine.root.alpha = 1;
    this.pose(mine, me.dir, me.moving, nowMs);
    for (const r of world.others.values()) {
      seen.add(r.userId);
      const p = world.positionOf(r, nowMs);
      const a = this.avatarFor(r.userId, r.name, r.palette);
      a.root.position.set(Math.round(p.x), Math.round(p.y + 6));
      a.root.zIndex = p.y;
      a.root.alpha = r.state === "reconnecting" ? 0.45 : r.state === "idle" ? 0.75 : 1;
      this.pose(a, r.dir, r.moving, nowMs);
    }
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      a.root.destroy({ children: true });
      this.avatars.delete(id);
    }
  }

  destroy() {
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }
}
