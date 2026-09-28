import type { VideoEncoding } from "livekit-client";

import type { ScreenShareQualityName } from "@revolt/state/stores/Voice";

/**
 * Screen share resolution/frame rate/bitrate, in one place.
 *
 * The picker has offered 15/30/60 FPS for a while, but the chosen value only
 * ever reached getDisplayMedia: the publish call kept passing
 * ScreenSharePresets.h720fps30 / h1080fps30, whose encoding carries
 * `maxFramerate: 30`. livekit then clamps every simulcast layer with
 * `min(sourceFramerate, preset.maxFramerate)`, so picking 60 captured 60 and
 * published 30 — all of the CPU cost, none of the benefit.
 *
 * Bitrate has to move with the frame rate. livekit only ships presets up to
 * 30 fps and its 1080p30 figure (5 Mbps) is already tight for motion; doubling
 * the frame rate at the same ceiling just halves the bits per frame and smears
 * the picture. The numbers below keep livekit's values where they exist so
 * nothing changes for anyone who does not touch the FPS control.
 */

/** Frame rates offered in the picker. "text" ignores this and stays at 5. */
export const SCREEN_SHARE_FRAME_RATES = [15, 30, 60] as const;

/**
 * What each tier may publish.
 *
 * Free stops at 720p30 and VIP adds 1080p, source resolution and 60 fps. The
 * split is a product decision, not a capacity one: the SFU forwards without
 * transcoding and hel1 sits near idle. What 1080p60 really costs is the
 * *client* CPU on both ends.
 */
export const FREE_FRAME_RATES = [15, 30] as const;
export const VIP_FRAME_RATES = SCREEN_SHARE_FRAME_RATES;

export type QualityTier = "free" | "vip";

export function frameRatesForTier(tier: QualityTier): readonly number[] {
  return tier === "vip" ? VIP_FRAME_RATES : FREE_FRAME_RATES;
}

/** Resolutions a tier may pick, before the server's own limits are applied. */
export function qualitiesForTier(
  tier: QualityTier,
): readonly ScreenShareQualityName[] {
  return tier === "vip" ? ["low", "high", "text"] : ["low"];
}

export function tierAllowsQuality(
  tier: QualityTier,
  quality: ScreenShareQualityName,
): boolean {
  return qualitiesForTier(tier).includes(quality);
}

export function tierAllowsFrameRate(tier: QualityTier, fps: number): boolean {
  return frameRatesForTier(tier).includes(fps);
}

export const DEFAULT_SCREEN_SHARE_FPS = 30;

/** Source-resolution mode trades frame rate for readable text. */
export const TEXT_SCREEN_SHARE_FPS = 5;

/**
 * Source-resolution mode keeps livekit's `ScreenSharePresets.original` bitrate
 * (7 Mbps, no resize). Inlined rather than imported so this module stays free
 * of runtime dependencies and can be unit tested on its own.
 */
const SOURCE_BITRATE = 7_000_000;

/** bps, keyed by frame rate. 15 and 30 match livekit's own presets. */
const BITRATE_BY_FPS: Record<
  Exclude<ScreenShareQualityName, "text">,
  Record<number, number>
> = {
  low: { 15: 1_500_000, 30: 2_000_000, 60: 3_000_000 },
  high: { 15: 2_500_000, 30: 5_000_000, 60: 8_000_000 },
};

/**
 * Clamps to a frame rate we actually have a bitrate for, and that this tier is
 * allowed to publish.
 *
 * The tier check lives here rather than only in the UI so a stale picker value
 * — saved before the VIP expired, say — cannot publish 60 fps.
 */
export function normaliseFrameRate(
  quality: ScreenShareQualityName,
  frameRate?: number,
  tier: QualityTier = "vip",
): number {
  if (quality === "text") return TEXT_SCREEN_SHARE_FPS;
  const allowed = frameRatesForTier(tier);
  const candidate = frameRate ?? DEFAULT_SCREEN_SHARE_FPS;
  if (allowed.includes(candidate)) return candidate;
  return allowed.includes(DEFAULT_SCREEN_SHARE_FPS)
    ? DEFAULT_SCREEN_SHARE_FPS
    : allowed[allowed.length - 1];
}

/**
 * The encoding to publish with. Unlike the livekit presets this one carries
 * the frame rate the user actually picked, which is what stops the encoder
 * from being capped at 30.
 */
export function screenShareEncoding(
  quality: ScreenShareQualityName,
  frameRate?: number,
  tier: QualityTier = "vip",
): VideoEncoding {
  const fps = normaliseFrameRate(quality, frameRate, tier);
  if (quality === "text") {
    return {
      maxBitrate: SOURCE_BITRATE,
      maxFramerate: TEXT_SCREEN_SHARE_FPS,
      priority: "medium",
    };
  }
  return {
    maxBitrate: BITRATE_BY_FPS[quality][fps],
    maxFramerate: fps,
    priority: "medium",
  };
}

/** Label for the quality dropdown, e.g. "1080p 60FPS". */
export function screenShareLabel(
  quality: ScreenShareQualityName,
  frameRate?: number,
  tier: QualityTier = "vip",
): string {
  const fps = normaliseFrameRate(quality, frameRate, tier);
  if (quality === "text") return `Source ${TEXT_SCREEN_SHARE_FPS}FPS`;
  return `${quality === "high" ? "1080p" : "720p"} ${fps}FPS`;
}

/**
 * How the encoder should give ground when it cannot keep up.
 *
 * livekit picks `maintain-resolution` for every screen share, on the reasoning
 * that text has to stay readable. That is right for source-resolution mode and
 * wrong for a game at 60 fps: holding resolution there is exactly how you get
 * the slideshow instead of the smooth picture the frame rate was chosen for.
 *
 * So it follows the content hint, which is the thing that already says what
 * kind of image this is.
 */
export function screenShareDegradation(
  quality: ScreenShareQualityName,
  frameRate?: number,
  tier: QualityTier = "vip",
): RTCDegradationPreference {
  if (quality === "text") return "maintain-resolution";
  const fps = normaliseFrameRate(quality, frameRate, tier);
  // Acima de 30 o motivo de estar ali é a fluidez; abaixo, deixa o navegador
  // equilibrar, que é o que já acontecia na prática.
  return fps > DEFAULT_SCREEN_SHARE_FPS ? "maintain-framerate" : "balanced";
}
