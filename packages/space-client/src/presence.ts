import type { PresenceEvent, PresencePerson } from "@muchat/space-core";

import { type ConnStatus, SpaceConnection } from "./connection.ts";

export type Presence = PresenceEvent["d"];

export const EMPTY_PRESENCE: Presence = { rooms: [], outside: [] };

/** People inside a room (empty when nobody, or when the viewer may not see it). */
export function peopleIn(p: Presence, roomId: string): PresencePerson[] {
  return p.rooms.find((r) => r.room_id === roomId)?.people ?? [];
}

/** Everybody on the map: halls and corridors plus every room the viewer sees. */
export function peopleInSpace(p: Presence): number {
  return p.outside.length + p.rooms.reduce((n, r) => n + r.people.length, 0);
}

/** What the space server answered to a move (`member.move`). */
export type MoveResult =
  | { ok: true }
  | { ok: false; code: string; reason?: string };

export interface PresenceLinkOptions {
  baseUrl: string;
  sessionToken: string;
  serverId: string;
  client: "web" | "desktop" | "android";
  /** Injected in tests. */
  socketFactory?: (url: string) => WebSocket;
}

/**
 * Watch-only connection to one server's space (ADR 0008): who is in each room,
 * in the call, muted, sharing — without being on the map. The server sidebar
 * holds one while it shows that server; nothing here can act in the space.
 */
export class PresenceLink {
  private readonly conn: SpaceConnection;
  private presence: Presence = EMPTY_PRESENCE;
  private status: ConnStatus = "connecting";
  private readonly listeners = new Set<
    (p: Presence, status: ConnStatus) => void
  >();

  constructor(opts: PresenceLinkOptions) {
    this.conn = new SpaceConnection({
      ...opts,
      mode: "observe",
      onStatus: (status) => {
        this.status = status;
        // Out of the space (session over, not a member): show nobody, never stale names.
        if (
          status === "unauthenticated" ||
          status === "not_member" ||
          status === "closed"
        ) {
          this.presence = EMPTY_PRESENCE;
        }
        this.emit();
      },
      onEvent: (e) => {
        // The answer to a move asked from here (the sidebar's drag).
        const re = typeof e.re === "string" ? e.re : null;
        const waiting = re ? this.pending.get(re) : undefined;
        if (re && waiting && (e.t === "member.move.ok" || e.t === "error")) {
          this.pending.delete(re);
          clearTimeout(waiting.timer);
          const d = (e.d ?? {}) as { code?: string; reason?: string };
          waiting.resolve(
            e.t === "member.move.ok"
              ? { ok: true }
              : { ok: false, code: d.code ?? "error", reason: d.reason },
          );
          return;
        }
        if (e.t !== "space.presence") return;
        this.presence = e.d as Presence;
        this.emit();
      },
    });
  }

  private readonly pending = new Map<
    string,
    { resolve: (r: MoveResult) => void; timer: ReturnType<typeof setTimeout> }
  >();

  /**
   * A moderator takes someone to a room (the sidebar's drag, 27/11/2026): the space server checks
   * MoveMembers and whether the person may be there, and their call follows. The one action a
   * watch-only connection may take. Resolves with the server's answer, or "timeout".
   */
  moveMember(
    userId: string,
    roomId: string,
    timeoutMs = 8_000,
  ): Promise<MoveResult> {
    const id = this.conn.nextId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, code: "timeout" });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.conn.send({
        v: 1,
        t: "member.move",
        id,
        d: { user_id: userId, room_id: roomId },
      });
    });
  }

  start() {
    this.conn.start();
  }

  stop() {
    this.conn.stop();
  }

  get current(): Presence {
    return this.presence;
  }

  get connection(): ConnStatus {
    return this.status;
  }

  subscribe(fn: (p: Presence, status: ConnStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.presence, this.status);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.presence, this.status);
  }
}
