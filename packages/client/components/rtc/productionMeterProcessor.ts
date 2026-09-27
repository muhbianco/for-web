/**
 * Source of the production meter AudioWorkletProcessor. Import-free on
 * purpose, like rmsGateProcessor, so it can be evaluated in a unit test with
 * fake worklet globals.
 *
 * What it answers: **is this chain emitting silence while someone is
 * talking?**
 *
 * The listener's side showed sustained non-silent concealment with zero
 * packet loss — the receiver inventing audio to cover packets that were never
 * sent. Opus stops sending when DTX decides the input is silent, so gaps like
 * that mean the published stream really did go quiet mid-speech.
 *
 * Web Audio never skips a quantum: when the source underfeeds the graph, it
 * renders zeros rather than producing nothing. So starvation does not show up
 * as a missing sample count, it shows up as *digital silence in the middle of
 * speech*, and the only way to see it is to look at the samples that leave the
 * chain. This sits at the end, right before the destination, and counts them.
 *
 * A quantum of exact zeros is essentially impossible on a live microphone:
 * even a muted room has a noise floor, and the chain adds a highpass and a
 * compressor. Exact zeros mean the gate closed (expected, and reported
 * separately) or the graph starved (the defect).
 */

export const PRODUCTION_METER_PROCESSOR_NAME = "stoat-production-meter";

/** `type` of the message the processor posts on its port. */
export const PRODUCTION_METER_MESSAGE = "stoat-production";

/**
 * Peak below this counts as digital silence. Not exactly zero: the compressor
 * and gain stages can leave denormal-scale residue behind a true zero input.
 */
export const SILENCE_PEAK = 1e-6;

/** Post once per second at 48 kHz (375 * 128 = 48000 samples). */
export const PRODUCTION_REPORT_QUANTA = 375;

export interface ProductionStats {
  type: typeof PRODUCTION_METER_MESSAGE;
  /** Quanta rendered since the last message. */
  quanta: number;
  /** Of those, how many left the chain as digital silence. */
  silentQuanta: number;
  /** Longest run of consecutive silent quanta, in quanta. */
  longestSilentRun: number;
  /** Peak sample seen in the window, so a dead chain is distinguishable. */
  peak: number;
}

export function isProductionStats(data: unknown): data is ProductionStats {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<ProductionStats>;
  return (
    d.type === PRODUCTION_METER_MESSAGE &&
    typeof d.quanta === "number" &&
    typeof d.silentQuanta === "number" &&
    typeof d.longestSilentRun === "number" &&
    typeof d.peak === "number"
  );
}

/** Milliseconds of emitted silence per second of call. */
export function silentMsPerSec(stats: {
  quanta: number;
  silentQuanta: number;
}): number {
  if (stats.quanta <= 0) return 0;
  return Math.round((stats.silentQuanta / stats.quanta) * 1000);
}

export function buildProductionMeterSource(constants: {
  name: string;
  message: string;
  silencePeak: number;
  reportQuanta: number;
}): string {
  return `
class ProductionMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.quanta = 0;
    this.silentQuanta = 0;
    this.silentRun = 0;
    this.longestSilentRun = 0;
    this.peak = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;

    if (!input) {
      // No input connected at all: pass silence through and count it, which
      // is itself the signal we are looking for.
      output.fill(0);
      this.quanta++;
      this.silentQuanta++;
      this.silentRun++;
      if (this.silentRun > this.longestSilentRun) {
        this.longestSilentRun = this.silentRun;
      }
    } else {
      let peak = 0;
      for (let i = 0; i < input.length; i++) {
        output[i] = input[i];
        const abs = input[i] < 0 ? -input[i] : input[i];
        if (abs > peak) peak = abs;
      }
      if (peak > this.peak) this.peak = peak;
      this.quanta++;
      if (peak < ${constants.silencePeak}) {
        this.silentQuanta++;
        this.silentRun++;
        if (this.silentRun > this.longestSilentRun) {
          this.longestSilentRun = this.silentRun;
        }
      } else {
        this.silentRun = 0;
      }
    }

    if (this.quanta >= ${constants.reportQuanta}) {
      this.port.postMessage({
        type: '${constants.message}',
        quanta: this.quanta,
        silentQuanta: this.silentQuanta,
        longestSilentRun: this.longestSilentRun,
        peak: this.peak,
      });
      this.quanta = 0;
      this.silentQuanta = 0;
      this.longestSilentRun = 0;
      this.peak = 0;
    }
    return true;
  }
}

registerProcessor('${constants.name}', ProductionMeterProcessor);
`;
}
