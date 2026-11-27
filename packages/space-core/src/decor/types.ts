/**
 * Decoration model (ADR 0007): the catalog defines items; a server's space
 * holds instances of them, anchored to a zone of the map. Definitions and
 * instances are different things: an item says what a sofa is, an instance
 * says where this sofa stands in this server.
 */

export type DecorCategory =
  | "floor"
  | "rug"
  | "furniture"
  | "gamer"
  | "decor"
  | "lighting"
  | "equipment"
  | "special";

/**
 * Where an item is drawn and how it interacts with people:
 * - `floor`: a floor material, painted per zone (never an instance);
 * - `rug`: on the floor, under everyone; walkable;
 * - `furniture`: on the floor, sorted with the avatars by depth; usually solid;
 * - `wall`: hangs on the wall tile right above a zone (posters, windows);
 * - `ceiling`: above everyone (lamps); walkable.
 */
export type DecorLayer = "floor" | "rug" | "furniture" | "wall" | "ceiling";

/** Quarter turns clockwise from the item's default facing (down). */
export type Rotation = 0 | 1 | 2 | 3;

/**
 * Behaviours an instance can carry. The client runs them when someone stands
 * next to the instance and interacts; the server only stores and validates the
 * configuration (and performs `teleport`, which moves the avatar).
 */
/** `train`: dummy de treino do jogo idle (docs/espaco/jogo/ot): o herói treina ao lado dele. */
/** `npc`: NPC do jogo idle (etapa O8): mercador, banqueiro ou mestre das vocações. */
/** `news`: o quadro de avisos (25/11/2026): abre as novidades do produto, que vêm do servidor. */
/** `arsenal`: a estante do Arsenal (27/11/2026): abre todos os itens do jogo idle. */
export type InteractionKind = "link" | "note" | "picture" | "frame" | "teleport" | "tv" | "train" | "npc" | "news" | "arsenal";

/** Os NPCs do jogo idle (etapa O8). */
export type NpcKind = "mercador" | "banqueiro" | "mestre" | "ferreiro";

export interface InteractionConfig {
  /** Shown as the prompt and dialog title. */
  title?: string;
  /** `link`, `picture`, `frame`: http(s) URL. */
  url?: string;
  /** `note`: text shown in a dialog. */
  text?: string;
  /** `teleport`: destination zone key (hall, spine, wing:<i>, room:<id>). */
  target?: string;
}

export interface DecorItem {
  id: string;
  /** PT-BR display name (the product's language; i18n of the catalog is a later step). */
  name: string;
  category: DecorCategory;
  description?: string;
  layer: DecorLayer;
  /** Footprint in tiles at rotation 0 (w across, h down). */
  w: number;
  h: number;
  /** 1 = no rotation; 2 = across/along (odd rotations transpose the footprint); 4 = four facings. */
  rotations: 1 | 2 | 4;
  /** Blocks movement. Rugs, ceiling and wall items never do. */
  solid: boolean;
  /** Colour variants (ids understood by the art); the first is the default. */
  variants?: readonly string[];
  interaction?: InteractionKind;
  /** Store availability. Everything is free today; premium is a later step. */
  premium?: boolean;
  /** Search tags (PT-BR). */
  tags?: readonly string[];
  /** The room's Smart TV (ADR 0008): only works inside a room, needs no configuration. */
  smartTv?: boolean;
  /** `npc` items: which NPC of the idle game this is (stage O8). */
  npc?: NpcKind;
  /** Dummy de treino (`train`): de vocação (armas e magia, o padrão) ou de habilidade (24/11/2026). */
}

export interface DecorInstance {
  id: string;
  item: string;
  /** Zone key the coordinates are relative to (zones.ts). */
  zone: string;
  /** Top-left of the footprint, in tiles relative to the zone's rectangle. Wall items use y = -1. */
  x: number;
  y: number;
  rot: Rotation;
  variant?: string;
  config?: InteractionConfig;
  /**
   * Server → client only: the configuration exists but this viewer may not
   * use the object (Stoat InteractSpaceObjects), so it was left out.
   */
  locked?: boolean;
}

export interface DecorSettings {
  /**
   * Deprecated by ADR 0008: who decorates is Stoat's DecorateSpace permission
   * (roles and channel overrides). Kept so stored documents and older apps
   * still parse; the server no longer reads it.
   */
  editors: "admins" | "roles" | "everyone";
  roles: string[];
  /** Smart TV: minimum seconds between two different videos in a room ("um por vez"); 0 = off. */
  tv_cooldown_s?: number;
  /**
   * Refúgio, the space's game (ADR 0009): the server owner may turn it off
   * here once the operator switched it on (SPACE_GAME_SERVERS). Absent = on.
   * A save that leaves it out keeps the stored value (older apps).
   */
  game?: "on" | "off";
}

/** Longest TV interval a server may set (one day). */
export const MAX_TV_COOLDOWN_S = 86_400;

export interface DecorState {
  /** Monotonic revision; every accepted change bumps it. */
  rev: number;
  /** Floor item per zone key; zones without one use the theme's default. */
  floors: Record<string, string>;
  items: DecorInstance[];
  settings: DecorSettings;
  /** Zone keys already furnished by the default theme (so an emptied room stays empty). */
  furnished: string[];
}

/** Change applied to a DecorState; also what `decor.changed` carries. */
export type DecorOp =
  | { kind: "place"; item: DecorInstance }
  | { kind: "update"; item: DecorInstance }
  | { kind: "remove"; id: string }
  | { kind: "floor"; zone: string; floor: string | null }
  | { kind: "settings"; settings: DecorSettings }
  /** The state changed in a way not expressed as one op (theme, restart): fetch it again. */
  | { kind: "reset" };

export const DEFAULT_SETTINGS: DecorSettings = { editors: "admins", roles: [] };

export function emptyDecor(): DecorState {
  return { rev: 0, floors: {}, items: [], settings: { ...DEFAULT_SETTINGS, roles: [] }, furnished: [] };
}
