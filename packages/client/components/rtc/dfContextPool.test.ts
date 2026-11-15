import assert from "node:assert/strict";
import { test } from "node:test";

import { type PoolableContext, createDfContextPool } from "./dfContextPool.ts";

class FakeContext implements PoolableContext {
  state: "running" | "suspended" | "closed" = "running";
  calls: string[] = [];
  readonly sampleRate: number;
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
  }
  async resume() {
    this.calls.push("resume");
    this.state = "running";
  }
  async suspend() {
    this.calls.push("suspend");
    this.state = "suspended";
  }
  async close() {
    this.calls.push("close");
    this.state = "closed";
  }
}

function harness(rate = 48000) {
  const made: FakeContext[] = [];
  let timer: (() => void) | undefined;
  const pool = createDfContextPool<FakeContext>({
    create: () => {
      const c = new FakeContext(rate);
      made.push(c);
      return c;
    },
    idleMs: 1000,
    setTimer: (fn) => {
      timer = fn;
      return 1;
    },
    clearTimer: () => {
      timer = undefined;
    },
  });
  return { pool, made, fireIdle: () => timer?.(), hasTimer: () => !!timer };
}

// 15/11/2026: every Espaço room entry built a new VoiceProcessor and closed
// the old one's context, recompiling DeepFilter's 16 MB WASM and model on the
// audio thread at the start of every room.
test("the next room reuses the same context instead of a new one", async () => {
  const { pool, made } = harness();
  const a = await pool.acquire();
  pool.release(a);
  assert.equal(a.state, "suspended", "no audio device held between rooms");
  const b = await pool.acquire();
  assert.equal(b, a);
  assert.equal(b.state, "running");
  assert.equal(made.length, 1);
  assert.equal(pool.users(), 1);
});

test("a release racing the next acquire never suspends it for the newcomer", async () => {
  const { pool } = harness();
  const a = await pool.acquire();
  const b = await pool.acquire(); // new room's processor came up first
  pool.release(a); // old room's processor finishes tearing down
  assert.equal(b.state, "running");
  assert.equal(pool.users(), 1);
});

test("closed after the idle time with nobody holding it", async () => {
  const { pool, made, fireIdle } = harness();
  const a = await pool.acquire();
  pool.release(a);
  fireIdle();
  assert.equal(a.state, "closed");
  const b = await pool.acquire();
  assert.notEqual(b, a, "a fresh context after the idle close");
  assert.equal(made.length, 2);
});

test("acquiring within the idle time cancels the close", async () => {
  const { pool, hasTimer } = harness();
  const a = await pool.acquire();
  pool.release(a);
  assert.ok(hasTimer());
  await pool.acquire();
  assert.ok(!hasTimer());
  assert.notEqual(a.state, "closed");
});

test("a device that cannot run at 48 kHz is refused and not pooled", async () => {
  const { pool, made } = harness(44100);
  await assert.rejects(pool.acquire(), /48000/);
  assert.equal(made[0]!.state, "closed");
  assert.equal(pool.users(), 0);
});

test("double release does not go negative", async () => {
  const { pool } = harness();
  const a = await pool.acquire();
  pool.release(a);
  pool.release(a);
  assert.equal(pool.users(), 0);
});
