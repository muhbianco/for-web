// Autoteste do analisador: um sinal sintético com atraso, ganho, cortes e
// deriva conhecidos tem de ser medido com esses mesmos números.
import assert from "node:assert/strict";
import test from "node:test";

import { alignOffset, analyzePair, compareAligned, series } from "./analyze.mjs";

const SR = 48000;

/** "Fala" sintética: tons modulados em rajadas com pausas de silêncio digital. */
function synthSpeech(seconds) {
  const x = new Float32Array(SR * seconds);
  let t = 0;
  while (t < seconds) {
    const burst = 0.4 + Math.random() * 0.6; // 0,4–1,0 s de "fala"
    const f0 = 120 + Math.random() * 80;
    const n0 = Math.floor(t * SR);
    const n1 = Math.min(x.length, Math.floor((t + burst) * SR));
    for (let i = n0; i < n1; i++) {
      const tt = i / SR;
      const env = Math.sin((Math.PI * (i - n0)) / (n1 - n0));
      x[i] =
        0.3 *
        env *
        (Math.sin(2 * Math.PI * f0 * tt) +
          0.5 * Math.sin(2 * Math.PI * f0 * 2 * tt) +
          0.25 * Math.sin(2 * Math.PI * f0 * 3 * tt) +
          0.1 * Math.sin(2 * Math.PI * 3000 * tt));
    }
    t += burst + 0.2 + Math.random() * 0.3; // pausa
  }
  return x;
}

function delayed(x, lagSamples, gain = 1) {
  const y = new Float32Array(x.length + lagSamples);
  for (let i = 0; i < x.length; i++) y[i + lagSamples] = x[i] * gain;
  return y;
}

test("alinhamento acha o atraso e o ganho", () => {
  const ref = synthSpeech(12);
  const rec = delayed(ref, Math.round(0.35 * SR), 0.5);
  const lag = alignOffset(ref, rec, SR);
  assert.ok(Math.abs(lag - 0.35 * SR) <= 2, `lag=${lag}`);
  const cmp = compareAligned(ref, rec, SR, lag);
  assert.ok(Math.abs(cmp.levelDiffDbMedian + 6) < 0.5, `nível=${cmp.levelDiffDbMedian}`);
  assert.equal(cmp.dropoutEvents, 0);
  assert.ok(cmp.segSnrDb.p50 > 40, `snr=${cmp.segSnrDb.p50}`);
});

test("cortes de 60 ms dentro da fala são contados como dropouts", () => {
  const ref = synthSpeech(12);
  const rec = delayed(ref, 4800);
  // Zera 60 ms em cinco pontos dentro de trechos de fala (depois do 1.º segundo,
  // que o analisador descarta como aquecimento).
  let cuts = 0;
  for (let s = SR; s < rec.length - SR && cuts < 5; s += 2 * SR) {
    // procura um ponto com energia
    let p = s;
    while (p < rec.length && Math.abs(rec[p]) < 0.05) p++;
    if (p + 2880 >= rec.length) break;
    rec.fill(0, p, p + 2880);
    cuts++;
  }
  const r = analyzePair(ref, rec, SR);
  assert.ok(r.dropoutEvents >= cuts - 1 && r.dropoutEvents <= cuts + 1, `events=${r.dropoutEvents} cuts=${cuts}`);
  assert.ok(r.longestDropoutMs >= 40 && r.longestDropoutMs <= 80, `longest=${r.longestDropoutMs}`);
});

test("deriva de relógio aparece em ms/s", () => {
  const ref = synthSpeech(40);
  // Reproduz 1% mais rápido: a cada 100 amostras, pula uma (accelerate).
  const out = [];
  for (let i = 0; i < ref.length; i++) if (i % 100 !== 99) out.push(ref[i]);
  const rec = delayed(Float32Array.from(out), 2400);
  const r = analyzePair(ref, rec, SR);
  // 1% mais rápido = o atraso cai ~10 ms por segundo.
  assert.ok(r.driftMsPerSec < -6 && r.driftMsPerSec > -14, `drift=${r.driftMsPerSec}`);
});

test("series devolve percentis", () => {
  const s = series([5, 1, undefined, 3, 9, 7]);
  assert.equal(s.n, 5);
  assert.equal(s.min, 1);
  assert.equal(s.max, 9);
  assert.equal(s.p50, 5);
});
