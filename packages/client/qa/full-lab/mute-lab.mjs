#!/usr/bin/env node
/* global console, process, setTimeout */
/**
 * Mute e desmute no app de verdade (laboratório completo): a Ana e a Bia na mesma
 * sala do Espaço, as duas "falando" sem parar (o microfone falso toca a referência
 * PT-BR do laboratório de voz). A Ana usa os atalhos do mapa como uma pessoa:
 * M (microfone) e Shift+D (áudio: microfone e som). A cada ~150 ms as duas telas
 * são lidas:
 *
 * - o anel verde do mapa (quem fala, `__spaceView.world.speakers`) e o selo de
 *   mutado (`world.voiceOf(id).mic/deaf`), na tela de cada uma;
 * - o botão de microfone e de áudio da própria Ana (o que ela vê);
 * - o que chega na Bia da Ana (pacotes por segundo e energia do áudio, getStats
 *   do RTCPeerConnection) e o que a Ana envia;
 * - se a Ana ainda toca o áudio da Bia (elemento <audio> sem `muted`).
 *
 * Responde: depois de mutar, quanto tempo a Ana ainda aparece "falando" (para ela e
 * para a Bia), se a Bia para de ouvir de fato, se o desmute volta, e se o estado
 * do microfone sobrevive a mutar o áudio e desmutar.
 *
 * Uso (cwd packages/client, com o laboratório e o build no ar):
 *   FULL_LAB_DIR=<pasta do lab> node qa/full-lab/mute-lab.mjs --run nome [--room "Sala de estar"]
 * Saída: qa/full-lab/out/mute/<rodada>/{timeline.json,report.md} e capturas.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

import { openPerson } from "./person.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const BASE = opt("base", "http://localhost:5173");
const LAB = process.env.FULL_LAB_DIR ?? resolve("../space-server/lab/full");
const STATE = JSON.parse(readFileSync(join(LAB, "state.local.json"), "utf8"));
const RUN = opt("run", new Date().toISOString().replace(/[:.]/g, "-"));
const ROOM = opt("room", "Sala de estar");
const HOLD = Number(opt("hold", "7000"));
const OUT = join(resolve("qa/full-lab/out/mute"), RUN);
mkdirSync(OUT, { recursive: true });
const SPACE = `/server/${STATE.serverId}/space`;
const WAV = resolve(opt("wav", "qa/voice-lab/fixtures/ref-ptbr-48k.wav"));

// Guarda cada RTCPeerConnection da página, para ler o getStats de fora.
const PC_HOOK = `(() => {
  const Native = globalThis.RTCPeerConnection;
  if (!Native || Native.__muteLab) return;
  const pcs = [];
  globalThis.__pcs = pcs;
  class Hooked extends Native {
    constructor(...a) { super(...a); pcs.push(this); }
  }
  Hooked.__muteLab = true;
  globalThis.RTCPeerConnection = Hooked;
  // Toda faixa de áudio que a página abre (captura e clones): ao sair da
  // chamada nenhuma pode ficar viva segurando o microfone.
  const tracks = [];
  globalThis.__audioTracks = tracks;
  const md = globalThis.navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const st = await gum(c);
    for (const t of st.getAudioTracks()) tracks.push(t);
    return st;
  };
  const clone = globalThis.MediaStreamTrack.prototype.clone;
  globalThis.MediaStreamTrack.prototype.clone = function () {
    const t = clone.call(this);
    if (t.kind === "audio") tracks.push(t);
    return t;
  };
})();`;
const hookFile = join(OUT, "pc-hook.js");
writeFileSync(hookFile, PC_HOOK);

const browser = await chromium.launch({
  headless: !args.includes("--headed"),
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}`,
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});

async function gotoSpace(page) {
  await page.goto(BASE + SPACE, { waitUntil: "domcontentloaded" });
  await page
    .locator('[role="application"] canvas')
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2_500);
}

async function dismissAudio(page) {
  const done = page
    .getByRole("button", { name: "Pronto", exact: true })
    .first();
  if (!(await done.isVisible().catch(() => false))) return;
  await done.click();
  await page.waitForTimeout(1_000);
}

async function location(page) {
  return (
    await page
      .locator("strong")
      .first()
      .innerText()
      .catch(() => "")
  ).trim();
}

async function enterRoom(page, title) {
  if ((await location(page)) !== title) {
    const go = page.getByLabel(`Ir para ${title}`, { exact: true }).first();
    if (!(await go.isVisible().catch(() => false))) {
      const show = page
        .getByLabel("Mostrar lista de salas", { exact: true })
        .first();
      if (await show.isVisible().catch(() => false)) await show.click();
    }
    await go.click();
    const until = Date.now() + 25_000;
    while ((await location(page)) !== title) {
      if (Date.now() > until)
        throw new Error(`não chegou em ${title} ("${await location(page)}")`);
      await page.waitForTimeout(500);
    }
  }
  await page
    .getByText("Áudio da sala conectado")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => console.log("AVISO: o áudio da sala não confirmou"));
  await page.waitForTimeout(1_500);
}

/** Uma leitura da tela e do WebRTC de uma pessoa. */
function probe(page, selfId, otherId) {
  return page.evaluate(
    async ([me, other]) => {
      const v = globalThis.__spaceView;
      const w = v?.world;
      const vs = (id) => {
        const x = w?.voiceOf(id);
        return x ? { c: !!x.connected, mic: !!x.mic, deaf: !!x.deaf } : null;
      };
      const label = (l) =>
        !!globalThis.document.querySelector(`[aria-label="${l}"]`);
      const stats = {
        inPkts: 0,
        inEnergy: 0,
        inDur: 0,
        outPkts: 0,
        srcLevel: null,
      };
      for (const pc of globalThis.__pcs ?? []) {
        if (pc.connectionState === "closed") continue;
        const r = await pc.getStats();
        r.forEach((s) => {
          if (s.type === "inbound-rtp" && s.kind === "audio") {
            stats.inPkts += s.packetsReceived ?? 0;
            stats.inEnergy += s.totalAudioEnergy ?? 0;
            stats.inDur += s.totalSamplesDuration ?? 0;
          } else if (s.type === "outbound-rtp" && s.kind === "audio") {
            stats.outPkts += s.packetsSent ?? 0;
          } else if (s.type === "media-source" && s.kind === "audio") {
            stats.srcLevel = s.audioLevel ?? null;
          }
        });
      }
      // RMS de verdade (~43 ms) do que sai e do que chega: o audioLevel e o
      // totalAudioEnergy do getStats são um pico que cai ÷4 a cada ~110 ms e
      // inventam uma "cauda" de quase 1 s depois do mute.
      const lab = (globalThis.__muteLabAudio ??= {
        ctx: new globalThis.AudioContext(),
        taps: new Map(),
      });
      if (lab.ctx.state !== "running") await lab.ctx.resume().catch(() => {});
      const rmsOf = (track) => {
        let tap = lab.taps.get(track.id);
        if (!tap) {
          const src = lab.ctx.createMediaStreamSource(
            new globalThis.MediaStream([track]),
          );
          const an = lab.ctx.createAnalyser();
          an.fftSize = 2048;
          src.connect(an);
          tap = { an, buf: new Float32Array(an.fftSize) };
          lab.taps.set(track.id, tap);
        }
        tap.an.getFloatTimeDomainData(tap.buf);
        let sum = 0;
        for (const x of tap.buf) sum += x * x;
        const rms = Math.sqrt(sum / tap.buf.length);
        return rms > 0 ? Math.round(20 * Math.log10(rms)) : -120;
      };
      let sendDb = -120;
      let recvDb = -120;
      for (const pc of globalThis.__pcs ?? []) {
        if (pc.connectionState === "closed") continue;
        for (const s of pc.getSenders())
          if (s.track?.kind === "audio" && s.track.readyState === "live")
            sendDb = Math.max(sendDb, rmsOf(s.track));
        for (const r of pc.getReceivers())
          if (r.track?.kind === "audio" && r.track.readyState === "live")
            recvDb = Math.max(recvDb, rmsOf(r.track));
      }
      const audios = [...globalThis.document.querySelectorAll("audio")];
      // O balão "Você está mutado" (fala com o microfone fechado).
      const hint = [
        ...globalThis.document.querySelectorAll('[role="status"]'),
      ].some((e) => e.textContent?.includes("Você está mutado"));
      return {
        hint,
        sendDb,
        recvDb,
        t: Date.now(),
        ringSelf: w?.speakers.has(me) ?? null,
        ringOther: w?.speakers.has(other) ?? null,
        self: vs(me),
        other: vs(other),
        // Os botões do card/dock: o rótulo diz a ação (Silenciar = está aberto).
        btnMicOpen: label("Silenciar")
          ? true
          : label("Desmutar")
            ? false
            : null,
        btnDeaf: label("Reativar Áudio")
          ? true
          : label("Ensurdecer")
            ? false
            : null,
        playing: audios.filter((a) => !a.muted && !a.paused && a.volume > 0)
          .length,
        audios: audios.length,
        ...stats,
      };
    },
    [selfId, otherId],
  );
}

const ana = await openPerson(browser, {
  name: "ana",
  user: STATE.users.ana,
  base: BASE,
  out: OUT,
  initScript: hookFile,
});
const bia = await openPerson(browser, {
  name: "bia",
  user: STATE.users.bia,
  base: BASE,
  out: OUT,
  initScript: hookFile,
});
const ANA = STATE.users.ana.id;
const BIA = STATE.users.bia.id;

for (const p of [ana, bia]) {
  await gotoSpace(p.page);
  await dismissAudio(p.page);
  await enterRoom(p.page, ROOM);
}
console.log(`ana e bia em ${ROOM}`);

let hintShot = false;
class QuickDone extends Error {}

/** Lê as duas telas durante `ms` e devolve as amostras com taxas por segundo. */
async function watch(ms) {
  const samples = [];
  const until = Date.now() + ms;
  let prevA;
  let prevB;
  while (Date.now() < until) {
    const [a, b] = await Promise.all([
      probe(ana.page, ANA, BIA),
      probe(bia.page, BIA, ANA),
    ]);
    if (prevA && prevB) {
      const dt = (b.t - prevB.t) / 1000;
      const dE = b.inEnergy - prevB.inEnergy;
      const dD = b.inDur - prevB.inDur;
      samples.push({
        t: a.t,
        ana: a,
        bia: b,
        // O que a Bia recebe da Ana: pacotes/s e potência média (dBFS).
        biaInPps: Math.round((b.inPkts - prevB.inPkts) / dt),
        biaInDb: dD > 0 && dE > 0 ? Math.round(10 * Math.log10(dE / dD)) : -120,
        anaOutPps: Math.round((a.outPkts - prevA.outPkts) / dt),
      });
    }
    if (a.hint && !hintShot) {
      hintShot = true;
      await ana.page.waitForTimeout(350); // a animação de entrada do balão
      await ana.page.screenshot({ path: join(OUT, "balao-voce-esta-mutado.png") });
    }
    prevA = a;
    prevB = b;
    await new Promise((r) => setTimeout(r, 120));
  }
  return samples;
}

const timeline = [];
const focusMap = (page) => page.locator('[role="application"]').first().focus();

/** Uma ação da Ana e o que as telas mostram depois. */
async function step(name, action) {
  await focusMap(ana.page);
  const t0 = Date.now();
  if (action) await action();
  const samples = await watch(HOLD);
  timeline.push({ name, t0, samples });
  await ana.page.screenshot({
    path: join(OUT, `${timeline.length}-ana-${name}.png`),
  });
  await bia.page.screenshot({
    path: join(OUT, `${timeline.length}-bia-${name}.png`),
  });
  console.log(`${name}: ${summarize({ name, t0, samples }).line}`);
}

const key = (k) => () => ana.page.keyboard.press(k);

/** Fração das amostras em [a, b) ms depois da ação em que `f` vale. */
function frac(s, t0, a, b, f) {
  const w = s.filter((x) => x.t - t0 >= a && x.t - t0 < b);
  if (!w.length) return null;
  return Math.round((100 * w.filter(f).length) / w.length);
}
/** Primeiro instante (ms) a partir do qual `f` vale em todas as amostras seguintes. */
function settle(s, t0, f) {
  for (let i = 0; i < s.length; i++)
    if (s.slice(i).every(f)) return s[i].t - t0;
  return null;
}
const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

function summarize({ name, t0, samples: s, live }) {
  if (live)
    return {
      name,
      live,
      line: `faixas de áudio vivas depois de sair: ${live.filter((x) => x === "live").length} de ${live.length}`,
    };
  const late = s.filter((x) => x.t - t0 >= 3000);
  const r = {
    name,
    // O que a Ana vê de si: botão, selo e anel.
    anaBtnMic: s.at(-1)?.ana.btnMicOpen,
    anaBtnDeaf: s.at(-1)?.ana.btnDeaf,
    anaRingSelf_0_1s: frac(s, t0, 0, 1000, (x) => x.ana.ringSelf),
    anaRingSelf_1_3s: frac(s, t0, 1000, 3000, (x) => x.ana.ringSelf),
    anaRingSelf_3s: frac(s, t0, 3000, 1e9, (x) => x.ana.ringSelf),
    // O que a Bia vê da Ana.
    biaSeesAnaMic: s.at(-1)?.bia.other?.mic,
    biaSeesAnaDeaf: s.at(-1)?.bia.other?.deaf,
    biaRingAna_0_1s: frac(s, t0, 0, 1000, (x) => x.bia.ringOther),
    biaRingAna_1_3s: frac(s, t0, 1000, 3000, (x) => x.bia.ringOther),
    biaRingAna_3s: frac(s, t0, 3000, 1e9, (x) => x.bia.ringOther),
    // Selo e anel ao mesmo tempo (o "mutado mas falando").
    biaMutedAndRing: frac(
      s,
      t0,
      0,
      1e9,
      (x) => x.bia.other?.mic === false && x.bia.ringOther,
    ),
    anaMutedAndRing: frac(
      s,
      t0,
      0,
      1e9,
      (x) => x.ana.btnMicOpen === false && x.ana.ringSelf,
    ),
    // O áudio de fato.
    biaInPps: median(late.map((x) => x.biaInPps)),
    biaInDb: median(late.map((x) => x.biaInDb)),
    // RMS real: o que sai da Ana e o que chega na Bia (3 s+ depois da ação).
    anaSendDb: median(late.map((x) => x.ana.sendDb)),
    biaRecvDb: median(late.map((x) => x.bia.recvDb)),
    // Primeiro instante em que o que sai da Ana / chega na Bia fica abaixo de -60 dBFS de vez.
    sendSilentMs: settle(s, t0, (x) => x.ana.sendDb <= -60),
    recvSilentMs: settle(s, t0, (x) => x.bia.recvDb <= -60),
    anaOutPps: median(late.map((x) => x.anaOutPps)),
    anaPlaying: s.at(-1)?.ana.playing,
    anaAudios: s.at(-1)?.ana.audios,
    // Quando o balão "Você está mutado" apareceu (ms depois da ação) e por quanto tempo.
    hintAtMs: (() => {
      const h = s.find((x) => x.ana.hint);
      return h ? h.t - t0 : null;
    })(),
    hintSamples: s.filter((x) => x.ana.hint).length,
    ringOffMs_ana: settle(s, t0, (x) => !x.ana.ringSelf),
    ringOffMs_bia: settle(s, t0, (x) => !x.bia.ringOther),
    silentMs_bia: settle(s, t0, (x) => x.biaInDb <= -70),
  };
  r.line =
    `btn mic=${r.anaBtnMic} deaf=${r.anaBtnDeaf} | ` +
    `anel Ana(si) ${r.anaRingSelf_0_1s}/${r.anaRingSelf_1_3s}/${r.anaRingSelf_3s}% | ` +
    `Bia vê mic=${r.biaSeesAnaMic} deaf=${r.biaSeesAnaDeaf} anel ${r.biaRingAna_0_1s}/${r.biaRingAna_1_3s}/${r.biaRingAna_3s}% | ` +
    `mutado+anel Bia ${r.biaMutedAndRing}% Ana ${r.anaMutedAndRing}% | ` +
    `Bia recebe ${r.biaInPps} pkt/s, RMS ${r.biaRecvDb} dBFS (cala em ${r.recvSilentMs} ms) | ` +
    `Ana envia ${r.anaOutPps} pkt/s, RMS ${r.anaSendDb} dBFS (cala em ${r.sendSilentMs} ms) | ` +
    `Ana toca ${r.anaPlaying}/${r.anaAudios} | anel some Ana ${r.ringOffMs_ana} ms Bia ${r.ringOffMs_bia} ms | balão mutado em ${r.hintAtMs} ms (${r.hintSamples} amostras)`;
  return r;
}

try {
  await step("aberto", null);
  await step("muta-mic", key("KeyM"));
  await step("desmuta-mic", key("KeyM"));
  // --quick: só abrir, mutar e desmutar (o balão e o anel).
  if (args.includes("--quick")) throw new QuickDone();
  await step("muta-audio", key("Shift+KeyD"));
  await step("desmuta-audio", key("Shift+KeyD"));
  // O microfone fechado tem de sobreviver a mutar e desmutar o áudio.
  await step("muta-mic-2", key("KeyM"));
  await step("muta-audio-com-mic-fechado", key("Shift+KeyD"));
  await step("desmuta-audio-mic-segue-fechado", key("Shift+KeyD"));
  await step("desmuta-mic-2", key("KeyM"));
  // Como no Discord: M com o áudio mutado abre o microfone e o som.
  await step("muta-audio-2", key("Shift+KeyD"));
  await step("m-com-audio-mutado", key("KeyM"));
  // Troca de sala com o microfone fechado (o mic fica estacionado entre as
  // salas): a Bia não pode ouvir nada na volta, e o desmute tem de funcionar.
  await step("muta-mic-3", key("KeyM"));
  await step("troca-de-sala-mutada", async () => {
    await enterRoom(ana.page, opt("room2", "Cinema"));
    await enterRoom(ana.page, ROOM);
  });
  await step("desmuta-depois-da-troca", key("KeyM"));
  // Sair da chamada solta o microfone: nenhuma faixa de áudio viva (a
  // captura nem o clone da sonda do "Você está mutado").
  const hang = ana.page.getByLabel("Encerrar ligação").first();
  await hang.click({ timeout: 10_000 });
  await ana.page.waitForTimeout(3_000);
  const live = await ana.page.evaluate(() =>
    (globalThis.__audioTracks ?? []).map((t) => t.readyState),
  );
  const alive = live.filter((x) => x === "live").length;
  console.log(
    `saiu da chamada: ${live.length} faixas de áudio abertas na sessão, ${alive} ainda vivas`,
  );
  timeline.push({ name: "saiu-da-chamada", t0: Date.now(), samples: [], live });
} catch (e) {
  if (!(e instanceof QuickDone)) throw e;
} finally {
  const rows = timeline.map(summarize);
  writeFileSync(join(OUT, "timeline.json"), JSON.stringify(timeline, null, 1));
  writeFileSync(
    join(OUT, "report.md"),
    `# Mute no laboratório (${RUN})\n\nSala ${ROOM}; ${HOLD} ms por passo; amostra a cada ~150 ms.\n` +
      `Anel = % das amostras com o anel verde em 0–1 s / 1–3 s / 3 s+ depois da ação.\n\n` +
      rows.map((r) => `- **${r.name}**: ${r.line}`).join("\n") +
      "\n\n```json\n" +
      JSON.stringify(rows, null, 1) +
      "\n```\n",
  );
  const logs = { ana: ana.logs?.slice(-40), bia: bia.logs?.slice(-40) };
  writeFileSync(join(OUT, "console.json"), JSON.stringify(logs, null, 1));
  console.log(`relatório em ${OUT}`);
  await browser.close();
}
