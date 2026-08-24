/**
 * The upstream worklet only writes output when the ring already has 128
 * samples. DeepFilter frames are 480, so leftover 96 every ~7 callbacks
 * becomes a 128-sample hole (the "tec tec"). Rewrite the blob before
 * addModule so we always fill the quantum and prime two frames of latency.
 */

const BROKEN_OUTPUT = `const outputAvailable = this.getOutputAvailable();
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

const FIXED_OUTPUT = `const quantum = outputList[0]?.[0]?.length || 128;
            if (!this.outputPrimed) {
                if (this.getOutputAvailable() >= frameLength * 2) {
                    this.outputPrimed = true;
                }
                else {
                    return true;
                }
            }
            for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
                const output = outputList[inputNum];
                const channelCount = output.length;
                for (let channelNum = 0; channelNum < channelCount; channelNum++) {
                    const outputChannel = output[channelNum];
                    for (let i = 0; i < quantum; i++) {
                        if (this.getOutputAvailable() > 0) {
                            this.lastSample = this.outputBuffer[this.outputReadPos];
                            this.outputReadPos = (this.outputReadPos + 1) % this.bufferSize;
                            outputChannel[i] = this.lastSample;
                        }
                        else {
                            outputChannel[i] = this.lastSample;
                        }
                    }
                }
            }
            return true;`;

const INIT_NEEDLE = "this.tempFrame = new Float32Array(frameLength);\n                this.isInitialized = true;";
const INIT_PATCH =
  "this.tempFrame = new Float32Array(frameLength);\n                this.outputPrimed = false;\n                this.lastSample = 0;\n                this.isInitialized = true;";

export function patchDeepFilterWorkletSource(source: string): string {
  if (!source.includes(BROKEN_OUTPUT)) {
    throw new Error(
      "DeepFilter worklet output loop changed; refusing to load the unpatched processor",
    );
  }
  if (!source.includes(INIT_NEEDLE)) {
    throw new Error("DeepFilter worklet constructor changed; refusing to patch");
  }
  return source.replace(INIT_NEEDLE, INIT_PATCH).replace(BROKEN_OUTPUT, FIXED_OUTPUT);
}

export function workletHasOutputHole(source: string): boolean {
  return source.includes("if (outputAvailable >= 128)");
}

export async function addPatchedDeepFilterModule(
  addModule: (
    url: string | URL,
    options?: WorkletOptions,
  ) => Promise<void>,
  moduleURL: string | URL,
  options?: WorkletOptions,
): Promise<void> {
  const url = String(moduleURL);
  if (!url.startsWith("blob:")) {
    await addModule(moduleURL, options);
    return;
  }
  const source = await fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to read DeepFilter worklet blob: ${response.status}`);
    }
    return response.text();
  });
  const patched = patchDeepFilterWorkletSource(source);
  const blob = new Blob([patched], { type: "application/javascript" });
  const patchedUrl = URL.createObjectURL(blob);
  try {
    await addModule(patchedUrl, options);
  } finally {
    URL.revokeObjectURL(patchedUrl);
  }
}
