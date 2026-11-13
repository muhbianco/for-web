/**
 * DeepFilterNet's model ships as `DeepFilterNet3_onnx.tar.gz`, and libDF opens
 * it with a gzip decoder: `df_create` panics on anything that is not gzip.
 *
 * What `fetch()` returns for that URL depends on the server, not on the file.
 * sirv, the static server in the web image, labels every `*.gz` file
 * `Content-Encoding: gzip`, so the browser unzips it in transit and hands
 * over the plain tar. A CDN that serves it as `application/gzip` hands over
 * the gzip bytes. Both are valid HTTP for the same file; libDF takes one.
 *
 * Unhandled, that panic happened inside the worklet, which logged it and
 * passed the microphone through untouched. No stats ever reached the main
 * thread, so neither the suppression nor the RNNoise fallback ran.
 *
 * No runtime imports, so it runs under `node --test`.
 */

export type DeepFilterModelFormat = "gzip" | "tar" | "unknown";

/** POSIX/GNU tar headers carry "ustar" at byte 257 of the first block. */
const TAR_MAGIC = "ustar";
const TAR_MAGIC_OFFSET = 257;

export function detectDeepFilterModelFormat(
  bytes: Uint8Array,
): DeepFilterModelFormat {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return "gzip";
  }
  if (bytes.length < TAR_MAGIC_OFFSET + TAR_MAGIC.length) return "unknown";
  for (let i = 0; i < TAR_MAGIC.length; i++) {
    if (bytes[TAR_MAGIC_OFFSET + i] !== TAR_MAGIC.charCodeAt(i)) {
      return "unknown";
    }
  }
  return "tar";
}

export type Gzip = (data: ArrayBuffer) => Promise<ArrayBuffer>;

export async function gzipWithCompressionStream(
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  if (typeof CompressionStream === "undefined") {
    throw new Error(
      "this browser has no CompressionStream to re-gzip the DeepFilterNet model",
    );
  }
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function firstBytes(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join(" ");
}

/**
 * Returns the model as gzip bytes, re-compressing a plain tar. Anything else
 * (an HTML error page served with 200, a truncated file) throws, so the
 * caller falls back to RNNoise instead of loading a model that cannot work.
 */
export async function ensureGzippedDeepFilterModel(
  data: ArrayBuffer,
  gzip: Gzip = gzipWithCompressionStream,
): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data);
  switch (detectDeepFilterModelFormat(bytes)) {
    case "gzip":
      return data;
    case "tar":
      return gzip(data);
    default:
      throw new Error(
        `DeepFilterNet model is neither gzip nor tar (${bytes.length} bytes, starts ${firstBytes(bytes)})`,
      );
  }
}

/** Only the model archive is checked; the WASM goes through untouched. */
export const DEEPFILTER_MODEL_SUFFIX = ".tar.gz";

export function isDeepFilterModelUrl(url: string): boolean {
  return url.split(/[?#]/)[0].endsWith(DEEPFILTER_MODEL_SUFFIX);
}

type FetchAsset = (url: string) => Promise<ArrayBuffer>;

interface AssetLoaderClass {
  prototype: { fetchAsset: FetchAsset };
}

const INSTALLED = Symbol.for("stoat.deepFilterModelNormalizer");

/**
 * DeepFilterNet3Core builds its AssetLoader privately, so the exported
 * class's public `fetchAsset` is the only seam into what reaches the
 * worklet. Wraps it once per class; calling again is a no-op.
 */
export function installDeepFilterModelNormalizer(
  loader: AssetLoaderClass,
  gzip: Gzip = gzipWithCompressionStream,
): void {
  const proto = loader.prototype as AssetLoaderClass["prototype"] &
    Record<typeof INSTALLED, true | undefined>;
  if (proto[INSTALLED]) return;
  const fetchAsset = proto.fetchAsset;
  proto.fetchAsset = async function (this: unknown, url: string) {
    const data = await fetchAsset.call(this, url);
    return isDeepFilterModelUrl(url)
      ? ensureGzippedDeepFilterModel(data, gzip)
      : data;
  };
  Object.defineProperty(proto, INSTALLED, { value: true });
}
