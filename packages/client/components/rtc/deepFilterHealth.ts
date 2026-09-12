import type { DeepFilterStats } from "./patchDeepFilterWorklet";

/**
 * Decides when DeepFilterNet is not keeping up with real time on this device.
 *
 * The patched worklet posts one DeepFilterStats per second. A window is
 * "slow" when at least DF_SLOW_RATIO of its frames took DF_SLOW_FRAME_MS or
 * more. One slow window is normal right after start (WASM tier-up, model
 * warm-up); DF_SLOW_WINDOWS_TO_DEGRADE consecutive slow windows means the
 * voice is audibly chopping and RNNoise is the better trade.
 */
export const DF_SLOW_RATIO = 0.25;
export const DF_SLOW_WINDOWS_TO_DEGRADE = 3;
/** Windows with fewer frames (gate closed, no input yet) are not judged. */
export const DF_MIN_FRAMES_PER_WINDOW = 50;

export interface DeepFilterHealthSnapshot {
  /** Slowest frame in the last window (ms). */
  lastMaxMs?: number;
  /** Share of slow frames in the last window (0-1). */
  lastSlowRatio?: number;
  /** Consecutive slow windows so far. */
  slowWindows: number;
}

export class DeepFilterHealth {
  private slowWindows = 0;
  private lastMaxMs?: number;
  private lastSlowRatio?: number;

  /** Returns true when the caller should fall back to RNNoise. */
  observe(
    stats: Pick<DeepFilterStats, "frames" | "slowFrames" | "maxMs">,
  ): boolean {
    if (stats.frames < DF_MIN_FRAMES_PER_WINDOW) {
      return false;
    }
    const ratio = stats.slowFrames / stats.frames;
    this.lastMaxMs = stats.maxMs;
    this.lastSlowRatio = ratio;
    if (ratio >= DF_SLOW_RATIO) {
      this.slowWindows += 1;
    } else {
      this.slowWindows = 0;
    }
    return this.slowWindows >= DF_SLOW_WINDOWS_TO_DEGRADE;
  }

  snapshot(): DeepFilterHealthSnapshot {
    return {
      lastMaxMs: this.lastMaxMs,
      lastSlowRatio: this.lastSlowRatio,
      slowWindows: this.slowWindows,
    };
  }
}
