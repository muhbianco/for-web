/**
 * Runs the real DeepFilterNet worklet (as shipped by deepfilternet3-noise-filter,
 * with our patches applied) on the committed WASM and model, outside a browser.
 *
 * It pins the three facts the voice chain depends on: our string patches
 * still apply to the worklet we ship, libDF accepts the committed model, and
 * the plain tar that sirv + the browser deliver fails loudly (posted to the
 * main thread) unless it goes through ensureGzippedDeepFilterModel first.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";

import { ensureGzippedDeepFilterModel } from "./deepFilterModel.ts";
import {
  DF_INIT_ERROR_MESSAGE,
  patchDeepFilterWorkletSource,
} from "./patchDeepFilterWorklet.ts";

const ASSETS = new URL(
  "../../public/noise-suppression/deepfilternet3/v3/",
  import.meta.url,
);

interface FakeProcessor {
  dfModel: { frameLength: number } | null;
  isInitialized: boolean;
  port: { postMessage(message: unknown): void };
}

type ProcessorClass = new (options: {
  processorOptions: {
    wasmModule: WebAssembly.Module;
    modelBytes: ArrayBuffer;
    suppressionLevel: number;
  };
}) => FakeProcessor;

async function loadPatchedProcessor(): Promise<ProcessorClass> {
  const libPath = fileURLToPath(
    import.meta.resolve("deepfilternet3-noise-filter"),
  );
  const prefix = "var workletCode = ";
  const line = (await readFile(libPath, "utf8"))
    .split("\n")
    .find((l) => l.startsWith(prefix));
  assert.ok(line, "worklet source not found in deepfilternet3-noise-filter");
  const source = JSON.parse(
    line.slice(prefix.length).replace(/;\s*$/, ""),
  ) as string;
  const patched = patchDeepFilterWorkletSource(source);

  // Messages posted from the constructor land here; the port itself is
  // installed by the AudioWorkletProcessor stub before the subclass runs.
  let registered: ProcessorClass | undefined;
  const sandbox = {
    console: { ...console, error: () => {} },
    TextDecoder,
    TextEncoder,
    WebAssembly,
    FinalizationRegistry,
    Float32Array,
    Uint8Array,
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port = {
        posted: [] as unknown[],
        postMessage(m: unknown) {
          this.posted.push(m);
        },
      };
    },
    registerProcessor: (_name: string, cls: ProcessorClass) => {
      registered = cls;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox);
  assert.ok(registered, "patched worklet did not register a processor");
  return registered;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

test("real worklet: committed model loads, served tar is reported, normalized tar loads", async () => {
  const Processor = await loadPatchedProcessor();
  const wasmModule = await WebAssembly.compile(
    arrayBuffer(await readFile(new URL("pkg/df_bg.wasm", ASSETS))),
  );
  const gz = await readFile(
    new URL("models/DeepFilterNet3_onnx.tar.gz", ASSETS),
  );
  const tar = gunzipSync(gz);

  const start = (modelBytes: ArrayBuffer) => {
    const processor = new Processor({
      processorOptions: { wasmModule, modelBytes, suppressionLevel: 50 },
    });
    const posted = (processor.port as unknown as { posted: unknown[] }).posted;
    return { processor, posted };
  };

  const committed = start(arrayBuffer(gz));
  assert.equal(committed.processor.isInitialized, true);
  assert.equal(committed.processor.dfModel?.frameLength, 480);
  assert.deepEqual(committed.posted, []);

  const served = start(arrayBuffer(tar));
  assert.equal(served.processor.isInitialized, false);
  assert.equal(served.posted.length, 1);
  assert.equal(
    (served.posted[0] as { type: string }).type,
    DF_INIT_ERROR_MESSAGE,
  );

  const normalized = start(
    await ensureGzippedDeepFilterModel(arrayBuffer(tar)),
  );
  assert.equal(normalized.processor.isInitialized, true);
  assert.equal(normalized.processor.dfModel?.frameLength, 480);
  assert.deepEqual(normalized.posted, []);
});
