/**
 * How close the camera is, for the screen the map has (23/11/2026). The map used to
 * open at the computer's zoom on every screen: a phone in portrait saw six tiles of a
 * room. Now the zoom frames about FRAME_TILES tiles across the map's short side, so a
 * phone gets 1 and a computer 2, and it follows a rotation or a resize until the
 * person zooms by hand. Integer zooms only: the pixel art stays crisp.
 */

/** Tiles the camera tries to keep across the map's short side. */
export const FRAME_TILES = 11;
/** World pixels per tile. */
const TILE_PX = 32;
/** The framing never goes past the computer's zoom; closer is the person's choice. */
const FRAME_MAX = 2;

/**
 * Where the camera looks along one axis: on `c` (you), but never so close to the
 * map's edge that the screen shows the void beyond it; a map narrower than the
 * screen sits in the middle. `half` is half the visible span in world pixels,
 * [lo, hi] the map's extent.
 */
export function clampAxis(c: number, half: number, lo: number, hi: number): number {
  const size = hi - lo;
  if (size <= half * 2) return lo + size / 2;
  return Math.min(Math.max(c, lo + half), hi - half);
}

/** The zoom that frames a map area of `width` × `height` CSS pixels. */
export function fitZoom(width: number, height: number): number {
  const short = Math.min(width, height);
  if (!(short > 0)) return 1;
  return Math.max(1, Math.min(FRAME_MAX, Math.floor(short / (FRAME_TILES * TILE_PX))));
}
