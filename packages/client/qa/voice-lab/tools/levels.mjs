/* global console, process */
// Active speech level (P.56-like approximation), peak and noise floor of WAV files.
// Usage: node levels.mjs file1.wav [file2.wav ...]
import { readWav } from '../lib/wav.mjs';

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -150);
for (const f of process.argv.slice(2)) {
  let w;
  try { w = readWav(f); } catch (e) { console.log(f, 'ERR', e.message); continue; }
  const x = w.samples ?? w.data ?? w.signal ?? w;
  const sr = w.sampleRate ?? 48000;
  const N = Math.round(0.02 * sr);
  const fr = [];
  let peak = 0;
  for (let i = 0; i + N <= x.length; i += N) {
    let s = 0;
    for (let j = 0; j < N; j++) { const v = x[i + j]; s += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
    fr.push(Math.sqrt(s / N));
  }
  const sorted = [...fr].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const thr = Math.max(floor * 10 ** (12 / 20), 10 ** (-60 / 20));
  const act = fr.filter((r) => r > thr);
  const actRms = Math.sqrt(act.reduce((a, r) => a + r * r, 0) / Math.max(1, act.length));
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(
    f.replace(/^.*out[\\/]/, '').padEnd(70),
    `dur ${(x.length / sr).toFixed(1)}s`,
    `active ${db(actRms).toFixed(1)} dBFS (${((act.length / fr.length) * 100).toFixed(0)}% frames)`,
    `p95frame ${db(p95).toFixed(1)}`,
    `peak ${db(peak).toFixed(1)}`,
    `floor ${db(floor).toFixed(1)}`,
  );
}
