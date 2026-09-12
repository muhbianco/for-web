/**
 * The upstream worklet only writes output when the ring already has 128
 * samples. DeepFilter frames are 480, so leftover 96 every ~7 callbacks
 * becomes a 128-sample hole (the "tec tec"). Rewrite the blob before
 * addModule so we always fill the quantum and prime two frames of latency.
 *
 * The same patch adds per-frame timing so the main thread can see when the
 * model does not keep up with real time (see DeepFilterStats).
 */

/** `type` of the stats message the patched worklet posts on its port. */
export const DF_STATS_MESSAGE = "stoat-df-stats";
/** A frame that takes this long or more on the render thread counts as slow. */
export const DF_SLOW_FRAME_MS = 5;
/** Post stats every N render quanta (375 * 128 / 48000 = 1 s). */
const STATS_EVERY_QUANTA = 375;

export interface DeepFilterStats {
  type: typeof DF_STATS_MESSAGE;
  /** Frames processed since the last message. */
  frames: number;
  /** Frames at or above DF_SLOW_FRAME_MS since the last message. */
  slowFrames: number;
  /** Slowest frame since the last message (ms). */
  maxMs: number;
}

export function isDeepFilterStats(data: unknown): data is DeepFilterStats {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<DeepFilterStats>;
  return (
    d.type === DF_STATS_MESSAGE &&
    typeof d.frames === "number" &&
    typeof d.slowFrames === "number" &&
    typeof d.maxMs === "number"
  );
}

const BROKEN_OUTPUT = `const outputAvailable = this.getOutputAvailable();
            if (outputAvailable >= 128) {
                for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
                    const output = outputList[inputNum];
                    const channelCount = output.length;
                    for (let channelNum = 0; channelNum < channelCount; channelNum++) {
                        const outputChannel = output[channelNum];
                        let readPos = this.outputReadPos;
                        for (let i = 0; i < 128; i++) {
                            outputChannel[i] = this.outputBuffer[readPos];
                            readPos = (readPos + 1) % this.bufferSize;
                        }
                    }
                }
                this.outputReadPos = (this.outputReadPos + 128) % this.bufferSize;
            }
            return true;`;

const FIXED_OUTPUT = `const quantum = outputList[0]?.[0]?.length || 128;
            this.statTick = (this.statTick + 1) % ${STATS_EVERY_QUANTA};
            if (this.statTick === 0) {
                this.port.postMessage({
                    type: '${DF_STATS_MESSAGE}',
                    frames: this.statFrames,
                    slowFrames: this.statSlowFrames,
                    maxMs: this.statMaxMs,
                });
                this.statFrames = 0;
                this.statSlowFrames = 0;
                this.statMaxMs = 0;
            }
            if (!this.outputPrimed) {
                if (this.getOutputAvailable() >= frameLength * 2) {
                    this.outputPrimed = true;
                }
                else {
                    return true;
                }
            }
            for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
                const output = outputList[inputNum];
                const channelCount = output.length;
                for (let channelNum = 0; channelNum < channelCount; channelNum++) {
                    const outputChannel = output[channelNum];
                    for (let i = 0; i < quantum; i++) {
                        if (this.getOutputAvailable() > 0) {
                            this.lastSample = this.outputBuffer[this.outputReadPos];
                            this.outputReadPos = (this.outputReadPos + 1) % this.bufferSize;
                            outputChannel[i] = this.lastSample;
                        }
                        else {
                            outputChannel[i] = this.lastSample;
                        }
                    }
                }
            }
            return true;`;

const INIT_NEEDLE =
  "this.tempFrame = new Float32Array(frameLength);\n                this.isInitialized = true;";
const INIT_PATCH =
  "this.tempFrame = new Float32Array(frameLength);\n                this.outputPrimed = false;\n                this.lastSample = 0;\n                this.statTick = 0;\n                this.statFrames = 0;\n                this.statSlowFrames = 0;\n                this.statMaxMs = 0;\n                this.isInitialized = true;";

/**
 * Per-frame timing. `df_process_frame` runs synchronously on the audio render
 * thread; a 480-sample frame has a 10 ms real-time budget but must fit inside
 * the render callback, so anything at or above DF_SLOW_FRAME_MS is counted as
 * a slow frame. The main thread uses the ratio to detect a CPU that cannot
 * keep up (cold WASM tier-up, boot-time contention) and fall back to RNNoise.
 * `Date.now()` is the only clock in AudioWorkletGlobalScope; 1 ms resolution
 * is enough for this threshold.
 */
const FRAME_NEEDLE =
  "const processed = df_process_frame(this.dfModel.handle, this.tempFrame);";
const FRAME_PATCH = `const frameStart = Date.now();
                const processed = df_process_frame(this.dfModel.handle, this.tempFrame);
                const frameMs = Date.now() - frameStart;
                this.statFrames++;
                if (frameMs > this.statMaxMs) this.statMaxMs = frameMs;
                if (frameMs >= ${DF_SLOW_FRAME_MS}) this.statSlowFrames++;`;

export function patchDeepFilterWorkletSource(source: string): string {
  if (!source.includes(BROKEN_OUTPUT)) {
    throw new Error(
      "DeepFilter worklet output loop changed; refusing to load the unpatched processor",
    );
  }
  if (!source.includes(INIT_NEEDLE)) {
    throw new Error(
      "DeepFilter worklet constructor changed; refusing to patch",
    );
  }
  if (!source.includes(FRAME_NEEDLE)) {
    throw new Error("DeepFilter worklet frame loop changed; refusing to patch");
  }
  return source
    .replace(INIT_NEEDLE, INIT_PATCH)
    .replace(FRAME_NEEDLE, FRAME_PATCH)
    .replace(BROKEN_OUTPUT, FIXED_OUTPUT);
}

export function workletHasOutputHole(source: string): boolean {
  return source.includes("if (outputAvailable >= 128)");
}

export async function addPatchedDeepFilterModule(
  addModule: (url: string | URL, options?: WorkletOptions) => Promise<void>,
  moduleURL: string | URL,
  options?: WorkletOptions,
): Promise<void> {
  const url = String(moduleURL);
  if (!url.startsWith("blob:")) {
    await addModule(moduleURL, options);
    return;
  }
  const source = await fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(
        `Failed to read DeepFilter worklet blob: ${response.status}`,
      );
    }
    return response.text();
  });
  const patched = patchDeepFilterWorkletSource(source);
  const blob = new Blob([patched], { type: "application/javascript" });
  const patchedUrl = URL.createObjectURL(blob);
  try {
    await addModule(patchedUrl, options);
  } finally {
    URL.revokeObjectURL(patchedUrl);
  }
}
