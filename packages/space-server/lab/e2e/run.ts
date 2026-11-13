/**
 * Fase 1 — prova de isolamento e revogação de mídia (docs/espaco, plano §F.16).
 * Roda dentro do harness do laboratório: Chromium real (mídia falsa com tom),
 * LiveKit da mesma imagem da hel1, Caddy + livekit-gate, Valkey e o núcleo de
 * mídia de verdade (MediaController, adapters, Sweeper).
 *
 * Provas são por conexão, participantes e RTCStats (bytes de áudio recebidos),
 * nunca visuais.
 */
import { readFile } from "node:fs/promises";
import nodeHttp from "node:http";
import net from "node:net";
import { extname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { leaseKey, managedRoomName, mediaIdentity } from "@muchat/space-core";
import { Redis } from "ioredis";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { type Browser, chromium, type Page } from "playwright";

import { MediaController } from "../../src/media/controller.ts";
import {
  LiveKitRoomAdmin,
  LiveKitTokenMinter,
  RedisLeaseStore,
} from "../../src/media/adapters.ts";
import { Sweeper } from "../../src/media/sweeper.ts";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const LK_URL = env("LIVEKIT_URL");
const KEY = env("LIVEKIT_API_KEY");
const SECRET = env("LIVEKIT_API_SECRET");
const DIRECT_WS = env("DIRECT_WS");
const CADDY = env("CADDY_HTTP");

// getUserMedia needs a secure context, and http://localhost is one. A local TCP
// relay makes Caddy reachable as localhost:8080 for the browser pages.
const RELAY_PORT = 8080;
function startRelay(): Promise<net.Server> {
  const upstream = new URL(CADDY);
  const server = net.createServer((client) => {
    const up = net.connect(Number(upstream.port || 80), upstream.hostname);
    client.pipe(up).pipe(client);
    const close = () => {
      client.destroy();
      up.destroy();
    };
    client.on("error", close);
    up.on("error", close);
  });
  return new Promise((resolve) => server.listen(RELAY_PORT, "127.0.0.1", () => resolve(server)));
}
const PUBLIC_WS = `ws://localhost:${RELAY_PORT}/livekit`;

// The test page is served by the harness itself, so the suite also runs
// against the production Caddyfile (which has no /lab route).
const PAGE_PORT = 8081;
const PAGE_URL = `http://localhost:${PAGE_PORT}/`;
const WWW = new URL("../www/", import.meta.url);
function startPageServer(): Promise<nodeHttp.Server> {
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };
  const server = nodeHttp.createServer(async (req, res) => {
    const name = (req.url ?? "/").split("?")[0] === "/" ? "index.html" : (req.url ?? "").slice(1).split("?")[0];
    if (!name || !/^[a-z0-9.-]+$/i.test(name)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(new URL(name, WWW));
      res.writeHead(200, { "content-type": types[extname(name)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(PAGE_PORT, "127.0.0.1", () => resolve(server)));
}
const SCENARIO = process.env.SCENARIO ?? "main";

/** Test ULIDs (Crockford base32: no I, L, O, U). */
const ulid = (tag: string) => (tag + "0".repeat(26)).slice(0, 26);
const SERVER = ulid("01JSRV");
const R1 = ulid("01JRM1");
const R2 = ulid("01JRM2");
const UNMANAGED_ROOM = ulid("01JCHANNE"); // like a Stoat channel id
const USERS = {
  A: ulid("01JPXA"),
  B: ulid("01JPXB"),
  C: ulid("01JPXC"),
  D: ulid("01JPXD"),
  E: ulid("01JPXE"),
} as const;

type Result = { id: string; name: string; ok: boolean; detail: Record<string, unknown> };
const results: Result[] = [];
function record(id: string, name: string, ok: boolean, detail: Record<string, unknown> = {}) {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} ${JSON.stringify(detail)}`);
}

async function rawToken(identity: string, room: string, ttl: number | string = "10m"): Promise<string> {
  const at = new AccessToken(KEY, SECRET, { identity, ttl });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
  });
  return at.toJwt();
}

type JoinResult = { ok: boolean; name?: string; reason?: number; message?: string; identity?: string };
type Stats = {
  state: string;
  remote: string[];
  inboundAudioBytes: number;
  disconnectedAt: number | null;
  disconnectReason: number | null;
};

async function person(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => Boolean((window as unknown as { lab?: unknown }).lab));
  return page;
}

const join = (p: Page, url: string, token: string, publish = true): Promise<JoinResult> =>
  p.evaluate(
    ([u, t, pub]) => (window as any).lab.join(u, t, pub),
    [url, token, publish] as const,
  );
const stats = (p: Page): Promise<Stats> => p.evaluate(() => (window as any).lab.stats());
const refreshed = (p: Page): Promise<string | null> => p.evaluate(() => (window as any).lab.refreshedToken());
const leave = (p: Page): Promise<void> => p.evaluate(() => (window as any).lab.leave());

/** Polls until `fn` is true; returns elapsed ms or -1 on timeout. */
async function waitUntil(fn: () => Promise<boolean>, timeoutMs: number, stepMs = 100): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return Date.now() - t0;
    await sleep(stepMs);
  }
  return -1;
}

async function http(path: string, init: RequestInit = {}) {
  const res = await fetch(CADDY + path, { redirect: "manual", ...init });
  return { status: res.status, acao: res.headers.get("access-control-allow-origin") };
}

async function protocolChecks(managedNoLease: string, unmanaged: string) {
  const q = encodeURIComponent;
  const probe = await http("/livekit");
  record("P1", "sondagem do nó /livekit liberada", probe.status === 200, probe);
  for (const [id, path, method] of [
    ["P2", "/livekit/twirp/livekit.RoomService/ListRooms", "POST"],
    ["P3", "/livekit/whip/v1", "POST"],
    ["P4", "/livekit/agent", "GET"],
    ["P5", "/livekitrtc", "GET"],
  ] as const) {
    const r = await http(path, { method });
    record(id, `${method} ${path} bloqueado (404)`, r.status === 404, r);
  }
  const v1 = await http(`/livekit/rtc/v1/validate?access_token=${q(managedNoLease)}`);
  record("P6", "validate de sala do espaço sem lease → 403 com CORS", v1.status === 403 && v1.acao === "*", v1);
  // v0 validate: the v1 one also wants a join_request from the protocol.
  const v2 = await http(`/livekit/rtc/validate?access_token=${q(unmanaged)}`);
  record("P7", "validate de sala fora do espaço → 200", v2.status === 200, v2);
  const smug = await http(`/livekit/rtc/v1/validate?access_token=${q(unmanaged)};&access_token=${q(managedNoLease)}`);
  record("P8", "contrabando com ';' → 403", smug.status === 403, smug);
  const both = await http(`/livekit/rtc/v1/validate?access_token=${q(unmanaged)}`, {
    headers: { Authorization: `Bearer ${managedNoLease}` },
  });
  record("P9", "token no header e na query → 403", both.status === 403, both);
  const post = await http(`/livekit/rtc?access_token=${q(unmanaged)}`, { method: "POST" });
  record("P10", "POST no sinal → 403", post.status === 403, post);
  const pub = await http(`/livekit/rtc/validate?access_token=${q(unmanaged)}&publish=x`);
  record("P11", "parâmetro publish → 403", pub.status === 403, pub);
}

async function main() {
  const relay = await startRelay();
  const pages = await startPageServer();
  const redis = new Redis(env("REDIS_URL"), { maxRetriesPerRequest: 1, connectTimeout: 2_000 });
  const lk = new LiveKitRoomAdmin(LK_URL, KEY, SECRET, 3);
  const leases = new RedisLeaseStore(redis);
  const mc = new MediaController({ lk, leases, minter: new LiveKitTokenMinter(KEY, SECRET), publicUrl: PUBLIC_WS });
  const current = new Set([managedRoomName(R1, 1), managedRoomName(R2, 1)]);
  const sweeper = new Sweeper({ lk, leases, isCurrentRoom: (n) => current.has(n) });
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  // A freshly started LiveKit answers "could not find any available nodes"
  // until its first node stats are in; wait for a room create to succeed.
  const readyMs = await waitUntil(async () => {
    try {
      await lk.ensureRoom("lab-ready", { maxParticipants: 1, emptyTimeout: 5, departureTimeout: 1 });
      return true;
    } catch {
      return false;
    }
  }, 60_000, 500);
  if (readyMs < 0) throw new Error("LiveKit not ready after 60 s");
  await lk.deleteRoom("lab-ready");

  const grant = (user: string, room: string) =>
    mc.grant({
      userId: user,
      displayName: user.slice(5, 9),
      serverId: SERVER,
      roomId: room,
      epoch: 1,
      capacity: 10,
      sources: ["microphone"],
      canSubscribe: true,
    });

  try {
    const unmanagedToken = await rawToken(USERS.E, UNMANAGED_ROOM);

    if (SCENARIO === "r5") {
      // Stoat's voice-ingress gets every webhook of these rooms. Prove it
      // writes nothing to Stoat's Redis for msp_* rooms.
      const stoatKeys = async () =>
        (await redis.keys("*")).filter((k) => !k.startsWith("muchat:space:")).sort();
      // Seed keys shaped like real Stoat voice state for the same people, so a
      // stray delete would show up (fase-0-achados.md: keys embed id verbatim).
      await redis
        .multi()
        .sadd(`vc:${USERS.A}`, UNMANAGED_ROOM)
        .sadd(`vc_members:${UNMANAGED_ROOM}`, USERS.A)
        .set(`${USERS.A}:${SERVER}`, UNMANAGED_ROOM)
        .set(`is_publishing:${USERS.A}:${SERVER}`, "1")
        .set(`node:${UNMANAGED_ROOM}`, "worldwide")
        .exec();
      const before = await stoatKeys();
      const [p1, p2] = await Promise.all([person(browser), person(browser)]);
      const g1 = await grant(USERS.A, R1);
      const g2 = await grant(USERS.B, R1);
      const j1 = await join(p1, g1.url, g1.token);
      const j2 = await join(p2, g2.url, g2.token);
      await sleep(3_000);
      await p1.evaluate(() => (window as any).lab.mic(false)); // track_muted (Stoat fork event)
      await sleep(1_000);
      await p1.evaluate(() => (window as any).lab.mic(true));
      await sleep(1_000);
      await mc.revoke(USERS.A); // participant_left
      await mc.revoke(USERS.B);
      await sleep(25_000); // let LiveKit's webhook retries play out
      const after = await stoatKeys();
      const added = after.filter((k) => !before.includes(k));
      const removed = before.filter((k) => !after.includes(k));
      record("R5", "voice-ingress não escreve nem apaga chaves do Stoat por rooms msp_*", j1.ok && j2.ok && added.length === 0 && removed.length === 0, {
        added,
        removed,
        stoatKeysBefore: before.length,
      });
      return;
    }

    if (SCENARIO === "shadow") {
      const managedNoLease = await rawToken(mediaIdentity(USERS.D, 2), managedRoomName(R1, 1));
      const v = await http(`/livekit/rtc/validate?access_token=${encodeURIComponent(managedNoLease)}`);
      const metrics = await (await fetch("http://gate:8096/metrics")).text();
      record("S1", "modo sombra: libera e conta o que negaria", v.status === 200 &&
        /gate_decisions_total\{decision="deny",reason="lease_missing",mode="shadow"\} [1-9]/.test(metrics), {
        validate: v.status,
        metric: metrics.split("\n").filter((l) => l.includes("shadow")),
      });
      return;
    }

    if (SCENARIO === "gate-down") {
      const p = await person(browser);
      const r = await join(p, PUBLIC_WS, unmanagedToken);
      record("G1", "controle fora do ar: chamada fora do espaço falha (custo assumido, R3)", r.ok === false, r);
      const v = await http(`/livekit/rtc/v1/validate?access_token=${encodeURIComponent(unmanagedToken)}`);
      record("G2", "controle fora do ar: Caddy responde 5xx", v.status >= 500, v);
      return;
    }

    await protocolChecks(await rawToken(mediaIdentity(USERS.D, 1), managedRoomName(R1, 1)), unmanagedToken);

    // Caso 1 — mesma sala conversa.
    const [pa, pb, pc, pd] = await Promise.all([person(browser), person(browser), person(browser), person(browser)]);
    const ga = await grant(USERS.A, R1);
    const gb = await grant(USERS.B, R1);
    const ja = await join(pa, ga.url, ga.token);
    const jb = await join(pb, gb.url, gb.token);
    const heard = await waitUntil(async () => {
      const [sa, sb] = await Promise.all([stats(pa), stats(pb)]);
      return sa.inboundAudioBytes > 0 && sb.inboundAudioBytes > 0;
    }, 15_000);
    record("C1", "mesma sala: os dois recebem áudio", ja.ok && jb.ok && heard >= 0, { ja, jb, ms: heard });

    // Caso 2 — salas diferentes isoladas.
    const gc = await grant(USERS.C, R2);
    const jc = await join(pc, gc.url, gc.token);
    await sleep(3_000);
    const [sa2, sb2, sc2] = await Promise.all([stats(pa), stats(pb), stats(pc)]);
    record(
      "C2",
      "salas diferentes: nenhum participante nem byte cruzado",
      jc.ok && sc2.remote.length === 0 && sc2.inboundAudioBytes === 0 &&
        !sa2.remote.includes(gc.identity) && !sb2.remote.includes(gc.identity),
      { c: sc2, aRemote: sa2.remote, bRemote: sb2.remote },
    );

    // Casos 3 e 5 — sem lease (corredor, cliente adulterado com token forjado pelo próprio servidor).
    const forged = await rawToken(mediaIdentity(USERS.D, 1), managedRoomName(R1, 1));
    const jd = await join(pd, PUBLIC_WS, forged);
    const inR1 = (await lk.listParticipants(managedRoomName(R1, 1))).map((p) => p.identity);
    record(
      "C3",
      "sem lease: conexão negada pelo controle, ninguém novo na sala",
      jd.ok === false && !inR1.includes(mediaIdentity(USERS.D, 1)),
      { jd, inR1 },
    );

    // Casos 16 e 17 — token renovado de verdade, depois da revogação.
    const bRefreshed = await waitUntil(async () => {
      const t = await refreshed(pb);
      return Boolean(t && t !== gb.token);
    }, 10_000);
    const tokenB = await refreshed(pb);
    const tRevoke = Date.now();
    await mc.revoke(USERS.B); // B's client does nothing on its own (adulterado)
    const bGone = await waitUntil(async () => (await stats(pb)).disconnectedAt !== null, 10_000, 50);
    const sbAfter = await stats(pb);
    const aSeesB = (await stats(pa)).remote.includes(gb.identity);
    record("C6", "revogação derruba a mídia do cliente que ignora o aviso", bGone >= 0 && !aSeesB, {
      msToDisconnect: bGone >= 0 ? (sbAfter.disconnectedAt ?? 0) - tRevoke : -1,
      reason: sbAfter.disconnectReason,
      refreshedTokenSeen: bRefreshed >= 0,
    });
    const rejoinGate = tokenB ? await join(pb, PUBLIC_WS, tokenB) : { ok: false, message: "no token" };
    record("C16", "token renovado depois de sair: negado pelo controle", rejoinGate.ok === false && bRefreshed >= 0, {
      rejoinGate,
    });
    // Controle do experimento: o mesmo token direto no LiveKit (rede interna) ainda entra.
    const pb2 = await person(browser);
    const rejoinDirect = tokenB ? await join(pb2, DIRECT_WS, tokenB) : { ok: false };
    record("C17", "o mesmo token direto no LiveKit ainda entra (prova o risco sem o controle)", rejoinDirect.ok === true, {
      rejoinDirect,
    });
    const tSweep = Date.now();
    const sweep = await sweeper.tick();
    const removedB = await waitUntil(async () => (await stats(pb2)).disconnectedAt !== null, 10_000, 50);
    record("C15", "varredura remove quem está na sala sem lease", removedB >= 0, {
      msFromSweep: removedB >= 0 ? ((await stats(pb2)).disconnectedAt ?? 0) - tSweep : -1,
      removed: sweep?.removed,
    });

    // Caso 22 — troca R2→R1: a origem cai antes de existir lease no destino, mesmo sem conectar ao destino.
    const tMove = Date.now();
    const gc2 = await grant(USERS.C, R1);
    const cOff = await waitUntil(async () => (await stats(pc)).disconnectedAt !== null, 10_000, 50);
    const stillInR2 = (await lk.listParticipants(managedRoomName(R2, 1))).map((p) => p.identity);
    record("C22", "troca de sala: sai da origem antes de entrar no destino", cOff >= 0 && !stillInR2.includes(gc.identity), {
      msToLeaveOrigin: cOff >= 0 ? ((await stats(pc)).disconnectedAt ?? 0) - tMove : -1,
      stillInR2,
    });
    const jc2 = await join(pc, gc2.url, gc2.token);
    const cHearsA = await waitUntil(async () => (await stats(pc)).inboundAudioBytes > 0, 15_000);
    record("C22b", "no destino, ouve quem está lá", jc2.ok && cHearsA >= 0, { jc2, ms: cHearsA });

    // Reinício sem fantasma: lease sumiu (reinício + TTL) e a pessoa ficou conectada.
    await redis.del(leaseKey(ga.identity));
    const fresh = new Sweeper({ lk, leases, isCurrentRoom: (n) => current.has(n) });
    const tFresh = Date.now();
    const sweep2 = await fresh.tick();
    const aOff = await waitUntil(async () => (await stats(pa)).disconnectedAt !== null, 10_000, 50);
    record("C15b", "processo novo (sem memória) limpa participante sem lease numa passada", aOff >= 0, {
      msFromSweep: aOff >= 0 ? ((await stats(pa)).disconnectedAt ?? 0) - tFresh : -1,
      removed: sweep2?.removed,
    });

    // Regressão: sala fora do espaço (como canal/DM do Stoat) continua passando pelo controle.
    const [pe1, pe2] = await Promise.all([person(browser), person(browser)]);
    const je1 = await join(pe1, PUBLIC_WS, unmanagedToken);
    const je2 = await join(pe2, PUBLIC_WS, await rawToken(USERS.D, UNMANAGED_ROOM));
    const eHeard = await waitUntil(async () => {
      const [s1, s2] = await Promise.all([stats(pe1), stats(pe2)]);
      return s1.inboundAudioBytes > 0 && s2.inboundAudioBytes > 0;
    }, 15_000);
    record("R1", "sala fora do espaço (DM/canal) conecta e conversa com o controle em enforce", je1.ok && je2.ok && eHeard >= 0, {
      je1,
      je2,
      ms: eHeard,
    });

    // Saída cooperativa.
    const tLeave = Date.now();
    await mc.revoke(USERS.C);
    await leave(pc);
    record("C6b", "saída cooperativa", (await stats(pc)).state === "disconnected", { ms: Date.now() - tLeave });
  } finally {
    mc.stop();
    await browser.close();
    redis.disconnect();
    relay.close();
    pages.close();
  }
}

main().then(
  () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\nRESUMO ${results.length - failed.length}/${results.length} ok`);
    console.log("RESULTS_JSON " + JSON.stringify(results));
    process.exit(failed.length ? 1 : 0);
  },
  (err) => {
    console.error("harness error", err);
    process.exit(2);
  },
);
