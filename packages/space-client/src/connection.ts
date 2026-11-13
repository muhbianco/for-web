import { Close } from "@muchat/space-core";

export type ConnStatus =
  | "connecting"
  | "online"
  | "reconnecting"
  | "replaced" // another tab or device took over (4001)
  | "unauthenticated" // session invalid (4401)
  | "not_member" // not a member of this server (4403)
  | "closed";

export interface ConnectionOptions {
  /** Origin of the chat, e.g. https://chat.muhbianco.com.br (or the dev page origin). */
  baseUrl: string;
  sessionToken: string;
  serverId: string;
  client: "web" | "desktop" | "android";
  onEvent: (event: Record<string, unknown>) => void;
  onStatus: (status: ConnStatus) => void;
  /** Injected in tests. */
  socketFactory?: (url: string) => WebSocket;
}

const FINAL: Record<number, ConnStatus> = {
  [Close.Unauthenticated]: "unauthenticated",
  [Close.NotMember]: "not_member",
  [Close.Replaced]: "replaced",
};

/**
 * WebSocket to the space server. The session token goes in the first message,
 * never in the URL. Reconnects with backoff + jitter, except on final closes
 * (invalid session, not a member, replaced by another tab).
 */
export class SpaceConnection {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoffMs = 1_000;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private ids = 0;
  private readonly opts: ConnectionOptions;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
  }

  start() {
    this.stopped = false;
    this.open("connecting");
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000);
    this.opts.onStatus("closed");
  }

  /** Reopen after "replaced" when the person chooses "usar aqui". */
  takeOver() {
    this.stopped = false;
    this.open("connecting");
  }

  send(obj: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  nextId(): string {
    return `c${++this.ids}`;
  }

  private open(status: ConnStatus) {
    this.opts.onStatus(status);
    const url = new URL("/_muchat/space/v1/ws", this.opts.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = this.opts.socketFactory ? this.opts.socketFactory(url.toString()) : new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          v: 1,
          t: "hello",
          id: this.nextId(),
          d: { session_token: this.opts.sessionToken, server_id: this.opts.serverId, client: this.opts.client },
        }),
      );
      this.pingTimer = setInterval(() => this.send({ v: 1, t: "ping", id: this.nextId() }), 20_000);
    };
    ws.onmessage = (msg) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (event.t === "space.snapshot") {
        this.backoffMs = 1_000;
        this.opts.onStatus("online");
      }
      this.opts.onEvent(event);
    };
    ws.onclose = (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      const final = FINAL[ev.code];
      if (final) {
        this.stopped = true;
        this.opts.onStatus(final);
        return;
      }
      const delay = Math.round(this.backoffMs * (0.5 + Math.random()));
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      this.opts.onStatus("reconnecting");
      this.retryTimer = setTimeout(() => this.open("reconnecting"), delay);
    };
  }
}
