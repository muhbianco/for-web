import { DriftGuard, expectedPosition, type TvState } from "@muchat/space-core";

import type { PlayerState, TvPlayer } from "./player.ts";

/**
 * Keeps one local player on the room TV's shared state (ADR 0008):
 * - a new state (rev) is applied at once: load, play, pause, seek;
 * - while playing, once per second the local position is compared with the
 *   expected one (server clock + offset); a drift above 0.75 s seen twice is
 *   corrected with a seek (DriftGuard). No position is ever broadcast: the
 *   state carries `pos_s` at `ref_ms`, and each client computes the rest;
 * - buffering is left alone (the next check catches up).
 *
 * `needsGesture` turns on when the browser refused to start playback with
 * sound (autoplay policy): the UI asks for a tap, then calls `resume()`.
 */
export class TvSync {
  private readonly player: TvPlayer;
  private readonly serverNow: () => number;
  private readonly onChange: () => void;
  private readonly guard = new DriftGuard();
  private state: TvState | null = null;
  private loadedRef: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private startCheck: ReturnType<typeof setTimeout> | undefined;
  needsGesture = false;
  /** Last measured drift (s, local − expected) while playing; for the UI and tests. */
  lastDrift = 0;

  constructor(player: TvPlayer, serverNow: () => number, onChange: () => void = () => undefined) {
    this.player = player;
    this.serverNow = serverNow;
    this.onChange = onChange;
    this.timer = setInterval(() => this.check(), 1_000);
  }

  /** The room's TV changed (or this person just opened it). */
  apply(state: TvState | null) {
    const prev = this.state;
    this.state = state;
    this.guard.reset();
    if (!state) {
      this.loadedRef = null;
      this.player.pause();
      return;
    }
    const expected = expectedPosition(state, this.serverNow());
    if (state.ref !== this.loadedRef) {
      this.loadedRef = state.ref;
      this.player.load(state.ref, expected, state.status === "playing");
      if (state.status === "playing") this.watchStart();
      return;
    }
    if (state.status === "playing") {
      if (Math.abs(this.player.time() - expected) > 0.3 || prev?.status !== "playing") this.player.seek(expected);
      this.player.play();
      this.watchStart();
    } else {
      this.player.pause();
      if (Math.abs(this.player.time() - state.pos_s) > 0.3) this.player.seek(state.pos_s);
    }
  }

  /** The player reported a new state (ended, buffering, playing...). */
  playerState(s: PlayerState) {
    if (s === "playing" && this.needsGesture) {
      this.needsGesture = false;
      this.onChange();
    }
  }

  /** After a tap: the browser now lets us play with sound. */
  resume() {
    const s = this.state;
    if (!s || s.status !== "playing") return;
    this.player.seek(expectedPosition(s, this.serverNow()));
    this.player.play();
    this.needsGesture = false;
    this.onChange();
  }

  /** Where the shared video is now (seconds), for the progress bar. */
  position(): number {
    return this.state ? expectedPosition(this.state, this.serverNow()) : 0;
  }

  private watchStart() {
    if (this.startCheck) clearTimeout(this.startCheck);
    this.startCheck = setTimeout(() => {
      const s = this.player.state();
      const blocked = this.state?.status === "playing" && (s === "unstarted" || s === "cued" || s === "paused");
      if (blocked !== this.needsGesture) {
        this.needsGesture = blocked;
        this.onChange();
      }
    }, 2_500);
  }

  private check() {
    const s = this.state;
    if (!s || s.status !== "playing" || s.ref !== this.loadedRef) return;
    if (this.player.state() !== "playing") return;
    const expected = expectedPosition(s, this.serverNow());
    const local = this.player.time();
    this.lastDrift = local - expected;
    const dur = this.player.duration();
    if (dur > 0 && expected >= dur) return; // past the end: the player stops by itself
    const target = this.guard.check(local, expected, Date.now());
    if (target !== null) this.player.seek(target);
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.startCheck) clearTimeout(this.startCheck);
    this.timer = undefined;
  }
}
