/**
 * Página do laboratório da fase 3 (empacotada em www/space-lab.js por
 * lab/bundle.mjs). Uma "pessoa" por aba, sem PixiJS: o mesmo protocolo,
 * mundo, movimento e MediaLink do app, com o livekit-client no papel do Voice.
 * O harness chama window.lab.*.
 */
import { type CompiledMapWire, TILE } from "@muchat/space-core";

import { type ConnStatus, SpaceConnection } from "../../../space-client/src/connection.ts";
import { MediaLink, type MediaGrant, type VoicePort } from "../../../space-client/src/media.ts";
import { Mover } from "../../../space-client/src/mover.ts";
import { decodeMap, World } from "../../../space-client/src/world.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LK = (window as any).LivekitClient;
const BASE = location.origin;

const world = new World();
const statuses: ConnStatus[] = [];
const lkDisconnects: Array<{ at: number; reason: unknown }> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let room: any = null;
let lastGrant: MediaGrant | null = null;
let conn: SpaceConnection | null = null;
let link: MediaLink | null = null;
let token = "";
let snapshotSeen: () => void = () => undefined;

const voice: VoicePort = {
  async connect(g) {
    lastGrant = g;
    if (room) {
      const old = room;
      room = null;
      await old.disconnect(true);
    }
    const r = new LK.Room({ adaptiveStream: false, dynacast: false });
    r.on(LK.RoomEvent.Disconnected, (reason: unknown) => {
      lkDisconnects.push({ at: Date.now(), reason });
      if (room === r) link?.voiceChanged("dropped");
    });
    room = r;
    try {
      await r.connect(g.url, g.token, { autoSubscribe: true, maxRetries: 0 });
    } catch (err) {
      if (room === r) room = null;
      throw err;
    }
    if (g.sources.includes("microphone")) await r.localParticipant.setMicrophoneEnabled(true);
  },
  disconnect() {
    const r = room;
    room = null;
    void r?.disconnect(true);
  },
  // Like the app's Voice: the held call's identity in any state, liveness apart.
  identity: () => room?.localParticipant?.identity || null,
  live: () => room?.state === "connected",
  busyElsewhere: () => false,
};

async function loadMap(url: string) {
  const res = await fetch(new URL(url, BASE), { headers: { "X-Session-Token": token } });
  if (!res.ok) throw new Error(`layout ${res.status}`);
  world.setMap(decodeMap((await res.json()) as CompiledMapWire));
}

/**
 * The decoration (ADR 0007), as the app loads it: without it the predicted
 * path walks through furniture the server rightly refuses ("collision"). The
 * page predates the decoration and never loaded it (found on 16/11/2026).
 */
async function loadDecor(url: string) {
  const res = await fetch(new URL(url, BASE), { headers: { "X-Session-Token": token } });
  if (!res.ok) throw new Error(`decor ${res.status}`);
  const state = await res.json();
  world.setDecor({ ...state, furnished: state.furnished ?? [] });
}

const mover = new Mover(world, (cmd) => conn?.send(cmd as unknown as Record<string, unknown>));
setInterval(() => mover.step(66, performance.now()), 66);

world.on((e) => {
  if (e.kind === "corrected") mover.resync();
  if (e.kind === "room_changed" && e.local) link?.roomChanged(e.to);
  if (e.kind === "layout_changed") void loadMap(e.url);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** Last events (type + correction reason), for diagnosing a run. */
const trace: string[] = [];

async function onEvent(e: any) {
  const d = e.d;
  const now = performance.now();
  trace.push(e.t === "avatar.correction" ? `${e.t}:${d?.reason}@${d?.x},${d?.y}` : e.t === "error" ? `error:${d?.code}:${d?.reason ?? ""}` : String(e.t));
  if (trace.length > 80) trace.shift();
  switch (e.t) {
    case "space.snapshot":
      if (d.layout.fingerprint !== world.fingerprint) await loadMap(d.layout.url);
      world.applySnapshot(d, now);
      if (d.decor?.url) await loadDecor(d.decor.url).catch(() => undefined);
      mover.resync();
      snapshotSeen();
      return;
    case "decor.changed":
      if (!world.applyDecorOp(d.rev, d.op)) await loadDecor(world.decorUrl).catch(() => undefined);
      return;
    case "avatar.positions":
      return world.applyPositions(d, now);
    case "avatar.correction":
      return world.applyCorrection(d);
    case "space.rooms":
      return world.setRooms(d.rooms, d.wings);
    case "space.layout.changed":
      return world.layoutChanged(d.fingerprint, d.url);
    case "media.grant":
      return link?.onGrant(d);
    case "media.revoked":
      return link?.onRevoked(d);
    case "media.unavailable":
      return link?.onUnavailable(d);
    // Fase 4 (ADR 0008).
    case "space.presence":
      return world.setPresence(d);
    case "screen.stopped":
      screenStoppedBy.push(d.by);
      // As the app does: a moderator ended our screen share, stop it here too.
      return room?.localParticipant.setScreenShareEnabled(false).catch(() => undefined);
    case "error":
      errors.push({ re: e.re, ...d });
      return;
  }
}

const screenStoppedBy: string[] = [];
const errors: Array<Record<string, unknown>> = [];

async function bytesIn(kind: "audio" | "video"): Promise<number> {
  let total = 0;
  if (!room) return 0;
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      const receiver = pub.track?.receiver;
      if (!receiver) continue;
      const stats = await receiver.getStats();
      stats.forEach((s: { type: string; kind: string; bytesReceived?: number }) => {
        if (s.type === "inbound-rtp" && s.kind === kind) total += s.bytesReceived ?? 0;
      });
    }
  }
  return total;
}

function walkTile(t: { tx: number; ty: number }): boolean {
  return mover.walkTo(t.tx * TILE + TILE / 2, t.ty * TILE + TILE / 2);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).lab = {
  start(sessionToken: string, serverId: string): Promise<void> {
    token = sessionToken;
    const seen = new Promise<void>((r) => (snapshotSeen = r));
    conn = new SpaceConnection({
      baseUrl: BASE,
      sessionToken,
      serverId,
      client: "web",
      onEvent: (e) => void onEvent(e),
      onStatus: (s) => {
        if (s === "replaced" || s === "unauthenticated" || s === "not_member") link?.detach();
        statuses.push(s);
      },
    });
    link = new MediaLink({
      voice,
      request: () => conn?.send({ v: 1, t: "media.session.request", id: conn.nextId() }),
      onStatus: () => undefined,
    });
    conn.start();
    return seen;
  },
  walkIn: (roomId: string) => {
    const r = world.ix?.roomsById.get(roomId);
    return r ? walkTile(r.inside) : false;
  },
  walkOut: (roomId: string) => {
    const r = world.ix?.roomsById.get(roomId);
    return r ? walkTile(r.outside) : false;
  },
  where: () => world.me?.room ?? null,
  moving: () => mover.walkingPath,
  rooms: () => [...world.rooms.values()],
  media: () => link?.status ?? null,
  statuses: () => [...statuses],
  async lk() {
    return {
      state: room ? room.state : "none",
      identity: room?.localParticipant?.identity ?? null,
      name: room?.name ?? null,
      remote: room ? [...room.remoteParticipants.keys()].sort() : [],
      audioIn: await bytesIn("audio"),
      videoIn: await bytesIn("video"),
      disconnects: lkDisconnects.length,
    };
  },
  grant: () => lastGrant,
  async camera(on: boolean) {
    if (room) await room.localParticipant.setCameraEnabled(on);
  },
  // ---- fase 4 (ADR 0008) ----
  /** Shares (or stops) a screen through LiveKit, as the app's Voice does. */
  async screen(on: boolean) {
    if (!room) return { ok: false, message: "no room" };
    try {
      await room.localParticipant.setScreenShareEnabled(on, { audio: false });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: String((e as Error).message ?? e) };
    }
  },
  /** Our screen publication: published and not muted (a moderator mutes it). */
  screenLive() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pub = room?.localParticipant.getTrackPublication(LK.Track.Source.ScreenShare) as any;
    return Boolean(pub && pub.track && !pub.isMuted);
  },
  presence: () => world.presence,
  trace: () => [...trace],
  me: () => world.me && { x: world.me.x, y: world.me.y, room: world.me.room },
  screenStoppedBy: () => [...screenStoppedBy],
  errors: () => [...errors],
  /** A raw command (what a tampered client could send). */
  send(t: string, d: Record<string, unknown>) {
    const id = conn?.nextId() ?? "x";
    conn?.send({ v: 1, t, id, d });
    return id;
  },
  /** Raw join with any token (tampered-client tests): the app's flow is not used. */
  async rawJoin(url: string, t: string) {
    const r = new LK.Room({ adaptiveStream: false, dynacast: false });
    try {
      await r.connect(url, t, { autoSubscribe: true, maxRetries: 0 });
      const ok = { ok: true, identity: r.localParticipant.identity };
      await r.disconnect(true);
      return ok;
    } catch (e) {
      const err = e as { name?: string; reason?: unknown; status?: number; message?: string };
      return { ok: false, name: err.name, reason: err.reason, status: err.status, message: String(err.message) };
    }
  },
  retry: () => link?.retry(),
  close() {
    link?.destroy();
    conn?.stop();
  },
};
document.getElementById("log")!.textContent = "pronto";
