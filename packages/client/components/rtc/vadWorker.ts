/**
 * Silero VAD v5 in a dedicated Worker.
 *
 * AudioWorkletGlobalScope cannot fetch or stream-compile WASM, so the gate
 * worklet ships 16 kHz frames here over a MessagePort and gets one speech
 * probability back per frame. onnxruntime-web runs single-threaded WASM
 * (no SharedArrayBuffer / COOP headers needed); one 512-sample frame costs
 * ~1–3 ms on a laptop core.
 *
 * Only the newest frame is inferred when the Worker is behind: an old
 * probability is worth less than a fresh one to the gate, and a backlog
 * would only add latency.
 */
import { InferenceSession, Tensor, env } from "onnxruntime-web/wasm";

import {
  type VadFrameMessage,
  type VadProbMessage,
  type VadWorkerCommand,
  type VadWorkerEvent,
  VAD_FRAME_SAMPLES_16K,
  VAD_SAMPLE_RATE,
} from "./vadPolicy";

/** The DOM lib types `self` as Window; this is what a Worker really has. */
interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}
const scope = self as unknown as WorkerScope;

/** Silero v5 recurrent state: [2, 1, 128]. */
const STATE_SHAPE: [number, number, number] = [2, 1, 128];
const STATE_SIZE = STATE_SHAPE[0] * STATE_SHAPE[1] * STATE_SHAPE[2];
/**
 * Silero v5 prepends the last 64 samples of the previous frame to each
 * 512-sample frame (the official wrapper's `_context`), so the ONNX input is
 * [1, 576]. Without it the model runs but scores everything near zero.
 */
const CONTEXT_SAMPLES = 64;
const INPUT_SAMPLES = CONTEXT_SAMPLES + VAD_FRAME_SAMPLES_16K;

let session: InferenceSession | undefined;
/** ORT hands back Float32Array<ArrayBufferLike>; keep the looser type. */
let state: Float32Array = new Float32Array(STATE_SIZE);
/** Reused input buffer: [context | frame]. */
const inputBuffer = new Float32Array(INPUT_SAMPLES);
/** 0-d int64 like the reference `np.array(sr, dtype="int64")`. */
const srTensor = new Tensor(
  "int64",
  BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]),
  [],
);

function resetRecurrentState() {
  state = new Float32Array(STATE_SIZE);
  inputBuffer.fill(0, 0, CONTEXT_SAMPLES);
}

let framePort: MessagePort | undefined;
let busy = false;
let pending: VadFrameMessage | undefined;

function emit(event: VadWorkerEvent) {
  scope.postMessage(event);
}

function isFrame(data: unknown): data is VadFrameMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<VadFrameMessage>;
  return (
    d.type === "frame" &&
    d.pcm instanceof Float32Array &&
    d.pcm.length === VAD_FRAME_SAMPLES_16K &&
    typeof d.seq === "number"
  );
}

async function infer(frame: VadFrameMessage): Promise<void> {
  if (!session || !framePort) return;
  const started = performance.now();
  // [context (64) | frame (512)]; the context is the tail of the last frame.
  inputBuffer.set(frame.pcm, CONTEXT_SAMPLES);
  const feeds: Record<string, Tensor> = {
    input: new Tensor("float32", inputBuffer, [1, INPUT_SAMPLES]),
    state: new Tensor(
      "float32",
      state as Float32Array<ArrayBuffer>,
      STATE_SHAPE,
    ),
    sr: srTensor,
  };
  const results = await session.run(feeds);
  const out = results.output?.data as Float32Array | undefined;
  const next = results.stateN?.data as Float32Array | undefined;
  if (next && next.length === STATE_SIZE) state = next;
  inputBuffer.copyWithin(0, INPUT_SAMPLES - CONTEXT_SAMPLES, INPUT_SAMPLES);
  const prob = out && out.length > 0 ? out[0] : 0;
  // Warm-up frames (negative seq) are not reported to the gate.
  if (frame.seq < 0) return;
  const reply: VadProbMessage = {
    type: "prob",
    seq: frame.seq,
    prob,
    ms: performance.now() - started,
  };
  framePort.postMessage(reply);
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    while (pending) {
      const frame = pending;
      pending = undefined;
      await infer(frame);
    }
  } catch (error) {
    emit({ type: "error", message: errorMessage(error) });
  } finally {
    busy = false;
  }
}

function onFrame(event: MessageEvent) {
  if (!isFrame(event.data)) return;
  // Keep only the newest frame; see file header.
  pending = event.data;
  void drain();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function init(cmd: Extract<VadWorkerCommand, { type: "init" }>) {
  const started = performance.now();
  const base = cmd.assetBase.replace(/\/$/, "");
  // The ORT WASM binary is resolved by the bundler (import.meta.url) into a
  // content-hashed asset next to this Worker, so it always matches the
  // installed onnxruntime-web; no wasmPaths override needed.
  env.wasm.numThreads = 1;
  env.wasm.proxy = false;
  env.logLevel = "error";

  const modelUrl = `${base}/v5/silero_vad.onnx`;
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Silero VAD model: ${response.status} ${modelUrl}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  session = await InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  resetRecurrentState();

  framePort = cmd.port;
  framePort.onmessage = onFrame;
  framePort.start?.();

  // Warm the graph so the first real frame is not the slow one.
  await infer({
    type: "frame",
    pcm: new Float32Array(VAD_FRAME_SAMPLES_16K),
    seq: -1,
  });
  resetRecurrentState();

  emit({ type: "ready", loadMs: performance.now() - started });
}

scope.onmessage = (event: MessageEvent) => {
  const cmd = event.data as VadWorkerCommand | undefined;
  if (!cmd || typeof cmd !== "object") return;
  switch (cmd.type) {
    case "init":
      init(cmd).catch((error) => {
        emit({ type: "error", message: errorMessage(error) });
      });
      break;
    case "reset":
      resetRecurrentState();
      break;
    case "close":
      framePort?.close();
      framePort = undefined;
      void session?.release();
      session = undefined;
      scope.close();
      break;
  }
};
