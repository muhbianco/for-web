/**
 * Someone sharing a screen, on the map (Muchat, 23/11/2026): the small 7×7
 * screen badge was easy to miss, and the floating call card that showed the
 * screen is gone. Now the avatar broadcasts: waves leave its feet, a little
 * screen with a red "live" dot floats over its head, and a click on it opens
 * that screen on the stage.
 *
 * Cost: the map is drawn on demand (a still room during a call costs no GPU
 * work), so the animation moves at most every LIVE_FRAME_MS and only while a
 * sharer is in view; with reduced motion it is one still picture.
 */

/** 20 frames a second: smooth enough for pixel waves, a third of the 60 Hz cap. */
export const LIVE_FRAME_MS = 50;
/** One wave from the feet to its widest. */
export const LIVE_WAVE_MS = 1600;
/** Waves in flight at once, evenly spread over a period. */
export const LIVE_WAVES = 2;
/** The red dot blinks: on for most of the period, like a camera's tally light. */
export const LIVE_BLINK_MS = 1200;
const BLINK_ON = 0.65;
/** The little screen floats up and down by one pixel, slowly. */
export const LIVE_BOB_MS = 1400;

/** Screen colours (the same blue as the sidebar's screen icon). */
export const LIVE_BLUE = 0x74c0fc;
/** The waves: lighter, so they read on blue rugs and dark floors alike. */
export const LIVE_WAVE = 0xb4e2ff;
export const LIVE_DEEP = 0x1c3a5e;
export const LIVE_RED = 0xff4d4f;
/** The screen over the head, in world px (the avatar is 32 wide). */
export const LIVE_SCREEN = { w: 29, h: 17 } as const;

export interface LiveWave {
  /** Radii of the ellipse at the feet, in world px. */
  rx: number;
  ry: number;
  alpha: number;
}

export interface LiveFrame {
  waves: LiveWave[];
  /** Vertical offset of the floating screen: 0 or -1. */
  bob: number;
  /** The red dot is lit. */
  dot: boolean;
}

/** Waves start at the speaking ring's size and widen to about two tiles. */
const RX0 = 12;
const RX1 = 30;
const RY0 = 4.5;
const RY1 = 11;

/**
 * The look at `nowMs`. `seed` (any number from the user id) puts two people
 * sharing side by side out of step. With `still` (reduced motion): two fixed
 * rings, the screen at rest, the dot lit.
 */
export function livePulse(nowMs: number, seed = 0, still = false): LiveFrame {
  if (still) {
    return {
      waves: [
        { rx: 17, ry: 6.5, alpha: 0.85 },
        { rx: 24, ry: 9, alpha: 0.45 },
      ],
      bob: 0,
      dot: true,
    };
  }
  const t = nowMs + (seed % LIVE_WAVE_MS);
  const waves: LiveWave[] = [];
  for (let k = 0; k < LIVE_WAVES; k++) {
    const p = (t / LIVE_WAVE_MS + k / LIVE_WAVES) % 1;
    // Ease out: fast near the feet, slow as it fades.
    const e = 1 - (1 - p) * (1 - p);
    waves.push({
      rx: RX0 + (RX1 - RX0) * e,
      ry: RY0 + (RY1 - RY0) * e,
      alpha: 0.9 * (1 - p),
    });
  }
  const bob = (t % LIVE_BOB_MS) / LIVE_BOB_MS < 0.5 ? 0 : -1;
  const dot = (t % LIVE_BLINK_MS) / LIVE_BLINK_MS < BLINK_ON;
  return { waves, bob, dot };
}

/** Is a map point on a sharer standing at (ax, ay)? Their body or the screen over them. */
export function onSharer(
  x: number,
  y: number,
  ax: number,
  ay: number,
): boolean {
  return Math.abs(x - ax) <= 17 && y >= ay - 90 && y <= ay + 4;
}
