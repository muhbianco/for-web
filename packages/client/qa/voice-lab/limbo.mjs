/* global console, process, window, performance, setTimeout, Event */
// Reproduz o "limbo" do desmute (docs/voz/10 do muchat) no laboratório de voz.
// Pré-requisitos: lab/up.sh no WSL e o vite dev do client. De packages/client:
//   node qa/voice-lab/limbo.mjs http://127.0.0.1:5173/qa/voice-lab/index.html [--control] [--fix resume|restart] [--swap N]
// A publica a referência com a cadeia real (roomOptions + VoiceProcessor), B assina.
// Fases: base → usuário muta → sistema dispara `mute` na faixa crua (AFK) → usuário desmuta
// → candidata de correção (resumeUpstream). Mede em B: pacotes e energia recebidos de A,
// e como B vê a publicação de A (muted). --swap N troca o processador N vezes no meio
// da chamada (corrida do dfContextPool). --move N troca de "sala" N vezes (sai e entra
// de novo na room) estacionando o microfone (M1) e, para comparar, recriando faixa e
// processador como antes; mede o buraco de áudio em B e se a cadeia continuou quente.
// LAB_ENV=<caminho do lab/.env> usa as chaves de outro checkout (worktree não tem .env).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { mintToken } from './lib/token.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const pageUrl = args[0];
const control = args.includes('--control');
const fix = args.includes('--fix') ? args[args.indexOf('--fix') + 1] : 'resume';
const REF = join(HERE, 'fixtures', 'ref-ptbr-48k.wav');

const envPath = process.env.LAB_ENV ?? join(HERE, 'lab', '.env');
if (!existsSync(envPath)) throw new Error('lab/.env ausente');
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const room = `limbo_${Date.now()}`;
const mint = (identity) => mintToken({ apiKey: env.LAB_API_KEY, apiSecret: env.LAB_API_SECRET, identity, room, ttlSeconds: 900 });

const keep = spawn('wsl', ['-e', 'sleep', '600'], { detached: true, stdio: 'ignore' });
keep.unref();

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

async function launch(label) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${REF}`, '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => log(label, 'pageerror', e.message));
  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__lab, null, { timeout: 60000 });
  for (let i = 0; i < 5; i++) {
    const a = await page.evaluate(() => performance.timeOrigin);
    await page.waitForTimeout(4000);
    await page.waitForFunction(() => !!window.__lab, null, { timeout: 60000 });
    if (a === (await page.evaluate(() => performance.timeOrigin))) break;
    log(label, 'página recarregada pelo vite; aguardando');
  }
  return { browser, page };
}

const connectOpts = (token, publish) => ({ url: env.LAB_URL, token, publish, ns: 'advanced', gate: true, sensitivity: 'auto', vip: false, recordSeconds: 5, recordRaw: false });

// What B receives from A, accumulated counters.
const bCounters = (page) => page.evaluate(async () => {
  const lab = window.__lab;
  let packets = 0, energy = 0, muted = null, subscribed = false;
  for (const p of lab.room.remoteParticipants.values()) {
    for (const pub of p.audioTrackPublications.values()) {
      muted = pub.isMuted; subscribed = pub.isSubscribed;
      const rep = await pub.track?.getRTCStatsReport?.();
      rep?.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') { packets += s.packetsReceived ?? 0; energy += s.totalAudioEnergy ?? 0; } });
    }
  }
  return { packets, energy, muted, subscribed };
});
const aState = (page) => page.evaluate(() => {
  const t = window.__lab.micTrack;
  const raw = t?._mediaStreamTrack;
  return { isMuted: t?.isMuted, upstreamPaused: t?.isUpstreamPaused, rawState: raw?.readyState, rawEnabled: raw?.enabled, rawMuted: raw?.muted, micEnabled: window.__lab.room.localParticipant.isMicrophoneEnabled };
});

async function measure(B, A, label, secs = 3) {
  const c1 = await bCounters(B.page);
  await B.page.waitForTimeout(secs * 1000);
  const c2 = await bCounters(B.page);
  const a = await aState(A.page);
  const pps = (c2.packets - c1.packets) / secs;
  const energyRate = (c2.energy - c1.energy) / secs;
  log(`${label.padEnd(44)} B recebe ${pps.toFixed(1).padStart(5)} pkt/s, energia ${energyRate.toExponential(2)}/s, B vê A muted=${c2.muted} | A: mudo=${a.isMuted} upstreamPausado=${a.upstreamPaused} faixaCrua=${a.rawState}/enabled=${a.rawEnabled}`);
  return { pps, energyRate, bSeesMuted: c2.muted, ...a };
}

const A = await launch('A');
const B = await launch('B');
log('sala', room, control ? '(controle: sem evento mute do sistema)' : '(com evento mute do sistema)');
await B.page.evaluate((o) => window.__lab.connect(o), connectOpts(mint('qa-sub'), false));
await A.page.evaluate((o) => window.__lab.connect(o), connectOpts(mint('qa-pub'), true));
await B.page.waitForTimeout(5000);
// B subscribes to tracks published after it joined.
await B.page.evaluate(() => { for (const p of window.__lab.room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) if (pub.kind === 'audio') pub.setSubscribed(true); });
await B.page.waitForTimeout(3000);

const results = {};
results.base = await measure(B, A, '1. base (falando)');

if (args.includes('--move')) {
  // What B hears from A while A goes to another room and back, in ms since A
  // started leaving: B keeps subscribing whatever A publishes.
  const watchB = (ms) => B.page.evaluate(async (ms) => {
    const lab = window.__lab;
    const t0 = performance.now();
    let base;
    let firstAt;
    const sample = async () => {
      let packets = 0;
      for (const p of lab.room.remoteParticipants.values()) {
        for (const pub of p.audioTrackPublications.values()) {
          if (!pub.isSubscribed) pub.setSubscribed(true);
          const rep = await pub.track?.getRTCStatsReport?.();
          rep?.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') packets += s.packetsReceived ?? 0; });
        }
      }
      return packets;
    };
    let last = await sample();
    let lastChangeAt = 0;
    let gapStart;
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 50));
      const now = await sample();
      const t = performance.now() - t0;
      if (now !== last) {
        if (gapStart !== undefined && firstAt === undefined && t - gapStart > 0) firstAt = t;
        lastChangeAt = t;
      } else if (gapStart === undefined && t - lastChangeAt > 200) {
        gapStart = lastChangeAt;
      }
      last = now;
      base ??= now;
    }
    return { gapStart, firstAt, gapMs: gapStart !== undefined && firstAt !== undefined ? Math.round(firstAt - gapStart) : undefined };
  }, ms);

  const modes = [];
  for (let i = 0; i < Number(args[args.indexOf('--move') + 1] || 2); i++) modes.push('park', 'rebuild');
  for (const [i, mode] of modes.entries()) {
    const token = mint('qa-pub');
    const watching = watchB(9000);
    await A.page.waitForTimeout(300);
    const before = await A.page.evaluate(() => window.__lab.processor?.getSnapshot());
    const t = Date.now();
    if (mode === 'park') {
      await A.page.evaluate(async ({ url, token }) => {
        const lab = window.__lab;
        const track = lab.micTrack;
        const old = lab.room;
        void old.localParticipant.unpublishTrack(track, false).catch(() => undefined);
        await old.disconnect(true);
        const room2 = new old.constructor(old.options);
        await room2.connect(url, token, { autoSubscribe: false });
        await room2.localParticipant.publishTrack(track, { source: 'microphone' });
        lab.room = room2;
      }, { url: env.LAB_URL, token });
    } else {
      await A.page.evaluate(() => window.__lab.stop());
      await A.page.evaluate((o) => window.__lab.connect(o), connectOpts(token, true));
    }
    const ms = Date.now() - t;
    const gap = await watching;
    const after = await A.page.evaluate(() => window.__lab.processor?.getSnapshot());
    const res = {
      mode, switchMs: ms, gapMs: gap.gapMs,
      engine: after?.engine, contextState: after?.contextState,
      gainBefore: before?.agcGainDb, gainAfter: after?.agcGainDb,
    };
    results[`move${i + 1}`] = res;
    log(`move ${i + 1} ${mode.padEnd(7)} troca ${String(ms).padStart(5)} ms, buraco em B ${String(gap.gapMs ?? '?').padStart(5)} ms, motor ${after?.engine} ctx ${after?.contextState}, ganho ${before?.agcGainDb?.toFixed?.(1)}→${after?.agcGainDb?.toFixed?.(1)} dB`);
    await B.page.waitForTimeout(3000);
  }
  console.log('RESULT ' + JSON.stringify({ move: true, results }));
  await A.browser.close(); await B.browser.close();
  process.exit(0);
}

if (args.includes('--swap')) {
  // Same as Voice.applyCaptureConstraints → ensureVoiceProcessor(pub, true): stop the
  // processor (destroy → pool release → suspend() not awaited) and attach a new one.
  for (let i = 1; i <= Number(args[args.indexOf('--swap') + 1] || 5); i++) {
    const st = await A.page.evaluate(async () => {
      const lab = window.__lab;
      const P = lab.processor.constructor;
      const settings = lab.processor.settings;
      await lab.micTrack.stopProcessor();
      const np = new P(settings, () => undefined);
      await lab.micTrack.setProcessor(np);
      lab.processor = np;
      const right = np.dfContext?.state;
      await new Promise((r) => setTimeout(r, 1000));
      return { right, after1s: np.dfContext?.state, engine: np.getSnapshot().engine };
    });
    const m = await measure(B, A, `swap ${i}: ctx ${st.right}→${st.after1s} engine=${st.engine}`);
    results[`swap${i}`] = { ...st, pps: m.pps, energyRate: m.energyRate };
  }
  console.log('RESULT ' + JSON.stringify({ swap: true, results }));
  await A.browser.close(); await B.browser.close();
  process.exit(0);
}
await A.page.evaluate(() => window.__lab.room.localParticipant.setMicrophoneEnabled(false));
results.muted = await measure(B, A, '2. usuário mutou');
if (!control) {
  await A.page.evaluate(() => window.__lab.micTrack._mediaStreamTrack.dispatchEvent(new Event('mute')));
  log('   evento `mute` disparado na faixa crua (sistema parou de entregar áudio); aguardando 6 s');
  await A.page.waitForTimeout(6000);
}
results.afk = await measure(B, A, control ? '3. ainda mutado' : '3. AFK: mutado + sistema silenciou o mic');
await A.page.evaluate(() => window.__lab.room.localParticipant.setMicrophoneEnabled(true));
results.unmuted = await measure(B, A, '4. usuário desmutou (botão)');
results.unmuted2 = await measure(B, A, '4b. ... 3 s depois');
if (!control) {
  if (fix === 'restart') await A.page.evaluate(() => window.__lab.micTrack.restartTrack());
  else await A.page.evaluate(() => window.__lab.micTrack.resumeUpstream());
  results.fixed = await measure(B, A, `5. candidata: ${fix === 'restart' ? 'restartTrack()' : 'resumeUpstream()'} após o desmute`);
}
console.log('RESULT ' + JSON.stringify({ control, fix, results }));
await A.page.evaluate(() => window.__lab.stop()).catch(() => {});
await B.page.evaluate(() => window.__lab.stop()).catch(() => {});
await A.browser.close();
await B.browser.close();
