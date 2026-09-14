/* eslint-disable no-undef */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Voice gate asset: the Silero VAD v5 ONNX model (speech probability per
 * 32 ms frame). Downloaded once into public/ and gitignored, like the
 * DeepFilterNet assets. The onnxruntime-web WASM is bundled by Vite from
 * node_modules (content-hashed asset), so nothing else is needed here.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEST_ROOT = resolve(__dirname, "..", "public", "noise-suppression", "silero-vad");

/** Pin to a commit before relying on this in a release; `master` moves. */
const SILERO_REF = "master";
const SILERO_URL = `https://raw.githubusercontent.com/snakers4/silero-vad/${SILERO_REF}/src/silero_vad/data/silero_vad.onnx`;
const SILERO_DEST = resolve(DEST_ROOT, "v5", "silero_vad.onnx");

async function alreadyPresent(dest, minBytes) {
  try {
    const info = await stat(dest);
    return info.isFile() && info.size > minBytes;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} → ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  console.info(`Silero VAD asset: ${dest} (${bytes.length} bytes)`);
}

export async function fetchSileroVadAssets() {
  if (await alreadyPresent(SILERO_DEST, 1_000_000)) {
    console.info("Silero VAD asset already present: v5/silero_vad.onnx");
    return;
  }
  await download(SILERO_URL, SILERO_DEST);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  fetchSileroVadAssets().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
