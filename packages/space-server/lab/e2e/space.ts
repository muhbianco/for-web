/**
 * Fase 3d — voz nas salas, fluxo completo no laboratório (docs/espaco, plano §F.16).
 *
 * Tudo de verdade, menos o Stoat (lab/e2e/stoatSim.ts):
 * - o servidor do espaço da IMAGEM de produção (Dockerfile), com Mongo, Valkey e bonfire;
 * - o Caddy com a rota /_muchat/space e o livekit-gate em `enforce`;
 * - o LiveKit da hel1 e o Chromium com microfone e câmera falsos;
 * - no navegador, o mesmo protocolo, mundo, movimento e MediaLink do app.
 *
 * Provas por estado do servidor, participantes do LiveKit e RTCStats (bytes
 * recebidos), nunca visuais.
 *
 *   docker compose --profile space --profile run run --rm --no-deps harness node space-server/lab/e2e/space.ts
 *   SCENARIO=restart: o roteiro pede "RESTART_NOW" e espera o `space` cair e voltar.
 */
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import { type Browser, chromium, type Page } from "playwright";

import { LAB } from "./spaceFixture.ts";

const CADDY = process.env.CADDY_HTTP ?? "http://caddy:8080";
const SPACE = process.env.SPACE_INTERNAL ?? "http://space:8095";
const SIM = process.env.STOAT_SIM ?? "http://stoat-sim:14702";
const SCENARIO = process.env.SCENARIO ?? "main";

// getUserMedia needs a secure context; http://localhost is one. The relay makes
// Caddy reachable as localhost:8080, so the page, /_muchat/space and /livekit
// share one origin, as in production.
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
const PAGE = `http://localhost:${RELAY_PORT}/lab/space.html`;
const PUBLIC_WS = `ws://localhost:${RELAY_PORT}/livekit`;

type Result = { id: string; name: string; ok: boolean; detail: Record<string, unknown> };
const results: Result[] = [];
function record(id: string, name: string, ok: boolean, detail: Record<string, unknown> = {}) {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} ${JSON.stringify(detail)}`);
}

async function waitUntil(fn: () => Promise<boolean>, timeoutMs: number, stepMs = 100): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return Date.now() - t0;
    await sleep(stepMs);
  }
  return -1;
}

type Lk = { state: string; identity: string | null; name: string | null; remote: string[]; audioIn: number; videoIn: number; disconnects: number };
type MediaStatus = { kind: string; roomId?: string } | null;

class Person {
  readonly key: keyof typeof LAB.people;
  readonly page: Page;
  constructor(key: keyof typeof LAB.people, page: Page) {
    this.key = key;
    this.page = page;
  }
  get id() {
    return LAB.people[this.key].id;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ev<T>(fn: string, ...args: unknown[]): Promise<T> {
    return this.page.evaluate(([f, a]) => (window as any).lab[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
  }
  where = () => this.ev<string | null>("where");
  media = () => this.ev<MediaStatus>("media");
  lk = () => this.ev<Lk>("lk");
  statuses = () => this.ev<string[]>("statuses");
  grant = () => this.ev<{ url: string; token: string; identity: string; room_id: string } | null>("grant");
  camera = (on: boolean) => this.ev<void>("camera", on);
  rawJoin = (url: string, token: string) => this.ev<{ ok: boolean; status?: number; message?: string }>("rawJoin", url, token);
  rooms = () => this.ev<Array<{ room_id: string; label: string | null; private: boolean; can_enter: boolean }>>("rooms");
  close = () => this.ev<void>("close");

  /** Walks into (or out of) a room; resolves when the server agrees, -1 on timeout. */
  async walk(roomId: string, into: boolean, timeoutMs = 20_000): Promise<number> {
    const started = await this.ev<boolean>(into ? "walkIn" : "walkOut", roomId);
    if (!started) return -1;
    return waitUntil(async () => ((await this.where()) === roomId) === into && !(await this.ev<boolean>("moving")), timeoutMs, 100);
  }

  async connected(roomId: string, timeoutMs = 15_000): Promise<number> {
    return waitUntil(async () => {
      const m = await this.media();
      return m?.kind === "connected" && m.roomId === roomId && (await this.lk()).state === "connected";
    }, timeoutMs, 100);
  }
}

async function enter(browser: Browser, key: keyof typeof LAB.people): Promise<Person> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${key}] console: ${m.text()}`);
  });
  await page.goto(PAGE);
  await page.waitForFunction(() => Boolean((window as unknown as { lab?: unknown }).lab));
  await page.evaluate(([t, s]) => (window as any).lab.start(t, s), [LAB.people[key].session, LAB.server] as const);
  return new Person(key, page);
}

const hasRemote = (lk: Lk, userId: string) => lk.remote.some((id) => id.startsWith(`sp_${userId}_`));

async function setRoles(user: string, roles: string[]) {
  const res = await fetch(`${SIM}/_lab/roles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user, roles }),
  });
  if (!res.ok) throw new Error(`sim roles ${res.status}`);
}

async function main() {
  const relay = await startRelay();
  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ready = await waitUntil(async () => {
    try {
      return (await fetch(`${SPACE}/health/ready`)).ok;
    } catch {
      return false;
    }
  }, 90_000, 500);
  if (ready < 0) throw new Error("space not ready after 90 s");
  const { R1, R2, R3, R4 } = LAB.rooms;

  if (SCENARIO === "restart") return restart(browser, relay);

  const A = await enter(browser, "A");
  const B = await enter(browser, "B");
  const C = await enter(browser, "C");
  const D = await enter(browser, "D");
  const E = await enter(browser, "E");

  // S0 — structure from Mongo: the private room exists though the bot's Ready hides it.
  const roomsB = await B.rooms();
  const roomsA = await A.rooms();
  const r3B = roomsB.find((r) => r.room_id === R3);
  const r3A = roomsA.find((r) => r.room_id === R3);
  record("S0", "sala privada no mapa (vem do Mongo; o Ready do bot não a traz)", r3B?.label === "Diretoria" && r3B.can_enter && r3A?.label === null && r3A.private && !r3A.can_enter, {
    bia: r3B,
    ana: r3A,
  });

  // S1 — same room: both connect and hear each other.
  const tA = Date.now();
  const walkA = await A.walk(R1, true);
  const connA = await A.connected(R1);
  const entryToAudioA = connA >= 0 ? Date.now() - tA - walkA : -1;
  await B.walk(R1, true);
  const connB = await B.connected(R1);
  const heardMs = await waitUntil(async () => {
    const [la, lb] = [await A.lk(), await B.lk()];
    return hasRemote(la, B.id) && hasRemote(lb, A.id) && la.audioIn > 0 && lb.audioIn > 0;
  }, 15_000, 200);
  const la1 = await A.lk();
  record("S1", "mesma sala: os dois conectam e recebem áudio um do outro", connA >= 0 && connB >= 0 && heardMs >= 0, {
    entry_to_audio_ms: entryToAudioA,
    connB_ms: connB,
    heard_ms: heardMs,
    room: la1.name,
    identity: la1.identity,
  });
  record("S1b", "identity por entrada (sp_<usuário>_<n>) e room msp_<sala>_<época>", /^sp_[0-9A-Z]{26}_\d+$/.test(la1.identity ?? "") && (la1.name ?? "").startsWith(`msp_${R1}_`), {
    identity: la1.identity,
    room: la1.name,
  });

  // S2 — another room is isolated.
  await C.walk(R2, true);
  const connC = await C.connected(R2);
  await sleep(3_000);
  const [lc2, la2, lb2] = [await C.lk(), await A.lk(), await B.lk()];
  record("S2", "salas isoladas: Caio na Sala 2 não vê nem recebe ninguém da Sala 1", connC >= 0 && lc2.remote.length === 0 && lc2.audioIn === 0 && !hasRemote(la2, C.id) && !hasRemote(lb2, C.id), {
    c_remote: lc2.remote,
    c_audio_in: lc2.audioIn,
  });

  // S3 — corridor: no media at all.
  await sleep(500);
  const [md, ld] = [await D.media(), await D.lk()];
  record("S3", "corredor sem áudio: Davi no lobby não tem room nem concessão", md?.kind === "idle" && ld.state === "none", { media: md, lk: ld.state });

  // S4 — full room: the door stays shut, no grant.
  await E.walk(R4, true);
  const connE = await E.connected(R4);
  const dWalk = await D.walk(R4, true, 8_000);
  await sleep(1_000);
  const [dWhere, dMedia] = [await D.where(), await D.media()];
  record("S4", "sala cheia (1 lugar): a porta não abre para Davi e nada é concedido", connE >= 0 && dWalk < 0 && dWhere !== R4 && dMedia?.kind === "idle", {
    d_where: dWhere,
    d_media: dMedia,
  });

  // S5 — leaving = losing media, measured from the server's side of the walk.
  const grantBefore = await A.grant();
  const leftAt = Date.now();
  const walkOut = await A.walk(R1, false);
  const goneFromB = await waitUntil(async () => !hasRemote(await B.lk(), A.id), 10_000, 50);
  const aIdle = await waitUntil(async () => (await A.media())?.kind === "idle" && (await A.lk()).state === "none", 10_000, 50);
  record("S5", "sair da sala = perder a mídia (Bia deixa de ver Ana)", goneFromB >= 0 && aIdle >= 0, {
    walk_out_ms: walkOut,
    gone_from_b_after_exit_ms: goneFromB,
    a_idle_ms: aIdle,
    total_ms: Date.now() - leftAt,
  });

  // S6 — tampered client: the token of that entry no longer admits.
  const replay = grantBefore ? await A.rawJoin(PUBLIC_WS, grantBefore.token) : { ok: true };
  record("S6", "cliente adulterado: o token da entrada anterior não entra (gate em enforce)", !replay.ok, { replay });

  // S7 — revocation mid-conversation: Bia loses the role that opens the private room.
  await E.walk(R4, false);
  await E.walk(R3, true);
  await B.walk(R1, false);
  await B.walk(R3, true);
  const pair = await waitUntil(async () => hasRemote(await E.lk(), B.id) && (await E.lk()).audioIn > 0, 20_000, 200);
  const revokedAt = Date.now();
  await setRoles(B.id, []);
  const bOut = await waitUntil(async () => (await B.where()) !== R3, 10_000, 50);
  const bDropped = await waitUntil(async () => !hasRemote(await E.lk(), B.id), 10_000, 50);
  record("S7", "revogação no meio da conversa: Bia perde o papel e sai da sala e da mídia", pair >= 0 && bOut >= 0 && bDropped >= 0, {
    paired_ms: pair,
    b_out_of_room_ms: bOut,
    e_stops_seeing_b_ms: bDropped,
    total_ms: Date.now() - revokedAt,
  });
  await setRoles(B.id, ["DIR"]);

  // S8 — two tabs: the new tab takes over the same admission; never two sessions.
  const cIdentity = (await C.lk()).identity;
  const C2 = await enter(browser, "C");
  const c2Conn = await C2.connected(R2, 15_000);
  const c1Replaced = await waitUntil(async () => (await C.statuses()).includes("replaced"), 5_000);
  const c1Dropped = await waitUntil(async () => (await C.lk()).state !== "connected", 10_000);
  const lc2b = await C2.lk();
  record("S8", "segunda aba: assume a mesma entrada; a primeira sai da sessão e da room", c2Conn >= 0 && c1Replaced >= 0 && c1Dropped >= 0 && lc2b.identity === cIdentity, {
    first_identity: cIdentity,
    second_identity: lc2b.identity,
    c1_replaced_ms: c1Replaced,
    c1_dropped_ms: c1Dropped,
  });

  // S9 — video stops at the exit.
  await A.walk(R2, true);
  await A.connected(R2);
  await C2.camera(true);
  const sawVideo = await waitUntil(async () => (await A.lk()).videoIn > 0, 15_000, 200);
  await C2.walk(R2, false);
  const cGone = await waitUntil(async () => !hasRemote(await A.lk(), C.id), 10_000, 50);
  const v1 = (await A.lk()).videoIn;
  await sleep(2_000);
  const v2 = (await A.lk()).videoIn;
  record("S9", "vídeo na saída: a câmera de quem saiu para de chegar", sawVideo >= 0 && cGone >= 0 && v2 === v1, {
    saw_video_ms: sawVideo,
    gone_ms: cGone,
    video_bytes_after_exit: [v1, v2],
  });

  for (const p of [A, B, C, C2, D, E]) await p.close().catch(() => undefined);
  await finish(browser, relay);
}

/** SCENARIO=restart: the space server restarts under a running call (run the restart by hand). */
async function restart(browser: Browser, relay: net.Server) {
  const { R1 } = LAB.rooms;
  const A = await enter(browser, "A");
  const B = await enter(browser, "B");
  await A.walk(R1, true);
  await B.walk(R1, true);
  await A.connected(R1);
  await B.connected(R1);
  const heard = await waitUntil(async () => hasRemote(await B.lk(), A.id) && (await B.lk()).audioIn > 0, 15_000, 200);
  const before = await A.lk();
  const disconnectsBefore = before.disconnects;
  console.log("RESTART_NOW docker compose restart space");
  const down = await waitUntil(async () => {
    try {
      return !(await fetch(`${SPACE}/health/live`)).ok;
    } catch {
      return true;
    }
  }, 120_000, 200);
  const up = await waitUntil(async () => {
    try {
      return (await fetch(`${SPACE}/health/ready`)).ok;
    } catch {
      return false;
    }
  }, 120_000, 200);
  const back = await waitUntil(async () => (await A.statuses()).filter((s) => s === "online").length >= 2 && (await A.where()) === R1, 30_000, 200);
  await sleep(3_000);
  const after = await A.lk();
  const b0 = (await B.lk()).audioIn;
  await sleep(2_000);
  const b1 = (await B.lk()).audioIn;
  record("R1", "reinício do servidor do espaço sob uma chamada: mesma sala, mesma entrada, áudio sem queda", heard >= 0 && down >= 0 && up >= 0 && back >= 0 && after.identity === before.identity && after.disconnects === disconnectsBefore && b1 > b0, {
    identity: [before.identity, after.identity],
    lk_disconnects: [disconnectsBefore, after.disconnects],
    a_where: await A.where(),
    b_audio_growing: [b0, b1],
    back_ms: back,
  });
  await A.close();
  await B.close();
  await finish(browser, relay);
}

async function finish(browser: Browser, relay: net.Server) {
  await browser.close();
  relay.close();
  const ok = results.filter((r) => r.ok).length;
  console.log(`RESUMO ${ok}/${results.length} ok`);
  console.log(`RESULTS_JSON ${JSON.stringify(results)}`);
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("harness failed:", err);
  process.exit(2);
});
