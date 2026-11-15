/**
 * The 48 kHz AudioContext DeepFilterNet runs in, shared by consecutive
 * VoiceProcessors.
 *
 * Espaço reconnects LiveKit on every room entry, and every connect builds a
 * new VoiceProcessor. Closing its context threw the DeepFilter worklet away
 * with it, so each room started by compiling 16 MB of WASM and parsing the
 * model again on the audio thread: the first moments in every room were the
 * ones most likely to glitch. The worklet and the gate/meter modules are
 * cached per context, so keeping the context keeps all of that warm.
 *
 * Between calls the context is suspended (no audio device, no rendering), and
 * it is closed after `idleMs` with nobody holding it.
 */
export const DF_CONTEXT_IDLE_MS = 3 * 60_000;
export const DF_SAMPLE_RATE = 48000;

/** The part of AudioContext the pool touches (tests pass a fake). */
export interface PoolableContext {
  readonly sampleRate: number;
  readonly state: AudioContextState | string;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface DfContextPoolOptions<C extends PoolableContext> {
  create?: () => C;
  idleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DfContextPool<C extends PoolableContext> {
  /** Shared context, created or resumed as needed; give it back with `release`. */
  acquire(): Promise<C>;
  /** One holder is done. The last one suspends it and starts the idle timer. */
  release(ctx: C): void;
  /** Holders right now (diagnostics and tests). */
  users(): number;
}

export function createDfContextPool<C extends PoolableContext = AudioContext>(
  opts: DfContextPoolOptions<C> = {},
): DfContextPool<C> {
  const create =
    opts.create ??
    (() =>
      new AudioContext({
        sampleRate: DF_SAMPLE_RATE,
        latencyHint: "interactive",
      }) as unknown as C);
  const idleMs = opts.idleMs ?? DF_CONTEXT_IDLE_MS;
  const setTimer =
    opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ??
    ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let context: C | undefined;
  let holders = 0;
  let idleTimer: unknown;

  const stopIdleTimer = () => {
    if (idleTimer !== undefined) {
      clearTimer(idleTimer);
      idleTimer = undefined;
    }
  };

  return {
    async acquire() {
      stopIdleTimer();
      let ctx = context;
      if (!ctx || ctx.state === "closed") {
        ctx = create();
        if (ctx.sampleRate !== DF_SAMPLE_RATE) {
          const rate = ctx.sampleRate;
          await ctx.close().catch(() => undefined);
          throw new Error(
            `AudioContext sampleRate is ${rate}, DeepFilterNet needs ${DF_SAMPLE_RATE}`,
          );
        }
        context = ctx;
      }
      // Counted before any await, so a release racing this acquire never
      // suspends a context that is about to be used.
      holders += 1;
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => undefined);
      }
      return ctx;
    },

    release(ctx) {
      if (ctx !== context) {
        // Not the pooled one (it was replaced after an idle close): nobody
        // else can be holding it.
        if (ctx.state !== "closed") void ctx.close().catch(() => undefined);
        return;
      }
      holders = Math.max(0, holders - 1);
      if (holders > 0) return;
      void ctx.suspend().catch(() => undefined);
      stopIdleTimer();
      idleTimer = setTimer(() => {
        idleTimer = undefined;
        if (holders > 0 || context !== ctx) return;
        context = undefined;
        void ctx.close().catch(() => undefined);
      }, idleMs);
    },

    users: () => holders,
  };
}
