import { z } from "zod";

import { ID_PATTERN, MAX_TEXT, MAX_TITLE, MAX_URL } from "../decor/placement.ts";
import { type DecorOp, type DecorSettings, MAX_TV_COOLDOWN_S, type PlacementError } from "../decor/index.ts";
import { isUlid } from "../media/naming.ts";
import type { CompiledMap } from "../map/types.ts";
import { MAX_TV_POS_S, type TvRights, type TvState } from "../tv/tv.ts";

/**
 * WebSocket protocol v1 of the space (docs/espaco §F.8). Commands come from
 * the client and are validated here before anything reads them; events are
 * what the server confirms. Tokens never travel in URLs.
 */
export const PROTOCOL_VERSION = 1;

/** Number of character palettes (space-client render/sprites.ts draws them). */
export const AVATAR_PALETTES = 8;

/** What other people see of you on the map. */
export interface AvatarLook {
  palette: number;
}

/** Palette used until the person picks one: stable per user id. */
export function defaultPalette(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) >>> 0;
  return h % AVATAR_PALETTES;
}

/** Current version of the first-access flow; bump to show it again to everyone. */
export const ONBOARDING_VERSION = 1;

export const ProfilePatch = z
  .object({
    look: z.object({ palette: z.number().int().min(0).max(AVATAR_PALETTES - 1) }).optional(),
    onboarding_done: z.literal(ONBOARDING_VERSION).optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatch>;

export interface ProfileView {
  look: AvatarLook;
  /** Highest first-access version completed (0 = never). */
  onboarding_version: number;
}

/** Largest accepted client frame; a move is ~80 bytes, a decoration op under 1 KB. */
export const MAX_FRAME_BYTES = 4096;

const ulid = z.string().refine(isUlid, "ulid");
const commandId = z.string().min(1).max(40);
const coord = z.number().int().min(-1_000_000).max(1_000_000);

export const Direction = z.enum(["up", "down", "left", "right"]);
export type Direction = z.infer<typeof Direction>;

/**
 * `play` (default) puts the person on the map: avatar, rooms, media.
 * `observe` only watches who is where (the server sidebar): no avatar, never
 * counted as "in the space", same authentication and membership check.
 */
export const SessionMode = z.enum(["play", "observe"]);
export type SessionMode = z.infer<typeof SessionMode>;

export const HelloCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("hello"),
  id: commandId,
  d: z.object({
    session_token: z.string().min(16).max(256),
    server_id: ulid,
    resume_token: z.string().min(16).max(128).nullable().optional(),
    client: z.enum(["web", "desktop", "android"]),
    mode: SessionMode.optional(),
  }),
});

export const MoveCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("avatar.move"),
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  d: z.object({ x: coord, y: coord, dir: Direction, moving: z.boolean() }),
});

export const IdleCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("presence.idle"),
  id: commandId,
  d: z.object({ idle: z.boolean() }),
});

export const PingCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("ping"),
  id: commandId,
});

/** Ask for a fresh media token for the room we are in (LiveKit connect failed, reconnect). */
export const MediaRequestCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("media.session.request"),
  id: commandId,
});

/**
 * What my own call is doing, for the others' indicators (ADR 0008): sent when
 * it changes. LiveKit's participant list (read every 5 s) corrects it; deafen
 * exists only here (a LiveKit token of the space cannot set attributes).
 */
export const VoiceReport = z
  .object({
    connected: z.boolean(),
    mic: z.boolean(),
    deaf: z.boolean(),
    camera: z.boolean(),
    screen: z.boolean(),
  })
  .strict();
export type VoiceReport = z.infer<typeof VoiceReport>;

export const MediaStateCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("media.state.report"),
  id: commandId,
  d: VoiceReport,
});

/** A moderator (MuteMembers in the room) ends someone's screen share there. */
export const ScreenStopCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("screen.stop"),
  id: commandId,
  d: z.object({ user_id: ulid }),
});

// ---- Smart TV (ADR 0008) -------------------------------------------------------

const tvPos = z.number().min(0).max(MAX_TV_POS_S);
/** Every TV command names the room (the person must be inside it) and the rev it saw. */
const tvBase = { room_id: ulid, base_rev: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) };

/** Choose what the room's TV shows (replaces the current video: one at a time). */
export const TvLoadCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("tv.load"),
  id: commandId,
  d: z.object({ ...tvBase, app: z.literal("youtube"), ref: z.string().min(1).max(64) }).strict(),
});

/** Play from `pos_s` (where the controller's player is), pause at `pos_s`, or jump to `pos_s`. */
export const TvControlCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.enum(["tv.play", "tv.pause", "tv.seek"]),
  id: commandId,
  d: z.object({ ...tvBase, pos_s: tvPos }).strict(),
});

/** Turn the room's TV off (whoever chose the video, or ManageSpaceTvs). */
export const TvStopCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("tv.stop"),
  id: commandId,
  d: z.object(tvBase).strict(),
});

/** The video reached its end on the controller's player (status → ended). */
export const TvEndedCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("tv.ended"),
  id: commandId,
  d: z.object(tvBase).strict(),
});

/**
 * Server → people inside the room: the TV's state (null = off) and what this
 * recipient may do with it.
 */
export interface TvStateEvent {
  v: 1;
  t: "tv.state";
  d: {
    room_id: string;
    state: TvState | null;
    you: TvRights;
    /** The room's interval between videos (seconds; 0 = none). */
    cooldown_s: number;
    /** The room has a Smart TV object (otherwise there is no TV to open). */
    has_tv: boolean;
  };
}

// ---- decoration (ADR 0007) -------------------------------------------------

const zoneKey = z.string().min(1).max(64);
const instanceId = z.string().regex(ID_PATTERN);
const itemId = z.string().min(1).max(64);

export const InteractionConfigSchema = z
  .object({
    title: z.string().max(MAX_TITLE).optional(),
    url: z.string().max(MAX_URL).optional(),
    text: z.string().max(MAX_TEXT).optional(),
    target: zoneKey.optional(),
  })
  .strict();

/** An instance as the client proposes it; the server validates it against the map (placement.ts). */
export const DecorInstanceSchema = z
  .object({
    id: instanceId,
    item: itemId,
    zone: zoneKey,
    x: z.number().int().min(-1).max(10_000),
    y: z.number().int().min(-1).max(10_000),
    rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    variant: z.string().min(1).max(40).optional(),
    config: InteractionConfigSchema.optional(),
  })
  .strict();

export const DecorSettingsSchema = z
  .object({
    editors: z.enum(["admins", "roles", "everyone"]),
    roles: z.array(z.string().min(1).max(64)).max(50),
    tv_cooldown_s: z.number().int().min(0).max(MAX_TV_COOLDOWN_S).optional(),
    game: z.enum(["on", "off"]).optional(),
  })
  .strict();

export const DecorPlaceCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("decor.place"),
  id: commandId,
  d: DecorInstanceSchema,
});

/** Move, rotate, change variant or configuration: the whole instance again. */
export const DecorUpdateCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("decor.update"),
  id: commandId,
  d: DecorInstanceSchema,
});

export const DecorRemoveCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("decor.remove"),
  id: commandId,
  d: z.object({ id: instanceId }),
});

/** Floor of a zone: `<item>:<variant>`, or null to go back to the theme's default. */
export const DecorFloorCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("decor.floor"),
  id: commandId,
  d: z.object({ zone: zoneKey, floor: z.string().min(1).max(80).nullable() }),
});

export const DecorSettingsCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("decor.settings"),
  id: commandId,
  d: DecorSettingsSchema,
});

/** Use a portal: the server moves the avatar to the portal's target zone. */
export const TeleportCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("avatar.teleport"),
  id: commandId,
  d: z.object({ id: instanceId }),
});

export const ClientCommand = z.discriminatedUnion("t", [
  HelloCmd,
  MoveCmd,
  IdleCmd,
  PingCmd,
  MediaRequestCmd,
  MediaStateCmd,
  ScreenStopCmd,
  TvLoadCmd,
  TvControlCmd,
  TvStopCmd,
  TvEndedCmd,
  DecorPlaceCmd,
  DecorUpdateCmd,
  DecorRemoveCmd,
  DecorFloorCmd,
  DecorSettingsCmd,
  TeleportCmd,
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

/** LiveKit track sources a grant may publish (mirrors Stoat's Speak/Video). */
export type MediaSourceName = "microphone" | "camera" | "screen_share" | "screen_share_audio";

/** Server → client: connect to this room's media now (docs/espaco ADR 0001/0003). */
export interface MediaGrantEvent {
  v: 1;
  t: "media.grant";
  d: {
    room_id: string;
    url: string;
    /** Short-lived LiveKit token; never logged, never in a URL we build. */
    token: string;
    identity: string;
    sources: MediaSourceName[];
    can_subscribe: boolean;
    /** Unix ms when the lease lapses unless renewed by the server. */
    expires_at: number;
  };
}

/**
 * Server → client: stop media of this room now.
 * - `left`: you left the room (or its space closed);
 * - `access`: you may no longer be in it;
 * - `regrant`: a new grant for the same room follows (permissions changed);
 * - `elsewhere`: your media moved to a room in another space (another tab).
 */
export interface MediaRevokedEvent {
  v: 1;
  t: "media.revoked";
  d: { room_id: string; reason: "left" | "access" | "regrant" | "elsewhere" };
}

/**
 * Server → client: you are in the room but have no media in it; presence stays.
 * `elsewhere` means another space holds your media: `media.session.request`
 * moves it here ("Usar aqui").
 */
export interface MediaUnavailableEvent {
  v: 1;
  t: "media.unavailable";
  d: { room_id: string; reason: "livekit" | "elsewhere" };
}

/** Server → every member of the space: the decoration changed (apply the op if `rev` follows yours, else fetch). */
export interface DecorChangedEvent {
  v: 1;
  t: "decor.changed";
  d: { rev: number; op: DecorOp };
}

/** Parses a raw frame; never throws. */
export function parseCommand(raw: string): { ok: true; cmd: ClientCommand } | { ok: false; error: string } {
  if (raw.length > MAX_FRAME_BYTES) return { ok: false, error: "frame_too_large" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const res = ClientCommand.safeParse(json);
  return res.success ? { ok: true, cmd: res.data } : { ok: false, error: "invalid_message" };
}

// ---- server → client ---------------------------------------------------------

export type ErrorCode =
  | "unauthenticated"
  | "not_member"
  | "invalid_message"
  | "rate_limited"
  | "stoat_unavailable"
  | "not_allowed"
  | "decor_invalid"
  | "conflict"
  | "not_found"
  | "internal"
  /** TV: the command was based on an older state (someone else acted first). */
  | "stale_rev"
  /** TV: the room's interval between videos has not passed (`retry_after_ms`). */
  | "tv_cooldown"
  /** TV: no Smart TV object in that room, or not in that room. */
  | "no_tv"
  /** Game (ADR 0009): off on this server (operator or owner). */
  | "game_disabled"
  /** Game: the hero is still fighting (`retry_after_ms`). */
  | "game_busy"
  /** Game: the command does not apply to this hero (`reason`). */
  | "game_invalid";

export interface ErrorEvent {
  v: 1;
  t: "error";
  re?: string;
  d: { code: ErrorCode; reason?: PlacementError | string; retry_after_ms?: number };
}

/** WS close codes (§F.8). */
export const Close = {
  Unauthenticated: 4401,
  NotMember: 4403,
  Replaced: 4001,
  RateLimited: 4429,
  Protocol: 4400,
  ShuttingDown: 4503,
} as const;

/** A room as one viewer may see it: private rooms hide name and occupancy. */
export interface RoomView {
  room_id: string;
  /** null when the viewer lacks ViewChannel. */
  label: string | null;
  private: boolean;
  can_enter: boolean;
  occupants: string[] | null;
  /** Stoat voice.max_users; null when unlimited or the viewer cannot view the room. */
  capacity: number | null;
}

/** A wing's title is hidden unless the viewer can view at least one of its rooms. */
export interface WingView {
  index: number;
  title: string | null;
}

export interface AvatarView {
  user_id: string;
  name: string;
  look: AvatarLook;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  room: string | null;
  state: "online" | "idle" | "reconnecting";
  /** Idle game (docs/espaco/jogo/ot): the hero's level and whether they train at a dummy. */
  hero?: AvatarHero;
}

/** What a hero wears, as item ids of the idle game (the map draws it while they train). */
export interface AvatarGear {
  weapon?: string;
  shield?: string;
  head?: string;
  body?: string;
  legs?: string;
  feet?: string;
  ammo?: string;
}

/** The hero under an avatar; while training, also the dummy, the vocation and the gear. */
export interface AvatarHero {
  level: number;
  training: boolean;
  /** The dummy instance they train at (the map throws the attack at it). */
  at?: string;
  /** Training at both dummies (24/11/2026): the other one; the map alternates the shots. */
  also?: string;
  vocation?: number;
  gear?: AvatarGear;
}

/**
 * Presence (ADR 0008). Four different facts, never mixed:
 * - in the space (an avatar on the map: `state`);
 * - inside a room (listed under that room);
 * - in the room's call (`voice` not null; `connected` once LiveKit has them);
 * - speaking: not here — only the room's own call knows it (LiveKit, client).
 */
export interface PresenceVoice {
  connected: boolean;
  /** Microphone published and open. */
  mic: boolean;
  deaf: boolean;
  camera: boolean;
  screen: boolean;
}

export interface PresencePerson {
  user_id: string;
  name: string;
  state: "online" | "idle" | "reconnecting";
  /** null: inside the room without its call (connecting failed, paused, elsewhere). */
  voice: PresenceVoice | null;
}

export interface PresenceRoom {
  room_id: string;
  people: PresencePerson[];
  /** The room's Smart TV, when on (the map lights it up). */
  tv?: TvState["status"] | null;
}

/**
 * Server → client: who is where, as this viewer may see it (rooms without
 * ViewChannel are left out entirely). Sent whole when it changes (≤ 4 Hz).
 */
export interface PresenceEvent {
  v: 1;
  t: "space.presence";
  d: {
    rooms: PresenceRoom[];
    /** On the map, in the halls and corridors (not in any room). */
    outside: PresencePerson[];
  };
}

/** What this person may do to the decoration (server-decided, mirrored for the UI). */
export interface DecorRights {
  /** May decorate somewhere (halls or at least one room). */
  can_edit: boolean;
  /** ManageServer: the space's settings (TV interval). */
  can_manage: boolean;
  /**
   * ADR 0008, where (Stoat DecorateSpace / ConfigureSpaceObjects): the common
   * areas use the server's permissions, each room its channel's.
   */
  edit_common?: boolean;
  edit_rooms?: string[];
  configure_common?: boolean;
  configure_rooms?: string[];
}

export interface SnapshotEvent {
  v: 1;
  t: "space.snapshot";
  sv: number;
  d: {
    server_id: string;
    layout: { fingerprint: string; url: string };
    /** Current decoration revision; the state itself comes from `url` (GET, session header). */
    decor: { rev: number; url: string; settings: DecorSettings };
    you: {
      user_id: string;
      name: string;
      look: AvatarLook;
      x: number;
      y: number;
      room: string | null;
      seq: number;
      decor: DecorRights;
    };
    rooms: RoomView[];
    wings: WingView[];
    avatars: AvatarView[];
    /**
     * Refúgio (ADR 0009). `available`: the operator switched it on for this
     * server; `enabled`: this viewer may play now (owner setting, InteractSpaceObjects).
     */
    game?: { available: boolean; enabled: boolean };
  };
}

/** Compiled map on the wire: tiles as base64. */
export type CompiledMapWire = Omit<CompiledMap, "tiles"> & { tiles: string };
