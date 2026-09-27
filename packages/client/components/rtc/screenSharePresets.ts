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

/** Clamps to a frame rate we actually have a bitrate for. */
export function normaliseFrameRate(
  quality: ScreenShareQualityName,
  frameRate?: number,
): number {
  if (quality === "text") return TEXT_SCREEN_SHARE_FPS;
  const candidate = frameRate ?? DEFAULT_SCREEN_SHARE_FPS;
  return SCREEN_SHARE_FRAME_RATES.includes(
    candidate as (typeof SCREEN_SHARE_FRAME_RATES)[number],
  )
    ? candidate
    : DEFAULT_SCREEN_SHARE_FPS;
}

/**
 * The encoding to publish with. Unlike the livekit presets this one carries
 * the frame rate the user actually picked, which is what stops the encoder
 * from being capped at 30.
 */
export function screenShareEncoding(
  quality: ScreenShareQualityName,
  frameRate?: number,
): VideoEncoding {
  const fps = normaliseFrameRate(quality, frameRate);
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
): string {
  const fps = normaliseFrameRate(quality, frameRate);
  if (quality === "text") return `Source ${TEXT_SCREEN_SHARE_FPS}FPS`;
  return `${quality === "high" ? "1080p" : "720p"} ${fps}FPS`;
}
