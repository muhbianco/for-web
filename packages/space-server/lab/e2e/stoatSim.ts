/**
 * Stoat simulado do laboratório da fase 3 (só o que o servidor do espaço usa):
 *
 * - `GET /users/@me` (X-Session-Token) e `GET /servers/:s/members/:u` (X-Bot-Token);
 * - o bonfire em `/ws`: `Authenticated`, `Ready` e `Pong`. Como no Stoat real
 *   (bonfire/src/events/impl.rs), o Ready do bot **não traz a sala privada**: a
 *   estrutura completa só existe no Mongo, que este processo semeia (banco `revolt`);
 * - `POST /_lab/roles {user, roles}` troca os papéis de alguém e emite
 *   `ServerMemberUpdate` no bonfire, como o Stoat faria.
 *
 * Nada aqui é seguro nem completo: é um dublê de teste.
 */
import http from "node:http";

import { Perm } from "@muchat/space-core";
import { MongoClient } from "mongodb";
import { WebSocketServer, type WebSocket } from "ws";

import { LAB } from "./spaceFixture.ts";

const n = (b: bigint) => Number(b);
const PORT = 14702;

const server = {
  _id: LAB.server,
  owner: LAB.owner,
  name: "Laboratório",
  channels: [LAB.rooms.R1, LAB.rooms.R2, LAB.rooms.R3, LAB.rooms.R4, LAB.text],
  categories: [{ id: "CATDIR", title: "Diretoria", channels: [LAB.rooms.R3] }],
  default_permissions: n(
    Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Video | Perm.Listen,
  ),
  roles: { DIR: { name: "Diretoria", rank: 1, permissions: { a: 0, d: 0 } } },
};

const voice = (id: string, name: string, maxUsers: number | null, extra: Record<string, unknown> = {}) => ({
  channel_type: "TextChannel",
  _id: id,
  server: LAB.server,
  name,
  voice: maxUsers === null ? {} : { max_users: maxUsers },
  ...extra,
});

const channels = [
  voice(LAB.rooms.R1, "Sala 1", 8),
  voice(LAB.rooms.R2, "Sala 2", null),
  voice(LAB.rooms.R3, "Diretoria", 6, {
    default_permissions: { a: 0, d: n(Perm.ViewChannel | Perm.Connect) },
    role_permissions: { DIR: { a: n(Perm.ViewChannel | Perm.Connect), d: 0 } },
  }),
  voice(LAB.rooms.R4, "Cabine", 1),
  { channel_type: "TextChannel", _id: LAB.text, server: LAB.server, name: "geral" },
];

const roles = new Map<string, string[]>(Object.entries(LAB.people).map(([, p]) => [p.id, [...p.roles]]));
const bySession = new Map(Object.values(LAB.people).map((p) => [p.session, p]));

async function seed() {
  const mongo = new MongoClient(process.env.MONGO_URL ?? "mongodb://database:27017", { serverSelectionTimeoutMS: 5_000 });
  for (let i = 0; ; i++) {
    try {
      await mongo.connect();
      break;
    } catch (err) {
      if (i > 30) throw err;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  const db = mongo.db("revolt");
  await db.collection("servers").replaceOne({ _id: LAB.server } as never, server, { upsert: true });
  for (const c of channels) await db.collection("channels").replaceOne({ _id: c._id } as never, c, { upsert: true });
  await mongo.close();
}

const sockets = new Set<WebSocket>();
function broadcast(event: unknown) {
  const raw = JSON.stringify(event);
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(raw);
}

let ready = false;
const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://sim");
  if (url.pathname === "/_lab/health") return json(res, ready ? 200 : 503, { ready });
  if (url.pathname === "/users/@me" && req.method === "GET") {
    const p = bySession.get(String(req.headers["x-session-token"] ?? ""));
    return p ? json(res, 200, { _id: p.id, username: p.name, display_name: p.name }) : json(res, 401, { type: "InvalidSession" });
  }
  const m = /^\/servers\/([^/]+)\/members\/([^/]+)$/.exec(url.pathname);
  if (m && req.method === "GET") {
    if (req.headers["x-bot-token"] !== LAB.botToken) return json(res, 401, { type: "InvalidSession" });
    const r = roles.get(m[2]!);
    if (m[1] !== LAB.server || !r) return json(res, 404, { type: "NotFound" });
    return json(res, 200, { _id: { server: LAB.server, user: m[2] }, roles: r });
  }
  if (url.pathname === "/_lab/roles" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const { user, roles: next } = JSON.parse(raw) as { user: string; roles: string[] };
      roles.set(user, next);
      broadcast({ type: "ServerMemberUpdate", id: { server: LAB.server, user }, data: { roles: next }, clear: [] });
      json(res, 200, { ok: true });
    });
    return;
  }
  json(res, 404, { type: "NotFound" });
});

const wss = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://sim");
  if (url.searchParams.get("token") !== LAB.botToken) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("message", (raw) => {
      const e = JSON.parse(String(raw)) as { type?: string; data?: unknown };
      if (e.type === "Ping") ws.send(JSON.stringify({ type: "Pong", data: e.data }));
    });
    ws.send(JSON.stringify({ type: "Authenticated" }));
    // Filtered like the real one: the bot has no role, so no private room here.
    ws.send(
      JSON.stringify({
        type: "Ready",
        users: [],
        servers: [server],
        channels: channels.filter((c) => c._id !== LAB.rooms.R3),
        members: [],
      }),
    );
  });
});

await seed();
ready = true;
httpServer.listen(PORT, "0.0.0.0", () => console.log(`stoat-sim on :${PORT} (revolt seeded)`));
