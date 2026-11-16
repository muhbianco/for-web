/**
 * A local video player the Smart TV drives (ADR 0008). Every person plays the
 * video in their own browser; nothing is captured, proxied or sent through
 * the call. YouTube is the first implementation; another app is another class.
 */
export type PlayerState = "unstarted" | "ended" | "playing" | "paused" | "buffering" | "cued";

export interface TvPlayer {
  /** Loads `ref` at `startS`; plays at once when `play`. */
  load(ref: string, startS: number, play: boolean): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** Current position (s); 0 before the video loads. */
  time(): number;
  /** Duration (s); 0 while unknown. */
  duration(): number;
  /** Title of the loaded video ('' while unknown). */
  title(): string;
  /** 0..100, per person. */
  setVolume(volume: number): void;
  state(): PlayerState;
  destroy(): void;
}

export interface PlayerEvents {
  onReady?: () => void;
  onState?: (state: PlayerState) => void;
  /** YouTube error codes: 2 invalid, 5 HTML5, 100 unavailable, 101/150 not embeddable, 153 missing referrer. */
  onError?: (code: number) => void;
}

// ---- YouTube IFrame Player API (official) --------------------------------------

interface YtPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(v: number): void;
  getVideoData?(): { title?: string; video_id?: string };
  destroy(): void;
}

interface YtNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = "https://www.youtube.com/iframe_api";
let apiLoading: Promise<YtNamespace> | null = null;

/** Loads the official IFrame API once per page; rejects after 15 s. */
export function loadYouTubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiLoading) return apiLoading;
  apiLoading = new Promise<YtNamespace>((resolve, reject) => {
    const timer = setTimeout(() => {
      apiLoading = null;
      reject(new Error("youtube api timeout"));
    }, 15_000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("youtube api missing"));
    };
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      apiLoading = null;
      script.remove();
      reject(new Error("youtube api blocked"));
    };
    document.head.appendChild(script);
  });
  return apiLoading;
}

const STATES: Record<number, PlayerState> = { [-1]: "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };

/**
 * YouTube through its official IFrame Player API, on youtube-nocookie.com,
 * without YouTube's own controls (the TV has its own, shared). The element
 * given is replaced by YouTube's iframe; the caller owns a container that
 * nothing else renders into.
 */
export class YouTubePlayer implements TvPlayer {
  private yt: YtPlayer | null = null;
  private pending: { ref: string; startS: number; play: boolean } | null = null;
  private volume = 50;
  private destroyed = false;

  static async create(container: HTMLElement, events: PlayerEvents): Promise<YouTubePlayer> {
    const api = await loadYouTubeApi();
    const p = new YouTubePlayer();
    const mount = document.createElement("div");
    container.appendChild(mount);
    await new Promise<void>((resolve) => {
      p.yt = new api.Player(mount, {
        host: "https://www.youtube-nocookie.com",
        width: "100%",
        height: "100%",
        playerVars: {
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          modestbranding: 1,
          origin: location.origin,
        },
        events: {
          onReady: () => {
            p.yt?.setVolume(p.volume);
            events.onReady?.();
            if (p.pending) {
              const { ref, startS, play } = p.pending;
              p.pending = null;
              p.load(ref, startS, play);
            }
            resolve();
          },
          onStateChange: (e: { data: number }) => events.onState?.(STATES[e.data] ?? "unstarted"),
          onError: (e: { data: number }) => events.onError?.(e.data),
        },
      });
    });
    return p;
  }

  private ready(): YtPlayer | null {
    return this.destroyed ? null : this.yt;
  }

  load(ref: string, startS: number, play: boolean) {
    const yt = this.ready();
    if (!yt) {
      this.pending = { ref, startS, play };
      return;
    }
    const o = { videoId: ref, startSeconds: Math.max(0, startS) };
    if (play) yt.loadVideoById(o);
    else yt.cueVideoById(o);
  }

  play() {
    this.ready()?.playVideo();
  }

  pause() {
    this.ready()?.pauseVideo();
  }

  seek(seconds: number) {
    this.ready()?.seekTo(Math.max(0, seconds), true);
  }

  time(): number {
    return this.ready()?.getCurrentTime() ?? 0;
  }

  duration(): number {
    return this.ready()?.getDuration() ?? 0;
  }

  title(): string {
    return this.ready()?.getVideoData?.()?.title ?? "";
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, Math.round(volume)));
    this.ready()?.setVolume(this.volume);
  }

  state(): PlayerState {
    const s = this.ready()?.getPlayerState();
    return s === undefined ? "unstarted" : (STATES[s] ?? "unstarted");
  }

  destroy() {
    this.destroyed = true;
    try {
      this.yt?.destroy();
    } catch {
      // The iframe may already be gone with its container.
    }
    this.yt = null;
  }
}
