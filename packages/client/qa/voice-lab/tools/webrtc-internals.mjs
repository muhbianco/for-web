/* global console, process */
// Lê um dump do chrome://webrtc-internals (botão "Create a WebRTC-Internals dump")
// e imprime, para cada PeerConnection, as mesmas métricas por janela que o
// laboratório coleta: jitter, perda, concealment, accelerate, jitter buffer,
// pacotes/s, bitrate, RTT e codec. Serve para comparar o Discord (ou qualquer
// app WebRTC no Chrome/Electron) com o Muchat na mesma máquina, mesma rede e
// mesma pessoa falando — ver docs/voz/06-discord.md.
//
//   node qa/voice-lab/tools/webrtc-internals.mjs dump.json
//
// Formato do dump: PeerConnections[id].stats["<statId>-<campo>"] = { startTime,
// endTime, values: "[v0, v1, …]" } com uma amostra por segundo.
import { readFileSync } from "node:fs";

import { series } from "../lib/analyze.mjs";

const path = process.argv[2];
if (!path) {
  console.error("uso: node webrtc-internals.mjs <dump.json>");
  process.exit(2);
}
const dump = JSON.parse(readFileSync(path, "utf8"));
const pcs = dump.PeerConnections ?? {};

function seriesOf(stats, id, field) {
  const entry = stats[`${id}-${field}`];
  if (!entry) return undefined;
  try {
    const values = JSON.parse(entry.values);
    return Array.isArray(values) ? values : undefined;
  } catch {
    return undefined;
  }
}

function rates(values, elapsedSec = 1) {
  if (!values) return undefined;
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const a = Number(values[i - 1]);
    const b = Number(values[i]);
    if (Number.isFinite(a) && Number.isFinite(b)) out.push((b - a) / elapsedSec);
  }
  return out;
}

function idsOfType(stats, type) {
  const ids = new Set();
  for (const key of Object.keys(stats)) {
    if (key.endsWith("-type") && stats[key].values.includes(`"${type}"`)) {
      ids.add(key.slice(0, -"-type".length));
    }
  }
  return [...ids];
}

function lastValue(stats, id, field) {
  const v = seriesOf(stats, id, field);
  return v?.[v.length - 1];
}

for (const [pcId, pc] of Object.entries(pcs)) {
  const stats = pc.stats ?? {};
  console.log(`\n=== PeerConnection ${pcId} (${pc.url ?? ""})`);
  for (const id of idsOfType(stats, "inbound-rtp")) {
    if (lastValue(stats, id, "kind") !== "audio") continue;
    const recv = rates(seriesOf(stats, id, "packetsReceived"));
    const lost = rates(seriesOf(stats, id, "packetsLost"));
    const loss = recv?.map((r, i) => (r + (lost?.[i] ?? 0) >= 20 ? (100 * (lost?.[i] ?? 0)) / (r + (lost?.[i] ?? 0)) : undefined));
    const concealed = rates(seriesOf(stats, id, "concealedSamples"));
    const silent = rates(seriesOf(stats, id, "silentConcealedSamples"));
    const accel = rates(seriesOf(stats, id, "removedSamplesForAcceleration"));
    const jbDelay = rates(seriesOf(stats, id, "jitterBufferDelay"));
    const jbEmitted = rates(seriesOf(stats, id, "jitterBufferEmittedCount"));
    const codecId = lastValue(stats, id, "codecId");
    console.log(`inbound audio ${id}`);
    console.log(`  codec: ${lastValue(stats, codecId, "mimeType")} ${lastValue(stats, codecId, "sdpFmtpLine") ?? ""}`);
    console.log(`  jitter ms: ${fmt(series((seriesOf(stats, id, "jitter") ?? []).map((j) => Number(j) * 1000)))}`);
    console.log(`  perda %: ${fmt(series(loss ?? []))}`);
    console.log(`  concealment fala ms/s: ${fmt(series((concealed ?? []).map((c, i) => ((c - (silent?.[i] ?? 0)) / 48000) * 1000)))}`);
    console.log(`  acelerado ms/s: ${fmt(series((accel ?? []).map((a) => (a / 48000) * 1000)))}`);
    console.log(`  jitter buffer ms: ${fmt(series((jbDelay ?? []).map((d, i) => (jbEmitted?.[i] ? (d / jbEmitted[i]) * 1000 : undefined))))}`);
    console.log(`  pacotes/s: ${fmt(series(recv ?? []))}`);
    console.log(`  kbps: ${fmt(series((rates(seriesOf(stats, id, "bytesReceived")) ?? []).map((b) => (b * 8) / 1000)))}`);
  }
  for (const id of idsOfType(stats, "outbound-rtp")) {
    if (lastValue(stats, id, "kind") !== "audio") continue;
    const codecId = lastValue(stats, id, "codecId");
    console.log(`outbound audio ${id}`);
    console.log(`  codec: ${lastValue(stats, codecId, "mimeType")} ${lastValue(stats, codecId, "sdpFmtpLine") ?? ""}`);
    console.log(`  kbps: ${fmt(series((rates(seriesOf(stats, id, "bytesSent")) ?? []).map((b) => (b * 8) / 1000)))}`);
    console.log(`  alvo kbps: ${fmt(series((seriesOf(stats, id, "targetBitrate") ?? []).map((t) => Number(t) / 1000)))}`);
    console.log(`  pacotes/s: ${fmt(series(rates(seriesOf(stats, id, "packetsSent")) ?? []))}`);
  }
  for (const id of idsOfType(stats, "remote-inbound-rtp")) {
    if (lastValue(stats, id, "kind") !== "audio") continue;
    console.log(`remote-inbound audio ${id}`);
    console.log(`  RTT ms: ${fmt(series((seriesOf(stats, id, "roundTripTime") ?? []).map((r) => Number(r) * 1000)))}`);
    console.log(`  jitter remoto ms: ${fmt(series((seriesOf(stats, id, "jitter") ?? []).map((j) => Number(j) * 1000)))}`);
    console.log(`  fractionLost %: ${fmt(series((seriesOf(stats, id, "fractionLost") ?? []).map((f) => Number(f) * 100)))}`);
  }
  for (const id of idsOfType(stats, "candidate-pair")) {
    if (lastValue(stats, id, "nominated") !== true && lastValue(stats, id, "state") !== "succeeded") continue;
    const local = lastValue(stats, id, "localCandidateId");
    const remote = lastValue(stats, id, "remoteCandidateId");
    console.log(`candidate-pair ${id}: ${lastValue(stats, local, "candidateType")}/${lastValue(stats, local, "protocol")}${lastValue(stats, local, "relayProtocol") ? ` relay=${lastValue(stats, local, "relayProtocol")}` : ""} → ${lastValue(stats, remote, "candidateType")}:${lastValue(stats, remote, "port")} · RTT ms ${fmt(series((seriesOf(stats, id, "currentRoundTripTime") ?? []).map((r) => Number(r) * 1000)))}`);
  }
}

function fmt(s) {
  if (!s) return "—";
  return `p50 ${s.p50} · p95 ${s.p95} · max ${s.max} (n=${s.n})`;
}
