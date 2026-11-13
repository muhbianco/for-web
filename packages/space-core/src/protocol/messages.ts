import { z } from "zod";

import { isUlid } from "../media/naming.ts";
import type { CompiledMap } from "../map/types.ts";

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

/** Largest accepted client frame; a move is ~80 bytes. */
export const MAX_FRAME_BYTES = 4096;

const ulid = z.string().refine(isUlid, "ulid");
const commandId = z.string().min(1).max(40);
const coord = z.number().int().min(-1_000_000).max(1_000_000);

export const Direction = z.enum(["up", "down", "left", "right"]);
export type Direction = z.infer<typeof Direction>;

export const HelloCmd = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal("hello"),
  id: commandId,
  d: z.object({
    session_token: z.string().min(16).max(256),
    server_id: ulid,
    resume_token: z.string().min(16).max(128).nullable().optional(),
    client: z.enum(["web", "desktop", "android"]),
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

export const ClientCommand = z.discriminatedUnion("t", [HelloCmd, MoveCmd, IdleCmd, PingCmd, MediaRequestCmd]);
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
  | "internal";

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
}

export interface SnapshotEvent {
  v: 1;
  t: "space.snapshot";
  sv: number;
  d: {
    server_id: string;
    layout: { fingerprint: string; url: string };
    you: { user_id: string; name: string; look: AvatarLook; x: number; y: number; room: string | null; seq: number };
    rooms: RoomView[];
    wings: WingView[];
    avatars: AvatarView[];
  };
}

/** Compiled map on the wire: tiles as base64. */
export type CompiledMapWire = Omit<CompiledMap, "tiles"> & { tiles: string };
