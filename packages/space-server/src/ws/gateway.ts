import { randomUUID } from "node:crypto";
import http from "node:http";

import { Close, defaultPalette, MAX_FRAME_BYTES, parseCommand, ProfilePatch, TICK_HZ } from "@muchat/space-core";
import { type WebSocket, WebSocketServer } from "ws";

import type { Log } from "../log.ts";
import type { StoatAuth, StoatMembers } from "../stoat/api.ts";
import type { StoatCache } from "../stoat/cache.ts";
import type { StoatUser } from "../stoat/types.ts";
import type { ProfileStore } from "../space/profiles.ts";
import type { SessionPort, SpaceRuntime, Viewer } from "../space/runtime.ts";
import { TokenBucket } from "./ratelimit.ts";

const HELLO_TIMEOUT_MS = 5_000;
const REVALIDATE_MS = 5 * 60_000;
/** Without a successful revalidation for this long, the session ends. */
const REVALIDATE_GRACE_MS = 15 * 60_000;
const MAX_BUFFERED_BYTES = 1 << 20;

export interface RuntimeRegistry {
  /** Runtime of a Stoat server the bot knows, initialised; null when unknown. */
  get(serverId: string): Promise<SpaceRuntime | null>;
  all(): Iterable<SpaceRuntime>;
  /** Servers where the space is on (for the client's sidebar entry). */
  enabledServers(): string[];
}

export interface GatewayDeps {
  auth: StoatAuth;
  members: StoatMembers;
  cache: StoatCache;
  runtimes: RuntimeRegistry;
  profiles: ProfileStore;
  /** Browser origins allowed to open the socket (empty Origin is allowed: not a browser). */
  allowedOrigins: string[];
  log: Log;
  /** Readiness extras (bonfire up, store reachable). */
  ready?: () => Record<string, boolean>;
  /** Messages per second and burst per connection (default 20/40). */
  rateLimit?: { rate: number; burst: number };
}

class Session implements SessionPort {
  readonly id = randomUUID();
  viewer!: Viewer;
  runtime: SpaceRuntime | null = null;
  token = "";
  lastAuthOk = Date.now();
  /** Close code we sent, if we closed it. */
  closedWith: number | null = null;
  private sv = 0;
  readonly bucket: TokenBucket;
  readonly ws: WebSocket;

  constructor(ws: WebSocket, rate?: { rate: number; burst: number }) {
    this.ws = ws;
    this.bucket = new TokenBucket(rate?.rate, rate?.burst);
  }

  send(event: Record<string, unknown>): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      // A client that cannot keep up is dropped instead of growing our memory.
      this.ws.close(1013, "slow consumer");
      return;
    }
    this.ws.send(JSON.stringify({ ...event, sv: ++this.sv }));
  }

  close(code: number, reason: string): void {
    this.closedWith ??= code;
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) this.ws.close(code, reason);
  }
}

/**
 * HTTP + WebSocket front of the space server (`/_muchat/space` in Caddy, which
 * strips the prefix). Authentication is the first message (`hello` with the
 * Stoat session token), never the URL.
 */
export class Gateway {
  readonly server: http.Server;
  private readonly wss: WebSocketServer;
  private readonly deps: GatewayDeps;
  private readonly sessions = new Set<Session>();
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private revalidateTimer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: GatewayDeps) {
    this.deps = deps;
    this.server = http.createServer((req, res) => void this.http(req, res));
    this.server.headersTimeout = 10_000;
    this.server.requestTimeout = 15_000;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
    this.server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://space");
      if (url.pathname !== "/v1/ws") {
        socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        return;
      }
      const origin = req.headers.origin;
      if (origin && !this.deps.allowedOrigins.includes(origin)) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.connection(ws));
    });
  }

  listen(port: number, host = "0.0.0.0"): Promise<void> {
    this.tickTimer = setInterval(() => {
      for (const rt of this.deps.runtimes.all()) rt.tick();
    }, 1000 / TICK_HZ);
    this.revalidateTimer = setInterval(() => void this.revalidate(), REVALIDATE_MS);
    this.revalidateTimer.unref?.();
    return new Promise((resolve) => this.server.listen(port, host, resolve));
  }

  get address(): { port: number } {
    const a = this.server.address();
    return { port: typeof a === "object" && a ? a.port : 0 };
  }

  async close(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
    for (const s of this.sessions) s.close(Close.ShuttingDown, "shutting down");
    this.wss.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private connection(ws: WebSocket) {
    const s = new Session(ws, this.deps.rateLimit);
    this.sessions.add(s);
    const helloTimer = setTimeout(() => s.close(Close.Protocol, "hello expected"), HELLO_TIMEOUT_MS);
    let busy = false;
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return s.close(Close.Protocol, "text frames only");
      const verdict = s.bucket.take();
      if (verdict === "abuse") return s.close(Close.RateLimited, "rate limited");
      if (verdict === "drop") return s.send({ v: 1, t: "error", d: { code: "rate_limited" } });
      const parsed = parseCommand(String(raw));
      if (!parsed.ok) {
        if (!s.runtime) return s.close(Close.Protocol, parsed.error);
        return s.send({ v: 1, t: "error", d: { code: "invalid_message" } });
      }
      const cmd = parsed.cmd;
      if (!s.runtime) {
        if (cmd.t !== "hello" || busy) return s.close(Close.Protocol, "hello expected");
        busy = true;
        void this.hello(s, cmd.id, cmd.d.session_token, cmd.d.server_id).finally(() => {
          busy = false;
          clearTimeout(helloTimer);
        });
        return;
      }
      switch (cmd.t) {
        case "hello":
          return s.send({ v: 1, t: "error", re: cmd.id, d: { code: "invalid_message" } });
        case "avatar.move":
          return s.runtime.move(s, { seq: cmd.seq, ...cmd.d });
        case "presence.idle":
          return s.runtime.setIdle(s, cmd.d.idle);
        case "ping":
          return s.send({ v: 1, t: "pong", re: cmd.id, d: {} });
        case "media.session.request":
          if (!s.runtime.requestMedia(s)) s.send({ v: 1, t: "error", re: cmd.id, d: { code: "rate_limited" } });
          return;
        case "decor.place":
          return s.runtime.decorCommand(s, cmd.id, { kind: "place", item: cmd.d });
        case "decor.update":
          return s.runtime.decorCommand(s, cmd.id, { kind: "update", item: cmd.d });
        case "decor.remove":
          return s.runtime.decorCommand(s, cmd.id, { kind: "remove", id: cmd.d.id });
        case "decor.floor":
          return s.runtime.decorCommand(s, cmd.id, { kind: "floor", zone: cmd.d.zone, floor: cmd.d.floor });
        case "decor.settings":
          return s.runtime.decorCommand(s, cmd.id, { kind: "settings", settings: cmd.d });
        case "avatar.teleport":
          return s.runtime.teleport(s, cmd.id, cmd.d.id);
      }
    });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      this.sessions.delete(s);
      if (!s.runtime) return;
      // Session ended or membership gone: no reconnect grace, media ends now.
      if (s.closedWith === Close.Unauthenticated || s.closedWith === Close.NotMember) {
        if (s.runtime.sessionOf(s.viewer.user._id) === s) s.runtime.evict(s.viewer.user._id);
        return;
      }
      s.runtime.leave(s);
    });
    ws.on("error", () => ws.terminate());
  }

  private async hello(s: Session, id: string, token: string, serverId: string) {
    const auth = await this.deps.auth.me(token);
    if (auth.kind === "invalid") return s.close(Close.Unauthenticated, "invalid session");
    if (auth.kind === "unavailable") return s.close(Close.ShuttingDown, "stoat unavailable");
    const member = await this.memberOrNull(serverId, auth.user);
    if (member === "unavailable") return s.close(Close.ShuttingDown, "stoat unavailable");
    if (!member) return s.close(Close.NotMember, "not a member");
    const runtime = await this.deps.runtimes.get(serverId).catch((err) => {
      this.deps.log.error("runtime init failed", { server: serverId, err: String(err) });
      return null;
    });
    if (!runtime) return s.close(Close.NotMember, "unknown server");
    if (s.ws.readyState !== s.ws.OPEN) return; // left while we were checking
    // One session per person per space: the newest wins.
    const old = runtime.sessionOf(auth.user._id);
    if (old && old !== s) old.close(Close.Replaced, "opened elsewhere");
    s.viewer = { user: auth.user, member };
    s.token = token;
    s.lastAuthOk = Date.now();
    s.runtime = runtime;
    // A profile store hiccup must not keep anyone out: default look then.
    // In parallel: after a restart, a surviving media lease puts the person
    // back in their room (prepareJoin bounds its own wait).
    const [profile] = await Promise.all([
      Promise.race([
        this.deps.profiles.get(auth.user._id),
        new Promise<null>((r) => setTimeout(() => r(null), 1_500)),
      ]).catch(() => null),
      runtime.prepareJoin(s.viewer).catch((err) => {
        this.deps.log.warn("media recovery skipped", { server: serverId, user: auth.user._id, err: String(err) });
      }),
    ]);
    if (s.ws.readyState !== s.ws.OPEN) return;
    s.send({ v: 1, t: "hello.ok", re: id, d: { user_id: auth.user._id, protocol: 1 } });
    runtime.join(s, profile?.look ?? { palette: defaultPalette(auth.user._id) });
    this.deps.log.info("space join", { server: serverId, user: auth.user._id, session: s.id });
  }

  /** Owners and privileged users are members by definition. */
  private async memberOrNull(serverId: string, user: StoatUser) {
    const res = await this.deps.members.member(serverId, user._id);
    if (res.kind === "ok") return res.member;
    if (res.kind === "unavailable") return "unavailable" as const;
    const server = this.deps.cache.servers.get(serverId);
    if (server && (server.owner === user._id || user.privileged)) {
      return { _id: { server: serverId, user: user._id }, roles: [] };
    }
    return null;
  }

  private async revalidate() {
    const now = Date.now();
    for (const s of this.sessions) {
      if (!s.runtime) continue;
      const res = await this.deps.auth.me(s.token);
      if (res.kind === "ok") s.lastAuthOk = now;
      else if (res.kind === "invalid") s.close(Close.Unauthenticated, "session ended");
      else if (now - s.lastAuthOk > REVALIDATE_GRACE_MS) s.close(Close.ShuttingDown, "cannot revalidate");
    }
  }

  private async http(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://space");
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && url.pathname === "/health/live") return json(200, { ok: true });
      if (req.method === "GET" && url.pathname === "/health/ready") {
        const extra = this.deps.ready?.() ?? {};
        const ok = this.deps.cache.ready && Object.values(extra).every(Boolean);
        return json(ok ? 200 : 503, { ok, stoat_cache: this.deps.cache.ready, ...extra });
      }
      // Everything below needs a Stoat session.
      const token = req.headers["x-session-token"];
      if (typeof token !== "string" || token.length < 16 || token.length > 256) return json(401, { error: "unauthenticated" });
      const auth = await this.deps.auth.me(token);
      if (auth.kind === "invalid") return json(401, { error: "unauthenticated" });
      if (auth.kind === "unavailable") return json(503, { error: "stoat_unavailable" });
      const user = auth.user;

      if (url.pathname === "/v1/config" && req.method === "GET") {
        return json(200, { protocol: 1, servers: this.deps.runtimes.enabledServers() });
      }
      if (url.pathname === "/v1/me/profile") {
        if (req.method === "GET") return json(200, await this.deps.profiles.get(user._id));
        if (req.method === "PUT") {
          const raw = await readBody(req, 2_048);
          if (raw === null) return json(413, { error: "too_large" }, { connection: "close" });
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            return json(400, { error: "invalid_json" });
          }
          const patch = ProfilePatch.safeParse(body);
          if (!patch.success) return json(400, { error: "invalid_message" });
          const profile = await this.deps.profiles.patch(user._id, patch.data);
          if (patch.data.look) for (const rt of this.deps.runtimes.all()) rt.updateLook(user._id, profile.look);
          return json(200, profile);
        }
        return json(405, { error: "method" });
      }
      const m = /^\/v1\/spaces\/([0-9A-HJKMNP-TV-Z]{26})\/(layout\/([0-9a-f]{8})|decor)$/.exec(url.pathname);
      if (!m || req.method !== "GET") return json(404, { error: "not_found" });
      const [, serverId, what, fingerprint] = m as unknown as [string, string, string, string | undefined];
      const member = await this.memberOrNull(serverId, user);
      if (member === "unavailable") return json(503, { error: "stoat_unavailable" });
      if (!member) return json(403, { error: "not_member" });
      const runtime = await this.deps.runtimes.get(serverId).catch(() => null);
      if (!runtime) return json(404, { error: "not_found" });
      if (what === "decor") {
        // Every member sees the same decoration; it changes, so no caching.
        return json(200, runtime.decorWire);
      }
      if (runtime.layoutFingerprint !== fingerprint) return json(404, { error: "stale_layout" });
      // Same geometry for every member; the wire map carries no room or wing
      // names (runtime.ts): those come per viewer in the snapshot.
      return json(200, runtime.layoutWire, { "cache-control": "private, max-age=31536000, immutable" });
    } catch (err) {
      this.deps.log.error("http handler failed", { path: url.pathname, err: String(err) });
      if (!res.headersSent) json(500, { error: "internal" });
    }
  }
}

/** Reads a request body up to `limit` bytes; null when larger. */
function readBody(req: http.IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        // Answer 413 right away; the rest is discarded and the response closes the connection.
        if (!tooLarge) resolve(null);
        tooLarge = true;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}
