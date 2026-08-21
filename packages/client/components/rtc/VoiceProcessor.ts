import { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import type { DeepFilterNet3Core } from "deepfilternet3-noise-filter";
import { RNNoiseNode } from "livekit-rnnoise-processor";
import { createEffect, createRoot, on } from "solid-js";

import { CONFIGURATION } from "@revolt/common";
import { Voice } from "@revolt/state/stores/Voice";

import {
  canUseDeepFilter,
  usesMachineLearningNoise,
} from "./deepFilterSupport";

let sharedDeepFilterCore: Promise<DeepFilterNet3Core> | undefined;
const deepFilterNodes = new WeakMap<BaseAudioContext, AudioWorkletNode>();

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

export class VoiceProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  readonly name = "stoat-voice-processor";
  processedTrack?: MediaStreamTrack;

  private audioContext?: AudioContext;
  private settings: Voice;
  private graphToken = 0;

  private noiseSuppressionNode?: RNNoiseNode;
  private deepFilterNode?: AudioWorkletNode;
  private sourceNode?: MediaStreamAudioSourceNode;
  private highpassNode?: BiquadFilterNode;
  private compressorNode?: DynamicsCompressorNode;
  private gainNode?: GainNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  private disposeSolidjsContext: () => void = () => {};

  constructor(voiceSettings: Voice) {
    this.settings = voiceSettings;

    createRoot((dispose) => {
      createEffect(() => {
        this.setGain(this.getSettings().inputVolume);
      });

      createEffect(
        on(
          () => this.getSettings().noiseSupression,
          (next, prev) => {
            if (
              prev &&
              next !== prev &&
              (usesMachineLearningNoise(prev) ||
                usesMachineLearningNoise(next))
            ) {
              this.rebuild();
            }
          },
        ),
      );

      this.disposeSolidjsContext = dispose;
    });
  }

  private getSettings(): Voice {
    return this.settings;
  }

  private setGain(newGain: number) {
    if (this.gainNode) {
      this.gainNode.gain.value = newGain;
    }
  }

  private rebuild() {
    if (!this.audioContext) return;
    void this.updateNoiseSuppression(this.audioContext);
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    await RNNoiseNode.loadModule(
      opts.audioContext,
      CONFIGURATION.RNNOISE_WORKLET_CDN_URL,
    );
    return this.build(opts);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    return this.build(opts);
  }

  async destroy(): Promise<void> {
    this.disposeSolidjsContext();
    this.audioContext = undefined;
    this.deepFilterNode = undefined;
    return this.teardown();
  }

  private disconnectNoiseGraph() {
    this.compressorNode?.disconnect();
    this.noiseSuppressionNode?.disconnect();
    this.deepFilterNode?.disconnect();
    this.highpassNode?.disconnect();
    this.sourceNode?.disconnect();
    this.compressorNode = undefined;
    this.noiseSuppressionNode = undefined;
    this.highpassNode = undefined;
  }

  private connectMlChain(nsNode: AudioNode, context: AudioContext) {
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
    nsNode.connect(this.compressorNode);
    this.compressorNode.connect(this.gainNode!);
  }

  private connectRnnoise(context: AudioContext) {
    this.noiseSuppressionNode = new RNNoiseNode(context);
    this.connectMlChain(this.noiseSuppressionNode, context);
  }

  private connectBypass() {
    this.sourceNode!.connect(this.gainNode!);
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
    const node = await core.createAudioWorkletNode(context);
    deepFilterNodes.set(context, node);
    this.deepFilterNode = node;
    return node;
  }

  private async updateNoiseSuppression(context: AudioContext) {
    const token = ++this.graphToken;
    const mode = this.settings.noiseSupression;
    this.disconnectNoiseGraph();

    if (!this.sourceNode || !this.gainNode) return;

    if (mode === "advanced") {
      this.connectRnnoise(context);
      if (!canUseDeepFilter()) return;

      try {
        const node = await this.ensureDeepFilterNode(context);
        if (token !== this.graphToken) return;
        if (this.settings.noiseSupression !== "advanced") return;

        this.disconnectNoiseGraph();
        this.connectMlChain(node, context);
      } catch (error) {
        console.warn("DeepFilterNet3 failed; staying on RNNoise", error);
      }
      return;
    }

    if (mode === "enhanced") {
      this.connectRnnoise(context);
      return;
    }

    this.connectBypass();
  }

  private async build(opts: AudioProcessorOptions): Promise<void> {
    await this.teardown();
    let context = opts.audioContext;
    if (!context) {
      context = this.audioContext!;
    } else {
      this.audioContext = context;
    }
    if (!context) {
      return;
    }
    this.sourceNode = context.createMediaStreamSource(
      new MediaStream([opts.track]),
    );

    this.gainNode = context.createGain();
    this.gainNode.gain.value = this.settings.inputVolume;

    await this.updateNoiseSuppression(context);

    this.destinationNode = context.createMediaStreamDestination();
    this.gainNode.connect(this.destinationNode);
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  private async teardown() {
    this.disconnectNoiseGraph();
    this.gainNode?.disconnect();
    this.destinationNode?.disconnect();
    this.sourceNode = undefined;
    this.gainNode = undefined;
    this.destinationNode = undefined;
  }
}
