/* eslint-disable no-undef */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Voice noise-suppression binaries live in git under
 * public/noise-suppression/ and are pinned here by size and SHA-256.
 *
 * Nothing is downloaded at build time. The DeepFilterNet3 files used to be
 * fetched from cdn.mezon.ai, which started answering 403 on 2026-11-13; the
 * WASM is a wasm-bindgen build made by the deepfilternet3-noise-filter
 * authors and is published nowhere else (the npm package ships only JS), so
 * the committed copy is the only one we can rely on. Silero used to come
 * from the moving `master` branch.
 *
 * The build fails when a file is missing or differs from its pin: a
 * truncated copy, a Git LFS pointer or a line-ending conversion must never
 * reach users as a model that silently fails to load.
 *
 * Updating a file: replace it, then update `bytes`, `sha256` and `source`.
 * The DeepFilterNet WASM must match the JS glue of the pinned
 * deepfilternet3-noise-filter version (wasm-bindgen import names).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
export const NOISE_SUPPRESSION_ROOT = resolve(
  __dirname,
  "..",
  "public",
  "noise-suppression",
);

export const NOISE_SUPPRESSION_ASSETS = [
  {
    path: "deepfilternet3/v3/pkg/df_bg.wasm",
    bytes: 16418651,
    sha256: "440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432",
    source:
      "libDF WASM for deepfilternet3-noise-filter 1.3.0, fetched from cdn.mezon.ai on 2026-08-21; byte-identical to what chat.muhbianco.com.br served on 2026-11-13",
  },
  {
    path: "deepfilternet3/v3/models/DeepFilterNet3_onnx.tar.gz",
    bytes: 7983136,
    sha256: "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616",
    source:
      "github.com/Rikorose/DeepFilterNet models/DeepFilterNet3_onnx.tar.gz (last changed in 84d57ec2, 2023-05-23)",
  },
  {
    path: "silero-vad/v5/silero_vad.onnx",
    bytes: 2327524,
    sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
    source:
      "github.com/snakers4/silero-vad src/silero_vad/data/silero_vad.onnx at bfdc0193 (2025-11-06)",
  },
];

function sha256(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

/**
 * @returns {Promise<string[]>} one line per problem; empty when all match.
 */
export async function findNoiseSuppressionAssetProblems(
  root = NOISE_SUPPRESSION_ROOT,
  assets = NOISE_SUPPRESSION_ASSETS,
) {
  const problems = [];
  for (const asset of assets) {
    const file = resolve(root, asset.path);
    let info;
    try {
      info = await stat(file);
    } catch (error) {
      problems.push(`${asset.path}: missing (${error.code ?? error})`);
      continue;
    }
    if (!info.isFile()) {
      problems.push(`${asset.path}: not a regular file`);
      continue;
    }
    if (info.size !== asset.bytes) {
      problems.push(
        `${asset.path}: ${info.size} bytes, expected ${asset.bytes}`,
      );
      continue;
    }
    const digest = await sha256(file);
    if (digest !== asset.sha256) {
      problems.push(
        `${asset.path}: sha256 ${digest}, expected ${asset.sha256}`,
      );
    }
  }
  return problems;
}

export async function verifyNoiseSuppressionAssets(
  root = NOISE_SUPPRESSION_ROOT,
) {
  const problems = await findNoiseSuppressionAssetProblems(root);
  if (problems.length > 0) {
    throw new Error(
      [
        "Noise suppression assets failed verification:",
        ...problems.map((problem) => `  ${problem}`),
        "Restore them from git: git checkout -- packages/client/public/noise-suppression",
      ].join("\n"),
    );
  }
  console.info(
    `Noise suppression assets verified (${NOISE_SUPPRESSION_ASSETS.length} files).`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  verifyNoiseSuppressionAssets().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
