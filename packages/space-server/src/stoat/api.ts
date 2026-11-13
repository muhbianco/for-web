import type { StoatMember, StoatUser } from "./types.ts";

export type AuthResult =
  | { kind: "ok"; user: StoatUser }
  | { kind: "invalid" } // the session is not valid: close the connection
  | { kind: "unavailable" }; // Stoat did not answer: not the user's fault

export type MemberResult =
  | { kind: "ok"; member: StoatMember }
  | { kind: "not_member" }
  | { kind: "unavailable" };

export interface StoatAuth {
  me(sessionToken: string): Promise<AuthResult>;
}

export interface StoatMembers {
  member(serverId: string, userId: string): Promise<MemberResult>;
}

/**
 * REST client to delta inside stoat-net (`http://api:14702`, not through Caddy),
 * same contract as the `vip` sidecar (muchat/vip/vip.py:122-135). Every call
 * has a timeout; a timeout is "unavailable", never "invalid".
 */
export class StoatApi implements StoatAuth, StoatMembers {
  private readonly base: string;
  private readonly botToken: string;
  private readonly timeoutMs: number;

  constructor(base: string, botToken: string, timeoutMs = 5_000) {
    this.base = base.replace(/\/+$/, "");
    this.botToken = botToken;
    this.timeoutMs = timeoutMs;
  }

  async me(sessionToken: string): Promise<AuthResult> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/users/@me`, {
        headers: { "X-Session-Token": sessionToken },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { kind: "unavailable" };
    }
    if (res.status === 401 || res.status === 403) return { kind: "invalid" };
    if (!res.ok) return { kind: "unavailable" };
    const body = (await res.json().catch(() => null)) as StoatUser | null;
    if (!body || typeof body._id !== "string" || body.bot) return { kind: "invalid" };
    return { kind: "ok", user: body };
  }

  async member(serverId: string, userId: string): Promise<MemberResult> {
    let res: Response;
    try {
      res = await fetch(
        `${this.base}/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`,
        { headers: { "X-Bot-Token": this.botToken }, signal: AbortSignal.timeout(this.timeoutMs) },
      );
    } catch {
      return { kind: "unavailable" };
    }
    if (res.status === 404) return { kind: "not_member" };
    if (!res.ok) return { kind: "unavailable" };
    const body = (await res.json().catch(() => null)) as StoatMember | null;
    if (!body?._id || body._id.user !== userId) return { kind: "unavailable" };
    return { kind: "ok", member: body };
  }
}

/**
 * Member lookups with a short TTL, invalidated by bonfire member events.
 * "Not a member" is cached shorter; "unavailable" is never cached.
 */
export class MemberCache implements StoatMembers {
  private readonly src: StoatMembers;
  private readonly entries = new Map<string, { at: number; value: MemberResult }>();
  private readonly ttlMs: number;
  private readonly negativeTtlMs: number;
  private readonly now: () => number;

  constructor(src: StoatMembers, opts: { ttlMs?: number; negativeTtlMs?: number; now?: () => number } = {}) {
    this.src = src;
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.negativeTtlMs = opts.negativeTtlMs ?? 15_000;
    this.now = opts.now ?? Date.now;
  }

  async member(serverId: string, userId: string): Promise<MemberResult> {
    const key = `${serverId}:${userId}`;
    const hit = this.entries.get(key);
    if (hit) {
      const ttl = hit.value.kind === "ok" ? this.ttlMs : this.negativeTtlMs;
      if (this.now() - hit.at < ttl) return hit.value;
    }
    const value = await this.src.member(serverId, userId);
    if (value.kind !== "unavailable") this.entries.set(key, { at: this.now(), value });
    if (this.entries.size > 10_000) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return value;
  }

  invalidate(serverId: string, userId: string) {
    this.entries.delete(`${serverId}:${userId}`);
  }
}
