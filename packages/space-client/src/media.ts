import type { MediaGrantEvent, MediaRevokedEvent, MediaUnavailableEvent } from "@muchat/space-core";

/**
 * What the person sees about the room's audio. The server decides who may
 * hear what (ADR 0001/0003); this only follows its events and the app's voice.
 */
export type MediaStatus =
  | { kind: "idle" } // not in a room
  | { kind: "connecting"; roomId: string }
  | { kind: "connected"; roomId: string }
  /** Could not connect; retrying by itself a few times, then "Tentar de novo". */
  | { kind: "unavailable"; roomId: string; retrying: boolean }
  /** Another tab or space holds this person's audio: "Usar aqui". */
  | { kind: "elsewhere"; roomId: string }
  /** The app's voice left this room (hung up, another call): "Voltar ao áudio". */
  | { kind: "paused"; roomId: string };

export type MediaGrant = MediaGrantEvent["d"];

/** The app's single voice connection (Voice in the Muchat client). */
export interface VoicePort {
  /** Connects to the room with this grant; resolves once connected, rejects on failure. */
  connect(grant: MediaGrant): Promise<void>;
  /** Leaves the current call. Only called while the call is this space's. */
  disconnect(): void;
  /** LiveKit identity of the call the app is in now, or null. */
  identity(): string | null;
  /** True when the app is in a call of another channel (a DM, a group, another room). */
  busyElsewhere(roomId: string): boolean;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface MediaLinkOptions {
  voice: VoicePort;
  /** Sends `media.session.request` (the server allows one per 3 s). */
  request: () => void;
  onStatus: (s: MediaStatus) => void;
  /** Automatic retries after a failed connect, then manual. */
  retryDelaysMs?: number[];
  /** A LiveKit drop is often the server removing us: wait for its event first. */
  dropGraceMs?: number;
  timers?: Timers;
}

/**
 * Keeps the app's voice in line with the space server's media events:
 * - `media.grant` → connect (unless already in that very admission);
 * - `media.revoked` → leave the call, if it is ours;
 * - a failed connect or a dropped call → ask for a fresh token, with backoff.
 *
 * It never takes the app's voice away from another call by itself: only an
 * entry (walking into the room) or a button press does that.
 */
export class MediaLink {
  status: MediaStatus = { kind: "idle" };
  private readonly o: Required<Omit<MediaLinkOptions, "timers">> & { timers: Timers };
  /** The grant we are (or should be) connected with. */
  private active: { roomId: string; identity: string } | null = null;
  private connectSeq = 0;
  private attempt = 0;
  private retryTimer: unknown = null;
  private dropTimer: unknown = null;
  /** The person walked in or pressed a button: a grant may replace another call. */
  private intent = false;
  private destroyed = false;

  constructor(opts: MediaLinkOptions) {
    this.o = {
      retryDelaysMs: [3_000, 6_000, 12_000],
      dropGraceMs: 1_500,
      timers: realTimers,
      ...opts,
    };
  }

  private set(s: MediaStatus) {
    this.status = s;
    this.o.onStatus(s);
  }

  private clearTimers() {
    if (this.retryTimer !== null) this.o.timers.clear(this.retryTimer);
    if (this.dropTimer !== null) this.o.timers.clear(this.dropTimer);
    this.retryTimer = this.dropTimer = null;
  }

  private ours(): boolean {
    return this.active !== null && this.o.voice.identity() === this.active.identity;
  }

  /** The avatar's room changed (from the world). Entering is consent to switch calls. */
  roomChanged(to: string | null) {
    if (to) this.intent = true;
  }

  onGrant(d: MediaGrant) {
    if (this.destroyed) return;
    this.clearTimers();
    const intent = this.intent;
    this.intent = false;
    this.active = { roomId: d.room_id, identity: d.identity };
    if (this.o.voice.identity() === d.identity) {
      // Same admission still connected (our socket came back, a fresh token): nothing to do.
      this.attempt = 0;
      return this.set({ kind: "connected", roomId: d.room_id });
    }
    if (!intent && this.o.voice.busyElsewhere(d.room_id)) {
      return this.set({ kind: "paused", roomId: d.room_id });
    }
    this.set({ kind: "connecting", roomId: d.room_id });
    const seq = ++this.connectSeq;
    this.o.voice.connect(d).then(
      () => {
        if (seq !== this.connectSeq || this.destroyed) return;
        this.attempt = 0;
        this.set({ kind: "connected", roomId: d.room_id });
      },
      () => {
        if (seq !== this.connectSeq || this.destroyed) return;
        // Someone started another call meanwhile: theirs wins, ours waits.
        if (this.o.voice.busyElsewhere(d.room_id)) return this.set({ kind: "paused", roomId: d.room_id });
        this.failed(d.room_id);
      },
    );
  }

  onRevoked(d: MediaRevokedEvent["d"]) {
    if (this.destroyed) return;
    const mine = this.active?.roomId === d.room_id;
    if (mine) {
      this.clearTimers();
      this.connectSeq++;
      const ours = this.ours() || this.status.kind === "connecting";
      // Forget first: the voice's own events during disconnect must not look like a drop.
      this.active = null;
      if (ours) this.o.voice.disconnect();
    }
    switch (d.reason) {
      case "regrant":
        return this.set({ kind: "connecting", roomId: d.room_id });
      case "elsewhere":
        return this.set({ kind: "elsewhere", roomId: d.room_id });
      default:
        // "left" / "access": over for this room (a stale event for another room changes nothing).
        if (mine || ("roomId" in this.status && this.status.roomId === d.room_id)) {
          this.attempt = 0;
          this.set({ kind: "idle" });
        }
    }
  }

  onUnavailable(d: MediaUnavailableEvent["d"]) {
    if (this.destroyed) return;
    this.clearTimers();
    if (d.reason === "elsewhere") {
      this.connectSeq++;
      this.active = null;
      return this.set({ kind: "elsewhere", roomId: d.room_id });
    }
    this.failed(d.room_id);
  }

  /**
   * The app's voice changed while we hold a call: `dropped` = LiveKit lost
   * the connection; `gone` = the app left this call (hang up, another call).
   */
  voiceChanged(change: "dropped" | "gone") {
    if (this.destroyed || !this.active || this.status.kind !== "connected") return;
    const roomId = this.active.roomId;
    if (change === "gone") {
      this.clearTimers();
      this.connectSeq++;
      return this.set({ kind: "paused", roomId });
    }
    if (this.dropTimer !== null) return;
    this.dropTimer = this.o.timers.set(() => {
      this.dropTimer = null;
      if (this.active?.roomId === roomId && this.status.kind === "connected") this.failed(roomId);
    }, this.o.dropGraceMs);
  }

  /** "Tentar de novo", "Usar aqui", "Voltar ao áudio". */
  retry() {
    if (this.destroyed) return;
    this.clearTimers();
    this.attempt = 0;
    this.intent = true;
    this.o.request();
  }

  private failed(roomId: string) {
    const delay = this.o.retryDelaysMs[this.attempt];
    this.set({ kind: "unavailable", roomId, retrying: delay !== undefined });
    if (delay === undefined) return;
    this.attempt++;
    this.retryTimer = this.o.timers.set(() => {
      this.retryTimer = null;
      this.o.request();
    }, delay);
  }

  /** The space closes: leave its call, never anyone else's. */
  destroy() {
    if (this.destroyed) return;
    this.clearTimers();
    this.connectSeq++;
    const ours = this.ours() || this.status.kind === "connecting";
    this.active = null;
    this.destroyed = true;
    if (ours) this.o.voice.disconnect();
  }
}
