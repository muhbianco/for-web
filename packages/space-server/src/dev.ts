/**
 * Local development server: the real Gateway/Registry/Runtime with a fake
 * Stoat (fixture server, tokens "dev-<name>-session-token") and two NPCs
 * walking between rooms. Never talks to production.
 *
 *   node packages/space-server/src/dev.ts   → http://127.0.0.1:8095
 *   pnpm --filter @muchat/space-client dev  → http://localhost:5180/?as=ana
 */
import { findPath, MAX_SPEED, MOVE_SEND_HZ, Perm, TILE, tileCenter, indexMap } from "@muchat/space-core";

import { jsonLog } from "./log.ts";
import { MediaController } from "./media/controller.ts";
import { FakeLeases, FakeLiveKit, FakeMinter } from "./media/fakes.ts";
import { MediaHub } from "./space/roomMedia.ts";
import { Registry } from "./space/registry.ts";
import type { SessionPort, SpaceRuntime } from "./space/runtime.ts";
import { MemoryProfileStore } from "./space/profiles.ts";
import { MemoryAssignmentStore } from "./space/store.ts";
import type { AuthResult, MemberResult } from "./stoat/api.ts";
import { StoatCache } from "./stoat/cache.ts";
import type { StoatMember, StoatTextChannel, StoatUser } from "./stoat/types.ts";
import { Gateway } from "./ws/gateway.ts";

export const DEV_SERVER_ID = "01JDEV0SRV0000000000000000";
const n = (b: bigint) => Number(b);
const DEFAULT = Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Video | Perm.Listen;

const ids = (i: number) => `01JDEVCH${String(i).padStart(18, "0")}`;
const vc = (i: number, name: string, max: number, extra: Partial<StoatTextChannel> = {}): StoatTextChannel => ({
  channel_type: "TextChannel",
  _id: ids(i),
  server: DEV_SERVER_ID,
  name,
  voice: { max_users: max },
  ...extra,
});

const channels: StoatTextChannel[] = [
  vc(1, "Bate-papo", 10),
  vc(2, "Café", 4),
  vc(3, "Duo", 2),
  vc(4, "Squad", 8),
  vc(5, "Torneio", 25),
  vc(6, "Sala da diretoria", 6, {
    default_permissions: { a: 0, d: n(Perm.ViewChannel | Perm.Connect) },
    role_permissions: { DIR: { a: n(Perm.ViewChannel | Perm.Connect), d: 0 } },
  }),
  { channel_type: "TextChannel", _id: ids(7), server: DEV_SERVER_ID, name: "geral" },
];

const people: Record<string, { user: StoatUser; roles: string[] }> = {
  ana: { user: { _id: "01JDEVANA00000000000000000", username: "ana", display_name: "Ana" }, roles: [] },
  bia: { user: { _id: "01JDEVB1A00000000000000000", username: "bia", display_name: "Bia" }, roles: ["DIR"] },
  caio: { user: { _id: "01JDEVCA10000000000000000Z", username: "caio", display_name: "Caio" }, roles: [] },
};
const npcs: Record<string, { user: StoatUser; roles: string[] }> = {
  npc1: { user: { _id: "01JDEVNPC1000000000000000A", username: "davi", display_name: "Davi" }, roles: [] },
  npc2: { user: { _id: "01JDEVNPC2000000000000000B", username: "eva", display_name: "Eva" }, roles: ["DIR"] },
};
const everyone = { ...people, ...npcs };

const cache = new StoatCache();
cache.apply({
  type: "Ready",
  servers: [
    {
      _id: DEV_SERVER_ID,
      owner: "01JDEV0WNER000000000000000",
      name: "Muchat (dev)",
      channels: channels.map((c) => c._id),
      categories: [
        { id: "CATJOGOS", title: "Jogos", channels: [ids(3), ids(4), ids(5)] },
        { id: "CATDIR", title: "Diretoria", channels: [ids(6)] },
      ],
      default_permissions: n(DEFAULT),
      roles: { DIR: { name: "Diretoria", rank: 1, permissions: { a: 0, d: 0 } } },
    },
  ],
  channels,
});

const member = (userId: string, roles: string[]): StoatMember => ({ _id: { server: DEV_SERVER_ID, user: userId }, roles });
const auth = {
  async me(token: string): Promise<AuthResult> {
    const m = /^dev-([a-z0-9]+)-session-token$/.exec(token);
    const p = m ? everyone[m[1]!] : undefined;
    return p ? { kind: "ok", user: p.user } : { kind: "invalid" };
  },
};
const members = {
  async member(_s: string, userId: string): Promise<MemberResult> {
    const p = Object.values(everyone).find((x) => x.user._id === userId);
    return p ? { kind: "ok", member: member(userId, p.roles) } : { kind: "not_member" };
  },
};

// Room media with an in-memory LiveKit and lease store: grants, revocations
// and epochs are the real ones; the tokens are fake (`token-for-<identity>`).
const devLk = new FakeLiveKit();
const devMedia = new MediaController({ lk: devLk, leases: new FakeLeases(), minter: new FakeMinter(), publicUrl: "wss://dev.invalid/livekit" });
const hub = new MediaHub({ media: devMedia, log: jsonLog });
const registry = new Registry({ cache, store: new MemoryAssignmentStore(), members, log: jsonLog, media: { hub, lk: devLk } });
const gateway = new Gateway({
  auth,
  members,
  cache,
  runtimes: registry,
  profiles: new MemoryProfileStore(),
  allowedOrigins: ["http://localhost:5180", "http://127.0.0.1:5180"],
  log: jsonLog,
});

/** An in-process walker that uses the same move path as a real client. */
async function npc(rt: SpaceRuntime, key: keyof typeof npcs, seed: number) {
  const p = npcs[key]!;
  let pos = { x: 0, y: 0 };
  let seq = 0;
  const session: SessionPort = {
    viewer: { user: p.user, member: member(p.user._id, p.roles) },
    send(e) {
      const d = e.d as Record<string, number> | undefined;
      if (e.t === "space.snapshot") {
        const you = (e.d as { you: { x: number; y: number; seq: number } }).you;
        pos = { x: you.x, y: you.y };
        seq = you.seq;
      } else if (e.t === "avatar.correction" && d) {
        pos = { x: d.x!, y: d.y! };
      }
    },
    close() {},
  };
  rt.join(session);
  let r = seed;
  const rand = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
  const step = (MAX_SPEED * 0.8) / MOVE_SEND_HZ;
  for (;;) {
    const ix = indexMap(rt.map);
    const targets = rt.map.rooms.filter((room) => rt.canEnter(session.viewer, room.roomId));
    const goal = rand() < 0.3 ? rt.map.spawns[Math.floor(rand() * rt.map.spawns.length)]! : targets[Math.floor(rand() * targets.length)]?.inside;
    const path = goal ? findPath(ix, { tx: Math.floor(pos.x / TILE), ty: Math.floor(pos.y / TILE) }, goal, (id) => rt.canEnter(session.viewer, id)) : null;
    for (const tile of path?.slice(1) ?? []) {
      const g = tileCenter(tile);
      while (Math.hypot(g.x - pos.x, g.y - pos.y) > 0.5) {
        const d = Math.hypot(g.x - pos.x, g.y - pos.y);
        const k = Math.min(1, step / d);
        const next = { x: Math.round(pos.x + (g.x - pos.x) * k), y: Math.round(pos.y + (g.y - pos.y) * k) };
        const dir = Math.abs(g.x - pos.x) > Math.abs(g.y - pos.y) ? (g.x > pos.x ? "right" : "left") : g.y > pos.y ? "down" : "up";
        pos = next;
        rt.move(session, { seq: ++seq, x: pos.x, y: pos.y, dir, moving: true });
        await new Promise((res) => setTimeout(res, 1000 / MOVE_SEND_HZ));
      }
    }
    rt.move(session, { seq: ++seq, x: pos.x, y: pos.y, dir: "down", moving: false });
    await new Promise((res) => setTimeout(res, 2_000 + rand() * 4_000));
  }
}

const port = Number(process.env.SPACE_PORT ?? 8095);
await gateway.listen(port, "127.0.0.1");
jsonLog.info("dev space server", { port, server: DEV_SERVER_ID, users: Object.keys(people) });
const rt = await registry.get(DEV_SERVER_ID);
if (rt) {
  void npc(rt, "npc1", 7);
  void npc(rt, "npc2", 99);
}
