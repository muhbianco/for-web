/**
 * AudioWorklet that copies whatever flows through it to the main thread as
 * Float32 chunks (100 ms each). Used by the lab to capture (a) the processed
 * microphone track that leaves VoiceProcessor and (b) each remote track as the
 * listener's decoder + jitter buffer hand it over. Pass-through: output = input.
 */
export const RECORDER_PROCESSOR_NAME = "voice-lab-recorder";

export const RECORDER_WORKLET_SOURCE = `
class VoiceLabRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4800);
    this.pos = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data === "stop") this.active = false;
      if (e.data === "start") this.active = true;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const out = outputs[0];
    if (out) for (let c = 0; c < out.length; c++) out[c].fill(0);
    if (!input) {
      // Sem entrada neste quantum: registra silêncio para manter o tempo.
      if (this.active) this.push(new Float32Array(128));
      return true;
    }
    if (out && out[0]) out[0].set(input);
    if (this.active) this.push(input);
    return true;
  }
  push(samples) {
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(samples.length - i, this.buf.length - this.pos);
      this.buf.set(samples.subarray(i, i + n), this.pos);
      this.pos += n;
      i += n;
      if (this.pos === this.buf.length) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(4800);
        this.pos = 0;
      }
    }
  }
}
registerProcessor("${RECORDER_PROCESSOR_NAME}", VoiceLabRecorder);
`;

export interface Recording {
  node: AudioWorkletNode;
  context: AudioContext;
  chunks: Float32Array[];
  /** Date.now() when the first quantum could have been captured. */
  startedAt: number;
  maxChunks: number;
  stop(): Promise<Float32Array[]>;
}

const loaded = new WeakSet<AudioContext>();

async function ensureModule(context: AudioContext) {
  if (loaded.has(context)) return;
  const blob = new Blob([RECORDER_WORKLET_SOURCE], {
    type: "application/javascript",
  });
  const url = URL.createObjectURL(blob);
  try {
    await context.audioWorklet.addModule(url);
    loaded.add(context);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Records `track` through a 48 kHz context. The source node must reach the
 * destination or Chromium will not pull audio from a remote WebRTC track, so
 * the recorder node is wired to the destination with its output silenced.
 */
export async function recordTrack(
  track: MediaStreamTrack,
  maxSeconds: number,
  context?: AudioContext,
): Promise<Recording> {
  const ctx = context ?? new AudioContext({ sampleRate: 48000 });
  if (ctx.state === "suspended") await ctx.resume();
  await ensureModule(ctx);
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
  });
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  const chunks: Float32Array[] = [];
  const startedAt = Date.now();
  const maxChunks = Math.ceil((maxSeconds * 48000) / 4800);
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (chunks.length < maxChunks) chunks.push(event.data);
  };
  return {
    node,
    context: ctx,
    chunks,
    startedAt,
    maxChunks,
    async stop() {
      node.port.postMessage("stop");
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      mute.disconnect();
      return chunks;
    },
  };
}

/** Float32 chunks -> base64 strings (1 MiB each) for page.evaluate transfer. */
export function encodeChunks(chunks: Float32Array[]): string[] {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const all = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  const bytes = new Uint8Array(all.buffer);
  const out: string[] = [];
  const step = 1 << 20;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + step));
    let bin = "";
    for (let j = 0; j < slice.length; j += 0x8000) {
      bin += String.fromCharCode.apply(
        null,
        Array.from(slice.subarray(j, j + 0x8000)),
      );
    }
    out.push(btoa(bin));
  }
  return out;
}
