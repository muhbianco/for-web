/**
 * Smart TV of a room (ADR 0008). One session per room ("um por vez"): the
 * server keeps the state, every client plays the video locally and follows
 * it; nothing goes through the voice call, nothing is proxied.
 *
 * Apps: YouTube today. Another app is another `TvApp` (parse/validate here)
 * and another player in the client; the state and the sync stay the same.
 */

export type TvAppId = "youtube";

export type TvStatus = "playing" | "paused" | "ended";

/** The room's TV as the server holds it and every client follows it. */
export interface TvState {
  room_id: string;
  app: TvAppId;
  /** App reference (YouTube: the 11-character video id). */
  ref: string;
  status: TvStatus;
  /** Position in seconds at `ref_ms` (server clock). */
  pos_s: number;
  /** Server time (Unix ms) when `pos_s` was true; while playing, position = pos_s + (now − ref_ms)/1000. */
  ref_ms: number;
  /** Bumped on every change; a command based on an older rev is refused (no conflicting sessions). */
  rev: number;
  /** Who made the last change, and who chose the video. */
  by: string;
  by_name: string;
  started_by: string;
  /** When the video was chosen (server ms): the interval between videos counts from here. */
  started_ms: number;
}

/** What one viewer may do with the room's TV (server-decided, per recipient). */
export interface TvRights {
  /** Watch (InteractSpaceObjects). */
  watch: boolean;
  /** Choose, play, pause, seek (ControlSpaceTv). */
  control: boolean;
  /** Stop someone else's video, skip the interval (ManageSpaceTvs). */
  manage: boolean;
}

export interface TvApp {
  id: TvAppId;
  /** A link or id typed by a person → the app's reference, or null. */
  parse(input: string): string | null;
  /** A reference that came over the wire is well-formed. */
  valid(ref: string): boolean;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

/**
 * YouTube: `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `/v/`
 * on YouTube's own hosts, or a bare 11-character id. Only the id is kept: the
 * server never fetches any URL (no SSRF).
 */
export const youtube: TvApp = {
  id: "youtube",
  parse(input: string): string | null {
    const raw = input.trim();
    if (YT_ID.test(raw)) return raw;
    let url: URL;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (!YT_HOSTS.has(host)) return null;
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
    else if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = m?.[1] ?? null;
    }
    return id && YT_ID.test(id) ? id : null;
  },
  valid(ref: string): boolean {
    return YT_ID.test(ref);
  },
};

export const TV_APPS: Record<TvAppId, TvApp> = { youtube };

/** Longest position the server accepts (a 24-hour live stream). */
export const MAX_TV_POS_S = 86_400;

/** Where the video should be now (seconds), from the state and the server's clock. */
export function expectedPosition(state: Pick<TvState, "status" | "pos_s" | "ref_ms">, serverNowMs: number): number {
  if (state.status !== "playing") return state.pos_s;
  return Math.max(0, state.pos_s + (serverNowMs - state.ref_ms) / 1000);
}

/** Drift above this (seconds) is corrected with a seek; below it, left alone. */
export const TV_DRIFT_SEEK_S = 0.75;
/** Two corrections are at least this far apart (a seek takes a moment to settle). */
export const TV_MIN_SEEK_GAP_MS = 3_000;

/**
 * Decides whether a client should seek, from its player position and the
 * expected one. The caller checks once per second; a correction needs the
 * drift seen twice in a row (one stalled frame never causes a jump) and is
 * rate-limited.
 */
export class DriftGuard {
  private strikes = 0;
  private lastSeekMs = Number.NEGATIVE_INFINITY;

  /** Returns the position to seek to, or null. */
  check(playerPos: number, expected: number, nowMs: number): number | null {
    if (Math.abs(playerPos - expected) <= TV_DRIFT_SEEK_S) {
      this.strikes = 0;
      return null;
    }
    this.strikes++;
    if (this.strikes < 2 || nowMs - this.lastSeekMs < TV_MIN_SEEK_GAP_MS) return null;
    this.strikes = 0;
    this.lastSeekMs = nowMs;
    return expected;
  }

  /** A new state arrived (play, pause, seek): start over. */
  reset() {
    this.strikes = 0;
    this.lastSeekMs = Number.NEGATIVE_INFINITY;
  }
}

/**
 * Offset between this client's clock and the server's, NTP style: each
 * ping/pong gives `server_ms` and the round trip; the sample with the
 * smallest round trip among the last 8 wins (least queueing).
 */
export class ClockOffset {
  private samples: Array<{ rtt: number; offset: number }> = [];

  /** `sentMs`/`receivedMs` on the local clock; `serverMs` from the pong. */
  add(sentMs: number, receivedMs: number, serverMs: number) {
    const rtt = receivedMs - sentMs;
    if (!(rtt >= 0) || rtt > 10_000) return;
    // The server read its clock about half way through the round trip.
    const offset = serverMs - (sentMs + rtt / 2);
    this.samples.push({ rtt, offset });
    if (this.samples.length > 8) this.samples.shift();
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }

  /** server time ≈ local time + offset. */
  get offsetMs(): number {
    let best = this.samples[0];
    for (const s of this.samples) if (best === undefined || s.rtt < best.rtt) best = s;
    return best?.offset ?? 0;
  }

  get bestRttMs(): number | null {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rtt)) : null;
  }

  serverNow(localNowMs: number): number {
    return localNowMs + this.offsetMs;
  }
}
