import { State } from "..";

import { AbstractStore } from ".";
import {
  type DeepFilterSensitivity,
  type NoiseSuppresionState,
  applyNoiseSuppressionSchema,
  clampInputSensitivity,
  DEFAULT_DEEPFILTER_SENSITIVITY,
  DEFAULT_INPUT_SENSITIVITY,
  DEFAULT_NOISE_SUPPRESSION,
  isNoiseSuppressionMode,
  NOISE_SUPPRESSION_SCHEMA,
} from "./noiseSuppressionPolicy";
import {
  type VoiceBitrate,
  type VoiceProfile,
  DEFAULT_VOICE_BITRATE,
  isVoiceBitrate,
  matchVoiceProfile,
  VOICE_PROFILES,
} from "./voiceProfiles";

/**
 * Noise suppression modes.
 * - browser: WebRTC / Chromium NS
 * - enhanced: RNNoise (light)
 * - advanced: DeepFilterNet3 (default), falls back to RNNoise on weaker devices
 */
export type {
  DeepFilterSensitivity,
  NoiseSuppresionState,
  VoiceBitrate,
  VoiceProfile,
};

/**
 * Possible screen share qualities. Low is 720p@30fps, high 1080p@30fps and text is source@5fps.
 */
export type ScreenShareQualityName = "low" | "high" | "text";

/**
 * Array of available screen share quality names.
 */
export const ScreenShareQualityNames: ScreenShareQualityName[] = [
  "low",
  "high",
  "text",
];

export interface TypeVoice {
  preferredAudioInputDevice?: string;
  preferredAudioOutputDevice?: string;
  preferredVideoDevice?: string;

  echoCancellation: boolean;
  noiseSupression: NoiseSuppresionState;
  /** Bump when the default engine changes so a migration runs once per device. */
  noiseSuppressionSchema: number;
  autoGainControl: boolean;
  /**
   * DeepFilter strength. "auto" adapts the attenuation limit to the measured
   * noise floor and lets the gate track the floor (Discord-style). Fixed
   * presets use `inputSensitivity` for the gate.
   */
  deepFilterSensitivity: DeepFilterSensitivity;
  /** 0 = most sensitive, 1 = least. Only used when deepFilterSensitivity is not "auto". */
  inputSensitivity: number;
  /**
   * Open the microphone on speech (Silero VAD) instead of on loudness alone.
   * Off = legacy RMS gate. Only affects the DeepFilter chain.
   */
  voiceGate: boolean;
  /**
   * Opus ceiling for non-supporters (supporters always get 96 kbps). Set by
   * the "natural" voice profile; applies from the next room joined.
   */
  voiceBitrate: VoiceBitrate;

  screenShareQuality: ScreenShareQualityName;
  screenShareQualityAsk: boolean;
  screenShareAudio: boolean;

  /** Speak `/tts` messages from the connected voice channel on this device. */
  ttsEnabled: boolean;

  inputVolume: number;
  outputVolume: number;
  deafen: boolean;
  micOn: boolean;

  userVolumes: Record<string, number>;
  userMutes: Record<string, boolean>;

  screenShareVolumes: Record<string, number>;
  screenShareMutes: Record<string, boolean>;

  /** Volume of each person's `/tts` voice in the Muchat Espaço (0–1; apart from their voice). */
  ttsVolumes: Record<string, number>;
}

/**
 * Handles enabling and disabling client experiments.
 */
export class Voice extends AbstractStore<"voice", TypeVoice> {
  /**
   * Construct store
   * @param state State
   */
  constructor(state: State) {
    super(state, "voice");
  }

  /**
   * Hydrate external context
   */
  hydrate(): void {
    /** nothing needs to be done */
  }

  /**
   * Generate default values
   */
  default(): TypeVoice {
    return {
      echoCancellation: true,
      noiseSupression: DEFAULT_NOISE_SUPPRESSION,
      noiseSuppressionSchema: NOISE_SUPPRESSION_SCHEMA,
      autoGainControl: true,
      deepFilterSensitivity: DEFAULT_DEEPFILTER_SENSITIVITY,
      inputSensitivity: DEFAULT_INPUT_SENSITIVITY,
      voiceGate: true,
      voiceBitrate: DEFAULT_VOICE_BITRATE,
      screenShareQuality: "low",
      screenShareQualityAsk: true,
      screenShareAudio: true,
      ttsEnabled: true,
      inputVolume: 1.0,
      outputVolume: 1.0,
      deafen: false,
      micOn: true,
      userVolumes: {},
      userMutes: {},
      screenShareVolumes: {},
      screenShareMutes: {},
      ttsVolumes: {},
    };
  }

  /**
   * Validate the given data to see if it is compliant and return a compliant object
   */
  clean(input: Partial<TypeVoice>): TypeVoice {
    const data = this.default();

    if (typeof input.preferredAudioInputDevice === "string") {
      data.preferredAudioInputDevice = input.preferredAudioInputDevice;
    }

    if (typeof input.preferredAudioOutputDevice === "string") {
      data.preferredAudioOutputDevice = input.preferredAudioOutputDevice;
    }

    if (typeof input.preferredVideoDevice === "string") {
      data.preferredVideoDevice = input.preferredVideoDevice;
    }

    if (typeof input.echoCancellation === "boolean") {
      data.echoCancellation = input.echoCancellation;
    }

    // migrate legacy noise suppression to new suppression state
    let parsedMode: NoiseSuppresionState | undefined;
    if ((input.noiseSupression as unknown) === "true") {
      parsedMode = "enhanced";
    } else if ((input.noiseSupression as unknown) === "false") {
      parsedMode = "disabled";
    } else if (isNoiseSuppressionMode(input.noiseSupression)) {
      parsedMode = input.noiseSupression;
    }

    // `autoInputSensitivity` (schema 1) is folded into deepFilterSensitivity.
    const migrated = applyNoiseSuppressionSchema(
      parsedMode,
      input.noiseSuppressionSchema,
      input.deepFilterSensitivity,
    );
    data.noiseSupression = migrated.noiseSupression;
    data.noiseSuppressionSchema = migrated.noiseSuppressionSchema;
    data.deepFilterSensitivity = migrated.deepFilterSensitivity;

    if (typeof input.autoGainControl === "boolean") {
      data.autoGainControl = input.autoGainControl;
    }

    data.inputSensitivity = clampInputSensitivity(input.inputSensitivity);

    if (typeof input.voiceGate === "boolean") {
      data.voiceGate = input.voiceGate;
    }

    if (isVoiceBitrate(input.voiceBitrate)) {
      data.voiceBitrate = input.voiceBitrate;
    }

    if (
      input.screenShareQuality &&
      ScreenShareQualityNames.includes(input.screenShareQuality)
    ) {
      data.screenShareQuality = input.screenShareQuality;
    }

    if (typeof input.screenShareQualityAsk === "boolean") {
      data.screenShareQualityAsk = input.screenShareQualityAsk;
    }

    if (typeof input.screenShareAudio === "boolean") {
      data.screenShareAudio = input.screenShareAudio;
    }

    if (typeof input.ttsEnabled === "boolean") {
      data.ttsEnabled = input.ttsEnabled;
    }

    if (typeof input.inputVolume === "number") {
      data.inputVolume = input.inputVolume;
    }

    if (typeof input.outputVolume === "number") {
      data.outputVolume = input.outputVolume;
    }

    if (typeof input.deafen === "boolean") {
      data.deafen = input.deafen;
    }

    if (typeof input.micOn === "boolean") {
      data.micOn = input.micOn;
    }

    if (typeof input.ttsVolumes === "object" && input.ttsVolumes) {
      Object.entries(input.ttsVolumes)
        .filter(
          ([userId, volume]) =>
            typeof userId === "string" &&
            typeof volume === "number" &&
            volume >= 0 &&
            volume <= 1,
        )
        .forEach(([k, v]) => (data.ttsVolumes[k] = v));
    }

    if (typeof input.userVolumes === "object") {
      Object.entries(input.userVolumes)
        .filter(
          ([userId, volume]) =>
            typeof userId === "string" && typeof volume === "number",
        )
        .forEach(([k, v]) => (data.userVolumes[k] = v));
    }

    if (typeof input.userMutes === "object") {
      Object.entries(input.userMutes)
        .filter(
          ([userId, muted]) => typeof userId === "string" && muted === true,
        )
        .forEach(([k, v]) => (data.userMutes[k] = v));
    }

    if (typeof input.screenShareVolumes === "object") {
      Object.entries(input.screenShareVolumes)
        .filter(
          ([userId, volume]) =>
            typeof userId === "string" && typeof volume === "number",
        )
        .forEach(([k, v]) => (data.screenShareVolumes[k] = v));
    }

    if (typeof input.screenShareMutes === "object") {
      Object.entries(input.screenShareMutes)
        .filter(
          ([userId, muted]) => typeof userId === "string" && muted === true,
        )
        .forEach(([k, v]) => (data.screenShareMutes[k] = v));
    }

    return data;
  }

  /**
   * Set a user's volume
   * @param userId User ID
   * @param volume Volume
   */
  setUserVolume(userId: string, volume: number) {
    this.set("userVolumes", userId, volume);
  }

  /**
   * Get a user's volume
   * @param userId User ID
   * @returns Volume or default
   */
  getUserVolume(userId: string): number {
    return this.get().userVolumes[userId] || 1.0;
  }

  /**
   * Set the volume of a person's `/tts` voice in the Espaço (apart from their call volume)
   * @param userId User ID
   * @param volume 0 (silent) to 1
   */
  setUserTtsVolume(userId: string, volume: number) {
    this.set("ttsVolumes", userId, Math.max(0, Math.min(1, volume)));
  }

  /**
   * Volume of a person's `/tts` voice in the Espaço (0 stays 0: silenced on purpose)
   * @param userId User ID
   */
  getUserTtsVolume(userId: string): number {
    return this.get().ttsVolumes?.[userId] ?? 1;
  }

  /**
   * Set whether a user is muted
   * @param userId User ID
   * @param muted Whether they should be muted
   */
  setUserMuted(userId: string, muted: boolean) {
    this.set("userMutes", userId, muted);
  }

  /**
   * Get whether a user is muted
   * @param userId User ID
   * @returns Whether muted
   */
  getUserMuted(userId: string): boolean {
    return this.get().userMutes[userId] || false;
  }

  /**
   * Set a user's screen share volume
   * @param userId User ID
   * @param volume Volume
   */
  setScreenShareVolume(userId: string, volume: number) {
    this.set("screenShareVolumes", userId, volume);
  }

  /**
   * Get a user's screen share volume
   * @param userId User ID
   * @returns Volume or default
   */
  getScreenShareVolume(userId: string): number {
    return this.get().screenShareVolumes[userId] || 1.0;
  }

  /**
   * Set whether a user's screen share is muted
   * @param userId User ID
   * @param muted Whether they should be muted
   */
  setScreenShareMuted(userId: string, muted: boolean) {
    this.set("screenShareMutes", userId, muted);
  }

  /**
   * Get whether a user's screen share is muted
   * @param userId User ID
   * @returns Whether muted
   */
  getScreenShareMuted(userId: string): boolean {
    return this.get().screenShareMutes[userId] ?? true;
  }

  /**
   * Set the preferred audio input device
   */
  set preferredAudioInputDevice(value: string | undefined) {
    this.set("preferredAudioInputDevice", value);
  }

  /**
   * Set the preferred audio output device
   */
  set preferredAudioOutputDevice(value: string | undefined) {
    this.set("preferredAudioOutputDevice", value);
  }

  /**
   * Set the preferred video input device
   */
  set preferredVideoDevice(value: string | undefined) {
    this.set("preferredVideoDevice", value);
  }

  /**
   * Set echo cancellation
   */
  set echoCancellation(value: boolean) {
    this.set("echoCancellation", value);
  }

  /**
   * Set noise cancellation
   */
  set noiseSupression(value: NoiseSuppresionState) {
    this.set("noiseSupression", value);
  }

  /**
   * Set auto gain control
   */
  set autoGainControl(value: boolean) {
    this.set("autoGainControl", value);
  }

  /**
   * Set DeepFilter strength preset
   */
  set deepFilterSensitivity(value: DeepFilterSensitivity) {
    this.set("deepFilterSensitivity", value);
  }

  /**
   * Set manual gate sensitivity (0 = most sensitive)
   */
  set inputSensitivity(value: number) {
    this.set("inputSensitivity", clampInputSensitivity(value));
  }

  /**
   * Set whether the microphone gate needs speech (VAD) to open
   */
  set voiceGate(value: boolean) {
    this.set("voiceGate", value);
  }

  /**
   * Set the Opus ceiling for non-supporters (next room joined)
   */
  set voiceBitrate(value: VoiceBitrate) {
    this.set("voiceBitrate", value);
  }

  /**
   * Apply a voice profile: writes all of its settings at once
   */
  applyVoiceProfile(profile: VoiceProfile) {
    const settings = VOICE_PROFILES[profile];
    this.set("noiseSupression", settings.noiseSupression);
    this.set("deepFilterSensitivity", settings.deepFilterSensitivity);
    this.set("voiceGate", settings.voiceGate);
    this.set("autoGainControl", settings.autoGainControl);
    this.set("echoCancellation", settings.echoCancellation);
    this.set("voiceBitrate", settings.voiceBitrate);
  }

  /**
   * Which voice profile the current settings are, or "custom"
   */
  get voiceProfile(): VoiceProfile | "custom" {
    return matchVoiceProfile(this.get());
  }

  /**
   * Set screen share quality
   */
  set screenShareQuality(value: ScreenShareQualityName) {
    this.set("screenShareQuality", value);
  }

  /**
   * Set screen share quality always ask
   */
  set screenShareQualityAsk(value: boolean) {
    this.set("screenShareQualityAsk", value);
  }

  /**
   * Set screen share audio
   */
  set screenShareAudio(value: boolean) {
    this.set("screenShareAudio", value);
  }

  /**
   * Set whether `/tts` messages are read aloud
   */
  set ttsEnabled(value: boolean) {
    this.set("ttsEnabled", value);
  }

  /**
   * Set input volume
   */
  set inputVolume(value: number) {
    this.set("inputVolume", value);
  }

  /**
   * Set output volume
   */
  set outputVolume(value: number) {
    this.set("outputVolume", value);
  }

  /**
   * Set mic status
   */
  set micOn(value: boolean) {
    this.set("micOn", value);
  }

  /**
   * Set deafen status
   */
  set deafen(value: boolean) {
    this.set("deafen", value);
  }

  /**
   * Get the preferred audio input device
   */
  get preferredAudioInputDevice(): string | undefined {
    return this.get().preferredAudioInputDevice;
  }

  /**
   * Get the preferred audio output device
   */
  get preferredAudioOutputDevice(): string | undefined {
    return this.get().preferredAudioOutputDevice;
  }

  /**
   * Get the preferred video input device
   */
  get preferredVideoDevice(): string | undefined {
    return this.get().preferredVideoDevice;
  }

  /**
   * Get echo cancellation
   */
  get echoCancellation(): boolean | undefined {
    return this.get().echoCancellation;
  }

  /**
   * Get noise supression
   */
  get noiseSupression(): NoiseSuppresionState | undefined {
    return this.get().noiseSupression;
  }

  /**
   * Get auto gain control
   */
  get autoGainControl(): boolean | undefined {
    return this.get().autoGainControl;
  }

  /**
   * Get DeepFilter strength preset
   */
  get deepFilterSensitivity(): DeepFilterSensitivity {
    return this.get().deepFilterSensitivity;
  }

  /**
   * Whether the DeepFilter gate tracks the noise floor (auto preset)
   */
  get autoInputSensitivity(): boolean {
    return this.get().deepFilterSensitivity === "auto";
  }

  /**
   * Get manual gate sensitivity (0 = most sensitive)
   */
  get inputSensitivity(): number {
    return this.get().inputSensitivity;
  }

  /**
   * Whether the microphone gate needs speech (VAD) to open
   */
  get voiceGate(): boolean {
    return this.get().voiceGate;
  }

  /**
   * Get the Opus ceiling for non-supporters
   */
  get voiceBitrate(): VoiceBitrate {
    return this.get().voiceBitrate ?? DEFAULT_VOICE_BITRATE;
  }

  /**
   * Get screen share quality
   */
  get screenShareQuality(): ScreenShareQualityName | undefined {
    return this.get().screenShareQuality;
  }

  /**
   * Get screen share quality always ask
   */
  get screenShareQualityAsk(): boolean {
    return this.get().screenShareQualityAsk;
  }

  /**
   * Get screen share audio
   */
  get screenShareAudio(): boolean {
    return this.get().screenShareAudio;
  }

  /**
   * Get whether `/tts` messages are read aloud
   */
  get ttsEnabled(): boolean {
    return this.get().ttsEnabled;
  }

  /**
   * Get input volume
   */
  get inputVolume(): number {
    return this.get().inputVolume;
  }

  /**
   * Get output volume
   */
  get outputVolume(): number {
    return this.get().outputVolume;
  }

  /**
   * Get deafen status
   */
  get deafen(): boolean {
    return this.get().deafen;
  }

  /**
   * Get mic status
   */
  get micOn(): boolean {
    return this.get().micOn;
  }
}
