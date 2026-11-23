import {
  type AvatarGear,
  type AvatarHero,
  type DecorInstance,
  type DecorItem,
  type DecorOp,
  type Direction,
  type TileRect,
  CATALOG,
  defaultFloor,
  instanceRect,
  itemOf,
  parseFloorRef,
  TILE,
  zoneAt,
} from "@muchat/space-core";
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";

import { roomTitle } from "../list.ts";
import type { World } from "../world.ts";
import { textureFor } from "./atlas.ts";
import { type FxArt, equippedSheet, fxCanvas, gearKey } from "./heroArt.ts";
import { characterSheet, DIRS, FRAMES, palette, SPRITE } from "./sprites.ts";
import { type FloorLookup, CHUNK, chunksIn, drawChunk } from "./tiles.ts";
import { heroLabel } from "../hero.ts";
import {
  attackPeriod,
  seedOf,
  SHOT_FRAME_MS,
  shotFor,
  shotPhase,
  shotStage,
} from "./trainFx.ts";

const AVATAR_SCALE = 2; // 16 px art drawn at 32 px, one tile
const STEP_MS = 140;
/**
 * Frame cap. Uncapped, the ticker followed the display (144 Hz on 144 Hz
 * panels) for the whole call, competing with the voice chain for CPU.
 */
export const MAX_FPS = 60;
/** Backing-store density cap: DPR 3 phones paid 9× the pixels of the map for nothing. */
export const MAX_RESOLUTION = 2;

/** Removes the canvas; leaves PixiJS's global pools alone (see `Renderer.destroy`). */
export const RENDERER_DESTROY = {
  removeView: true,
  releaseGlobalResources: false,
} as const;

interface AvatarSprite {
  palette: number;
  /** What the avatar wears while training ("" = the plain character). */
  look: string;
  root: Container;
  body: Sprite;
  name: Text;
  frames: Texture[];
  /** Speaking ring at the feet (our own room's call only). */
  ring: Graphics;
  /** Call indicators above the name: muted mic, deafened, sharing a screen. */
  badge: Graphics;
  /** What ring and badge show now, to redraw only on change. */
  indicators: string;
}

/** The gear a hero wears on the map: only while training at a dummy. */
function trainingGear(hero: AvatarHero | null): AvatarGear | null {
  return hero?.training && hero.gear ? hero.gear : null;
}

/** What the map shows of someone's call (ADR 0008). */
export interface AvatarIndicators {
  muted: boolean;
  deaf: boolean;
  screen: boolean;
  speaking: boolean;
}

function indicatorsKey(i: AvatarIndicators): string {
  return `${+i.muted}${+i.deaf}${+i.screen}${+i.speaking}`;
}

/** Pixel icons, 7×7 each, drawn into `g` left to right and centred on x = 0. */
function drawBadge(g: Graphics, i: AvatarIndicators, y: number) {
  g.clear();
  const icons: Array<"mic" | "deaf" | "screen"> = [];
  if (i.muted) icons.push("mic");
  if (i.deaf) icons.push("deaf");
  if (i.screen) icons.push("screen");
  if (!icons.length) return;
  const w = icons.length * 9 + 2;
  let x = -Math.round(w / 2);
  g.roundRect(x, y - 1, w, 9, 3).fill({ color: 0x15131a, alpha: 0.8 });
  x += 2;
  for (const icon of icons) {
    if (icon === "mic") {
      // Microphone with a slash: red.
      g.rect(x + 2, y, 3, 4).fill({ color: 0xff6b6b });
      g.rect(x + 1, y + 3, 1, 2).fill({ color: 0xff6b6b });
      g.rect(x + 5, y + 3, 1, 2).fill({ color: 0xff6b6b });
      g.rect(x + 3, y + 5, 1, 2).fill({ color: 0xff6b6b });
      for (let k = 0; k < 7; k++)
        g.rect(x + k, y + k, 1, 1).fill({ color: 0xffffff });
    } else if (icon === "deaf") {
      // Headset with a slash: orange.
      g.rect(x + 1, y + 1, 5, 1).fill({ color: 0xffa94d });
      g.rect(x, y + 2, 1, 4).fill({ color: 0xffa94d });
      g.rect(x + 6, y + 2, 1, 4).fill({ color: 0xffa94d });
      for (let k = 0; k < 7; k++)
        g.rect(x + k, y + k, 1, 1).fill({ color: 0xffffff });
    } else {
      // Screen: blue frame with a stand.
      g.rect(x, y, 7, 5).fill({ color: 0x74c0fc });
      g.rect(x + 1, y + 1, 5, 3).fill({ color: 0x1c3a5e });
      g.rect(x + 3, y + 5, 1, 1).fill({ color: 0x74c0fc });
      g.rect(x + 2, y + 6, 3, 1).fill({ color: 0x74c0fc });
    }
    x += 9;
  }
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
  ghost: {
    item: DecorItem;
    rot: 0 | 1 | 2 | 3;
    variant: string | undefined;
    rect: TileRect;
    valid: boolean;
  } | null;
  /** Footprint of the selected instance. */
  selected: TileRect | null;
}

/** "Press E" hint over the interactive item next to us. */
export interface PromptView {
  x: number;
  y: number;
  label: string;
}

const EMPTY_OVERLAY: EditorOverlay = {
  enabled: false,
  hoverTile: null,
  zoneRect: null,
  floorTool: false,
  ghost: null,
  selected: null,
};

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
  /** Lit screens of rooms whose TV is playing (ADR 0008). */
  private readonly tvGlow = new Graphics();
  private tvKey = "";
  /** Something that decides which TVs are lit changed (TV state, presence, decoration). */
  tvDirty = true;
  private readonly overlayGfx = new Graphics();
  private readonly ghost = new Sprite();
  private readonly promptBox = new Container();
  private readonly promptBg = new Graphics();
  private readonly promptText = new Text({
    text: "",
    style: {
      fontFamily: "system-ui, sans-serif",
      fontSize: 11,
      fill: 0xffffff,
      fontWeight: "700",
    },
    resolution: 3,
  });
  private readonly chunks = new Map<string, Sprite>();
  private readonly avatars = new Map<string, AvatarSprite>();
  private readonly decor = new Map<string, Sprite>();
  private readonly paletteFrames = new Map<string, Texture[]>();
  /** Idle game training (docs/espaco/jogo/ot): the attack thrown at the dummy, per trainer. */
  private readonly fx = new Container();
  private readonly shots = new Map<
    string,
    { shot: Sprite; hit: Sprite; art: FxArt | null }
  >();
  private readonly fxTextures = new Map<FxArt, Texture>();
  private shotAt = -Infinity;
  /** Textures created for this renderer alone (avatar sheets); chunks are tracked in `chunks`. */
  private readonly ownedTextures: Texture[] = [];
  private cam = { x: 0, y: 0, ready: false };
  zoom = 2;
  reducedMotion = false;
  private mapFingerprint = "";
  private floorsKey = "";
  private floorLookup: FloorLookup = () => null;
  overlay: EditorOverlay = EMPTY_OVERLAY;
  prompt: PromptView | null = null;
  /** Overlay/prompt as last drawn (by reference / by value), so idle frames skip them. */
  private drawnOverlay: EditorOverlay | null = null;
  private drawnPrompt: PromptView | null = null;
  /**
   * Something on screen changed since the last present. The map is drawn on
   * demand: standing still in a room (the usual case during a call) costs no
   * GPU work at all. Every mutation of the scene must set this.
   */
  private dirty = true;
  /**
   * Pixi's resizeTo only listens to the window: the map's box also changes
   * when the media stage or a side panel opens. Resize (and redraw) on that.
   */
  private resizeObs: ResizeObserver | null = null;

  private observeSize(el: HTMLElement) {
    this.resizeObs?.disconnect();
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObs = new ResizeObserver(() => {
      this.app.resize();
      this.dirty = true;
    });
    this.resizeObs.observe(el);
  }

  async init(el: HTMLElement) {
    await this.app.init({
      resizeTo: el,
      background: "#14151c",
      antialias: false,
      autoDensity: true,
      resolution: Math.min(globalThis.devicePixelRatio || 1, MAX_RESOLUTION),
      roundPixels: true,
    });
    this.app.ticker.maxFPS = MAX_FPS;
    // We present from frame() only when dirty; the TickerPlugin would render
    // every tick. (ResizePlugin still renders on its own after a resize.)
    this.app.ticker.remove(this.app.render, this.app);
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.canvas.style.display = "block";
    el.appendChild(this.app.canvas);
    this.observeSize(el);
    this.scene.sortableChildren = true;
    this.ceiling.alpha = 0.95;
    this.ghost.anchor.set(0, 1);
    this.ghost.visible = false;
    this.promptBox.addChild(this.promptBg, this.promptText);
    this.promptBox.visible = false;
    this.stage.addChild(
      this.floor,
      this.doors,
      this.rugs,
      this.scene,
      this.fx,
      this.tvGlow,
      this.ceiling,
      this.labels,
      this.overlayGfx,
      this.ghost,
      this.promptBox,
    );
    this.app.stage.addChild(this.stage);
  }

  /** Moves the canvas to another host (the page was reopened); drawing resumes. */
  attach(el: HTMLElement) {
    this.app.resizeTo = el;
    el.appendChild(this.app.canvas);
    this.observeSize(el);
    this.dirty = true;
    this.app.ticker.start();
  }

  /** Forces the next frame to be drawn (e.g. the page became visible again). */
  invalidate() {
    this.dirty = true;
  }

  /** Takes the canvas off the page and stops drawing; the world keeps updating. */
  detach() {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.app.ticker.stop();
    this.app.canvas.remove();
  }

  setZoom(z: number) {
    this.zoom = Math.max(1, Math.min(3, Math.round(z)));
    this.dirty = true;
  }

  /** Where the camera looks for a moment instead of at us (world px). */
  private peekAt: { x: number; y: number; until: number } | null = null;

  /** Looks at a world point for `ms` (or until we walk). */
  peek(x: number, y: number, nowMs: number, ms = 5_000) {
    this.peekAt = { x, y, until: nowMs + ms };
    this.dirty = true;
  }

  /** Screen (CSS px relative to the canvas) → world px. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.stage.position.x) / this.zoom,
      y: (sy - this.stage.position.y) / this.zoom,
    };
  }

  /** The character sheet of a palette; with `gear`, the hero dressed for training. */
  private framesFor(idx: number, gear: AvatarGear | null = null): Texture[] {
    const key = gear ? `${idx}|${gearKey(gear)}` : String(idx);
    let frames = this.paletteFrames.get(key);
    if (!frames) {
      const base = Texture.from(
        gear
          ? equippedSheet(palette(idx), gear)
          : characterSheet(palette(idx)),
      );
      this.ownedTextures.push(base);
      base.source.scaleMode = "nearest";
      frames = [];
      for (let i = 0; i < DIRS.length * FRAMES; i++) {
        frames.push(
          new Texture({
            source: base.source,
            frame: new Rectangle(i * SPRITE, 0, SPRITE, SPRITE),
          }),
        );
      }
      this.paletteFrames.set(key, frames);
    }
    return frames;
  }

  // ---- static layers -------------------------------------------------------

  /** Map geometry or room views changed: rebuild doors and labels (chunks if geometry changed). */
  rebuildStatic(world: World) {
    const { map, ix } = world;
    if (!map || !ix) return;
    this.dirty = true;
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
        this.doors
          .rect(x + 6, y + 6, TILE - 12, TILE - 12)
          .fill({ color: 0x9a6b3f });
        this.doors
          .rect(x + 8, y + 8, TILE - 16, TILE - 16)
          .fill({ color: 0xc48f5a });
        this.doors.rect(x + 12, y + 14, 2, 4).fill({ color: 0xe9d7a8 });
      } else {
        this.doors
          .rect(x + 6, y + 6, TILE - 12, TILE - 12)
          .fill({ color: 0x5a2f2a });
        // Lock glyph: shackle + body (shape, not only colour).
        this.doors.rect(x + 12, y + 9, 8, 2).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 11, y + 10, 2, 5).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 19, y + 10, 2, 5).fill({ color: 0xe9d7a8 });
        this.doors.rect(x + 9, y + 14, 14, 9).fill({ color: 0xe9d7a8 });
      }
      const title = view?.label
        ? view.label
        : `🔒 ${roomTitle(world, r.roomId)}`;
      // How many are inside (server presence), for rooms the viewer may see.
      const inside = view?.label
        ? (world.presence?.rooms.find((x) => x.room_id === r.roomId)?.people
            .length ?? 0)
        : 0;
      const label = new Text({
        text: inside > 0 ? `${title} · ${inside}` : title,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          fill: 0xffffff,
          fontWeight: "700",
          stroke: { color: 0x15131a, width: 3 },
        },
        resolution: 3,
      });
      label.anchor.set(0.5, 0);
      label.position.set(
        r.labelAnchor.tx * TILE + TILE / 2,
        r.interior.y0 * TILE + 2,
      );
      this.labels.addChild(label);
    }
    for (const w of map.wings) {
      const title = world.wings.get(w.index)?.title;
      if (!title) continue;
      const t = new Text({
        text: `Ala ${title}`,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 11,
          fill: 0xeeeeff,
          fontWeight: "700",
          stroke: { color: 0x15131a, width: 3 },
        },
        resolution: 3,
      });
      t.anchor.set(0.5);
      const near = w.north ? w.corridor.y1 : w.corridor.y0;
      t.position.set(
        ((w.corridor.x0 + w.corridor.x1 + 1) / 2) * TILE,
        near * TILE + TILE / 2,
      );
      this.labels.addChild(t);
    }
  }

  private dropChunks() {
    for (const s of this.chunks.values())
      s.destroy({ texture: true, textureSource: true });
    this.chunks.clear();
    this.dirty = true;
  }

  /** Floors per zone changed (or the decoration was loaded): chunks repaint lazily. */
  private refreshFloors(world: World) {
    const key =
      JSON.stringify(world.decor?.floors ?? {}) + "|" + this.mapFingerprint;
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
    for (const [cx, cy] of chunksIn(
      x0 - margin,
      y0 - margin,
      x0 + w + margin,
      y0 + h + margin,
    )) {
      const key = `${cx},${cy}`;
      need.add(key);
      if (this.chunks.has(key)) continue;
      const tex = Texture.from(drawChunk(ix, cx, cy, this.floorLookup));
      tex.source.scaleMode = "nearest";
      const s = new Sprite(tex);
      s.position.set(cx * CHUNK * TILE, cy * CHUNK * TILE);
      this.floor.addChild(s);
      this.chunks.set(key, s);
      this.dirty = true;
    }
    for (const [key, s] of this.chunks) {
      if (need.has(key)) continue;
      s.destroy({ texture: true, textureSource: true });
      this.chunks.delete(key);
      this.dirty = true;
    }
  }

  // ---- decoration ----------------------------------------------------------

  /** Whole decoration (re)built: after a load, a reset, or a map change. */
  rebuildDecor(world: World) {
    this.dirty = true;
    for (const s of this.decor.values()) s.destroy();
    this.decor.clear();
    this.refreshFloors(world);
    if (!world.decor) return;
    for (const inst of world.decor.items) this.addDecor(world, inst);
  }

  /** One change: keeps every other sprite as it is. */
  applyDecorOp(world: World, op: DecorOp) {
    this.dirty = true;
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

  private avatarFor(
    userId: string,
    name: string,
    paletteIndex: number,
    gear: AvatarGear | null = null,
  ): AvatarSprite {
    let a = this.avatars.get(userId);
    const look = gear ? gearKey(gear) : "";
    if (a && (a.palette !== paletteIndex || a.look !== look)) {
      a.palette = paletteIndex;
      a.look = look;
      a.frames = this.framesFor(paletteIndex, gear);
      this.dirty = true;
    }
    if (!a) {
      const frames = this.framesFor(paletteIndex, gear);
      const body = new Sprite(frames[0]);
      body.anchor.set(0.5, 1);
      body.scale.set(AVATAR_SCALE);
      const tag = new Text({
        text: name,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 11,
          fill: 0xffffff,
          stroke: { color: 0x15131a, width: 3 },
        },
        resolution: 3,
      });
      tag.anchor.set(0.5, 1);
      tag.position.set(0, -SPRITE * AVATAR_SCALE - 2);
      const ring = new Graphics();
      const badge = new Graphics();
      const root = new Container();
      root.addChild(ring, body, tag, badge);
      this.scene.addChild(root);
      a = {
        palette: paletteIndex,
        look,
        root,
        body,
        name: tag,
        frames,
        ring,
        badge,
        indicators: "",
      };
      this.avatars.set(userId, a);
      this.dirty = true;
    }
    if (a.name.text !== name) {
      a.name.text = name;
      this.dirty = true;
    }
    return a;
  }

  private pose(
    a: AvatarSprite,
    dir: Direction,
    moving: boolean,
    nowMs: number,
    visible: boolean,
  ) {
    const d = DIRS.indexOf(dir);
    const f = moving ? 1 + (Math.floor(nowMs / STEP_MS) % 2) : 0;
    const tex = a.frames[d * FRAMES + f] ?? a.frames[0]!;
    if (a.body.texture === tex) return;
    a.body.texture = tex;
    if (visible) this.dirty = true;
  }

  /** The middle of a dummy, in world px (null: it is gone). */
  private dummyCenter(world: World, id: string): { x: number; y: number } | null {
    const inst = world.decor?.items.find((i) => i.id === id);
    const item = inst ? itemOf(CATALOG, inst.item) : undefined;
    const zone = inst ? world.zones?.byKey.get(inst.zone) : undefined;
    if (!inst || !item || !zone) return null;
    const r = instanceRect(zone, item, inst);
    return {
      x: ((r.x0 + r.x1 + 1) / 2) * TILE,
      y: ((r.y0 + r.y1 + 1) / 2) * TILE - 4,
    };
  }

  /** A trainer standing still faces their dummy. */
  private faceDummy(
    world: World,
    x: number,
    y: number,
    hero: AvatarHero | null,
    moving: boolean,
  ): Direction | null {
    if (moving || !hero?.training || !hero.at) return null;
    const c = this.dummyCenter(world, hero.at);
    if (!c) return null;
    const dx = c.x - x;
    const dy = c.y - (y - 8);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "down" : "up";
  }

  private fxTexture(k: FxArt): Texture {
    let t = this.fxTextures.get(k);
    if (!t) {
      t = Texture.from(fxCanvas(k));
      t.source.scaleMode = "nearest";
      this.ownedTextures.push(t);
      this.fxTextures.set(k, t);
    }
    return t;
  }

  /**
   * The attack of each trainer in view, thrown at the dummy in the rhythm of the vocation
   * (trainFx.ts). Moves at most every SHOT_FRAME_MS, so a room of trainers costs ~30 frames a
   * second while a shot flies and nothing in between; reduced motion shows none.
   */
  private drawShots(
    world: World,
    nowMs: number,
    trainers: Array<{ userId: string; x: number; y: number; hero: AvatarHero }>,
  ) {
    const live = new Set<string>();
    if (!this.reducedMotion) {
      const due = nowMs - this.shotAt >= SHOT_FRAME_MS;
      if (due) this.shotAt = nowMs;
      for (const t of trainers) {
        if (!t.hero.at || !t.hero.gear) continue;
        const c = this.dummyCenter(world, t.hero.at);
        if (!c || (!this.inView(t.x, t.y) && !this.inView(c.x, c.y))) continue;
        live.add(t.userId);
        if (!due) continue;
        this.moveShot(t, c, nowMs);
      }
    }
    for (const [id, s] of this.shots) {
      if (live.has(id)) continue;
      s.shot.destroy();
      s.hit.destroy();
      this.shots.delete(id);
      this.dirty = true;
    }
  }

  private moveShot(
    t: { userId: string; x: number; y: number; hero: AvatarHero },
    c: { x: number; y: number },
    nowMs: number,
  ) {
    let s = this.shots.get(t.userId);
    if (!s) {
      const shot = new Sprite();
      shot.anchor.set(0.5);
      shot.scale.set(AVATAR_SCALE);
      shot.visible = false;
      const hit = new Sprite(this.fxTexture("faisca"));
      hit.anchor.set(0.5);
      hit.scale.set(AVATAR_SCALE);
      hit.visible = false;
      this.fx.addChild(shot, hit);
      s = { shot, hit, art: null };
      this.shots.set(t.userId, s);
    }
    const { n, phase } = shotPhase(
      nowMs,
      seedOf(t.userId),
      attackPeriod(t.hero.vocation),
    );
    const kind = shotFor(t.hero.gear!, n);
    const stage = shotStage(phase);
    const fromX = t.x;
    const fromY = t.y - 8;
    if (s.art !== kind.art) {
      s.art = kind.art;
      s.shot.texture = this.fxTexture(kind.art);
    }
    s.shot.tint = kind.tint;
    s.hit.tint = kind.tint;
    if (stage.kind === "flying") {
      const e = 1 - (1 - stage.t) * (1 - stage.t);
      s.shot.position.set(
        Math.round(fromX + (c.x - fromX) * e),
        Math.round(fromY + (c.y - fromY) * e),
      );
      s.shot.rotation = kind.spin
        ? phase / 60
        : Math.atan2(c.y - fromY, c.x - fromX);
      s.shot.visible = true;
      s.hit.visible = false;
    } else if (stage.kind === "hit") {
      s.shot.visible = false;
      s.hit.position.set(Math.round(c.x), Math.round(c.y));
      s.hit.visible = true;
    } else {
      if (!s.shot.visible && !s.hit.visible) return;
      s.shot.visible = false;
      s.hit.visible = false;
    }
    this.dirty = true;
  }

  /** Call indicators of someone, from the server presence and our room's speakers. */
  private indicatorsOf(world: World, userId: string): AvatarIndicators {
    const v = world.voiceOf(userId);
    return {
      muted: Boolean(v?.connected && !v.mic),
      deaf: Boolean(v?.deaf),
      screen: Boolean(v?.screen),
      speaking: world.speakers.has(userId),
    };
  }

  private indicate(a: AvatarSprite, i: AvatarIndicators, visible: boolean) {
    const key = indicatorsKey(i);
    if (a.indicators === key) return;
    a.indicators = key;
    a.ring.clear();
    if (i.speaking) {
      a.ring
        .ellipse(0, -2, 11, 4)
        .stroke({ color: 0x4ade80, width: 2, alpha: 0.95 });
    }
    drawBadge(a.badge, i, -SPRITE * AVATAR_SCALE - 24);
    if (visible) this.dirty = true;
  }

  /** World rect on screen (plus a margin for sprites and name tags), set each frame. */
  private readonly view = { x0: 0, y0: 0, x1: 0, y1: 0 };

  private inView(x: number, y: number): boolean {
    const v = this.view;
    return x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1;
  }

  /**
   * Moves an avatar. Marks the frame dirty only when something on screen
   * changed: someone walking around the hall while we sit in a room does not
   * cost a frame. Returns whether the avatar is (or just was) visible.
   */
  private place(a: AvatarSprite, x: number, y: number, alpha: number): boolean {
    const px = Math.round(x);
    const py = Math.round(y + 6);
    const pos = a.root.position;
    const visible = this.inView(px, py) || this.inView(pos.x, pos.y);
    if (pos.x !== px || pos.y !== py) {
      pos.set(px, py);
      if (visible) this.dirty = true;
    }
    // zIndex's setter is a no-op on equal values, so idle avatars never re-sort the scene.
    const z = y + 6;
    if (a.root.zIndex !== z) {
      a.root.zIndex = z;
      if (visible) this.dirty = true;
    }
    if (a.root.alpha !== alpha) {
      a.root.alpha = alpha;
      if (visible) this.dirty = true;
    }
    return visible;
  }

  // ---- overlays ------------------------------------------------------------

  private drawOverlay() {
    const o = this.overlay;
    // `overlay` is replaced (never mutated) on every editor change. Clearing the
    // Graphics on every frame made PixiJS rebuild the instructions of the whole
    // stage on every frame, even with the editor closed.
    if (o === this.drawnOverlay) return;
    this.drawnOverlay = o;
    this.dirty = true;
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
      if (o.floorTool)
        g.rect(x0, y0, w, h).fill({ color: 0x7aa2ff, alpha: 0.18 });
      for (let x = x0; x <= x0 + w; x += TILE)
        g.rect(x, y0, 1, h).fill({ color: 0xffffff, alpha: 0.18 });
      for (let y = y0; y <= y0 + h; y += TILE)
        g.rect(x0, y, w, 1).fill({ color: 0xffffff, alpha: 0.18 });
      g.rect(x0, y0, w, h).stroke({ color: 0x7aa2ff, width: 2, alpha: 0.6 });
    }
    if (o.hoverTile && !o.ghost) {
      g.rect(o.hoverTile.tx * TILE, o.hoverTile.ty * TILE, TILE, TILE).stroke({
        color: 0xffffff,
        width: 2,
        alpha: 0.5,
      });
    }
    if (o.selected) {
      const r = o.selected;
      g.rect(
        r.x0 * TILE - 2,
        r.y0 * TILE - 2,
        (r.x1 - r.x0 + 1) * TILE + 4,
        (r.y1 - r.y0 + 1) * TILE + 4,
      ).stroke({ color: 0xffd166, width: 3 });
    }
    if (o.ghost) {
      const gh = o.ghost;
      this.ghost.texture = textureFor(gh.item, gh.rot, gh.variant);
      this.ghost.position.set(gh.rect.x0 * TILE, (gh.rect.y1 + 1) * TILE);
      this.ghost.alpha = 0.75;
      this.ghost.tint = gh.valid ? 0xb8ffb8 : 0xff8a8a;
      this.ghost.visible = true;
      const r = gh.rect;
      g.rect(
        r.x0 * TILE,
        r.y0 * TILE,
        (r.x1 - r.x0 + 1) * TILE,
        (r.y1 - r.y0 + 1) * TILE,
      ).fill({ color: gh.valid ? 0x4dff7a : 0xff5d5d, alpha: 0.2 });
    } else {
      this.ghost.visible = false;
    }
  }

  private drawPrompt() {
    const p = this.prompt;
    const was = this.drawnPrompt;
    // Re-set at 4 Hz with a fresh object; redraw only when it actually moved.
    if (
      p === was ||
      (p && was && p.x === was.x && p.y === was.y && p.label === was.label)
    )
      return;
    this.drawnPrompt = p;
    this.dirty = true;
    if (!p) {
      this.promptBox.visible = false;
      return;
    }
    this.promptBox.visible = true;
    this.promptText.text = `E · ${p.label}`;
    const w = this.promptText.width + 14;
    const h = this.promptText.height + 8;
    this.promptBg.clear();
    this.promptBg
      .roundRect(0, 0, w, h, 6)
      .fill({ color: 0x15131a, alpha: 0.85 });
    this.promptBg
      .roundRect(0, 0, w, h, 6)
      .stroke({ color: 0x7aa2ff, width: 1 });
    this.promptText.position.set(7, 4);
    this.promptBox.position.set(
      Math.round(p.x - w / 2),
      Math.round(p.y - h - 6),
    );
  }

  /** Updates the scene from World, then draws it if anything visible changed. */
  frame(world: World, nowMs: number, dtMs: number) {
    this.update(world, nowMs, dtMs);
    this.present();
  }

  /**
   * Draws only when the scene changed since the last present, and never while
   * the page is hidden (the frame stays owed and is drawn on return).
   */
  private present() {
    if (!this.dirty || globalThis.document?.hidden) return;
    this.dirty = false;
    this.app.render();
  }

  private update(world: World, nowMs: number, dtMs: number) {
    const me = world.me;
    if (!me || !world.map) return;
    // Camera follows us, or looks at a room for a moment ("Ver no mapa");
    // walking brings it back at once. Smoothing off with reduced motion.
    if (this.peekAt && (me.moving || nowMs > this.peekAt.until))
      this.peekAt = null;
    const target = this.peekAt ?? me;
    if (!this.cam.ready || this.reducedMotion) {
      this.cam = { x: target.x, y: target.y, ready: true };
    } else {
      const k = Math.min(1, (dtMs / 1000) * 10);
      this.cam.x += (target.x - this.cam.x) * k;
      this.cam.y += (target.y - this.cam.y) * k;
    }
    if (this.stage.scale.x !== this.zoom) {
      this.stage.scale.set(this.zoom);
      this.dirty = true;
    }
    // Rounded: the eased camera converges asymptotically, and once it is within
    // half a pixel the stage stops moving and idle frames stop drawing.
    const sx = Math.round(this.app.screen.width / 2 - this.cam.x * this.zoom);
    const sy = Math.round(this.app.screen.height / 2 - this.cam.y * this.zoom);
    if (this.stage.position.x !== sx || this.stage.position.y !== sy) {
      this.stage.position.set(sx, sy);
      this.dirty = true;
    }
    this.ensureChunks(world);

    const margin = SPRITE * AVATAR_SCALE * 2;
    this.view.x0 = -this.stage.position.x / this.zoom - margin;
    this.view.y0 = -this.stage.position.y / this.zoom - margin;
    this.view.x1 =
      this.view.x0 + this.app.screen.width / this.zoom + margin * 2;
    this.view.y1 =
      this.view.y0 + this.app.screen.height / this.zoom + margin * 2;

    const seen = new Set<string>([me.userId]);
    // Who trains at a dummy now (they wear their gear, face it and throw at it).
    const trainers: Array<{ userId: string; x: number; y: number; hero: AvatarHero }> = [];
    const mine = this.avatarFor(
      me.userId,
      heroLabel(me.name, world.myHero),
      me.palette,
      trainingGear(world.myHero),
    );
    const mineVisible = this.place(mine, me.x, me.y, 1);
    this.pose(
      mine,
      this.faceDummy(world, me.x, me.y, world.myHero, me.moving) ?? me.dir,
      me.moving,
      nowMs,
      mineVisible,
    );
    this.indicate(mine, this.indicatorsOf(world, me.userId), mineVisible);
    if (world.myHero?.training)
      trainers.push({ userId: me.userId, x: me.x, y: me.y, hero: world.myHero });
    for (const r of world.others.values()) {
      seen.add(r.userId);
      const p = world.positionOf(r, nowMs);
      const a = this.avatarFor(
        r.userId,
        heroLabel(r.name, r.hero),
        r.palette,
        trainingGear(r.hero),
      );
      const visible = this.place(
        a,
        p.x,
        p.y,
        r.state === "reconnecting" ? 0.45 : r.state === "idle" ? 0.75 : 1,
      );
      this.pose(
        a,
        this.faceDummy(world, p.x, p.y, r.hero, r.moving) ?? r.dir,
        r.moving,
        nowMs,
        visible,
      );
      this.indicate(a, this.indicatorsOf(world, r.userId), visible);
      if (r.hero?.training)
        trainers.push({ userId: r.userId, x: p.x, y: p.y, hero: r.hero });
    }
    this.drawShots(world, nowMs, trainers);
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      a.root.destroy({ children: true });
      this.avatars.delete(id);
      this.dirty = true;
    }
    this.drawOverlay();
    this.drawPrompt();
    if (this.tvDirty) this.drawTvGlow(world);
  }

  /**
   * A TV whose room is watching something gets a lit screen: a bright panel
   * and a play mark over the set (no animation: the map stays drawn on demand).
   */
  private drawTvGlow(world: World) {
    this.tvDirty = false;
    const zones = world.zones;
    const lit: Array<{ id: string; rect: TileRect; wall: boolean }> = [];
    for (const inst of world.decor?.items ?? []) {
      const item = itemOf(CATALOG, inst.item);
      const zone = zones?.byKey.get(inst.zone);
      if (
        !item?.smartTv ||
        zone?.kind !== "room" ||
        !zone.roomId ||
        !world.tvOn(zone.roomId)
      )
        continue;
      lit.push({
        id: inst.id,
        rect: instanceRect(zone, item, inst),
        wall: item.layer === "wall",
      });
    }
    const key = lit.map((l) => l.id).join(",");
    if (key === this.tvKey) return;
    this.tvKey = key;
    this.dirty = true;
    const g = this.tvGlow;
    g.clear();
    for (const { rect, wall } of lit) {
      const w = (rect.x1 - rect.x0 + 1) * TILE;
      // Wall sets fill their wall tile; a set on a rack shows its screen above the footprint.
      const x = rect.x0 * TILE + 4;
      const y = wall ? rect.y0 * TILE + 6 : rect.y0 * TILE - TILE * 0.55;
      const h = wall ? TILE - 14 : TILE * 0.5;
      g.rect(x, y, w - 8, h).fill({ color: 0x7dd3fc, alpha: 0.55 });
      g.rect(x, y, w - 8, h).stroke({ color: 0xe0f2fe, width: 1, alpha: 0.9 });
      const cx = x + (w - 8) / 2;
      const cy = y + h / 2;
      g.poly([cx - 3, cy - 4, cx - 3, cy + 4, cx + 4, cy]).fill({
        color: 0xffffff,
        alpha: 0.95,
      });
    }
  }

  /**
   * Frees what this renderer owns, and only that. Another space can be alive on
   * the same page (one kept connected for its room audio), so:
   * - never `app.destroy(true, …)`: `true` also means `releaseGlobalResources`,
   *   which destroys PixiJS's module-wide batch pool that every other
   *   Application is drawing with; the kept space then crashed on its next
   *   render ("reading 'clear'") and the page showed "Não foi possível abrir o
   *   mapa";
   * - never `texture: true` on the stage: decoration textures are shared by
   *   every space through the atlas cache.
   */
  destroy() {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.dropChunks();
    for (const t of this.ownedTextures) t.destroy(true);
    this.ownedTextures.length = 0;
    this.paletteFrames.clear();
    this.fxTextures.clear();
    this.shots.clear();
    this.app.destroy(RENDERER_DESTROY, { children: true });
  }
}
