/**
 * Voice gate policy: the microphone opens on *speech*, not on loudness.
 *
 * The RMS gate alone opens on anything loud (a dog bark, a keyboard). Silero
 * VAD gives a speech probability per 32 ms frame; the gate requires both
 * "loud enough" and "probably speech" to open, and holds a little before
 * closing so pauses between words do not chop.
 *
 * Everything here is free of imports so `decideGate` can be embedded verbatim
 * into the AudioWorklet source (see rmsGateProcessor.ts) and unit-tested in
 * Node with the same code.
 */

/** Silero VAD v5 runs on 16 kHz, 512-sample (32 ms) frames. */
export const VAD_SAMPLE_RATE = 16000;
export const VAD_FRAME_SAMPLES_16K = 512;
/** Graph sample rate; DeepFilter forces 48 kHz. 48000 / 16000 = 3. */
export const VAD_DECIMATION = 3;
/** One VAD frame in graph samples: 512 * 3. */
export const VAD_LOOKAHEAD_48K = VAD_FRAME_SAMPLES_16K * VAD_DECIMATION;
/** Render quantum of the Web Audio graph. */
export const RENDER_QUANTUM = 128;
/** Quanta per VAD frame: 1536 / 128. */
export const VAD_FRAME_QUANTA = VAD_LOOKAHEAD_48K / RENDER_QUANTUM;

/** Speech probability needed to open. */
export const VAD_OPEN = 0.5;
/** Below this the frame counts as non-speech while open. */
export const VAD_CLOSE = 0.35;
/** Loud but non-speech for this long closes the gate (bark after a sentence). */
export const VAD_HOLD_MS = 200;
/** Quiet (RMS below close threshold) for this long closes; covers the lookahead tail. */
export const RMS_QUIET_HOLD_MS = 40;
/** No probability from the Worker for this long → treat VAD as gone, RMS only. */
export const VAD_STALE_MS = 600;

const QUANTUM_MS = (RENDER_QUANTUM / 48000) * 1000;
export const VAD_HOLD_QUANTA = Math.round(VAD_HOLD_MS / QUANTUM_MS);
export const RMS_QUIET_HOLD_QUANTA = Math.round(RMS_QUIET_HOLD_MS / QUANTUM_MS);
export const VAD_STALE_QUANTA = Math.round(VAD_STALE_MS / QUANTUM_MS);

export type VadEngineId = "silero" | "rms-only" | "off";

export interface GateDecisionState {
  open: boolean;
  /** Consecutive quanta the current "should close" condition has held. */
  hold: number;
}

export interface GateDecisionInput {
  rms: number;
  openTh: number;
  closeTh: number;
  /** Latest speech probability, or -1 when the VAD is not delivering. */
  prob: number;
  /** True while the VAD is active and its probability is fresh. */
  vadActive: boolean;
  vadOpen: number;
  vadClose: number;
  vadHoldQuanta: number;
  quietHoldQuanta: number;
}

/**
 * One gate decision per render quantum. Mutates and returns `state`.
 *
 * Without VAD this is exactly the legacy RMS gate: open above `openTh`,
 * close the moment RMS drops under `closeTh`. With VAD:
 * - open needs RMS above `openTh` AND prob >= `vadOpen`;
 * - quiet input closes after `quietHoldQuanta` (lets the lookahead tail out);
 * - loud non-speech (prob < `vadClose`) closes after `vadHoldQuanta`.
 *
 * Self-contained on purpose: this function's source is inlined into the
 * worklet, so it must not reference anything outside its own body.
 */
export function decideGate(
  s: GateDecisionState,
  i: GateDecisionInput,
): GateDecisionState {
  if (!i.vadActive) {
    s.hold = 0;
    if (s.open) {
      if (i.rms < i.closeTh) s.open = false;
    } else if (i.rms > i.openTh) {
      s.open = true;
    }
    return s;
  }
  if (!s.open) {
    s.hold = 0;
    if (i.rms > i.openTh && i.prob >= i.vadOpen) s.open = true;
    return s;
  }
  const quiet = i.rms < i.closeTh;
  const nonSpeech = i.prob < i.vadClose;
  if (!quiet && !nonSpeech) {
    s.hold = 0;
    return s;
  }
  s.hold += 1;
  if (quiet && s.hold >= i.quietHoldQuanta) {
    s.open = false;
    s.hold = 0;
  } else if (nonSpeech && s.hold >= i.vadHoldQuanta) {
    s.open = false;
    s.hold = 0;
  }
  return s;
}

export interface DecimatorState {
  /** Up to 2 leftover 48 kHz samples from the previous call. */
  carry: Float32Array;
  carryLen: number;
  /** 16 kHz frame being filled (VAD_FRAME_SAMPLES_16K long). */
  frame: Float32Array;
  frameLen: number;
}

export function createDecimatorState(frameSamples: number): DecimatorState {
  return {
    // Holds a partial triplet; the third slot is filled right before averaging.
    carry: new Float32Array(3),
    carryLen: 0,
    frame: new Float32Array(frameSamples),
    frameLen: 0,
  };
}

/**
 * 48 kHz → 16 kHz by averaging every 3 samples (a cheap low-pass; Silero is
 * tolerant of the residual aliasing at speech bandwidth). 128-sample quanta
 * are not a multiple of 3, so leftovers carry over to the next call. Returns
 * true when `state.frame` is full; the caller ships it and resets
 * `state.frameLen`. Any input beyond a full frame is dropped for that call
 * (cannot happen with 128-sample quanta and a 512-sample frame).
 *
 * Self-contained: inlined into the worklet source.
 */
export function pushDecimated(
  state: DecimatorState,
  input: Float32Array,
): boolean {
  let k = 0;
  const frame = state.frame;
  // Finish a triplet started in the previous quantum.
  if (state.carryLen > 0) {
    while (state.carryLen < 3 && k < input.length) {
      state.carry[state.carryLen++] = input[k++];
    }
    if (state.carryLen < 3) return false;
    if (state.frameLen < frame.length) {
      frame[state.frameLen++] =
        (state.carry[0] + state.carry[1] + state.carry[2]) / 3;
    }
    state.carryLen = 0;
  }
  for (; k + 2 < input.length; k += 3) {
    if (state.frameLen >= frame.length) break;
    frame[state.frameLen++] = (input[k] + input[k + 1] + input[k + 2]) / 3;
  }
  for (; k < input.length; k++) {
    if (state.carryLen < 2) state.carry[state.carryLen++] = input[k];
  }
  return state.frameLen >= frame.length;
}

/** Message the gate worklet sends to the VAD Worker: one 16 kHz frame. */
export interface VadFrameMessage {
  type: "frame";
  /** 512 samples, transferred. */
  pcm: Float32Array;
  /** Monotonic frame counter so late replies can be ignored. */
  seq: number;
}

/** Reply from the Worker for one frame. */
export interface VadProbMessage {
  type: "prob";
  seq: number;
  prob: number;
  /** Inference wall time (ms). */
  ms: number;
}

/** Worker lifecycle messages (main thread ↔ Worker). */
export type VadWorkerCommand =
  | {
      type: "init";
      /** Base URL for `v5/silero_vad.onnx`. */
      assetBase: string;
      /** Worker end of the channel; frames arrive here, probabilities go back. */
      port: MessagePort;
    }
  | { type: "reset" }
  | { type: "close" };

export type VadWorkerEvent =
  | { type: "ready"; loadMs: number }
  | { type: "error"; message: string };

export function isVadProbMessage(data: unknown): data is VadProbMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<VadProbMessage>;
  return (
    d.type === "prob" &&
    typeof d.seq === "number" &&
    typeof d.prob === "number" &&
    typeof d.ms === "number"
  );
}

export function isVadWorkerEvent(data: unknown): data is VadWorkerEvent {
  if (!data || typeof data !== "object") return false;
  const d = data as { type?: unknown };
  return d.type === "ready" || d.type === "error";
}
