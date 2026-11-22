import { monitorEventLoopDelay } from "node:perf_hooks";

import type { Log } from "./log.ts";

/**
 * Event loop delay of this process, one log line per period (docs/espaco ADR 0009,
 * decision 10). The same process grants room media, so anything new here (the
 * game, first) is judged by whether p99 moves. Values are the histogram's raw
 * sample intervals in ms: an idle loop reads about `resolution_ms` (more on
 * Windows, whose timers are coarse); compare periods, not absolutes.
 */
export function startLoopDelayLog(log: Log, opts: { everyMs?: number; resolutionMs?: number } = {}): () => void {
  const everyMs = opts.everyMs ?? 60_000;
  const resolutionMs = opts.resolutionMs ?? 20;
  const h = monitorEventLoopDelay({ resolution: resolutionMs });
  h.enable();
  const ms = (ns: number) => Math.round(ns / 1e4) / 100;
  const timer = setInterval(() => {
    if (h.count > 0) {
      log.info("event loop delay", {
        resolution_ms: resolutionMs,
        samples: h.count,
        p50_ms: ms(h.percentile(50)),
        p99_ms: ms(h.percentile(99)),
        max_ms: ms(h.max),
      });
    }
    h.reset();
  }, everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    h.disable();
  };
}
