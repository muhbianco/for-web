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
  /** Stat windows received from the worklet. Zero means it never reported. */
  windows: number;
  /** Frames in the last window; below DF_MIN_FRAMES_PER_WINDOW is not judged. */
  lastFrames?: number;
  /** Slowest frame in the last window (ms). */
  lastMaxMs?: number;
  /** Share of slow frames in the last window (0-1). */
  lastSlowRatio?: number;
  /** Consecutive slow windows so far. */
  slowWindows: number;
}

export class DeepFilterHealth {
  private slowWindows = 0;
  private windows = 0;
  private lastFrames?: number;
  private lastMaxMs?: number;
  private lastSlowRatio?: number;

  /**
   * Returns true when the caller should fall back to RNNoise.
   *
   * Recording and judging are deliberately separate. A thin window must not
   * trigger degradation, but it must still be *visible*: the first version
   * returned early and left lastMaxMs undefined, which the settings panel
   * rendered as "—". That dash was read as "nothing to see here" for weeks
   * while it actually meant "this measurement never arrived".
   */
  observe(
    stats: Pick<DeepFilterStats, "frames" | "slowFrames" | "maxMs">,
  ): boolean {
    this.windows += 1;
    this.lastFrames = stats.frames;
    this.lastMaxMs = stats.maxMs;
    this.lastSlowRatio = stats.frames > 0 ? stats.slowFrames / stats.frames : 0;
    if (stats.frames < DF_MIN_FRAMES_PER_WINDOW) {
      return false;
    }
    const ratio = stats.slowFrames / stats.frames;
    if (ratio >= DF_SLOW_RATIO) {
      this.slowWindows += 1;
    } else {
      this.slowWindows = 0;
    }
    return this.slowWindows >= DF_SLOW_WINDOWS_TO_DEGRADE;
  }

  snapshot(): DeepFilterHealthSnapshot {
    return {
      windows: this.windows,
      lastFrames: this.lastFrames,
      lastMaxMs: this.lastMaxMs,
      lastSlowRatio: this.lastSlowRatio,
      slowWindows: this.slowWindows,
    };
  }
}
