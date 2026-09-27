import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_METER_MESSAGE,
  PRODUCTION_METER_PROCESSOR_NAME,
  SILENCE_PEAK,
  buildProductionMeterSource,
  isProductionStats,
  silentMsPerSec,
} from "./productionMeterProcessor.ts";

/** Evaluates the generated worklet source with fake worklet globals. */
function makeProcessor(reportQuanta: number) {
  const posted: Record<string, unknown>[] = [];
  const source = buildProductionMeterSource({
    name: PRODUCTION_METER_PROCESSOR_NAME,
    message: PRODUCTION_METER_MESSAGE,
    silencePeak: SILENCE_PEAK,
    reportQuanta,
  });
  let Registered: new () => {
    port: { postMessage(data: Record<string, unknown>): void };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  };
  const scope = {
    AudioWorkletProcessor: class {
      port = {
        postMessage: (data: Record<string, unknown>) => posted.push(data),
      };
    },
    registerProcessor: (_name: string, cls: typeof Registered) => {
      Registered = cls;
    },
  };
  new Function("AudioWorkletProcessor", "registerProcessor", source)(
    scope.AudioWorkletProcessor,
    scope.registerProcessor,
  );
  return { processor: new Registered!(), posted };
}

function quantum(fill: number): Float32Array {
  return new Float32Array(128).fill(fill);
}

function run(
  processor: { process(i: Float32Array[][], o: Float32Array[][]): boolean },
  frames: (Float32Array | null)[],
) {
  for (const frame of frames) {
    const out = new Float32Array(128);
    processor.process(frame ? [[frame]] : [[]], [[out]]);
  }
}

test("fala normal não conta como silêncio", () => {
  const { processor, posted } = makeProcessor(4);
  run(processor, [quantum(0.2), quantum(-0.3), quantum(0.1), quantum(0.25)]);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].silentQuanta, 0);
  assert.equal(posted[0].longestSilentRun, 0);
  assert.equal(posted[0].quanta, 4);
});

test("zeros no meio da fala são contados e o maior trecho é reportado", () => {
  // Este é o defeito que estamos caçando: o grafo renderiza zeros quando a
  // fonte não entrega, o DTX para de mandar, e quem ouve reconstrói.
  const { processor, posted } = makeProcessor(6);
  run(processor, [
    quantum(0.2),
    quantum(0),
    quantum(0),
    quantum(0.2),
    quantum(0),
    quantum(0.2),
  ]);
  assert.equal(posted[0].silentQuanta, 3);
  assert.equal(posted[0].longestSilentRun, 2);
});

test("entrada desconectada é silêncio, não um buraco invisível", () => {
  const { processor, posted } = makeProcessor(3);
  run(processor, [null, null, null]);
  assert.equal(posted[0].silentQuanta, 3);
  assert.equal(posted[0].longestSilentRun, 3);
  assert.equal(posted[0].peak, 0);
});

test("o áudio passa intacto — o medidor não pode alterar o som", () => {
  const { processor } = makeProcessor(1000);
  const input = new Float32Array(128);
  for (let i = 0; i < 128; i++) input[i] = Math.sin(i / 8) * 0.4;
  const out = new Float32Array(128);
  processor.process([[input]], [[out]]);
  assert.deepEqual([...out], [...input]);
});

test("resíduo denormal ainda é silêncio", () => {
  // Compressor e ganho deixam lixo de escala minúscula depois de um zero
  // verdadeiro; comparar com zero exato perderia o sinal.
  const { processor, posted } = makeProcessor(2);
  run(processor, [quantum(SILENCE_PEAK / 10), quantum(0.5)]);
  assert.equal(posted[0].silentQuanta, 1);
});

test("os contadores zeram a cada janela", () => {
  const { processor, posted } = makeProcessor(2);
  run(processor, [quantum(0), quantum(0), quantum(0.3), quantum(0.3)]);
  assert.equal(posted.length, 2);
  assert.equal(posted[0].silentQuanta, 2);
  assert.equal(
    posted[1].silentQuanta,
    0,
    "a segunda janela não herda a primeira",
  );
});

test("silentMsPerSec traduz para algo que dá pra ler", () => {
  assert.equal(silentMsPerSec({ quanta: 375, silentQuanta: 0 }), 0);
  assert.equal(silentMsPerSec({ quanta: 375, silentQuanta: 375 }), 1000);
  assert.equal(silentMsPerSec({ quanta: 100, silentQuanta: 10 }), 100);
  assert.equal(silentMsPerSec({ quanta: 0, silentQuanta: 0 }), 0);
});

test("mensagem malformada é rejeitada", () => {
  assert.equal(isProductionStats(null), false);
  assert.equal(isProductionStats({ type: "outra-coisa" }), false);
  assert.equal(
    isProductionStats({
      type: PRODUCTION_METER_MESSAGE,
      quanta: 1,
      silentQuanta: 0,
      longestSilentRun: 0,
      peak: 0.1,
    }),
    true,
  );
});
