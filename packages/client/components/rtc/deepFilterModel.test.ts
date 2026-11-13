import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  detectDeepFilterModelFormat,
  ensureGzippedDeepFilterModel,
  installDeepFilterModelNormalizer,
  isDeepFilterModelUrl,
} from "./deepFilterModel.ts";

/** Two tar blocks: a header with the ustar magic at 257, then data. */
function fakeTar(): Uint8Array {
  const tar = new Uint8Array(1024);
  tar.set(new TextEncoder().encode("./model.onnx"), 0);
  tar.set(new TextEncoder().encode("ustar\u000000"), 257);
  tar.fill(7, 512);
  return tar;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

test("tells gzip, tar and anything else apart", () => {
  assert.equal(detectDeepFilterModelFormat(gzipSync(fakeTar())), "gzip");
  assert.equal(detectDeepFilterModelFormat(fakeTar()), "tar");
  assert.equal(
    detectDeepFilterModelFormat(new TextEncoder().encode("<html>403</html>")),
    "unknown",
  );
  assert.equal(detectDeepFilterModelFormat(new Uint8Array(0)), "unknown");
});

test("hands gzip bytes over untouched", async () => {
  const gzip = toArrayBuffer(gzipSync(fakeTar()));
  assert.equal(await ensureGzippedDeepFilterModel(gzip), gzip);
});

test("re-gzips the plain tar a Content-Encoding: gzip server delivers", async () => {
  const tar = fakeTar();
  const out = new Uint8Array(
    await ensureGzippedDeepFilterModel(toArrayBuffer(tar)),
  );
  assert.equal(detectDeepFilterModelFormat(out), "gzip");
  assert.deepEqual(new Uint8Array(gunzipSync(out)), tar);
});

test("refuses bytes that are neither, so the caller falls back", async () => {
  const page = new TextEncoder().encode("<html>403 Forbidden</html>");
  await assert.rejects(
    ensureGzippedDeepFilterModel(toArrayBuffer(page)),
    /neither gzip nor tar \(26 bytes, starts 3c 68 74 6d/,
  );
});

test("matches the model URL only, query string or not", () => {
  const base = "https://chat.example/noise-suppression/deepfilternet3/v3";
  assert.equal(
    isDeepFilterModelUrl(`${base}/models/DeepFilterNet3_onnx.tar.gz`),
    true,
  );
  assert.equal(
    isDeepFilterModelUrl(`${base}/models/DeepFilterNet3_onnx.tar.gz?v=2`),
    true,
  );
  assert.equal(isDeepFilterModelUrl(`${base}/pkg/df_bg.wasm`), false);
});

test("normalizer wraps the loader once and leaves the WASM alone", async () => {
  const tar = toArrayBuffer(fakeTar());
  const wasm = toArrayBuffer(new Uint8Array([0, 0x61, 0x73, 0x6d]));
  const fetched: string[] = [];
  class FakeLoader {
    async fetchAsset(url: string): Promise<ArrayBuffer> {
      fetched.push(url);
      return url.endsWith(".wasm") ? wasm : tar;
    }
  }

  installDeepFilterModelNormalizer(FakeLoader);
  const wrapped = FakeLoader.prototype.fetchAsset;
  installDeepFilterModelNormalizer(FakeLoader);
  assert.equal(FakeLoader.prototype.fetchAsset, wrapped);

  const loader = new FakeLoader();
  assert.equal(await loader.fetchAsset("/v3/pkg/df_bg.wasm"), wasm);
  const model = new Uint8Array(
    await loader.fetchAsset("/v3/models/DeepFilterNet3_onnx.tar.gz"),
  );
  assert.equal(detectDeepFilterModelFormat(model), "gzip");
  assert.deepEqual(fetched, [
    "/v3/pkg/df_bg.wasm",
    "/v3/models/DeepFilterNet3_onnx.tar.gz",
  ]);
});
