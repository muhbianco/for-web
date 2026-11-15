/* global Buffer */
// Leitura e escrita de WAV PCM (16-bit ou float32), mono ou estéreo.
// Sem dependências: o laboratório roda com o Node que já está na máquina.
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Lê um WAV e devolve o sinal em mono (média dos canais) como Float32Array.
 * Aceita PCM 16-bit, PCM 32-bit e IEEE float 32-bit.
 */
export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: não é um WAV`);
  }
  let pos = 12;
  let fmt;
  let data;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
      // WAVE_FORMAT_EXTENSIBLE guarda o formato real no subformato.
      if (fmt.format === 0xfffe && size >= 26) {
        fmt.format = buf.readUInt16LE(body + 24);
      }
    } else if (id === "data") {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${path}: WAV sem fmt/data`);
  const { channels, bits, format } = fmt;
  const bytesPerSample = bits / 8;
  const frames = Math.floor(data.length / (bytesPerSample * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const off = (i * channels + c) * bytesPerSample;
      let v;
      if (format === 3 && bits === 32) v = data.readFloatLE(off);
      else if (bits === 16) v = data.readInt16LE(off) / 32768;
      else if (bits === 32) v = data.readInt32LE(off) / 2147483648;
      else if (bits === 8) v = (data.readUInt8(off) - 128) / 128;
      else throw new Error(`${path}: ${bits} bits não suportado`);
      acc += v;
    }
    out[i] = acc / channels;
  }
  return { sampleRate: fmt.sampleRate, channels, bits, data: out };
}

/** Grava mono 16-bit PCM. Valores fora de [-1, 1] são saturados. */
export function writeWav(path, samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/** Concatena os blocos Float32 que a página devolve (base64 de float32 little-endian). */
export function decodePcmChunks(chunksBase64) {
  const parts = chunksBase64.map((b64) => {
    const raw = Buffer.from(b64, "base64");
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  });
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
