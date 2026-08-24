import { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import type { DeepFilterNet3Core } from "deepfilternet3-noise-filter";
import { RNNoiseNode } from "livekit-rnnoise-processor";
import { createEffect, createRoot } from "solid-js";

import { CONFIGURATION } from "@revolt/common";
import { Voice } from "@revolt/state/stores/Voice";
import { gateThresholdsFromSensitivity } from "@revolt/state/stores/noiseSuppressionPolicy";

import { canUseDeepFilter } from "./deepFilterSupport";
import { addPatchedDeepFilterModule } from "./patchDeepFilterWorklet";
import { ensureRmsGateNode } from "./rmsGateWorklet";
import type { VoiceEngineId } from "./voiceEngineStatus";

let sharedDeepFilterCore: Promise<DeepFilterNet3Core> | undefined;
const deepFilterNodes = new WeakMap<BaseAudioContext, AudioWorkletNode>();

export interface VoiceProcessorSnapshot {
  engine: VoiceEngineId;
  sampleRate?: number;
  lastError?: string;
  inputRms?: number;
  gateOpen?: boolean;
  gateOpenThreshold?: number;
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
          noiseReductionLevel: 80,
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
    };
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
    if (openParam) openParam.value = open;
    if (closeParam) closeParam.value = close;
    if (autoParam) autoParam.value = auto ? 1 : 0;
    if (!auto) this.gateOpenThreshold = open;
  }

  private listenToGate(gate: AudioWorkletNode) {
    gate.port.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        rms?: number;
        open?: boolean;
        threshold?: number;
      };
      if (typeof data?.rms !== "number") return;
      this.lastRms = data.rms;
      this.gateOpen = !!data.open;
      if (typeof data.threshold === "number") {
        this.gateOpenThreshold = data.threshold;
      }
      this.emitStatus();
    };
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
    this.engine = "bypass";
    this.emitStatus();
  }

  private disconnectNoiseGraph() {
    if (this.gateNode) {
      this.gateNode.port.onmessage = null;
    }
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
    const worklet = context.audioWorklet;
    const addModule = worklet.addModule.bind(worklet);
    worklet.addModule = (moduleURL: string | URL, options?: WorkletOptions) =>
      addPatchedDeepFilterModule(
        addModule,
        moduleURL,
        options,
      );
    try {
      const node = await core.createAudioWorkletNode(context);
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
    this.destinationNode = context.createMediaStreamDestination();
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

    if (mode === "advanced" && canUseDeepFilter()) {
      try {
        const node = await this.ensureDeepFilterNode(context);
        const gate = await ensureRmsGateNode(context);
        if (token !== this.graphToken) return;
        if (this.settings.noiseSupression !== "advanced") return;
        this.gateNode = gate;
        this.listenToGate(gate);
        this.applyGateSettings();
        this.connectMlChain(node, context, gate);
        this.engine = "deepfilter";
        this.lastError = undefined;
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
