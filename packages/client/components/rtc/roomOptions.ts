import {
  type AudioCaptureOptions,
  AudioPresets,
  type RoomOptions,
  ScreenSharePresets,
  type TrackPublishDefaults,
  VideoPresets,
} from "livekit-client";

import {
  type NoiseSuppresionState,
  captureAutoGainEnabled,
  captureBrowserNoiseSuppression,
} from "@revolt/state/stores/noiseSuppressionPolicy";
import type { VoiceBitrate } from "@revolt/state/stores/voiceProfiles";

/**
 * Everything that decides how a voice Room captures and publishes, in one
 * place. `Voice.connect` (state.tsx) builds its Room from here, and so does the
 * voice lab (qa/voice-lab), so a measurement in the lab is a measurement of
 * exactly what ships. Change a parameter here and both move together.
 */

/** The slice of the voice settings store that shapes capture. */
export interface VoiceCaptureSettings {
  echoCancellation?: boolean;
  autoGainControl?: boolean;
  noiseSupression?: NoiseSuppresionState;
}

export interface VoiceDeviceSettings extends VoiceCaptureSettings {
  preferredAudioInputDevice?: string;
  preferredAudioOutputDevice?: string;
  preferredVideoDevice?: string;
  /** Opus ceiling for non-supporters (the "natural" profile picks high). */
  voiceBitrate?: VoiceBitrate;
}

/** 64 kbps: the "natural" profile, and what Discord sends by default. */
export const AUDIO_PRESET_HIGH = { maxBitrate: 64_000 } as const;

/**
 * One noise suppressor per signal path: browser NS / voiceIsolation are only
 * requested in "browser" mode. In ML modes (DeepFilter / RNNoise) the
 * VoiceProcessor owns suppression and browser AGC is off so it does not pump
 * the residual noise floor. See VoiceProcessor.ts for the full chain.
 *
 * `voiceIsolation` is not standard yet; livekit and Chromium-based browsers
 * (Electron included) honour it, so it rides along as an extra constraint.
 */
export function voiceCaptureOptions(
  settings: VoiceCaptureSettings,
): AudioCaptureOptions & { voiceIsolation: boolean } {
  const mode = settings.noiseSupression;
  return {
    echoCancellation: settings.echoCancellation ?? true,
    autoGainControl: captureAutoGainEnabled(mode, settings.autoGainControl),
    noiseSuppression: captureBrowserNoiseSuppression(mode),
    voiceIsolation: captureBrowserNoiseSuppression(mode),
  };
}

/**
 * Audio publish options. Audio used to ride on livekit's defaults, which only
 * hold while the published track is mono. VoiceProcessor forces mono today,
 * but the day someone changes that, `red` would switch itself off in silence
 * and we would lose our only real protection against packet loss. RED resends
 * the previous payload alongside the current one, so a single lost packet is
 * still heard; it is worth the extra bandwidth.
 *
 * 48 kbps for everyone (64 with the "natural" profile), 96 for supporters.
 * Mono in all cases, otherwise `red` and `dtx` switch themselves off.
 * (`voice_quality` in Revolt.toml is dead config: nothing in the client reads
 * it. This is the value that ships.)
 */
export function voiceAudioPublishOptions(
  vip: boolean,
  bitrate: VoiceBitrate = "standard",
): Pick<TrackPublishDefaults, "audioPreset" | "dtx" | "red" | "forceStereo"> {
  return {
    audioPreset: vip
      ? AudioPresets.musicHighQuality
      : bitrate === "high"
        ? AUDIO_PRESET_HIGH
        : AudioPresets.music,
    dtx: true,
    red: true,
    forceStereo: false,
  };
}

/**
 * The Room options `Voice.connect` uses. `vip` is read once per call: the tier
 * decides what this Room may publish, and changing it mid-call would mean
 * republishing the tracks.
 */
export function buildVoiceRoomOptions(
  settings: VoiceDeviceSettings,
  vip: boolean,
): RoomOptions {
  return {
    audioCaptureDefaults: {
      deviceId: settings.preferredAudioInputDevice,
      ...voiceCaptureOptions(settings),
    },
    audioOutput: {
      deviceId: settings.preferredAudioOutputDevice,
    },
    videoCaptureDefaults: {
      // Was a TODO pinned at 720p. The ceiling is the tier now: the server
      // allows 1920x1080 for everyone, VIP is what tells the accounts apart.
      resolution: vip
        ? VideoPresets.h1080.resolution
        : VideoPresets.h720.resolution,
      deviceId: settings.preferredVideoDevice,
    },
    publishDefaults: {
      videoEncoding: vip
        ? VideoPresets.h1080.encoding
        : VideoPresets.h720.encoding,
      screenShareEncoding: ScreenSharePresets.h720fps30.encoding,
      ...voiceAudioPublishOptions(vip, settings.voiceBitrate),
    },
    // Stop the SFU from pulling layers nobody is subscribed to. Pure upload
    // saving for whoever is publishing, invisible to everyone else.
    dynacast: true,
  };
}
