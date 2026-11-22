/**
 * sfc32: só operações de 32 bits, então dá a mesma sequência em qualquer motor
 * JS (servidor Node e app). Cada luta e cada sala da expedição recebe a própria
 * semente por `seedOf`, assim o resultado não depende da ordem dos comandos.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 12; i++) this.u32();
  }

  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Inteiro em [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + (this.u32() % (hi - lo + 1));
  }

  /** Verdadeiro com probabilidade `bp` em pontos-base (1/10000). */
  bp(bp: number): boolean {
    return bp > 0 && this.u32() % 10_000 < bp;
  }

  pick<T>(xs: readonly T[]): T {
    const x = xs[this.u32() % xs.length];
    if (x === undefined) throw new Error("pick from empty");
    return x;
  }

  /** Chave sorteada pelo peso (pesos inteiros ≥ 0, soma > 0). */
  weighted<K extends string>(w: Readonly<Record<K, number>>): K {
    const keys = Object.keys(w) as K[];
    let total = 0;
    for (const k of keys) total += w[k];
    let r = this.u32() % total;
    for (const k of keys) {
      if (r < w[k]) return k;
      r -= w[k];
    }
    return keys[keys.length - 1]!;
  }
}

function fmix(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Mistura de 32 bits (finalizador do murmur3) de uma semente com rótulos
 * inteiros. Não é criptográfica: serve para testes, simulação e para separar
 * sorteios de uma mesma luta. A expedição no servidor usa HMAC (run.ts).
 */
export function seedOf(seed: number, ...parts: number[]): number {
  let h = fmix((seed >>> 0) ^ 0x9e3779b9);
  for (const p of parts) h = fmix(((h ^ fmix(((p >>> 0) + 0x632be5ab) >>> 0)) + 0x9e3779b9) >>> 0);
  return h;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Id curto (8 caracteres) para itens, tirado do RNG da sala. */
export function shortId(rng: Rng): string {
  let a = rng.u32();
  let b = rng.u32();
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += CROCKFORD[a & 31];
    a >>>= 5;
  }
  for (let i = 0; i < 4; i++) {
    s += CROCKFORD[b & 31];
    b >>>= 5;
  }
  return s;
}
