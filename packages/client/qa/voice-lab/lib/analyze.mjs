// Comparação objetiva entre o áudio de referência e o áudio gravado na outra
// ponta. Sem dependências. Tudo em 48 kHz mono (Opus decodifica a 48 kHz e a
// cadeia do cliente só aceita 48 kHz).
//
// O que mede e por quê:
// - alinhamento global por correlação de envelope (janela de busca configurável,
//   centrada num atraso esperado quando se conhece) + refino por amostra;
// - alinhamento LOCAL por bloco de 5 s: acompanha deriva de relógio e detecta
//   trechos sem correspondência (gravação começou no meio de um loop da
//   referência, rede caiu); blocos sem correspondência são excluídos e contados;
// - deriva do alinhamento ao longo do tempo (ms/s): evidência de accelerate /
//   expand do NetEQ ou de relógio diferente entre as pontas;
// - dropouts: quadros de fala na referência que chegaram ≥ 20 dB mais baixos,
//   classificados em "início da fala" (silêncio logo antes) e "meio da fala";
//   é a medida direta de "picote" e "parte da palavra sumiu";
// - SNR segmental e distância log-espectral (LSD) nos quadros de fala: quanto
//   a forma de onda/espectro mudou (codec, supressor, concealment);
// - energia acima de 4 kHz: queda grande = banda cortada ("voz de telefone",
//   "metálica" por supressão agressiva).
// Não é MOS. POLQA/ViSQOL exigem licença/build próprios; ver README.

const FRAME_MS = 20;
const BLOCK_SEC = 5;

export function rmsDb(frame) {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  const r = Math.sqrt(s / Math.max(1, frame.length));
  return r > 0 ? 20 * Math.log10(r) : -120;
}

/** Envelope RMS por quadro (dB). */
function envelopeDb(x, sr, frameMs = FRAME_MS) {
  const n = Math.floor((sr * frameMs) / 1000);
  const frames = Math.floor(x.length / n);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) out[f] = rmsDb(x.subarray(f * n, (f + 1) * n));
  return out;
}

/** Envelope em dB → escala linear 0..60 (silêncio digital conta como 0). */
function clipEnv(env) {
  return Float32Array.from(env, (v) => Math.max(v, -60) + 60);
}

/**
 * Melhor atraso (em quadros) de `b` em relação a `a` numa faixa, por correlação
 * normalizada (Pearson) dos envelopes. Devolve também o escore (−1..1).
 */
function bestLagEnvelope(aEnv, bEnv, minLag, maxLag) {
  const a = clipEnv(aEnv);
  const b = clipEnv(bEnv);
  let best = { lag: 0, score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag++) {
    let n = 0;
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      const x = a[i];
      const y = b[j];
      n++;
      sa += x;
      sb += y;
      saa += x * x;
      sbb += y * y;
      sab += x * y;
    }
    if (n < 25) continue;
    const cov = sab / n - (sa / n) * (sb / n);
    const va = saa / n - (sa / n) ** 2;
    const vb = sbb / n - (sb / n) ** 2;
    const score = va > 1e-9 && vb > 1e-9 ? cov / Math.sqrt(va * vb) : -1;
    if (score > best.score) best = { lag, score };
  }
  return best;
}

/** Refina o atraso em amostras por correlação direta num trecho energético. */
function refineLagSamples(ref, rec, coarseLag, sr, excerptSec, spanSamples) {
  const n = Math.floor(sr * excerptSec);
  if (ref.length < n) return coarseLag;
  let bestStart = 0;
  let bestE = -1;
  const step = Math.floor(sr / 2);
  for (let s = 0; s + n < ref.length; s += step) {
    let e = 0;
    for (let i = s; i < s + n; i += 16) e += ref[i] * ref[i];
    if (e > bestE) {
      bestE = e;
      bestStart = s;
    }
  }
  const x = ref.subarray(bestStart, bestStart + n);
  let best = { lag: coarseLag, score: -Infinity };
  for (let lag = coarseLag - spanSamples; lag <= coarseLag + spanSamples; lag++) {
    const start = bestStart + lag;
    if (start < 0 || start + n > rec.length) continue;
    let s = 0;
    for (let i = 0; i < n; i += 1) s += x[i] * rec[start + i];
    if (s > best.score) best = { lag, score: s };
  }
  return best.lag;
}

/** Como alignOffset, mas devolve também o escore do envelope. */
function alignWithScore(ref, rec, sr, maxLagSec, centerSec) {
  const refEnv = envelopeDb(ref, sr);
  const recEnv = envelopeDb(rec, sr);
  const frameSamples = Math.floor((sr * FRAME_MS) / 1000);
  const c = Math.round((centerSec * 1000) / FRAME_MS);
  const w = Math.ceil((maxLagSec * 1000) / FRAME_MS);
  const coarse = bestLagEnvelope(refEnv, recEnv, c - w, c + w);
  return {
    lag: refineLagSamples(ref, rec, coarse.lag * frameSamples, sr, 2, frameSamples),
    score: coarse.score,
  };
}

/**
 * Atraso (amostras) com que `rec` reproduz `ref`: rec[i + lag] ≈ ref[i].
 * Busca em [center − maxLag, center + maxLag] segundos.
 */
export function alignOffset(ref, rec, sr, maxLagSec = 6, centerSec = 0) {
  return alignWithScore(ref, rec, sr, maxLagSec, centerSec).lag;
}

/** Deriva do alinhamento: realinha blocos e mede a variação do atraso. */
export function alignmentDrift(ref, rec, sr, lag0, blockSec = 10) {
  const n = Math.floor(sr * blockSec);
  const points = [];
  for (let s = 0; s + n <= ref.length && s + n + lag0 <= rec.length; s += n) {
    const refBlock = ref.subarray(s, s + n);
    const env = envelopeDb(refBlock, sr);
    let active = 0;
    for (const v of env) if (v > -45) active++;
    if (active < env.length * 0.3) continue; // bloco quase todo silêncio
    const recStart = Math.max(0, s + lag0 - sr);
    const recBlock = rec.subarray(recStart, Math.min(rec.length, s + lag0 + n + sr));
    const local = alignOffset(refBlock, recBlock, sr, 1) + recStart - s;
    points.push({ atSec: s / sr, lagMs: (local * 1000) / sr });
  }
  if (points.length < 2) return { points, driftMsPerSec: undefined };
  const first = points[0];
  const last = points[points.length - 1];
  const driftMsPerSec = (last.lagMs - first.lagMs) / (last.atSec - first.atSec);
  return { points, driftMsPerSec };
}

// FFT radix-2 in-place (re, im), N potência de 2.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

function magSpectrumDb(frame, N) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < Math.min(N, frame.length); i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); // Hann
    re[i] = frame[i] * w;
  }
  fft(re, im);
  const out = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    out[k] = 10 * Math.log10(p + 1e-12);
  }
  return out;
}

function percentile(sorted, p) {
  if (!sorted.length) return undefined;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function round1(v) {
  return v === undefined || Number.isNaN(v) ? undefined : Math.round(v * 10) / 10;
}

/**
 * Compara `ref` com `rec` dado um atraso inicial `lag` (amostras), bloco a
 * bloco: cada bloco de 5 s realinha localmente (±0,25 s) e é excluído se o
 * envelope não casar (escore < 0,4) — gravação que começou noutro ponto do
 * loop da referência, queda de rede, etc. Métricas só sobre quadros de fala.
 */
/** Piso de ruído da referência: percentil 10 do envelope (dB). */
export function noiseFloorDb(x, sr) {
  const env = Array.from(envelopeDb(x, sr)).sort((a, b) => a - b);
  if (!env.length) return -120;
  return env[Math.floor(env.length * 0.1)];
}

export function compareAligned(ref, rec, sr, lag, opts = {}) {
  // "Fala" na referência = 12 dB acima do piso de ruído dela, entre −45 e −30 dBFS.
  // Sem isso, uma referência com piso a −45 dBFS tinha o próprio ruído contado
  // como fala, e a supressão do ruído virava "dropout".
  const floor = noiseFloorDb(ref, sr);
  const speechDb = opts.speechDb ?? Math.min(-30, Math.max(-45, floor + 12));
  const dropoutDb = opts.dropoutDb ?? 20; // queda relativa que conta como corte
  const minScore = opts.minBlockScore ?? 0.4;
  const n = Math.floor((sr * FRAME_MS) / 1000);
  const N = 1024;
  const blockSamples = sr * BLOCK_SEC;
  const ONSET_LOOKBACK = 5; // 100 ms

  let speechFrames = 0;
  let dropoutFrames = 0;
  let dropoutEvents = 0;
  let dropoutOnsetEvents = 0;
  let dropoutMidEvents = 0;
  let longestRun = 0;
  const snrs = [];
  const lsds = [];
  const levelDiffs = [];
  let refHigh = 0;
  let recHigh = 0;
  let refAll = 0;
  let recAll = 0;
  const dropoutsAt = [];
  const blocks = [];
  let skippedSec = 0;
  let comparedSec = 0;

  let localLag = lag;
  for (let bs = 0; bs + blockSamples <= ref.length; bs += blockSamples) {
    const refBlock = ref.subarray(bs, bs + blockSamples);
    const env = envelopeDb(refBlock, sr);
    let active = 0;
    for (const v of env) if (v > speechDb) active++;
    if (active < 10) {
      blocks.push({ atSec: bs / sr, skipped: "silêncio" });
      continue;
    }
    // Realinha ±0,25 s em torno do atraso corrente (deriva, correção do NetEQ).
    const margin = Math.floor(sr * 0.5);
    const recStart = Math.max(0, bs + localLag - margin);
    const recEnd = Math.min(rec.length, bs + blockSamples + localLag + margin);
    if (recEnd - recStart < blockSamples + Math.floor(sr * 0.3)) {
      blocks.push({ atSec: bs / sr, skipped: "fora da gravação" });
      skippedSec += BLOCK_SEC;
      continue;
    }
    const recBlock = rec.subarray(recStart, recEnd);
    // Gravação muda neste bloco enquanto a referência fala: a fala sumiu por
    // inteiro (portão fechado, rede caída). Conta como dropout, não como
    // "sem correspondência".
    const recEnv = envelopeDb(recBlock, sr);
    let recPeak = -120;
    for (const v of recEnv) if (v > recPeak) recPeak = v;
    if (recPeak < speechDb - 25) {
      let run = 0;
      for (let k = 0; k < env.length; k++) {
        if (env[k] < speechDb) {
          run = 0;
          continue;
        }
        speechFrames++;
        dropoutFrames++;
        levelDiffs.push(-120 - env[k]);
        run++;
        if (run === 1) {
          dropoutEvents++;
          dropoutsAt.push(Math.round(((bs / n + k) * FRAME_MS) / 10) / 100);
          if (k === 0 || env[k - 1] < speechDb) dropoutOnsetEvents++;
          else dropoutMidEvents++;
        }
        longestRun = Math.max(longestRun, run);
      }
      blocks.push({ atSec: bs / sr, silent: true });
      comparedSec += BLOCK_SEC;
      continue;
    }
    const centerSec = (bs + localLag - recStart) / sr;
    const local = alignWithScore(refBlock, recBlock, sr, 0.25, centerSec);
    if (local.score < minScore) {
      blocks.push({ atSec: bs / sr, skipped: "sem correspondência", score: round1(local.score) });
      skippedSec += BLOCK_SEC;
      continue;
    }
    const blockLag = recStart + local.lag - bs; // rec[i + blockLag] ≈ ref[i]
    localLag = blockLag;
    blocks.push({ atSec: bs / sr, lagMs: Math.round((blockLag * 1000) / sr), score: round1(local.score) });
    comparedSec += BLOCK_SEC;

    // Ganho ótimo do bloco (compensa diferença de nível fixa).
    let xy = 0;
    let xx = 0;
    for (let i = bs; i < bs + blockSamples; i++) {
      const r = ref[i];
      xy += r * rec[i + blockLag];
      xx += r * r;
    }
    const gain = xx > 0 ? xy / xx : 1;

    let run = 0;
    const frames = blockSamples / n;
    const f0 = bs / n;
    for (let k = 0; k < frames; k++) {
      const f = f0 + k;
      const a = ref.subarray(f * n, (f + 1) * n);
      const b = rec.subarray(f * n + blockLag, (f + 1) * n + blockLag);
      const aDb = rmsDb(a);
      if (aDb < speechDb) {
        run = 0;
        continue;
      }
      speechFrames++;
      const bDb = rmsDb(b);
      levelDiffs.push(bDb - aDb);
      const isDrop = bDb < aDb - dropoutDb;
      if (isDrop) {
        dropoutFrames++;
        run++;
        if (run === 1) {
          dropoutEvents++;
          dropoutsAt.push(Math.round((f * FRAME_MS) / 10) / 100);
          let onset = false;
          for (let q = Math.max(0, f - ONSET_LOOKBACK); q < f; q++) {
            if (rmsDb(ref.subarray(q * n, (q + 1) * n)) < speechDb) onset = true;
          }
          if (onset) dropoutOnsetEvents++;
          else dropoutMidEvents++;
        }
        longestRun = Math.max(longestRun, run);
      } else {
        run = 0;
      }
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        const e = a[i] - b[i] / (gain || 1);
        num += a[i] * a[i];
        den += e * e;
      }
      snrs.push(10 * Math.log10((num + 1e-12) / (den + 1e-12)));
      if (f * n + N <= ref.length && f * n + blockLag + N <= rec.length) {
        const sa = magSpectrumDb(ref.subarray(f * n, f * n + N), N);
        const sb = magSpectrumDb(rec.subarray(f * n + blockLag, f * n + blockLag + N), N);
        const kMax = Math.floor((8000 / (sr / 2)) * (N / 2));
        const k4 = Math.floor((4000 / (sr / 2)) * (N / 2));
        let acc = 0;
        for (let q = 1; q < kMax; q++) {
          const d = sa[q] - sb[q];
          acc += d * d;
          const pa = 10 ** (sa[q] / 10);
          const pb = 10 ** (sb[q] / 10);
          refAll += pa;
          recAll += pb;
          if (q >= k4) {
            refHigh += pa;
            recHigh += pb;
          }
        }
        lsds.push(Math.sqrt(acc / (kMax - 1)));
      }
    }
  }

  snrs.sort((x, y) => x - y);
  lsds.sort((x, y) => x - y);
  levelDiffs.sort((x, y) => x - y);
  const refHighRatioDb = refAll > 0 ? 10 * Math.log10((refHigh + 1e-12) / refAll) : undefined;
  const recHighRatioDb = recAll > 0 ? 10 * Math.log10((recHigh + 1e-12) / recAll) : undefined;
  const aligned = blocks.filter((b) => b.lagMs !== undefined);
  const driftMsPerSec =
    aligned.length >= 2
      ? (aligned[aligned.length - 1].lagMs - aligned[0].lagMs) /
        (aligned[aligned.length - 1].atSec - aligned[0].atSec)
      : undefined;

  return {
    frameMs: FRAME_MS,
    speechDb,
    refNoiseFloorDb: round1(floor),
    comparedSec,
    skippedSec,
    blocks,
    speechFrames,
    speechSec: Math.round(speechFrames * FRAME_MS) / 1000,
    dropoutFrames,
    dropoutPct: speechFrames ? Math.round((dropoutFrames / speechFrames) * 1000) / 10 : undefined,
    dropoutEvents,
    dropoutOnsetEvents,
    dropoutMidEvents,
    longestDropoutMs: longestRun * FRAME_MS,
    dropoutsAtSec: dropoutsAt.slice(0, 60),
    levelDiffDbMedian: round1(percentile(levelDiffs, 50)),
    segSnrDb: { p10: round1(percentile(snrs, 10)), p50: round1(percentile(snrs, 50)), p90: round1(percentile(snrs, 90)) },
    lsdDb: { p50: round1(percentile(lsds, 50)), p90: round1(percentile(lsds, 90)) },
    highBandRatioDb: { ref: round1(refHighRatioDb), rec: round1(recHighRatioDb) },
    driftMsPerSec: driftMsPerSec === undefined ? undefined : Math.round(driftMsPerSec * 100) / 100,
  };
}

/**
 * Pipeline completo: alinha e compara bloco a bloco.
 * opts.skipStartSec   descarta o começo da gravação (gravador liga antes da cadeia)
 * opts.expectedLagSec atraso esperado de rec em relação a ref (ex.: diferença de relógio
 *                     entre o início das duas gravações); a busca fica em ±maxLagSec dele
 * opts.maxLagSec      meia-largura da busca (padrão 6 s; 1,5 s quando há atraso esperado)
 */
export function analyzePair(ref, rec, sr, opts = {}) {
  const skip = Math.floor((opts.skipStartSec ?? 0.5) * sr);
  if (skip > 0 && rec.length > skip) rec = rec.subarray(skip);
  if (rec.length < sr * 2) return { error: "gravação curta demais" };
  const center = (opts.expectedLagSec ?? 0) - (opts.skipStartSec ?? 0.5);
  const maxLag = opts.maxLagSec ?? (opts.expectedLagSec !== undefined ? 1.5 : 6);
  const lag = alignOffset(ref, rec, sr, maxLag, center);
  let refCutSec;
  if (lag < 0) {
    // Gravação começou depois do início da referência: corta a referência.
    const cut = -lag;
    refCutSec = cut / sr;
    ref = ref.subarray(cut);
  }
  const effLag = lag < 0 ? 0 : lag;
  const cmp = compareAligned(ref, rec, sr, effLag, opts);
  return {
    lagMs: Math.round((lag * 1000) / sr),
    refCutSec,
    ...cmp,
  };
}

/** Percentis de uma série numérica (ignora undefined). */
export function series(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return {
    n: v.length,
    min: round1(v[0]),
    p50: round1(percentile(v, 50)),
    p95: round1(percentile(v, 95)),
    max: round1(v[v.length - 1]),
    mean: round1(mean),
  };
}
