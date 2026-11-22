import assert from "node:assert/strict";
import { test } from "node:test";

import type { Log } from "./log.ts";
import { startLoopDelayLog } from "./loopDelay.ts";

test("loop delay: one line per period with p50/p99/max, and stop ends it", async () => {
  const lines: Record<string, unknown>[] = [];
  const log: Log = {
    info: (msg, extra) => {
      if (msg === "event loop delay") lines.push(extra ?? {});
    },
    warn: () => {},
    error: () => {},
  };
  const stop = startLoopDelayLog(log, { everyMs: 120, resolutionMs: 10 });
  // Keep the loop alive (the timer is unref'd) and block it once, so the
  // histogram has something above the resolution.
  await new Promise((r) => setTimeout(r, 60));
  const t0 = Date.now();
  while (Date.now() - t0 < 40) {
    /* busy */
  }
  await new Promise((r) => setTimeout(r, 200));
  stop();
  const seen = lines.length;
  assert.ok(seen >= 1, "at least one period logged");
  const first = lines[0]!;
  for (const k of ["p50_ms", "p99_ms", "max_ms", "samples", "resolution_ms"]) assert.equal(typeof first[k], "number", k);
  assert.ok((first.max_ms as number) >= (first.p50_ms as number));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(lines.length, seen, "nothing after stop");
});
