import type { DeepFilterNet3Core } from "deepfilternet3-noise-filter";
import { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { RNNoiseNode } from "livekit-rnnoise-processor";
import { createEffect, createRoot } from "solid-js";

import { CONFIGURATION } from "@revolt/common";
import { Voice } from "@revolt/state/stores/Voice";
import {
  DEEPFILTER_ATTEN_DB,
  DEEPFILTER_AUTO_STEP_DB,
  deepFilterAttenDb,
  gateThresholdsFromSensitivity,
  rmsToDbfs,
} from "@revolt/state/stores/noiseSuppressionPolicy";

import { DeepFilterHealth } from "./deepFilterHealth";
import { canUseDeepFilter } from "./deepFilterSupport";
import {
  addPatchedDeepFilterModule,
  isDeepFilterStats,
} from "./patchDeepFilterWorklet";
import {
  attachVadPort,
  detachVadPort,
  ensureRmsGateNode,
} from "./rmsGateWorklet";
import { VadClient, canUseVadWorker } from "./vadClient";
import type { VadEngineId } from "./vadPolicy";
import type { VoiceEngineId } from "./voiceEngineStatus";

/**
 * Microphone processing pipeline (runs on the LocalAudioTrack, i.e. on raw
 * PCM *before* the Opus encoder and before LiveKit publishes the track).
 *
 *   getUserMedia (EC on, AGC off in ML modes, browser NS off in ML modes)
 *     -> highpass 50 Hz (explicit mono: a stereo capture is downmixed here)
 *     -> ONE neural noise suppressor: DeepFilterNet3 (default) or RNNoise
 *     -> voice gate (DeepFilter only, sits *after* the suppressor)
 *          RMS + Silero VAD speech probability; 32 ms lookahead
 *     -> brickwall compressor (limiter)
 *     -> input gain
 *     -> processedTrack (mono) -> Opus -> LiveKit
 *
 * Voice gate: the RMS gate alone opens on anything loud (dog bark, keyboard).
 * A Silero VAD Worker (see vadWorker.ts) scores each 32 ms frame; the gate
 * needs "loud AND probably speech" to open. If the Worker fails to load or
 * stops answering, the worklet falls back to RMS by itself (vadEngine
 * "rms-only"); voice never goes silent because of the VAD.
 *
 * The whole graph is forced to one channel. The suppressors only look at
 * channel 0, and a 2-channel destination would make LiveKit publish
 * `stereo=1`; any node that fills channel 0 only then reaches the listener as
 * "voice in the left ear only".
 *
 * Rule: exactly one noise suppressor per signal path. Browser NS /
 * voiceIsolation are only requested when the user picks the "browser" mode
 * (see noiseSuppressionPolicy.captureBrowserNoiseSuppression); DeepFilter and
 * RNNoise are never wired at the same time. Stacking suppressors produces
 * metallic / "2004 phone" artifacts.
 *
 * Fallback: when "advanced" (DeepFilter) is selected but the device fails
 * canUseDeepFilter(), the 48 kHz context cannot be created, or the worklet
 * fails to load, we silently wire RNNoise instead and only console.warn +
 * surface `lastError` in the settings diagnostics. Never browser NS.
 *
 * DeepFilter strength: `noiseReductionLevel` / `setSuppressionLevel` map to
 * DeepFilterNet's `atten_lim_db`. The "auto" preset measures the pre-filter
 * noise floor while the gate is closed (nobody talking) and picks the limit
 * from that; fixed presets use DEEPFILTER_ATTEN_DB.
 *
 * Overload: the patched worklet reports per-frame timing once a second. When
 * DeepFilterHealth sees the model falling behind real time for several
 * seconds (cold WASM, busy CPU right after boot) the chain is rewired to
 * RNNoise on the same context, keeping the published track, and the reason is
 * surfaced in `lastError`.
 */

let sharedDeepFilterCore: Promise<DeepFilterNet3Core> | undefined;
const deepFilterNodes = new WeakMap<BaseAudioContext, AudioWorkletNode>();

/** How often the auto preset samples the pre-filter noise floor. */
const NOISE_FLOOR_POLL_MS = 200;
/** EMA coefficient for the noise floor (slow: fans, not keystrokes). */
const NOISE_FLOOR_EMA = 0.1;

export interface VoiceProcessorSnapshot {
  engine: VoiceEngineId;
  sampleRate?: number;
  lastError?: string;
  inputRms?: number;
  gateOpen?: boolean;
  gateOpenThreshold?: number;
  /** Current DeepFilter attenuation limit (dB). */
  deepFilterAttenDb?: number;
  /** Estimated pre-filter background noise (dBFS), auto preset only. */
  noiseFloorDb?: number;
  /** Slowest DeepFilter frame in the last second (ms). */
  deepFilterMaxFrameMs?: number;
  /** Share of slow DeepFilter frames in the last second (0-1). */
  deepFilterSlowRatio?: number;
  /** True once DeepFilter was replaced by RNNoise because it fell behind. */
  deepFilterOverloaded?: boolean;
  /** Which signal decides the gate right now. */
  vadEngine?: VadEngineId;
  /** Latest Silero speech probability (0-1) while the VAD is live. */
  speechProb?: number;
  /** Last VAD inference wall time (ms). */
  vadInferMs?: number;
  /** Why the VAD is not running, if it is not. */
  vadError?: string;
}

function deepFilterCdnUrl(): string {
  const override = CONFIGURATION.DEEPFILTERNET_CDN_URL;
  if (override) return override.replace(/\/$/, "");

  const base = import.meta.env.BASE_URL || "/";
  return new URL(
    "noise-suppression/deepfilternet3",
    `${window.location.origin}${base}`,
  )
    .toString()
    .replace(/\/$/, "");
}

function getDeepFilterCore(): Promise<DeepFilterNet3Core> {
  if (!sharedDeepFilterCore) {
    sharedDeepFilterCore = import("deepfilternet3-noise-filter")
      .then(async ({ DeepFilterNet3Core }) => {
        const core = new DeepFilterNet3Core({
          sampleRate: 48000,
          // Initial atten_lim; applyDeepFilterStrength() overrides it live.
          noiseReductionLevel: DEEPFILTER_ATTEN_DB.strong,
          assetConfig: { cdnUrl: deepFilterCdnUrl() },
        });
        await core.initialize();
        return core;
      })
      .catch((error) => {
        sharedDeepFilterCore = undefined;
        throw error;
      });
  }
  return sharedDeepFilterCore;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Mix whatever arrives at this node's input down to one channel. */
function forceMono(node: AudioNode) {
  node.channelCount = 1;
  node.channelCountMode = "explicit";
  node.channelInterpretation = "speakers";
}

export class VoiceProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  readonly name = "stoat-voice-processor";
  processedTrack?: MediaStreamTrack;

  private livekitContext?: AudioContext;
  private dfContext?: AudioContext;
  private settings: Voice;
  private graphToken = 0;
  private lastError?: string;
  private engine: VoiceEngineId = "bypass";
  private onStatus?: () => void;
  private sourceTrack?: MediaStreamTrack;
  private lastRms?: number;
  private gateOpen = false;
  private gateOpenThreshold?: number;
  private deepFilterCore?: DeepFilterNet3Core;
  private deepFilterAttenDb?: number;
  private noiseFloorDb?: number;
  private noiseFloorTimer?: ReturnType<typeof setInterval>;
  private analyserNode?: AnalyserNode;
  private deepFilterHealth?: DeepFilterHealth;
  /** Set when DeepFilter fell behind on this device; stays on for the call. */
  private deepFilterOverloaded = false;
  private degrading = false;

  private vadClient?: VadClient;
  private vadActive = false;
  private speechProb?: number;
  private vadInferMs?: number;
  private vadError?: string;

  private noiseSuppressionNode?: RNNoiseNode;
  private deepFilterNode?: AudioWorkletNode;
  private gateNode?: AudioWorkletNode;
  private sourceNode?: MediaStreamAudioSourceNode;
  private highpassNode?: BiquadFilterNode;
  private compressorNode?: DynamicsCompressorNode;
  private gainNode?: GainNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  private disposeSolidjsContext: () => void = () => {};

  constructor(voiceSettings: Voice, onStatus?: () => void) {
    this.settings = voiceSettings;
    this.onStatus = onStatus;

    createRoot((dispose) => {
      createEffect(() => {
        this.setGain(this.getSettings().inputVolume);
        this.applyGateSettings();
        this.applyDeepFilterStrength();
      });
      // Toggling the voice gate mid-call starts/stops the Worker; the
      // `vadMode` param above already tells the worklet which path to use.
      createEffect(() => {
        const wanted = this.getSettings().voiceGate;
        if (!this.gateNode || this.engine !== "deepfilter") return;
        if (wanted && !this.vadClient) {
          this.startVad(this.gateNode, this.graphToken);
        } else if (!wanted && this.vadClient) {
          this.stopVad();
          this.emitStatus();
        }
      });
      this.disposeSolidjsContext = dispose;
    });
  }

  getSnapshot(): VoiceProcessorSnapshot {
    const graphContext = this.destinationNode?.context as
      | AudioContext
      | undefined;
    return {
      engine: this.engine,
      sampleRate: graphContext?.sampleRate,
      lastError: this.lastError,
      inputRms: this.lastRms,
      gateOpen: this.gateOpen,
      gateOpenThreshold: this.gateOpenThreshold,
      deepFilterAttenDb:
        this.engine === "deepfilter" ? this.deepFilterAttenDb : undefined,
      noiseFloorDb:
        this.engine === "deepfilter" ? this.noiseFloorDb : undefined,
      deepFilterMaxFrameMs:
        this.engine === "deepfilter"
          ? this.deepFilterHealth?.snapshot().lastMaxMs
          : undefined,
      deepFilterSlowRatio:
        this.engine === "deepfilter"
          ? this.deepFilterHealth?.snapshot().lastSlowRatio
          : undefined,
      deepFilterOverloaded: this.deepFilterOverloaded,
      vadEngine: this.vadEngine(),
      speechProb: this.vadActive ? this.speechProb : undefined,
      vadInferMs: this.vadActive ? this.vadInferMs : undefined,
      vadError: this.vadError,
    };
  }

  private vadEngine(): VadEngineId | undefined {
    if (this.engine !== "deepfilter" || !this.gateNode) return undefined;
    if (!this.settings.voiceGate) return "off";
    return this.vadActive ? "silero" : "rms-only";
  }

  private getSettings(): Voice {
    return this.settings;
  }

  private setGain(newGain: number) {
    if (this.gainNode) {
      this.gainNode.gain.value = newGain;
    }
  }

  private applyGateSettings() {
    const auto = this.settings.autoInputSensitivity;
    const { open, close } = gateThresholdsFromSensitivity(
      this.settings.inputSensitivity,
    );
    const params = this.gateNode?.parameters;
    if (!params) return;
    const openParam = params.get("openThreshold");
    const closeParam = params.get("closeThreshold");
    const autoParam = params.get("autoMode");
    const vadParam = params.get("vadMode");
    if (openParam) openParam.value = open;
    if (closeParam) closeParam.value = close;
    if (autoParam) autoParam.value = auto ? 1 : 0;
    if (vadParam) vadParam.value = this.settings.voiceGate ? 1 : 0;
    if (!auto) this.gateOpenThreshold = open;
  }

  /**
   * Spin up the Silero Worker for this gate. Non-blocking: the gate runs as
   * a plain RMS gate until the Worker reports ready, and stays that way if
   * it never does. Failures are logged and shown in diagnostics only.
   */
  private startVad(gate: AudioWorkletNode, token: number) {
    this.stopVad();
    this.vadError = undefined;
    if (!this.settings.voiceGate) return;
    if (!canUseVadWorker()) {
      this.vadError =
        "this browser cannot run the VAD worker; using the RMS gate";
      this.emitStatus();
      return;
    }
    let client: VadClient;
    try {
      client = new VadClient();
    } catch (error) {
      this.vadError = `VAD worker failed to start: ${errorMessage(error)}`;
      console.warn("[voice]", this.vadError);
      this.emitStatus();
      return;
    }
    this.vadClient = client;
    client.ready
      .then(({ loadMs }) => {
        if (token !== this.graphToken || this.vadClient !== client) {
          client.close();
          return;
        }
        attachVadPort(gate, client.gatePort);
        console.info(`[voice] Silero VAD ready in ${Math.round(loadMs)} ms`);
      })
      .catch((error) => {
        if (this.vadClient === client) {
          this.vadClient = undefined;
          this.vadError = `VAD unavailable, using the RMS gate: ${errorMessage(error)}`;
          console.warn("[voice]", this.vadError);
        }
        client.close();
        this.emitStatus();
      });
  }

  private stopVad() {
    if (this.gateNode && this.vadClient) {
      try {
        detachVadPort(this.gateNode);
      } catch {
        // gate may already be gone
      }
    }
    this.vadClient?.close();
    this.vadClient = undefined;
    this.vadActive = false;
    this.speechProb = undefined;
    this.vadInferMs = undefined;
  }

  /**
   * Push the DeepFilter attenuation limit for the current preset. Auto uses
   * the tracked noise floor; changes smaller than DEEPFILTER_AUTO_STEP_DB are
   * ignored so the model is not re-tuned on every poll.
   */
  private applyDeepFilterStrength() {
    const sensitivity = this.settings.deepFilterSensitivity;
    if (!this.deepFilterCore || this.engine !== "deepfilter") return;
    const target = deepFilterAttenDb(sensitivity, this.noiseFloorDb);
    if (
      this.deepFilterAttenDb !== undefined &&
      Math.abs(target - this.deepFilterAttenDb) < DEEPFILTER_AUTO_STEP_DB
    ) {
      return;
    }
    this.deepFilterAttenDb = target;
    this.deepFilterCore.setSuppressionLevel(target);
    this.emitStatus();
  }

  /**
   * Sample the pre-DeepFilter signal while the gate is closed (no speech) and
   * keep a slow EMA of the room noise floor for the auto preset.
   */
  private startNoiseFloorTracking(context: AudioContext, tap: AudioNode) {
    this.stopNoiseFloorTracking();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    tap.connect(analyser);
    this.analyserNode = analyser;
    const buffer = new Float32Array(analyser.fftSize);
    this.noiseFloorTimer = setInterval(() => {
      if (this.engine !== "deepfilter" || !this.analyserNode) return;
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      const db = rmsToDbfs(Math.sqrt(sum / buffer.length));
      // Gate open = someone talking; that is not the floor.
      if (this.gateOpen) return;
      this.noiseFloorDb =
        this.noiseFloorDb === undefined
          ? db
          : this.noiseFloorDb + (db - this.noiseFloorDb) * NOISE_FLOOR_EMA;
      if (this.settings.deepFilterSensitivity === "auto") {
        this.applyDeepFilterStrength();
      }
    }, NOISE_FLOOR_POLL_MS);
  }

  private stopNoiseFloorTracking() {
    if (this.noiseFloorTimer) {
      clearInterval(this.noiseFloorTimer);
      this.noiseFloorTimer = undefined;
    }
    this.analyserNode?.disconnect();
    this.analyserNode = undefined;
  }

  private listenToGate(gate: AudioWorkletNode) {
    gate.port.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        rms?: number;
        open?: boolean;
        threshold?: number;
        vadActive?: boolean;
        prob?: number;
        inferMs?: number;
      };
      if (typeof data?.rms !== "number") return;
      this.lastRms = data.rms;
      this.gateOpen = !!data.open;
      if (typeof data.threshold === "number") {
        this.gateOpenThreshold = data.threshold;
      }
      this.vadActive = !!data.vadActive;
      this.speechProb = typeof data.prob === "number" ? data.prob : undefined;
      this.vadInferMs =
        typeof data.inferMs === "number" ? data.inferMs : undefined;
      this.emitStatus();
    };
  }

  /**
   * Per-second frame timing from the patched worklet. Three slow seconds in a
   * row means the CPU cannot run the model in real time right now; rewire to
   * RNNoise instead of letting the voice chop.
   */
  private listenToDeepFilterStats(
    node: AudioWorkletNode,
    context: AudioContext,
  ) {
    const health = new DeepFilterHealth();
    this.deepFilterHealth = health;
    node.port.onmessage = (event: MessageEvent) => {
      if (!isDeepFilterStats(event.data)) return;
      if (this.engine !== "deepfilter" || this.deepFilterNode !== node) return;
      const overloaded = health.observe(event.data);
      this.emitStatus();
      if (overloaded && !this.degrading) {
        void this.degradeToRnnoise(context, event.data.maxMs);
      }
    };
  }

  private async degradeToRnnoise(context: AudioContext, maxMs: number) {
    this.degrading = true;
    const token = ++this.graphToken;
    try {
      await RNNoiseNode.loadModule(
        context,
        CONFIGURATION.RNNOISE_WORKLET_CDN_URL,
      );
      if (token !== this.graphToken || !this.sourceNode || !this.gainNode)
        return;
      this.disconnectNoiseGraph();
      this.deepFilterOverloaded = true;
      this.connectRnnoise(context);
      this.lastError = `DeepFilterNet fell behind real time (slowest frame ${maxMs} ms); using RNNoise for this call`;
      console.warn("[voice]", this.lastError);
    } catch (error) {
      // Keep DeepFilter running rather than dropping to no suppression.
      console.warn(
        "[voice] RNNoise fallback failed; staying on DeepFilter",
        error,
      );
    } finally {
      this.degrading = false;
      this.emitStatus();
    }
  }

  private emitStatus() {
    this.onStatus?.();
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    if (opts.audioContext) {
      await RNNoiseNode.loadModule(
        opts.audioContext,
        CONFIGURATION.RNNOISE_WORKLET_CDN_URL,
      );
    }
    return this.build(opts);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    return this.build(opts);
  }

  async destroy(): Promise<void> {
    this.disposeSolidjsContext();
    this.livekitContext = undefined;
    this.sourceTrack = undefined;
    await this.teardown();
    if (this.dfContext) {
      void this.dfContext.close();
      this.dfContext = undefined;
    }
    this.deepFilterNode = undefined;
    this.deepFilterCore = undefined;
    this.engine = "bypass";
    this.emitStatus();
  }

  private disconnectNoiseGraph() {
    this.stopVad();
    if (this.gateNode) {
      this.gateNode.port.onmessage = null;
    }
    if (this.deepFilterNode) {
      this.deepFilterNode.port.onmessage = null;
    }
    this.deepFilterHealth = undefined;
    this.stopNoiseFloorTracking();
    this.deepFilterAttenDb = undefined;
    this.noiseFloorDb = undefined;
    this.compressorNode?.disconnect();
    this.gateNode?.disconnect();
    this.noiseSuppressionNode?.disconnect();
    this.deepFilterNode?.disconnect();
    this.highpassNode?.disconnect();
    this.sourceNode?.disconnect();
    this.compressorNode = undefined;
    this.gateNode = undefined;
    this.lastRms = undefined;
    this.gateOpen = false;
    this.gateOpenThreshold = undefined;
    this.noiseSuppressionNode = undefined;
    this.highpassNode = undefined;
  }

  private connectMlChain(
    nsNode: AudioNode,
    context: AudioContext,
    gate?: AudioNode,
  ) {
    this.highpassNode = context.createBiquadFilter();
    this.highpassNode.type = "highpass";
    this.highpassNode.frequency.value = 50;
    this.highpassNode.Q.value = Math.SQRT1_2;
    // Head of the chain: downmix a stereo capture to mono before any
    // suppressor sees it (they only process channel 0).
    forceMono(this.highpassNode);

    this.compressorNode = context.createDynamicsCompressor();
    this.compressorNode.threshold.value = -3;
    this.compressorNode.knee.value = 0;
    this.compressorNode.ratio.value = 20;
    this.compressorNode.attack.value = 0.003;
    this.compressorNode.release.value = 0.05;

    this.sourceNode!.connect(this.highpassNode);
    this.highpassNode.connect(nsNode);
    if (gate) {
      nsNode.connect(gate);
      gate.connect(this.compressorNode);
    } else {
      nsNode.connect(this.compressorNode);
    }
    this.compressorNode.connect(this.gainNode!);
  }

  private connectRnnoise(context: AudioContext) {
    this.noiseSuppressionNode = new RNNoiseNode(context);
    this.connectMlChain(this.noiseSuppressionNode, context);
    this.engine = "rnnoise";
  }

  private connectBypass() {
    this.sourceNode!.connect(this.gainNode!);
  }

  private async ensureDfContext(): Promise<AudioContext> {
    if (this.dfContext && this.dfContext.state !== "closed") {
      if (this.dfContext.state === "suspended") {
        await this.dfContext.resume().catch(() => undefined);
      }
      return this.dfContext;
    }
    const ctx = new AudioContext({
      sampleRate: 48000,
      latencyHint: "interactive",
    });
    if (ctx.sampleRate !== 48000) {
      const rate = ctx.sampleRate;
      await ctx.close();
      throw new Error(
        `AudioContext sampleRate is ${rate}, DeepFilterNet needs 48000`,
      );
    }
    this.dfContext = ctx;
    return ctx;
  }

  private async ensureDeepFilterNode(
    context: AudioContext,
  ): Promise<AudioWorkletNode> {
    const cached = deepFilterNodes.get(context);
    if (cached) {
      this.deepFilterNode = cached;
      return cached;
    }
    const core = await getDeepFilterCore();
    this.deepFilterCore = core;
    const worklet = context.audioWorklet;
    const addModule = worklet.addModule.bind(worklet);
    worklet.addModule = (moduleURL: string | URL, options?: WorkletOptions) =>
      addPatchedDeepFilterModule(addModule, moduleURL, options);
    try {
      const node = await core.createAudioWorkletNode(context);
      // The worklet copies channel 0 to every output channel; keep it at one
      // so the rest of the chain never widens again.
      forceMono(node);
      deepFilterNodes.set(context, node);
      this.deepFilterNode = node;
      return node;
    } finally {
      worklet.addModule = addModule;
    }
  }

  private async openGraph(
    context: AudioContext,
    track: MediaStreamTrack,
  ): Promise<void> {
    this.sourceNode = context.createMediaStreamSource(new MediaStream([track]));
    this.gainNode = context.createGain();
    this.gainNode.gain.value = this.settings.inputVolume;
    // Bypass / browser modes connect source -> gain directly, so the gain
    // node is the mono point there. The destination defaults to 2 channels,
    // which is what LiveKit reads as a stereo input.
    forceMono(this.gainNode);
    this.destinationNode = context.createMediaStreamDestination();
    this.destinationNode.channelCount = 1;
    this.gainNode.connect(this.destinationNode);
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  private async wireGraph(context: AudioContext): Promise<void> {
    const token = ++this.graphToken;
    const mode = this.settings.noiseSupression;
    this.disconnectNoiseGraph();

    if (!this.sourceNode || !this.gainNode) return;

    if (mode === "browser") {
      this.connectBypass();
      this.engine = "browser-ns";
      this.lastError = undefined;
      return;
    }

    if (mode === "disabled") {
      this.connectBypass();
      this.engine = "bypass";
      this.lastError = undefined;
      return;
    }

    if (mode === "advanced" && this.deepFilterOverloaded) {
      // Already proven too slow during this call; do not retry on rewire.
      // `context` may be the 48 kHz DeepFilter context, which never saw
      // RNNoise's worklet; addModule with the same URL is idempotent.
      await RNNoiseNode.loadModule(
        context,
        CONFIGURATION.RNNOISE_WORKLET_CDN_URL,
      );
      if (token !== this.graphToken) return;
      this.connectRnnoise(context);
      return;
    }

    if (mode === "advanced" && canUseDeepFilter()) {
      try {
        const node = await this.ensureDeepFilterNode(context);
        const gate = await ensureRmsGateNode(context);
        if (token !== this.graphToken) return;
        if (this.settings.noiseSupression !== "advanced") return;
        this.gateNode = gate;
        this.listenToGate(gate);
        this.listenToDeepFilterStats(node, context);
        this.applyGateSettings();
        this.connectMlChain(node, context, gate);
        this.engine = "deepfilter";
        this.lastError = undefined;
        this.startVad(gate, token);
        // Pre-filter tap for the auto preset; applies the initial atten_lim.
        this.startNoiseFloorTracking(context, this.highpassNode!);
        this.applyDeepFilterStrength();
        return;
      } catch (error) {
        this.lastError = errorMessage(error);
        console.warn("DeepFilterNet3 failed; staying on RNNoise", error);
        if (
          this.livekitContext &&
          context !== this.livekitContext &&
          this.sourceTrack
        ) {
          await this.teardown();
          context = this.livekitContext;
          await this.openGraph(context, this.sourceTrack);
        }
      }
    } else if (mode === "advanced") {
      this.lastError = "device cannot run DeepFilterNet; using RNNoise";
    } else {
      this.lastError = undefined;
    }

    this.connectRnnoise(context);
  }

  private async build(opts: AudioProcessorOptions): Promise<void> {
    await this.teardown();
    this.sourceTrack = opts.track;
    if (opts.audioContext) {
      this.livekitContext = opts.audioContext;
    }
    if (!this.sourceTrack) return;

    const mode = this.settings.noiseSupression;
    let context = this.livekitContext;
    if (mode === "advanced" && canUseDeepFilter()) {
      try {
        context = await this.ensureDfContext();
      } catch (error) {
        this.lastError = errorMessage(error);
        console.warn("DeepFilterNet3 context failed; using RNNoise", error);
        context = this.livekitContext;
      }
    }
    if (!context) return;

    await this.openGraph(context, this.sourceTrack);
    await this.wireGraph(context);
    this.emitStatus();
  }

  private async teardown() {
    this.disconnectNoiseGraph();
    this.gainNode?.disconnect();
    this.destinationNode?.disconnect();
    this.sourceNode = undefined;
    this.gainNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
  }
}
