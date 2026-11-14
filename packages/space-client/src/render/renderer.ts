import {
  CATALOG,
  type DecorInstance,
  type DecorItem,
  type DecorOp,
  type Direction,
  defaultFloor,
  instanceRect,
  itemOf,
  parseFloorRef,
  TILE,
  type TileRect,
  zoneAt,
} from "@muchat/space-core";
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";

import { roomTitle } from "../list.ts";
import type { World } from "../world.ts";
import { textureFor } from "./atlas.ts";
import { characterSheet, DIRS, FRAMES, palette, SPRITE } from "./sprites.ts";
import { CHUNK, chunksIn, drawChunk, type FloorLookup } from "./tiles.ts";

const AVATAR_SCALE = 2; // 16 px art drawn at 32 px, one tile
const STEP_MS = 140;

interface AvatarSprite {
  palette: number;
  root: Container;
  body: Sprite;
  name: Text;
  frames: Texture[];
}

/** What the editor wants drawn over the map this frame. */
export interface EditorOverlay {
  enabled: boolean;
  /** Tile under the cursor (world tiles). */
  hoverTile: { tx: number; ty: number } | null;
  /** Zone under the cursor: grid lines and, with the floor tool, a highlight. */
  zoneRect: TileRect | null;
  floorTool: boolean;
  /** Item preview following the cursor (absolute tile rect already resolved). */
  ghost: { item: DecorItem; rot: 0 | 1 | 2 | 3; variant: string | undefined; rect: TileRect; valid: boolean } | null;
  /** Footprint of the selected instance. */
  selected: TileRect | null;
}

/** "Press E" hint over the interactive item next to us. */
export interface PromptView {
  x: number;
  y: number;
  label: string;
}

const EMPTY_OVERLAY: EditorOverlay = { enabled: false, hoverTile: null, zoneRect: null, floorTool: false, ghost: null, selected: null };

/**
 * PixiJS view of the world. Holds no game state: every frame reads World.
 * Layers, bottom to top: floor chunks → doors → rugs → scene (furniture, wall
 * items and avatars sorted by depth) → ceiling lights → labels → editor
 * overlay and prompts. Only chunks near the camera exist on the GPU.
 */
export class Renderer {
  readonly app = new Application();
  private readonly stage = new Container();
  private readonly floor = new Container();
  private readonly doors = new Graphics();
  private readonly rugs = new Container();
  private readonly scene = new Container();
  private readonly ceiling = new Container();
  private readonly labels = new Container();
  private readonly overlayGfx = new Graphics();
  private readonly ghost = new Sprite();
  private readonly promptBox = new Container();
  private readonly promptBg = new Graphics();
  private readonly promptText = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fill: 0xffffff, fontWeight: "700" }, resolution: 3 });
  private readonly chunks = new Map<string, Sprite>();
  private readonly avatars = new Map<string, AvatarSprite>();
  private readonly decor = new Map<string, Sprite>();
  private readonly paletteFrames = new Map<number, Texture[]>();
  private cam = { x: 0, y: 0, ready: false };
  zoom = 2;
  reducedMotion = false;
  private mapFingerprint = "";
  private floorsKey = "";
  private floorLookup: FloorLookup = () => null;
  overlay: EditorOverlay = EMPTY_OVERLAY;
  prompt: PromptView | null = null;

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
    this.scene.sortableChildren = true;
    this.ceiling.alpha = 0.95;
    this.ghost.anchor.set(0, 1);
    this.ghost.visible = false;
    this.promptBox.addChild(this.promptBg, this.promptText);
    this.promptBox.visible = false;
    this.stage.addChild(this.floor, this.doors, this.rugs, this.scene, this.ceiling, this.labels, this.overlayGfx, this.ghost, this.promptBox);
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

  // ---- static layers -------------------------------------------------------

  /** Map geometry or room views changed: rebuild doors and labels (chunks if geometry changed). */
  rebuildStatic(world: World) {
    const { map, ix } = world;
    if (!map || !ix) return;
    if (map.fingerprint !== this.mapFingerprint) {
      this.dropChunks();
      this.mapFingerprint = map.fingerprint;
    }
    this.doors.clear();
    for (const t of this.labels.removeChildren()) t.destroy();
    for (const r of map.rooms) {
      const view = world.rooms.get(r.roomId);
      const open = world.doorRule(r.roomId);
      const x = r.door.tx * TILE;
      const y = r.door.ty * TILE;
      const vertical = r.outside.ty !== r.door.ty; // door in a horizontal wall (spine side)
      // Frame posts, then the leaf (wood when open to us, dark red when shut).
      this.doors.rect(x, y, TILE, TILE).fill({ color: 0x2a2c3a });
      if (vertical) {
        this.doors.rect(x + 2, y, 3, TILE).fill({ color: 0x575b74 });
        this.doors.rect(x + TILE - 5, y, 3, TILE).fill({ color: 0x575b74 });
      } else {
        this.doors.rect(x, y + 2, TILE, 3).fill({ color: 0x575b74 });
        this.doors.rect(x, y + TILE - 5, TILE, 3).fill({ color: 0x575b74 });
      }
      if (open) {
        this.doors.rect(x + 6, y + 6, TILE - 12, TILE - 12).fill({ color: 0x9a6b3f });
        this.doors.rect(x + 8, y + 8, TILE - 16, TILE - 16).fill({ color: 0xc48f5a });
        this.doors.rect(x + 12, y + 14, 2, 4).fill({ color: 0xe9d7a8 });
      } else {
        this.doors.rect(x + 6, y + 6, TILE - 12, TILE - 12).fill({ color: 0x5a2f2a });
        // Lock glyph: shackle + body (shape, not only colour).
        this.doors.rect(x + 12, y + 9, 8, 2).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 11, y + 10, 2, 5).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 19, y + 10, 2, 5).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 9, y + 14, 14, 9).fill({ color: 0xe9d7a8 });
      }
      const title = view?.label ? view.label : `🔒 ${roomTitle(world, r.roomId)}`;
      const label = new Text({
        text: title,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fill: 0xffffff, fontWeight: "700", stroke: { color: 0x15131a, width: 3 } },
        resolution: 3,
      });
      label.anchor.set(0.5, 0);
      label.position.set(r.labelAnchor.tx * TILE + TILE / 2, r.interior.y0 * TILE + 2);
      this.labels.addChild(label);
    }
    for (const w of map.wings) {
      const title = world.wings.get(w.index)?.title;
      if (!title) continue;
      const t = new Text({
        text: `Ala ${title}`,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fill: 0xeeeeff, fontWeight: "700", stroke: { color: 0x15131a, width: 3 } },
        resolution: 3,
      });
      t.anchor.set(0.5);
      const near = w.north ? w.corridor.y1 : w.corridor.y0;
      t.position.set(((w.corridor.x0 + w.corridor.x1 + 1) / 2) * TILE, near * TILE + TILE / 2);
      this.labels.addChild(t);
    }
  }

  private dropChunks() {
    for (const s of this.chunks.values()) s.destroy({ texture: true, textureSource: true });
    this.chunks.clear();
  }

  /** Floors per zone changed (or the decoration was loaded): chunks repaint lazily. */
  private refreshFloors(world: World) {
    const key = JSON.stringify(world.decor?.floors ?? {}) + "|" + this.mapFingerprint;
    if (key === this.floorsKey) return;
    this.floorsKey = key;
    const { map, zones } = world;
    const floors = world.decor?.floors ?? {};
    this.floorLookup = (tx, ty) => {
      if (!map || !zones) return null;
      const z = zoneAt(zones, tx, ty);
      if (!z) return null;
      const ref = floors[z.key];
      if (ref) {
        const { item, variant } = parseFloorRef(ref);
        return { item, variant };
      }
      return defaultFloor(map, z.key);
    };
    this.dropChunks();
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
      const tex = Texture.from(drawChunk(ix, cx, cy, this.floorLookup));
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

  // ---- decoration ----------------------------------------------------------

  /** Whole decoration (re)built: after a load, a reset, or a map change. */
  rebuildDecor(world: World) {
    for (const s of this.decor.values()) s.destroy();
    this.decor.clear();
    this.refreshFloors(world);
    if (!world.decor) return;
    for (const inst of world.decor.items) this.addDecor(world, inst);
  }

  /** One change: keeps every other sprite as it is. */
  applyDecorOp(world: World, op: DecorOp) {
    switch (op.kind) {
      case "place":
        this.addDecor(world, op.item);
        return;
      case "update":
        this.removeDecor(op.item.id);
        this.addDecor(world, op.item);
        return;
      case "remove":
        this.removeDecor(op.id);
        return;
      case "floor":
        this.refreshFloors(world);
        return;
      case "settings":
        return;
      case "reset":
        this.rebuildDecor(world);
    }
  }

  private addDecor(world: World, inst: DecorInstance) {
    const item = itemOf(CATALOG, inst.item);
    const zone = world.zones?.byKey.get(inst.zone);
    if (!item || !zone || item.layer === "floor") return;
    const sp = new Sprite(textureFor(item, inst.rot, inst.variant));
    sp.anchor.set(0, 1);
    const rect = instanceRect(zone, item, inst);
    const bottom = (rect.y1 + 1) * TILE;
    sp.position.set(rect.x0 * TILE, bottom);
    sp.eventMode = "none";
    switch (item.layer) {
      case "rug":
        this.rugs.addChild(sp);
        break;
      case "ceiling":
        this.ceiling.addChild(sp);
        break;
      case "wall":
        sp.zIndex = bottom - 1;
        this.scene.addChild(sp);
        break;
      default:
        sp.zIndex = bottom - 0.5;
        this.scene.addChild(sp);
    }
    this.decor.set(inst.id, sp);
  }

  private removeDecor(id: string) {
    const sp = this.decor.get(id);
    if (!sp) return;
    sp.destroy();
    this.decor.delete(id);
  }

  // ---- avatars -------------------------------------------------------------

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
      this.scene.addChild(root);
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

  // ---- overlays ------------------------------------------------------------

  private drawOverlay() {
    const o = this.overlay;
    const g = this.overlayGfx;
    g.clear();
    if (!o.enabled) {
      this.ghost.visible = false;
      return;
    }
    if (o.zoneRect) {
      const r = o.zoneRect;
      const x0 = r.x0 * TILE;
      const y0 = r.y0 * TILE;
      const w = (r.x1 - r.x0 + 1) * TILE;
      const h = (r.y1 - r.y0 + 1) * TILE;
      if (o.floorTool) g.rect(x0, y0, w, h).fill({ color: 0x7aa2ff, alpha: 0.18 });
      for (let x = x0; x <= x0 + w; x += TILE) g.rect(x, y0, 1, h).fill({ color: 0xffffff, alpha: 0.18 });
      for (let y = y0; y <= y0 + h; y += TILE) g.rect(x0, y, w, 1).fill({ color: 0xffffff, alpha: 0.18 });
      g.rect(x0, y0, w, h).stroke({ color: 0x7aa2ff, width: 2, alpha: 0.6 });
    }
    if (o.hoverTile && !o.ghost) {
      g.rect(o.hoverTile.tx * TILE, o.hoverTile.ty * TILE, TILE, TILE).stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
    }
    if (o.selected) {
      const r = o.selected;
      g.rect(r.x0 * TILE - 2, r.y0 * TILE - 2, (r.x1 - r.x0 + 1) * TILE + 4, (r.y1 - r.y0 + 1) * TILE + 4).stroke({ color: 0xffd166, width: 3 });
    }
    if (o.ghost) {
      const gh = o.ghost;
      this.ghost.texture = textureFor(gh.item, gh.rot, gh.variant);
      this.ghost.position.set(gh.rect.x0 * TILE, (gh.rect.y1 + 1) * TILE);
      this.ghost.alpha = 0.75;
      this.ghost.tint = gh.valid ? 0xb8ffb8 : 0xff8a8a;
      this.ghost.visible = true;
      const r = gh.rect;
      g.rect(r.x0 * TILE, r.y0 * TILE, (r.x1 - r.x0 + 1) * TILE, (r.y1 - r.y0 + 1) * TILE).fill({ color: gh.valid ? 0x4dff7a : 0xff5d5d, alpha: 0.2 });
    } else {
      this.ghost.visible = false;
    }
  }

  private drawPrompt() {
    const p = this.prompt;
    if (!p) {
      this.promptBox.visible = false;
      return;
    }
    this.promptBox.visible = true;
    this.promptText.text = `E · ${p.label}`;
    const w = this.promptText.width + 14;
    const h = this.promptText.height + 8;
    this.promptBg.clear();
    this.promptBg.roundRect(0, 0, w, h, 6).fill({ color: 0x15131a, alpha: 0.85 });
    this.promptBg.roundRect(0, 0, w, h, 6).stroke({ color: 0x7aa2ff, width: 1 });
    this.promptText.position.set(7, 4);
    this.promptBox.position.set(Math.round(p.x - w / 2), Math.round(p.y - h - 6));
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
    mine.root.zIndex = me.y + 6;
    mine.root.alpha = 1;
    this.pose(mine, me.dir, me.moving, nowMs);
    for (const r of world.others.values()) {
      seen.add(r.userId);
      const p = world.positionOf(r, nowMs);
      const a = this.avatarFor(r.userId, r.name, r.palette);
      a.root.position.set(Math.round(p.x), Math.round(p.y + 6));
      a.root.zIndex = p.y + 6;
      a.root.alpha = r.state === "reconnecting" ? 0.45 : r.state === "idle" ? 0.75 : 1;
      this.pose(a, r.dir, r.moving, nowMs);
    }
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      a.root.destroy({ children: true });
      this.avatars.delete(id);
    }
    this.drawOverlay();
    this.drawPrompt();
  }

  destroy() {
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }
}
