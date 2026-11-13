import assert from "node:assert/strict";
import test from "node:test";

import {
  DF_INIT_ERROR_MESSAGE,
  DF_STATS_MESSAGE,
  isDeepFilterInitError,
  isDeepFilterStats,
  patchDeepFilterWorkletSource,
  workletHasOutputHole,
} from "./patchDeepFilterWorklet.ts";

const BROKEN = `            const frameLength = this.dfModel.frameLength;
            while (this.getInputAvailable() >= frameLength) {
                const processed = df_process_frame(this.dfModel.handle, this.tempFrame);
            }
            const outputAvailable = this.getOutputAvailable();
            if (outputAvailable >= 128) {
                for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
                    const output = outputList[inputNum];
                    const channelCount = output.length;
                    for (let channelNum = 0; channelNum < channelCount; channelNum++) {
                        const outputChannel = output[channelNum];
                        let readPos = this.outputReadPos;
                        for (let i = 0; i < 128; i++) {
                            outputChannel[i] = this.outputBuffer[readPos];
                            readPos = (readPos + 1) % this.bufferSize;
                        }
                    }
                }
                this.outputReadPos = (this.outputReadPos + 128) % this.bufferSize;
            }
            return true;`;

const INIT_CATCH = `            catch (error) {
                console.error('Failed to initialize DeepFilter in AudioWorklet:', error);
                this.isInitialized = false;
            }`;

const WITH_INIT = `                this.tempFrame = new Float32Array(frameLength);
                this.isInitialized = true;
${INIT_CATCH}
${BROKEN}`;

test("rejects unknown worklet source instead of loading the hole", () => {
  assert.throws(() => patchDeepFilterWorkletSource("registerProcessor('x')"));
});

test("removes the 128-sample skip and primes two frames", () => {
  assert.equal(workletHasOutputHole(WITH_INIT), true);
  const patched = patchDeepFilterWorkletSource(WITH_INIT);
  assert.equal(workletHasOutputHole(patched), false);
  assert.match(patched, /outputPrimed/);
  assert.match(patched, /frameLength \* 2/);
  assert.match(patched, /for \(let i = 0; i < quantum; i\+\+\)/);
});

test("times every frame and posts stats once a second", () => {
  const patched = patchDeepFilterWorkletSource(WITH_INIT);
  assert.match(patched, /const frameStart = Date\.now\(\);/);
  assert.match(patched, /this\.statSlowFrames\+\+/);
  assert.match(patched, new RegExp(`type: '${DF_STATS_MESSAGE}'`));
  assert.match(patched, /this\.statTick = 0;/);
});

test("refuses a worklet whose frame loop moved", () => {
  const withoutFrame = WITH_INIT.replace(
    "const processed = df_process_frame(this.dfModel.handle, this.tempFrame);",
    "this.tempFrame[0] = 0;",
  );
  assert.throws(() => patchDeepFilterWorkletSource(withoutFrame), /frame loop/);
});

test("recognises stats messages only", () => {
  assert.equal(
    isDeepFilterStats({
      type: DF_STATS_MESSAGE,
      frames: 100,
      slowFrames: 3,
      maxMs: 4,
    }),
    true,
  );
  assert.equal(
    isDeepFilterStats({ type: "SET_SUPPRESSION_LEVEL", value: 40 }),
    false,
  );
  assert.equal(isDeepFilterStats(null), false);
});

test("reports a failed model load instead of passing audio through silently", () => {
  const patched = patchDeepFilterWorkletSource(WITH_INIT);
  assert.match(
    patched,
    new RegExp(
      `this\\.isInitialized = false;\\s+this\\.port\\.postMessage\\(\\{\\s+type: '${DF_INIT_ERROR_MESSAGE}'`,
    ),
  );
});

test("refuses a worklet whose init error handling moved", () => {
  const withoutCatch = WITH_INIT.replace(INIT_CATCH, "");
  assert.throws(
    () => patchDeepFilterWorkletSource(withoutCatch),
    /init error handling/,
  );
});

test("recognises init error messages only", () => {
  assert.equal(
    isDeepFilterInitError({
      type: DF_INIT_ERROR_MESSAGE,
      message: "unreachable",
    }),
    true,
  );
  assert.equal(isDeepFilterInitError({ type: DF_INIT_ERROR_MESSAGE }), false);
  assert.equal(
    isDeepFilterInitError({ type: DF_STATS_MESSAGE, frames: 1 }),
    false,
  );
  assert.equal(isDeepFilterInitError(undefined), false);
});
