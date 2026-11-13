/** Seeded PRNG for property tests (mulberry32): same seed, same sequence. */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => {
      const x = xs[Math.floor(next() * xs.length)];
      if (x === undefined) throw new Error("pick from empty");
      return x;
    },
  };
}

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Deterministic fake ULID from a counter (26 Crockford chars). */
export function fakeUlid(n: number): string {
  let s = "";
  let v = n;
  for (let i = 0; i < 26; i++) {
    s = (ULID_ALPHABET[v % 32] ?? "0") + s;
    v = Math.floor(v / 32);
  }
  return s;
}
