import WebSocket from "ws";

import type { StoatCache } from "./cache.ts";

export interface BonfireLog {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
}

/**
 * The space bot on Stoat's events websocket (bonfire), like the invite-bot
 * (muchat/invite-bot/stoat_client.py): token in the query (internal network
 * only, never logged), Ping every 30 s, reconnect with backoff and jitter.
 * Every event goes to the cache; a fresh Ready rebuilds it after a reconnect.
 */
export class BonfireClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoffMs = 1_000;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  connected = false;

  private readonly url: string;
  private readonly token: string;
  private readonly cache: StoatCache;
  private readonly log: BonfireLog;

  constructor(url: string, token: string, cache: StoatCache, log: BonfireLog) {
    this.url = url;
    this.token = token;
    this.cache = cache;
    this.log = log;
  }

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close(1000);
  }

  private open() {
    const u = new URL(this.url);
    u.searchParams.set("version", "1");
    u.searchParams.set("format", "json");
    u.searchParams.set("token", this.token);
    const ws = new WebSocket(u, { handshakeTimeout: 10_000, maxPayload: 64 * 1024 * 1024 });
    this.ws = ws;
    ws.on("open", () => {
      this.connected = true;
      this.backoffMs = 1_000;
      this.log.info("bonfire connected");
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Ping", data: 0 }));
      }, 30_000);
      this.heartbeat.unref?.();
    });
    ws.on("message", (raw) => {
      let event: unknown;
      try {
        event = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        this.cache.apply(event);
      } catch (err) {
        this.log.warn("bonfire event failed", { err: String(err) });
      }
    });
    const down = (why: string) => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      if (this.stopped) return;
      const delay = Math.round(this.backoffMs * (0.5 + Math.random()));
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      this.log.warn("bonfire down, reconnecting", { why, delay_ms: delay });
      this.reconnectTimer = setTimeout(() => this.open(), delay);
      this.reconnectTimer.unref?.();
    };
    ws.on("close", (code) => down(`close ${code}`));
    ws.on("error", (err) => {
      down(`error ${err.name}`);
      ws.terminate();
    });
  }
}
