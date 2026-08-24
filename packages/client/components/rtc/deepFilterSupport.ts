/**
 * DeepFilterNet3 is too heavy for low-end / mobile CPUs. RNNoise stays the
 * fallback there. SIMD is required by the v3 WASM build we ship.
 */
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8,
  0, 65, 0, 253, 15, 253, 98, 11,
]);

const WEAK_CPU_CORES = 4;

function hasWasmSimd(): boolean {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") {
    return false;
  }
  try {
    return WebAssembly.validate(WASM_SIMD_PROBE);
  } catch {
    return false;
  }
}

function isMobileUserAgent(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function canUseDeepFilter(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof AudioContext === "undefined") return false;
  if (typeof AudioWorkletNode === "undefined") return false;
  if (typeof WebAssembly === "undefined") return false;
  if (isMobileUserAgent()) return false;
  if ((navigator.hardwareConcurrency ?? 2) < WEAK_CPU_CORES) return false;
  return hasWasmSimd();
}
