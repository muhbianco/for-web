#!/usr/bin/env node
/* global window, document, console, process, setTimeout, performance */
/**
 * Driver do laboratório de voz: dois Chromium (Playwright) com microfone falso
 * (arquivo WAV), conectados ao SFU de laboratório (WSL) ou ao LiveKit da hel1,
 * usando a página qa/voice-lab (mesma Room e mesma cadeia DSP do app).
 *
 * Mede: estatísticas WebRTC por janela de 2 s nas duas pontas, estado do DSP
 * do publicador, caminho ICE, SDP negociada; grava o áudio processado que sai
 * do publicador e o áudio que chega no assinante e compara os dois com a
 * referência (lib/analyze.mjs). Opcionalmente degrada a rede (lab/netem.sh) e
 * carrega a CPU local.
 *
 *   node qa/voice-lab/run.mjs --target lab --name baseline --duration 60
 *   node qa/voice-lab/run.mjs --target prod --tokens-dir out/tokens --name prod-udp
 *
 * Rode de packages/client (resolve @playwright/test do node_modules do client).
 * Pré-requisitos: `vite dev` servindo /qa/voice-lab/index.html (--page) e, no
 * alvo lab, `lab/up.sh` já executado no WSL.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { chromium } from "@playwright/test";

import { analyzePair, series } from "./lib/analyze.mjs";
import { mintToken } from "./lib/token.mjs";
import { decodePcmChunks, readWav, writeWav } from "./lib/wav.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const opts = {
  target: args.target ?? "lab",
  name: args.name ?? "run",
  durationSec: Number(args.duration ?? 60),
  recordSec: Number(args.record ?? 130),
  ns: args.ns ?? "advanced",
  gate: (args.gate ?? "on") !== "off",
  sensitivity: args.sensitivity ?? "auto",
  vip: !!args.vip,
  bidir: !!args.bidir,
  netem: typeof args.netem === "string" ? args.netem : undefined,
  netemAtSec: Number(args["netem-at"] ?? 0),
  netemClearAtSec: Number(args["netem-clear-at"] ?? 0),
  uplinkLoss: typeof args["uplink-loss"] === "string" ? args["uplink-loss"] : undefined,
  cpuLoad: Number(args["cpu-load"] ?? 0),
  /**
   * Fase 4: while talking, A shares a (fake) screen that B watches and/or plays a
   * video (the Smart TV's load). `--media-load` = both; `--media-load screen|tv`.
   */
  mediaLoad: args["media-load"] === true ? "both" : ["screen", "tv", "both"].includes(args["media-load"]) ? args["media-load"] : undefined,
  /**
   * Refúgio (ADR 0009, E6): A runs the game's real scene, one boss fight after
   * another at 1× (continuous 30 fps animation), in the same page that talks.
   */
  gameLoad: !!args["game-load"],
  // Etapa O6 do jogo idle: a tela da aventura (RunPanel) com um quadro por segundo.
  runLoad: !!args["run-load"],
  /** Runs (and the Chromiums it starts) at BelowNormal, so the lab doesn't take the machine. */
  belowNormal: !!args["below-normal"],
  labEnv: typeof args["lab-env"] === "string" ? resolve(args["lab-env"]) : undefined,
  page: args.page ?? "http://127.0.0.1:5173/qa/voice-lab/index.html",
  url: typeof args.url === "string" ? args.url : undefined,
  tokensDir: args["tokens-dir"] ? resolve(args["tokens-dir"]) : join(HERE, "out", "tokens"),
  ref: args.ref ? resolve(args.ref) : join(HERE, "fixtures", "ref-ptbr-48k.wav"),
  room: args.room ?? `qa_${Date.now().toString(36)}`,
  headed: !!args.headed,
  recordRaw: !!args["record-raw"],
  out: args.out ? resolve(args.out) : undefined,
};

if (opts.belowNormal) {
  try {
    os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* sem permissão: segue */
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = opts.out ?? join(HERE, "out", `${stamp}-${opts.name}`);
mkdirSync(outDir, { recursive: true });

function log(...parts) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${parts.join(" ")}`;
  console.log(line);
}

function toWslPath(winPath) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  if (!m) return winPath;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

function wsl(...cmd) {
  return execFileSync("wsl", ["-e", ...cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function netem(...a) {
  if (opts.target !== "lab") return;
  const script = toWslPath(join(HERE, "lab", "netem.sh"));
  const res = wsl("bash", script, ...a);
  log("netem:", res.trim().split("\n").join(" | "));
}

// --- tokens -----------------------------------------------------------------
function resolveTokens() {
  const idPub = `qa-pub`;
  const idSub = `qa-sub`;
  if (opts.target === "lab") {
    // Another checkout's lab keys (a git worktree has none: .env is not versioned).
    const envPath = opts.labEnv ?? join(HERE, "lab", ".env");
    if (!existsSync(envPath)) throw new Error("lab/.env ausente: rode lab/up.sh no WSL");
    const env = Object.fromEntries(
      readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    const mint = (identity) =>
      mintToken({
        apiKey: env.LAB_API_KEY,
        apiSecret: env.LAB_API_SECRET,
        identity,
        room: opts.room,
        ttlSeconds: 3600,
      });
    return { url: opts.url ?? env.LAB_URL, pub: { id: idPub, token: mint(idPub) }, sub: { id: idSub, token: mint(idSub) } };
  }
  const read = (id) => {
    const p = join(opts.tokensDir, `${id}.jwt`);
    if (!existsSync(p)) throw new Error(`token ausente: ${p} (hel1/mint-tokens.sh + download)`);
    return readFileSync(p, "utf8").trim();
  };
  return {
    url: opts.url ?? "wss://chat.muhbianco.com.br/livekit",
    pub: { id: idPub, token: read(idPub) },
    sub: { id: idSub, token: read(idSub) },
  };
}

// --- browsers ---------------------------------------------------------------
async function launch(label, fakeAudio) {
  const browserArgs = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${fakeAudio}`,
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ];
  // --media-load: getDisplayMedia takes the whole (fake) screen without a dialog.
  if (opts.mediaLoad) browserArgs.push("--auto-select-desktop-capture-source=Entire screen");
  const browser = await chromium.launch({ headless: !opts.headed, args: browserArgs });
  const page = await browser.newPage();
  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`${msg.type()} ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`pageerror ${err.message}`));
  await page.goto(opts.page, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__lab, null, { timeout: 30000 });
  // O vite dev reotimiza dependências na primeira visita e recarrega a página
  // (o LiveKit então registra "Page leave detected" e derruba a chamada).
  // Espera a página ficar estável: mesma origem de tempo por 4 s seguidos.
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await page.evaluate(() => performance.timeOrigin);
    await page.waitForTimeout(4000);
    await page.waitForFunction(() => !!window.__lab, null, { timeout: 30000 });
    const after = await page.evaluate(() => performance.timeOrigin);
    if (before === after) break;
    log(`${label}: página recarregada pelo vite; aguardando estabilizar`);
  }
  return { label, browser, page, consoleLines };
}

async function connect(client, token, publish) {
  return client.page.evaluate(
    (o) => window.__lab.connect(o),
    {
      url: token.url,
      token: token.token,
      publish,
      ns: opts.ns,
      gate: opts.gate,
      sensitivity: opts.sensitivity,
      vip: opts.vip,
      recordSeconds: opts.recordSec,
      recordRaw: opts.recordRaw,
    },
  );
}

// --- CPU load ---------------------------------------------------------------
function startCpuLoad(n) {
  if (!n) return () => {};
  try {
    os.setPriority(os.constants.priority.PRIORITY_LOW);
  } catch {
    /* sem permissão: segue */
  }
  const workers = [];
  for (let i = 0; i < n; i++) {
    workers.push(
      new Worker("let x = 0; for (;;) { x = (x * 1103515245 + 12345) % 2147483648; }", { eval: true }),
    );
  }
  log(`carga de CPU: ${n} threads ocupadas (prioridade baixa)`);
  return () => workers.forEach((w) => void w.terminate());
}

// --- main -------------------------------------------------------------------
async function main() {
  log(`laboratório: alvo=${opts.target} nome=${opts.name} duração=${opts.durationSec}s ns=${opts.ns} gate=${opts.gate ? "on" : "off"} bidir=${opts.bidir}`);
  const tokens = resolveTokens();
  log(`LiveKit: ${tokens.url} sala=${opts.room}`);

  let keepAlive;
  if (opts.target === "lab") {
    // O WSL desliga containers ~15 s depois do último `wsl -e`; segura a distro.
    keepAlive = spawn("wsl", ["-e", "sleep", String(opts.durationSec + 600)], { detached: true, stdio: "ignore" });
    keepAlive.unref();
    netem("clear");
    if (opts.netem && opts.netemAtSec <= 0) netem(...opts.netem.split(/\s+/));
    if (opts.uplinkLoss) netem("uplink-loss", opts.uplinkLoss);
  }

  const stopCpu = startCpuLoad(opts.cpuLoad);
  const refPath = opts.ref;
  const A = await launch("A", refPath);
  const B = await launch("B", refPath);
  const timeline = [];
  let firstSnapshot;
  let mediaLoad;
  let gameLoad;
  let runLoad;
  try {
    const a = await connect(A, { url: tokens.url, token: tokens.pub.token }, true);
    log(`A conectado: ${a.localIdentity} em ${a.room}`);
    if (opts.mediaLoad) {
      // What the media stage adds to a call: a shared screen (encoded and
      // published by the same Room) and the room's TV decoding a video.
      const res = await A.page.evaluate(async (mode) => {
        if (mode === "tv") return "sem tela";
        try {
          await window.__lab.room.localParticipant.setScreenShareEnabled(true, { audio: false });
          return "tela ok";
        } catch (e) {
          return `tela falhou: ${String(e?.message ?? e)}`;
        }
      }, opts.mediaLoad);
      const tvRes = await A.page.evaluate((mode) => {
        if (mode === "screen") return "sem TV";
        const f = document.createElement("iframe");
        f.src = "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1&controls=0&loop=1&playlist=aqz-KE-bpKQ";
        f.allow = "autoplay; encrypted-media";
        f.width = "640";
        f.height = "360";
        document.body.appendChild(f);
        return "TV ok";
      }, opts.mediaLoad);
      log(`carga de mídia em A (${opts.mediaLoad}): ${res} · ${tvRes}`);
    }
    if (opts.gameLoad) {
      const res = await A.page
        .evaluate(async () =>
          (await import("/qa/voice-lab/gameLoad.ts")).startGameLoad(),
        )
        .catch((e) => `jogo falhou: ${String(e?.message ?? e)}`);
      log(`carga do jogo em A: ${res}`);
    }
    if (opts.runLoad) {
      const res = await A.page
        .evaluate(async () =>
          (await import("/qa/voice-lab/runLoad.tsx")).startRunLoad(),
        )
        .catch((e) => `corrida falhou: ${String(e?.message ?? e)}`);
      log(`carga da corrida em A: ${res}`);
    }
    const b = await connect(B, { url: tokens.url, token: tokens.sub.token }, opts.bidir);
    log(`B conectado: ${b.localIdentity}`);
    if (opts.mediaLoad && opts.mediaLoad !== "tv") {
      // Someone watching the screen: without a subscriber, dynacast pauses the
      // encoder and the load disappears.
      const watching = await B.page.evaluate(async () => {
        const room = window.__lab.room;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          for (const p of room.remoteParticipants.values()) {
            for (const pub of p.trackPublications.values()) {
              if (pub.source !== "screen_share") continue;
              pub.setSubscribed(true);
              if (!pub.track) continue;
              const el = pub.track.attach();
              el.muted = true;
              el.autoplay = true;
              el.style.width = "640px";
              el.style.height = "360px";
              document.body.appendChild(el);
              window.__screenWatch = pub.track;
              return "ok";
            }
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        return "a tela de A não chegou em 15 s";
      });
      log(`B assistindo à tela de A: ${watching}`);
    }

    await B.page.waitForFunction(() => window.__lab.snapshot().remoteCount >= 1, null, { timeout: 30000 });
    log("B vê A; medindo…");
    const started = Date.now();
    let netemApplied = !opts.netem || opts.netemAtSec <= 0;
    let netemCleared = false;
    while (Date.now() - started < opts.durationSec * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      const elapsed = (Date.now() - started) / 1000;
      if (!netemApplied && elapsed >= opts.netemAtSec) {
        netem(...opts.netem.split(/\s+/));
        netemApplied = true;
      }
      if (
        netemApplied &&
        opts.netemClearAtSec > 0 &&
        !netemCleared &&
        elapsed >= opts.netemClearAtSec
      ) {
        netem("clear");
        netemCleared = true;
      }
      const [sa, sb] = await Promise.all([
        A.page.evaluate(() => window.__lab.sample()),
        B.page.evaluate(() => window.__lab.sample()),
      ]);
      if (!firstSnapshot) firstSnapshot = { A: sa, B: sb };
      // SDP/ICE só mudam em renegociação; guarda uma vez e corta do timeline.
      const strip = (s) => ({ ...s, sdps: undefined, iceServers: undefined });
      timeline.push({ t: Math.round(elapsed), A: strip(sa), B: strip(sb) });
      if (Math.round(elapsed) % 10 === 0) {
        const inA = sb.stats.participants.find((p) => p.identity === a.localIdentity)?.audio;
        log(
          `t=${Math.round(elapsed)}s B←A jitter=${inA?.jitterMs ?? "—"}ms loss=${inA?.lossPct ?? "—"}% conceal=${inA?.concealedMsPerSec ?? "—"} accel=${inA?.acceleratedMsPerSec ?? "—"} jb=${inA?.jitterBufferMs ?? "—"}ms ` +
            `| A rtt=${sa.stats.self.audio?.rttMs ?? "—"}ms up=${sa.stats.self.audio?.bitrateKbps ?? "—"}kbps dsp=${sa.dsp?.engine ?? "—"} slow=${sa.dsp?.deepFilterSlowRatio ?? "—"} max=${sa.dsp?.deepFilterMaxFrameMs ?? "—"}ms silent=${sa.dsp?.silentMsPerSec ?? "—"}`,
        );
      }
    }

    if (opts.mediaLoad) {
      const screen = await B.page.evaluate(async () => {
        const tr = window.__screenWatch;
        if (!tr?.receiver) return null;
        let out = null;
        (await tr.receiver.getStats()).forEach((r) => {
          if (r.type === "inbound-rtp" && r.kind === "video")
            out = { framesDecoded: r.framesDecoded, kbytes: Math.round(r.bytesReceived / 1024), width: r.frameWidth, height: r.frameHeight };
        });
        return out;
      });
      const yt = A.page.frames().find((f) => f.url().includes("youtube-nocookie.com/embed"));
      const tv = yt
        ? await yt
            .evaluate(() => {
              const v = document.querySelector("video");
              return v ? { currentTimeS: Math.round(v.currentTime * 10) / 10, paused: v.paused } : null;
            })
            .catch((e) => ({ error: String(e?.message ?? e) }))
        : null;
      mediaLoad = { screenAtB: screen, youtubeAtA: tv };
      log(`carga de mídia no fim: tela recebida em B ${JSON.stringify(screen)} · YouTube em A ${JSON.stringify(tv)}`);
    }
    if (opts.gameLoad) {
      gameLoad = await A.page
        .evaluate(() => window.__gameLoad?.stats() ?? null)
        .catch(() => null);
      log(`carga do jogo no fim: ${JSON.stringify(gameLoad)}`);
    }
    if (opts.runLoad) {
      runLoad = await A.page
        .evaluate(() => window.__runLoad?.stats() ?? null)
        .catch(() => null);
      log(`carga da corrida no fim: ${JSON.stringify(runLoad)}`);
    }
    log("parando e coletando áudio…");
    const [audioA, audioB] = await Promise.all([
      A.page.evaluate(() => window.__lab.stop()),
      B.page.evaluate(() => window.__lab.stop()),
    ]);
    stopCpu();
    netem("clear");

    // --- áudio ---------------------------------------------------------------
    const ref = readWav(refPath);
    if (ref.sampleRate !== 48000) throw new Error("referência precisa estar em 48 kHz");
    const wavs = {};
    const save = (name, chunks) => {
      if (!chunks) return undefined;
      const pcm = decodePcmChunks(chunks);
      const p = join(outDir, `${name}.wav`);
      writeWav(p, pcm, 48000);
      wavs[name] = { path: p, seconds: Math.round((pcm.length / 48000) * 10) / 10 };
      return pcm;
    };
    const aLocal = save("A-local-processed", audioA.local);
    const aRaw = save("A-raw-capture", audioA.raw);
    const bFromA = save("B-heard-from-A", audioB.remote[a.localIdentity]);
    const aFromB = opts.bidir ? save("A-heard-from-B", audioA.remote[b.localIdentity]) : undefined;

    const analysis = {};
    if (aLocal) analysis.dspChain = analyzePair(ref.data, aLocal, 48000);
    if (aRaw) analysis.capture = analyzePair(ref.data, aRaw, 48000);
    if (bFromA) analysis.endToEnd = analyzePair(ref.data, bFromA, 48000);
    const bStart0 = audioB.remoteStartedAt?.[a.localIdentity];
    const expected =
      audioA.localStartedAt && bStart0
        ? (bStart0 - audioA.localStartedAt) / 1000 + 0.1
        : undefined;
    if (aLocal && bFromA)
      analysis.transportAndDecoder = analyzePair(aLocal, bFromA, 48000, {
        expectedLagSec: expected,
        maxLagSec: expected === undefined ? 6 : 1.5,
      });
    // Latência boca-ouvido do trecho SFU: as duas páginas rodam na mesma máquina,
    // então o relógio de parede alinha o início das gravações.
    const td = analysis.transportAndDecoder;
    const bStart = audioB.remoteStartedAt?.[a.localIdentity];
    if (td && !td.error && audioA.localStartedAt && bStart) {
      const lag = (td.lagMs ?? 0) - (td.refCutSec ? td.refCutSec * 1000 : 0);
      td.mouthToEarMs = Math.round(lag + (bStart - audioA.localStartedAt));
    }
    if (aFromB) analysis.endToEndReverse = analyzePair(ref.data, aFromB, 48000);

    // --- estatísticas ------------------------------------------------------
    const inFromA = timeline.map((e) => e.B.stats.participants.find((p) => p.identity === a.localIdentity)?.audio);
    const outA = timeline.map((e) => e.A.stats.self.audio);
    const dspA = timeline.map((e) => e.A.dsp);
    const lastA = timeline[timeline.length - 1]?.A;
    const lastB = timeline[timeline.length - 1]?.B;
    const identities = [
      ...new Set(
        timeline.flatMap((e) => e.B.stats.participants.map((p) => p.identity)),
      ),
    ];
    const inboundSummary = (identity) => {
      const rows = timeline.map(
        (e) => e.B.stats.participants.find((p) => p.identity === identity)?.audio,
      );
      return {
        identity,
        speechWindows: rows.filter((x) => (x?.packetsInWindow ?? 0) >= 25).length,
        jitterMs: series(rows.map((x) => x?.jitterMs)),
        lossPct: series(rows.map((x) => x?.lossPct)),
        concealedMsPerSec: series(rows.map((x) => x?.concealedMsPerSec)),
        acceleratedMsPerSec: series(rows.map((x) => x?.acceleratedMsPerSec)),
        jitterBufferMs: series(rows.map((x) => x?.jitterBufferMs)),
        packetsPerSec: series(rows.map((x) => x?.packetsPerSec)),
        bitrateKbps: series(rows.map((x) => x?.bitrateKbps)),
      };
    };
    const stats = {
      windows: timeline.length,
      bHeardOthers: identities
        .filter((id) => id !== a.localIdentity)
        .map(inboundSummary),
      bHeardFromA: {
        speechWindows: inFromA.filter((x) => (x?.packetsInWindow ?? 0) >= 25).length,
        jitterMs: series(inFromA.map((x) => x?.jitterMs)),
        lossPct: series(inFromA.map((x) => x?.lossPct)),
        concealedMsPerSec: series(inFromA.map((x) => x?.concealedMsPerSec)),
        silentConcealedMsPerSec: series(inFromA.map((x) => x?.silentConcealedMsPerSec)),
        concealmentEventsPerSec: series(inFromA.map((x) => x?.concealmentEventsPerSec)),
        acceleratedMsPerSec: series(inFromA.map((x) => x?.acceleratedMsPerSec)),
        deceleratedMsPerSec: series(inFromA.map((x) => x?.deceleratedMsPerSec)),
        jitterBufferMs: series(inFromA.map((x) => x?.jitterBufferMs)),
        jitterBufferTargetMs: series(inFromA.map((x) => x?.jitterBufferTargetMs)),
        packetsPerSec: series(inFromA.map((x) => x?.packetsPerSec)),
        bitrateKbps: series(inFromA.map((x) => x?.bitrateKbps)),
        fecPacketsReceivedPerSec: series(inFromA.map((x) => x?.fecPacketsReceivedPerSec)),
        codec: inFromA.find((x) => x?.codec)?.codec,
      },
      aOutbound: {
        rttMs: series(outA.map((x) => x?.rttMs)),
        lossPct: series(outA.map((x) => x?.lossPct)),
        jitterMs: series(outA.map((x) => x?.jitterMs)),
        bitrateKbps: series(outA.map((x) => x?.bitrateKbps)),
        targetBitrateKbps: series(outA.map((x) => x?.targetBitrateKbps)),
        packetsPerSec: series(outA.map((x) => x?.packetsPerSec)),
        codec: outA.find((x) => x?.codec)?.codec,
      },
      aDsp: {
        engines: [...new Set(dspA.map((d) => d?.engine).filter(Boolean))],
        deepFilterSlowRatio: series(dspA.map((d) => d?.deepFilterSlowRatio)),
        deepFilterMaxFrameMs: series(dspA.map((d) => d?.deepFilterMaxFrameMs)),
        deepFilterOverloaded: dspA.some((d) => d?.deepFilterOverloaded),
        silentMsPerSec: series(dspA.map((d) => d?.silentMsPerSec)),
        longestSilentRunMs: series(dspA.map((d) => d?.longestSilentRunMs)),
        deepFilterAttenDb: series(dspA.map((d) => d?.deepFilterAttenDb)),
        agcGainDb: series(dspA.map((d) => d?.agcGainDb)),
        gateOpenShare: dspA.length ? Math.round((dspA.filter((d) => d?.gateOpen).length / dspA.length) * 100) : undefined,
        vadEngines: [...new Set(dspA.map((d) => d?.vadEngine).filter(Boolean))],
        lastError: dspA.map((d) => d?.lastError).filter(Boolean).slice(-1)[0],
      },
      transport: {
        aPublisher: lastA?.stats.transport?.publisher,
        bSubscriber: lastB?.stats.transport?.subscriber,
        aPublisherRttMs: series(timeline.map((e) => e.A.stats.transport?.publisher?.currentRttMs)),
        aAvailableOutgoingKbps: series(timeline.map((e) => e.A.stats.transport?.publisher?.availableOutgoingKbps)),
        reconnectsA: lastA?.stats.reconnects,
        reconnectsB: lastB?.stats.reconnects,
      },
      sdp: firstSnapshot?.A.sdps,
      iceServers: firstSnapshot?.A.iceServers,
    };

    const report = {
      name: opts.name,
      startedAt: stamp,
      options: { ...opts, out: outDir },
      livekitUrl: tokens.url,
      identities: { A: a.localIdentity, B: b.localIdentity },
      machine: { platform: os.platform(), cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemGb: Math.round(os.totalmem() / 1e9) },
      wavs,
      analysis,
      stats,
      mediaLoad,
      gameLoad,
      runLoad,
    };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(outDir, "timeline.json"), JSON.stringify(timeline));
    writeFileSync(join(outDir, "console-A.log"), A.consoleLines.join("\n"));
    writeFileSync(join(outDir, "console-B.log"), B.consoleLines.join("\n"));
    writeFileSync(join(outDir, "report.md"), renderMarkdown(report));
    console.log("\n" + renderMarkdown(report));
    log(`relatório em ${outDir}`);
  } finally {
    stopCpu();
    await Promise.allSettled([A.browser.close(), B.browser.close()]);
    if (keepAlive) {
      try {
        keepAlive.kill();
      } catch {
        /* já saiu */
      }
    }
  }
}

function fmtSeries(s) {
  if (!s) return "—";
  return `p50 ${s.p50} · p95 ${s.p95} · max ${s.max} (n=${s.n})`;
}

function fmtAnalysis(a) {
  if (!a) return "—";
  if (a.error) return a.error;
  return [
    a.mouthToEarMs !== undefined ? `boca-ouvido ${a.mouthToEarMs} ms` : `atraso rel. ${a.lagMs} ms`,
    `deriva ${a.driftMsPerSec ?? "—"} ms/s`,
    `fala ${a.speechSec}s`,
    `dropouts ${a.dropoutPct ?? "—"}% (${a.dropoutEvents} eventos: ${a.dropoutOnsetEvents ?? "?"} no início da fala, ${a.dropoutMidEvents ?? "?"} no meio; maior ${a.longestDropoutMs} ms)`,
    `nível ${a.levelDiffDbMedian} dB`,
    `SNR seg. p50 ${a.segSnrDb?.p50} dB`,
    `LSD p50 ${a.lsdDb?.p50} dB`,
    `>4 kHz ref ${a.highBandRatioDb?.ref} / rec ${a.highBandRatioDb?.rec} dB`,
  ].join(" · ");
}

function renderMarkdown(r) {
  const s = r.stats;
  const t = s.transport;
  const path = (x) => (x ? `${x.protocol ?? "?"} ${x.localCandidateType ?? "?"}→${x.remoteCandidateType ?? "?"}:${x.remotePort ?? "?"}${x.usesRelay ? " RELAY" : ""}` : "—");
  const codec = (c) => (c ? `${c.mimeType} ${c.channels ?? ""}ch ${c.fmtp ?? ""}` : "—");
  return [
    `# Laboratório de voz — ${r.name}`,
    ``,
    `- Início: ${r.startedAt} · alvo: ${r.options.target} · LiveKit: ${r.livekitUrl} · sala: ${r.options.room}`,
    `- Parâmetros: ns=${r.options.ns} gate=${r.options.gate ? "on" : "off"} sensibilidade=${r.options.sensitivity} vip=${r.options.vip} bidir=${r.options.bidir} netem=${r.options.netem ?? "—"}${r.options.netemAtSec ? ` (aos ${r.options.netemAtSec}s)` : ""} uplink-loss=${r.options.uplinkLoss ?? "—"} cpu-load=${r.options.cpuLoad} media-load=${r.options.mediaLoad ?? "—"} game-load=${r.options.gameLoad ? `on (${r.gameLoad?.fights ?? "?"} lutas, ${r.gameLoad?.fps ?? "?"} fps)` : "—"} run-load=${r.options.runLoad ? `on (${r.runLoad?.runs ?? "?"} corridas, ${r.runLoad?.frames ?? "?"} quadros, atualização máx ${r.runLoad?.updateMsMax ?? "?"} ms)` : "—"}`,
    `- Máquina: ${r.machine.cpuModel} (${r.machine.cpus} núcleos, ${r.machine.totalMemGb} GB) · janelas de 2 s: ${s.windows}`,
    ``,
    `## Caminho`,
    `- A (publicador): ${path(t.aPublisher)} · RTT STUN ${fmtSeries(t.aPublisherRttMs)} ms · BWE ${fmtSeries(t.aAvailableOutgoingKbps)} kbps · reconexões ${t.reconnectsA ?? 0}`,
    `- B (assinante): ${path(t.bSubscriber)} · reconexões ${t.reconnectsB ?? 0}`,
    `- Codec A→SFU: ${codec(s.aOutbound.codec)} · SFU→B: ${codec(s.bHeardFromA.codec)}`,
    `- ICE servers anunciados: ${(r.stats.iceServers ?? []).map((l) => l.join(", ")).filter(Boolean).join(" | ") || "—"}`,
    ``,
    `## Rede (B ouvindo A, janelas com fala: ${s.bHeardFromA.speechWindows})`,
    `| métrica | p50 · p95 · max |`,
    `|---|---|`,
    `| jitter (ms) | ${fmtSeries(s.bHeardFromA.jitterMs)} |`,
    `| perda (%) | ${fmtSeries(s.bHeardFromA.lossPct)} |`,
    `| concealment fala (ms/s) | ${fmtSeries(s.bHeardFromA.concealedMsPerSec)} |`,
    `| concealment silêncio/DTX (ms/s) | ${fmtSeries(s.bHeardFromA.silentConcealedMsPerSec)} |`,
    `| eventos de concealment (/s) | ${fmtSeries(s.bHeardFromA.concealmentEventsPerSec)} |`,
    `| acelerado (ms/s) | ${fmtSeries(s.bHeardFromA.acceleratedMsPerSec)} |`,
    `| desacelerado (ms/s) | ${fmtSeries(s.bHeardFromA.deceleratedMsPerSec)} |`,
    `| jitter buffer (ms) | ${fmtSeries(s.bHeardFromA.jitterBufferMs)} |`,
    `| alvo do jitter buffer (ms) | ${fmtSeries(s.bHeardFromA.jitterBufferTargetMs)} |`,
    `| pacotes/s | ${fmtSeries(s.bHeardFromA.packetsPerSec)} |`,
    `| bitrate recebido (kbps) | ${fmtSeries(s.bHeardFromA.bitrateKbps)} |`,
    `| FEC usado (/s) | ${fmtSeries(s.bHeardFromA.fecPacketsReceivedPerSec)} |`,
    ``,
    ...(s.bHeardOthers?.length
      ? [
          `## Rede (B ouvindo outros publicadores)`,
          `| identidade | janelas c/ fala | jitter | perda % | conceal ms/s | accel ms/s | buffer ms | kbps |`,
          `|---|---|---|---|---|---|---|---|`,
          ...s.bHeardOthers.map(
            (o) =>
              `| ${o.identity} | ${o.speechWindows} | ${o.jitterMs?.p50 ?? "—"}/${o.jitterMs?.p95 ?? "—"} | ${o.lossPct?.p50 ?? "—"}/${o.lossPct?.p95 ?? "—"} | ${o.concealedMsPerSec?.p50 ?? "—"}/${o.concealedMsPerSec?.p95 ?? "—"} | ${o.acceleratedMsPerSec?.p50 ?? "—"}/${o.acceleratedMsPerSec?.p95 ?? "—"} | ${o.jitterBufferMs?.p50 ?? "—"} | ${o.bitrateKbps?.p50 ?? "—"} |`,
          ),
          ``,
        ]
      : []),
    `## Subida de A (o que o SFU reporta)`,
    `- RTT ${fmtSeries(s.aOutbound.rttMs)} ms · perda ${fmtSeries(s.aOutbound.lossPct)} % · jitter ${fmtSeries(s.aOutbound.jitterMs)} ms`,
    `- bitrate ${fmtSeries(s.aOutbound.bitrateKbps)} kbps · alvo ${fmtSeries(s.aOutbound.targetBitrateKbps)} kbps · pacotes/s ${fmtSeries(s.aOutbound.packetsPerSec)}`,
    ``,
    `## DSP de A (cadeia do microfone)`,
    `- motores: ${s.aDsp.engines.join(", ") || "—"} · VAD: ${s.aDsp.vadEngines.join(", ") || "—"} · portão aberto em ${s.aDsp.gateOpenShare ?? "—"}% das janelas · DeepFilter sobrecarregado: ${s.aDsp.deepFilterOverloaded}`,
    `- quadros lentos (razão) ${fmtSeries(s.aDsp.deepFilterSlowRatio)} · quadro mais lento ${fmtSeries(s.aDsp.deepFilterMaxFrameMs)} ms · atenuação ${fmtSeries(s.aDsp.deepFilterAttenDb)} dB`,
    `- pré-ganho ${fmtSeries(s.aDsp.agcGainDb)} dB`,
    `- silêncio emitido ${fmtSeries(s.aDsp.silentMsPerSec)} ms/s · maior corrida de silêncio ${fmtSeries(s.aDsp.longestSilentRunMs)} ms${s.aDsp.lastError ? ` · erro: ${s.aDsp.lastError}` : ""}`,
    ``,
    `## Áudio (referência → gravação)`,
    `- captura (fake mic → APM do navegador): ${fmtAnalysis(r.analysis.capture)}`,
    `- cadeia DSP (referência → saída do VoiceProcessor em A): ${fmtAnalysis(r.analysis.dspChain)}`,
    `- transporte + decoder (saída de A → o que B ouviu): ${fmtAnalysis(r.analysis.transportAndDecoder)}`,
    `- fim a fim (referência → o que B ouviu): ${fmtAnalysis(r.analysis.endToEnd)}`,
    r.analysis.endToEndReverse ? `- fim a fim reverso (referência → o que A ouviu de B): ${fmtAnalysis(r.analysis.endToEndReverse)}` : "",
    ``,
    `## SDP (seção de áudio)`,
    "```",
    ...(s.sdp ?? []).slice(0, 4).map((x) => `--- ${x.side} ${x.type}\n${x.audio}`),
    "```",
    ``,
    `Arquivos: ${Object.entries(r.wavs).map(([k, v]) => `${k}.wav (${v.seconds}s)`).join(", ")}`,
  ].join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
