/* global console, process */
// Recalcula a análise de áudio de rodadas já gravadas (out/<data>-<nome>/) com a
// versão ATUAL do analisador e imprime uma tabela comparativa. Assim "antes" e
// "depois" são sempre comparados pela mesma régua, mesmo que o analisador tenha
// mudado entre as rodadas.
//
//   node qa/voice-lab/tools/reanalyze.mjs [filtro-de-nome ...]
//
// Escreve analysis-v2.json em cada pasta e summary.md em out/.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzePair, series } from "../lib/analyze.mjs";
import { readWav } from "../lib/wav.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");
const filters = process.argv.slice(2);

const refs = new Map();
function ref(path) {
  if (!refs.has(path)) refs.set(path, readWav(path).data);
  return refs.get(path);
}

const rows = [];
for (const dir of readdirSync(OUT).sort()) {
  const full = join(OUT, dir);
  const reportPath = join(full, "report.json");
  if (!existsSync(reportPath)) continue;
  if (filters.length && !filters.some((f) => dir.includes(f))) continue;
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const refPath = report.options?.ref;
  if (!refPath || !existsSync(refPath)) continue;
  const r = ref(refPath);
  const wav = (name) => {
    const p = join(full, `${name}.wav`);
    return existsSync(p) ? readWav(p).data : undefined;
  };
  const aLocal = wav("A-local-processed");
  const bFromA = wav("B-heard-from-A");
  const analysis = {};
  if (aLocal) analysis.dspChain = analyzePair(r, aLocal, 48000);
  if (bFromA) analysis.endToEnd = analyzePair(r, bFromA, 48000);
  if (aLocal && bFromA) analysis.transportAndDecoder = analyzePair(aLocal, bFromA, 48000);
  writeFileSync(join(full, "analysis-v2.json"), JSON.stringify(analysis, null, 2));
  const s = report.stats ?? {};
  const inA = s.bHeardFromA ?? {};
  rows.push({
    name: report.name,
    dir,
    dsp: analysis.dspChain,
    e2e: analysis.endToEnd,
    tr: analysis.transportAndDecoder,
    net: {
      jitter: inA.jitterMs,
      loss: inA.lossPct,
      conceal: inA.concealedMsPerSec,
      accel: inA.acceleratedMsPerSec,
      jb: inA.jitterBufferMs,
      rtt: s.aOutbound?.rttMs,
      reconnects: (s.transport?.reconnectsA ?? 0) + (s.transport?.reconnectsB ?? 0),
    },
    dsp95: {
      slow: s.aDsp?.deepFilterSlowRatio,
      maxMs: s.aDsp?.deepFilterMaxFrameMs,
      engines: s.aDsp?.engines,
      vad: s.aDsp?.vadEngines,
    },
  });
}

function pct(a) {
  if (!a || a.error) return "—";
  return `${a.dropoutPct ?? "—"}% (${a.dropoutOnsetEvents ?? "?"}/${a.dropoutMidEvents ?? "?"}, máx ${a.longestDropoutMs} ms)`;
}
function p95(s) {
  return s ? `${s.p50}/${s.p95}` : "—";
}

const lines = [
  "# Rodadas do laboratório (análise recalculada)",
  "",
  "Dropouts = % dos quadros de fala com queda ≥ 20 dB (eventos no início da fala / no meio, maior evento). Rede = p50/p95 nas janelas de 2 s.",
  "",
  "| rodada | DSP (ref→saída de A) | fim a fim (ref→B) | transp.+decoder | LSD e2e p50 | jitter ms | perda % | conceal ms/s | accel ms/s | buffer ms | RTT ms | reconex. | DF lento p95 / máx ms | motor / VAD |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (x) =>
      `| ${x.name} | ${pct(x.dsp)} | ${pct(x.e2e)} | ${pct(x.tr)}${x.tr?.mouthToEarMs !== undefined ? ` · ${x.tr.mouthToEarMs} ms` : ""} | ${x.e2e?.lsdDb?.p50 ?? "—"} | ${p95(x.net.jitter)} | ${p95(x.net.loss)} | ${p95(x.net.conceal)} | ${p95(x.net.accel)} | ${p95(x.net.jb)} | ${x.net.rtt?.p50 ?? "—"} | ${x.net.reconnects} | ${x.dsp95.slow?.p95 ?? "—"} / ${x.dsp95.maxMs?.max ?? "—"} | ${(x.dsp95.engines ?? []).join(",")} / ${(x.dsp95.vad ?? []).join(",")} |`,
  ),
  "",
];
writeFileSync(join(OUT, "summary.md"), lines.join("\n"));
console.log(lines.join("\n"));
