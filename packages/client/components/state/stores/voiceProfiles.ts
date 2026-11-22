import type {
  DeepFilterSensitivity,
  NoiseSuppresionState,
} from "./noiseSuppressionPolicy";

/**
 * Voice profiles (docs/voz/10 in the muchat repo, §8): one choice for people
 * who do not want to learn what a suppressor or a gate is. A profile is just a
 * set of the existing settings; picking one writes them, and the screen shows
 * "custom" as soon as any of them is changed by hand. Nothing new is stored
 * apart from the bitrate.
 *
 * There is no "low latency" profile: with the media server in Helsinki the
 * network costs ~245 ms, and the only latency left to trade here is the
 * gate's 32 ms lookahead, which is what keeps the first syllable (doc 09).
 */
export type VoiceProfile = "natural" | "balanced" | "strong";

/** Opus ceiling for non-supporters: standard 48 kbps, high 64 kbps. */
export type VoiceBitrate = "standard" | "high";

export const DEFAULT_VOICE_BITRATE: VoiceBitrate = "standard";

export function isVoiceBitrate(value: unknown): value is VoiceBitrate {
  return value === "standard" || value === "high";
}

export interface VoiceProfileSettings {
  noiseSupression: NoiseSuppresionState;
  deepFilterSensitivity: DeepFilterSensitivity;
  voiceGate: boolean;
  autoGainControl: boolean;
  echoCancellation: boolean;
  voiceBitrate: VoiceBitrate;
}

export const VOICE_PROFILES: Record<VoiceProfile, VoiceProfileSettings> = {
  // Least processing: light suppression keeps room tone and every consonant,
  // and the higher bitrate keeps the timbre.
  natural: {
    noiseSupression: "advanced",
    deepFilterSensitivity: "light",
    voiceGate: true,
    autoGainControl: true,
    echoCancellation: true,
    voiceBitrate: "high",
  },
  // The default: suppression follows the measured noise.
  balanced: {
    noiseSupression: "advanced",
    deepFilterSensitivity: "auto",
    voiceGate: true,
    autoGainControl: true,
    echoCancellation: true,
    voiceBitrate: "standard",
  },
  // Fans, street, people talking around: removes the most, at some cost to
  // how natural the voice sounds.
  strong: {
    noiseSupression: "advanced",
    deepFilterSensitivity: "strong",
    voiceGate: true,
    autoGainControl: true,
    echoCancellation: true,
    voiceBitrate: "standard",
  },
};

export const VOICE_PROFILE_ORDER: VoiceProfile[] = [
  "natural",
  "balanced",
  "strong",
];

/** Which profile the current settings are, or "custom". */
export function matchVoiceProfile(
  settings: Partial<VoiceProfileSettings>,
): VoiceProfile | "custom" {
  for (const name of VOICE_PROFILE_ORDER) {
    const profile = VOICE_PROFILES[name];
    const same = (Object.keys(profile) as (keyof VoiceProfileSettings)[]).every(
      (key) => (settings[key] ?? defaultFor(key)) === profile[key],
    );
    if (same) return name;
  }
  return "custom";
}

function defaultFor(key: keyof VoiceProfileSettings) {
  return key === "voiceBitrate" ? DEFAULT_VOICE_BITRATE : undefined;
}
