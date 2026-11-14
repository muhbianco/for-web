import {
  CATALOG,
  type DecorInstance,
  type DecorItem,
  type DecorOp,
  type DecorSettings,
  footprint,
  type InteractionConfig,
  instanceRect,
  itemOf,
  type PlacementError,
  type Rotation,
  Tile,
  TILE,
  tileAt,
  type TileRect,
  validatePlacement,
  type Zone,
  zoneAt,
  zoneHeight,
  zoneWidth,
} from "@muchat/space-core";

import type { World } from "./world.ts";

/**
 * The decoration editor (ADR 0007): tools, ghost preview, selection, drag,
 * undo/redo. It never changes the world itself: every change is a command to
 * the server, and the world changes when the server confirms it (so what you
 * see is what everyone sees). The ghost is validated with the same rules the
 * server applies, so a green preview is never refused.
 */
export type Tool =
  | { kind: "none" }
  | { kind: "place"; item: DecorItem; rot: Rotation; variant: string | undefined }
  | { kind: "floor"; floor: string };

export interface Ghost {
  inst: DecorInstance;
  item: DecorItem;
  rect: TileRect;
  error: PlacementError | null;
}

export interface EditorState {
  enabled: boolean;
  tool: Tool;
  selected: DecorInstance | null;
  /** Zone under the cursor (for the floor tool and the status line). */
  hoverZone: Zone | null;
  hoverTile: { tx: number; ty: number } | null;
  ghost: Ghost | null;
  dragging: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Last refusal, in words (PT-BR); cleared on the next successful change. */
  message: string | null;
}

/** PT-BR for the server's refusals. */
export const PLACEMENT_MESSAGES: Record<PlacementError, string> = {
  unknown_item: "Esse item não existe.",
  not_placeable: "Pisos são aplicados ao ambiente, não colocados.",
  unknown_zone: "Fora de um ambiente.",
  bad_rotation: "Esse item não gira assim.",
  bad_id: "Erro interno (identificador).",
  out_of_zone: "Não cabe aqui.",
  not_floor: "Só no chão.",
  not_wall: "Só na parede de fundo.",
  overlap: "Já tem algo aqui.",
  blocks_door: "Bloquearia uma porta, uma entrada ou o ponto de chegada.",
  blocks_path: "Fecharia o caminho até uma sala.",
  too_many: "O servidor chegou ao limite de itens.",
  bad_config: "Configuração inválida.",
};

export const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: "Você não pode decorar aqui.",
  conflict: "Outra pessoa alterou a decoração ao mesmo tempo. Tente de novo.",
  not_found: "Esse item não existe mais.",
  rate_limited: "Calma: muitas alterações por segundo.",
  internal: "Erro no servidor do espaço.",
};

const LAYER_PRIORITY: Record<string, number> = { ceiling: 4, wall: 3, furniture: 2, rug: 1, floor: 0 };

export function newInstanceId(): string {
  const n = Math.floor(Math.random() * 2 ** 40);
  return `d-${n.toString(36).padStart(8, "0")}`;
}

type Pending = { inverse: DecorOp | null; from: "normal" | "undo" | "redo" };

export class Editor {
  state: EditorState = {
    enabled: false,
    tool: { kind: "none" },
    selected: null,
    hoverZone: null,
    hoverTile: null,
    ghost: null,
    dragging: false,
    canUndo: false,
    canRedo: false,
    message: null,
  };
  private readonly world: World;
  private readonly send: (cmd: Record<string, unknown>) => string;
  private readonly changed: () => void;
  private readonly pending = new Map<string, Pending>();
  private readonly undoStack: DecorOp[] = [];
  private readonly redoStack: DecorOp[] = [];
  private drag: { inst: DecorInstance; offX: number; offY: number; moved: boolean } | null = null;

  constructor(world: World, send: (cmd: Record<string, unknown>) => string, changed: () => void) {
    this.world = world;
    this.send = send;
    this.changed = changed;
  }

  private patch(p: Partial<EditorState>) {
    this.state = { ...this.state, ...p, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
    this.changed();
  }

  setEnabled(on: boolean) {
    if (on === this.state.enabled) return;
    this.drag = null;
    this.patch({ enabled: on, tool: { kind: "none" }, selected: null, ghost: null, dragging: false, message: null });
    if (on) this.refreshGhost();
  }

  pickItem(itemId: string, variant?: string) {
    const item = itemOf(CATALOG, itemId);
    if (!item || item.layer === "floor") return;
    const v = variant ?? item.variants?.[0];
    this.patch({ tool: { kind: "place", item, rot: 0, variant: v }, selected: null, message: null });
    this.refreshGhost();
  }

  pickFloor(floor: string) {
    this.patch({ tool: { kind: "floor", floor }, selected: null, ghost: null, message: null });
  }

  cancel() {
    this.drag = null;
    this.patch({ tool: { kind: "none" }, selected: null, ghost: null, dragging: false });
  }

  /** Next facing of the ghost, or of the selected instance (a server change). */
  rotate() {
    const t = this.state.tool;
    if (t.kind === "place") {
      this.patch({ tool: { ...t, rot: nextRot(t.item, t.rot) } });
      this.refreshGhost();
      return;
    }
    const sel = this.state.selected;
    if (sel) {
      const item = itemOf(CATALOG, sel.item);
      if (!item || item.rotations === 1) return;
      this.sendUpdate({ ...sel, rot: nextRot(item, sel.rot) }, sel);
    }
  }

  removeSelected() {
    const sel = this.state.selected;
    if (!sel) return;
    const id = this.send({ v: 1, t: "decor.remove", d: { id: sel.id } });
    this.pending.set(id, { inverse: { kind: "place", item: sel }, from: "normal" });
  }

  duplicateSelected() {
    const sel = this.state.selected;
    if (!sel) return;
    const item = itemOf(CATALOG, sel.item);
    if (!item) return;
    this.patch({ tool: { kind: "place", item, rot: sel.rot, variant: sel.variant }, selected: null });
    this.refreshGhost();
  }

  /** Variant or interaction configuration of the selected instance. */
  updateSelected(p: { variant?: string; config?: InteractionConfig | null }) {
    const sel = this.state.selected;
    if (!sel) return;
    const next: DecorInstance = { ...sel };
    if (p.variant !== undefined) next.variant = p.variant;
    if (p.config !== undefined) {
      if (p.config === null) delete next.config;
      else next.config = p.config;
    }
    this.sendUpdate(next, sel);
  }

  setSettings(settings: DecorSettings) {
    this.send({ v: 1, t: "decor.settings", d: settings });
  }

  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    this.perform(op, "undo");
    this.patch({});
  }

  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    this.perform(op, "redo");
    this.patch({});
  }

  /** Sends the command that performs `op`, remembering its inverse for the other stack. */
  private perform(op: DecorOp, from: "undo" | "redo") {
    const decor = this.world.decor;
    let id: string;
    let inverse: DecorOp | null = null;
    switch (op.kind) {
      case "place":
        id = this.send({ v: 1, t: "decor.place", d: op.item });
        inverse = { kind: "remove", id: op.item.id };
        break;
      case "remove": {
        const cur = decor?.items.find((i) => i.id === op.id);
        id = this.send({ v: 1, t: "decor.remove", d: { id: op.id } });
        inverse = cur ? { kind: "place", item: cur } : null;
        break;
      }
      case "update": {
        const cur = decor?.items.find((i) => i.id === op.item.id);
        id = this.send({ v: 1, t: "decor.update", d: op.item });
        inverse = cur ? { kind: "update", item: cur } : null;
        break;
      }
      case "floor": {
        const cur = decor?.floors[op.zone] ?? null;
        id = this.send({ v: 1, t: "decor.floor", d: { zone: op.zone, floor: op.floor } });
        inverse = { kind: "floor", zone: op.zone, floor: cur };
        break;
      }
      default:
        return;
    }
    this.pending.set(id, { inverse, from });
  }

  private sendUpdate(next: DecorInstance, prev: DecorInstance) {
    const id = this.send({ v: 1, t: "decor.update", d: next });
    this.pending.set(id, { inverse: { kind: "update", item: prev }, from: "normal" });
  }

  // ---- pointer -------------------------------------------------------------

  hover(wx: number, wy: number) {
    const tile = { tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
    if (this.state.hoverTile?.tx === tile.tx && this.state.hoverTile?.ty === tile.ty) return;
    this.state = { ...this.state, hoverTile: tile };
    if (this.drag && (tile.tx !== Math.floor(this.drag.inst.x) || true)) this.drag.moved = this.drag.moved || this.dragMoved(tile);
    this.refreshGhost();
  }

  private dragMoved(tile: { tx: number; ty: number }): boolean {
    const d = this.drag;
    if (!d) return false;
    const zone = this.world.zones?.byKey.get(d.inst.zone);
    if (!zone) return false;
    return tile.tx - d.offX !== zone.rect.x0 + d.inst.x || tile.ty - d.offY !== zone.rect.y0 + d.inst.y;
  }

  pointerDown(wx: number, wy: number) {
    if (!this.state.enabled) return;
    const tile = { tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
    this.state = { ...this.state, hoverTile: tile };
    if (this.state.tool.kind !== "none") return; // place/floor act on release
    const hit = this.instanceAt(tile.tx, tile.ty);
    if (!hit) {
      this.patch({ selected: null, ghost: null });
      return;
    }
    const zone = this.world.zones?.byKey.get(hit.inst.zone);
    if (!zone) return;
    const rect = instanceRect(zone, hit.item, hit.inst);
    this.drag = { inst: hit.inst, offX: tile.tx - rect.x0, offY: tile.ty - rect.y0, moved: false };
    this.patch({ selected: hit.inst, dragging: true, ghost: null, message: null });
  }

  pointerUp(wx: number, wy: number) {
    if (!this.state.enabled) return;
    const tile = { tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
    this.state = { ...this.state, hoverTile: tile };
    const t = this.state.tool;
    if (t.kind === "place") {
      this.refreshGhost();
      const g = this.state.ghost;
      if (!g) return this.patch({ message: PLACEMENT_MESSAGES.unknown_zone });
      if (g.error) return this.patch({ message: PLACEMENT_MESSAGES[g.error] });
      const id = this.send({ v: 1, t: "decor.place", d: g.inst });
      this.pending.set(id, { inverse: { kind: "remove", id: g.inst.id }, from: "normal" });
      // Keep placing with a fresh id: a row of chairs takes a few clicks.
      this.patch({ message: null });
      this.refreshGhost(true);
      return;
    }
    if (t.kind === "floor") {
      const zone = this.zoneUnder(tile);
      if (!zone) return this.patch({ message: PLACEMENT_MESSAGES.unknown_zone });
      const cur = this.world.decor?.floors[zone.key] ?? null;
      if (cur === t.floor) return;
      const id = this.send({ v: 1, t: "decor.floor", d: { zone: zone.key, floor: t.floor } });
      this.pending.set(id, { inverse: { kind: "floor", zone: zone.key, floor: cur }, from: "normal" });
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const g = this.state.ghost;
    if (d.moved && g && g.inst.id === d.inst.id) {
      if (g.error) this.patch({ message: PLACEMENT_MESSAGES[g.error], dragging: false, ghost: null });
      else {
        this.sendUpdate(g.inst, d.inst);
        this.patch({ dragging: false, ghost: null, message: null });
      }
      return;
    }
    this.patch({ dragging: false, ghost: null });
  }

  // ---- server feedback -----------------------------------------------------

  /** A confirmed change (ours or someone else's). */
  onChanged(op: DecorOp, re?: string) {
    const mine = re ? this.pending.get(re) : undefined;
    if (re) this.pending.delete(re);
    if (mine?.inverse) {
      if (mine.from === "undo") this.redoStack.push(mine.inverse);
      else {
        if (mine.from === "normal") this.redoStack.length = 0;
        this.undoStack.push(mine.inverse);
      }
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    let selected = this.state.selected;
    if (selected && op.kind === "remove" && op.id === selected.id) selected = null;
    if (selected && op.kind === "update" && op.item.id === selected.id) selected = op.item;
    if (selected && op.kind === "reset") selected = this.world.decor?.items.find((i) => i.id === selected!.id) ?? null;
    this.patch({ selected, message: mine ? null : this.state.message });
    this.refreshGhost();
  }

  onError(re: string | undefined, code: string, reason?: string) {
    if (re) this.pending.delete(re);
    const text = reason && reason in PLACEMENT_MESSAGES ? PLACEMENT_MESSAGES[reason as PlacementError] : (ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal!);
    this.patch({ message: text });
  }

  // ---- helpers -------------------------------------------------------------

  /** Topmost instance covering a tile (wall and ceiling items first, then furniture, then rugs). */
  instanceAt(tx: number, ty: number): { inst: DecorInstance; item: DecorItem } | null {
    const decor = this.world.decor;
    const zones = this.world.zones;
    if (!decor || !zones) return null;
    let best: { inst: DecorInstance; item: DecorItem; prio: number } | null = null;
    for (const inst of decor.items) {
      const item = itemOf(CATALOG, inst.item);
      const zone = zones.byKey.get(inst.zone);
      if (!item || !zone) continue;
      const r = instanceRect(zone, item, inst);
      if (tx < r.x0 || tx > r.x1 || ty < r.y0 || ty > r.y1) continue;
      const prio = LAYER_PRIORITY[item.layer] ?? 0;
      if (!best || prio >= best.prio) best = { inst, item, prio };
    }
    return best ? { inst: best.inst, item: best.item } : null;
  }

  /** Zone a tile belongs to; a wall tile counts for the zone right below it. */
  private zoneUnder(tile: { tx: number; ty: number }): Zone | null {
    const { zones, map } = this.world;
    if (!zones || !map) return null;
    const direct = zoneAt(zones, tile.tx, tile.ty);
    if (direct) return direct;
    if (tileAt(map, tile.tx, tile.ty) === Tile.Wall) return zoneAt(zones, tile.tx, tile.ty + 1) ?? null;
    return null;
  }

  /** Recomputes the ghost for the place tool or the drag at the hovered tile. */
  private refreshGhost(freshId = false) {
    const tile = this.state.hoverTile;
    const t = this.state.tool;
    const zone = tile ? this.zoneUnder(tile) : null;
    if (!tile || !this.world.decor || !this.world.ix || !this.world.zones) {
      this.patch({ ghost: null, hoverZone: zone });
      return;
    }
    let ghost: Ghost | null = null;
    if (t.kind === "place") {
      const id = freshId || !this.state.ghost || this.state.ghost.inst.item !== t.item.id ? newInstanceId() : this.state.ghost.inst.id;
      ghost = this.ghostFor(t.item, t.rot, t.variant, tile, id, undefined, undefined);
    } else if (this.drag) {
      const d = this.drag;
      const item = itemOf(CATALOG, d.inst.item);
      if (item) ghost = this.ghostFor(item, d.inst.rot, d.inst.variant, { tx: tile.tx - d.offX, ty: tile.ty - d.offY }, d.inst.id, d.inst, "topleft");
    }
    this.patch({ ghost, hoverZone: zone });
  }

  /**
   * Builds a candidate instance at a tile: centred on it (place tool) or with
   * its top-left there (drag), clamped into the zone, then validated.
   */
  private ghostFor(
    item: DecorItem,
    rot: Rotation,
    variant: string | undefined,
    tile: { tx: number; ty: number },
    id: string,
    base: DecorInstance | undefined,
    anchor: "topleft" | undefined,
  ): Ghost | null {
    const { map, ix, zones, decor } = this.world;
    if (!map || !ix || !zones || !decor) return null;
    const fp = footprint(item, rot);
    let zone: Zone | undefined;
    let x: number;
    let y: number;
    if (item.layer === "wall") {
      zone = zoneAt(zones, tile.tx, tile.ty + 1) ?? zoneAt(zones, tile.tx, tile.ty);
      if (!zone) return null;
      x = tile.tx - (anchor ? 0 : Math.floor((fp.w - 1) / 2)) - zone.rect.x0;
      y = -1;
      x = Math.max(0, Math.min(zoneWidth(zone) - fp.w, x));
    } else {
      const cx = anchor ? tile.tx : tile.tx - Math.floor((fp.w - 1) / 2);
      const cy = anchor ? tile.ty : tile.ty - Math.floor((fp.h - 1) / 2);
      zone = zoneAt(zones, tile.tx, tile.ty) ?? (base ? zones.byKey.get(base.zone) : undefined);
      if (!zone) return null;
      x = Math.max(0, Math.min(zoneWidth(zone) - fp.w, cx - zone.rect.x0));
      y = Math.max(0, Math.min(zoneHeight(zone) - fp.h, cy - zone.rect.y0));
    }
    const inst: DecorInstance = {
      ...(base ?? {}),
      id,
      item: item.id,
      zone: zone.key,
      x,
      y,
      rot,
      ...(variant ? { variant } : {}),
    };
    if (!variant) delete (inst as { variant?: string }).variant;
    const error = validatePlacement({ ix, zones, catalog: CATALOG, state: decor }, inst, base?.id);
    return { inst, item, rect: instanceRect(zone, item, inst), error };
  }
}

function nextRot(item: DecorItem, rot: Rotation): Rotation {
  return ((rot + 1) % item.rotations) as Rotation;
}
