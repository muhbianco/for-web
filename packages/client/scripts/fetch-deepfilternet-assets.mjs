/* eslint-disable no-undef */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEST_ROOT = resolve(__dirname, "..", "public", "noise-suppression", "deepfilternet3");

const SOURCE_BASE =
  "https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3";

const FILES = [
  { rel: "v3/pkg/df_bg.wasm" },
  { rel: "v3/models/DeepFilterNet3_onnx.tar.gz" },
];

async function alreadyPresent(dest) {
  try {
    const info = await stat(dest);
    return info.isFile() && info.size > 1024;
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
  console.info(`DeepFilterNet asset: ${dest} (${bytes.length} bytes)`);
}

export async function fetchDeepFilterAssets() {
  for (const file of FILES) {
    const dest = resolve(DEST_ROOT, file.rel);
    if (await alreadyPresent(dest)) {
      console.info(`DeepFilterNet asset already present: ${file.rel}`);
      continue;
    }
    await download(`${SOURCE_BASE}/${file.rel}`, dest);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  fetchDeepFilterAssets().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
