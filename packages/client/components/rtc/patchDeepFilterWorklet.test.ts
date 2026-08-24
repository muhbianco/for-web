import assert from "node:assert/strict";
import test from "node:test";

import {
  patchDeepFilterWorkletSource,
  workletHasOutputHole,
} from "./patchDeepFilterWorklet.ts";

const BROKEN = `            const frameLength = this.dfModel.frameLength;
            while (this.getInputAvailable() >= frameLength) {
                this.tempFrame[0] = 0;
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

const WITH_INIT = `                this.tempFrame = new Float32Array(frameLength);
                this.isInitialized = true;
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
