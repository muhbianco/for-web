/**
 * Main-thread handle on the Silero VAD Worker.
 *
 * One instance per DeepFilter graph. It owns the Worker and a MessageChannel:
 * `port1` goes to the Worker (frames in, probabilities out), `port2` is
 * handed to the gate worklet. `ready` resolves once the model is loaded and
 * warmed; on failure the caller keeps the plain RMS gate.
 */
import { CONFIGURATION } from "@revolt/common";

import { type VadWorkerCommand, isVadWorkerEvent } from "./vadPolicy";

/** How long model + WASM load may take before we give up and stay RMS-only. */
const VAD_INIT_TIMEOUT_MS = 15_000;

function sileroAssetBase(): string {
  const override = CONFIGURATION.SILERO_VAD_CDN_URL;
  if (override) return override.replace(/\/$/, "");
  const base = import.meta.env.BASE_URL || "/";
  return new URL(
    "noise-suppression/silero-vad",
    `${window.location.origin}${base}`,
  )
    .toString()
    .replace(/\/$/, "");
}

export function canUseVadWorker(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof MessageChannel !== "undefined" &&
    typeof WebAssembly !== "undefined"
  );
}

export class VadClient {
  private worker: Worker;
  private channel: MessageChannel;
  private closed = false;
  /** Worklet end of the channel; transfer it with `attachVadPort`. */
  readonly gatePort: MessagePort;
  readonly ready: Promise<{ loadMs: number }>;

  constructor() {
    this.channel = new MessageChannel();
    this.gatePort = this.channel.port2;
    this.worker = new Worker(new URL("./vadWorker.ts", import.meta.url), {
      type: "module",
      name: "stoat-vad",
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `VAD worker did not become ready in ${VAD_INIT_TIMEOUT_MS} ms`,
          ),
        );
      }, VAD_INIT_TIMEOUT_MS);
      this.worker.onmessage = (event: MessageEvent) => {
        if (!isVadWorkerEvent(event.data)) return;
        if (event.data.type === "ready") {
          clearTimeout(timer);
          resolve({ loadMs: event.data.loadMs });
        } else {
          clearTimeout(timer);
          reject(new Error(event.data.message));
        }
      };
      this.worker.onerror = (event: ErrorEvent) => {
        clearTimeout(timer);
        reject(new Error(event.message || "VAD worker crashed"));
      };
    });
    const init: VadWorkerCommand = {
      type: "init",
      assetBase: sileroAssetBase(),
      port: this.channel.port1,
    };
    this.worker.postMessage(init, [this.channel.port1]);
  }

  /** Forget the recurrent state (new capture device / rewired graph). */
  reset() {
    if (this.closed) return;
    const cmd: VadWorkerCommand = { type: "reset" };
    this.worker.postMessage(cmd);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const cmd: VadWorkerCommand = { type: "close" };
    try {
      this.worker.postMessage(cmd);
    } catch {
      // Worker may already be gone.
    }
    this.worker.terminate();
    try {
      // Usually already transferred to the worklet (then this is a no-op).
      this.channel.port2.close();
    } catch {
      // ignore
    }
  }
}
