import assert from "node:assert/strict";
import test from "node:test";

import {
  avatarVoice,
  hash32,
  PITCHES,
  portugueseVoices,
  RATES,
} from "./ttsVoice.ts";

const WINDOWS = [
  { name: "Microsoft Maria - Portuguese (Brazil)", lang: "pt-BR" },
  { name: "Microsoft Daniel - Portuguese (Brazil)", lang: "pt-BR" },
  { name: "Google português do Brasil", lang: "pt-BR" },
  { name: "Microsoft David - English (United States)", lang: "en-US" },
  { name: "Google português de Portugal", lang: "pt_PT" },
];

test("a mesma pessoa tem sempre a mesma voz (e o mesmo tom e ritmo)", () => {
  const a = avatarVoice("01JANA0000000000000000000A", WINDOWS);
  const b = avatarVoice("01JANA0000000000000000000A", [...WINDOWS].reverse());
  assert.equal(a.voice?.name, b.voice?.name);
  assert.equal(a.pitch, b.pitch);
  assert.equal(a.rate, b.rate);
});

test("só vozes do português do Brasil; sem elas, qualquer português; sem nada, a padrão", () => {
  assert.deepEqual(
    portugueseVoices(WINDOWS).map((v) => v.lang),
    ["pt-BR", "pt-BR", "pt-BR"],
  );
  assert.deepEqual(
    portugueseVoices([
      { name: "x", lang: "pt_PT" },
      { name: "y", lang: "en-US" },
    ]).map((v) => v.name),
    ["x"],
  );
  const none = avatarVoice("01JX", [{ name: "y", lang: "en-US" }]);
  assert.equal(none.voice, undefined);
  assert.ok(PITCHES.includes(none.pitch as (typeof PITCHES)[number]));
});

test("pessoas diferentes soam diferentes: 30 ids espalham tom, ritmo e voz", () => {
  const ids = Array.from(
    { length: 30 },
    (_, i) => `01JUSER${String(i).padStart(19, "0")}`,
  );
  const combos = new Set(
    ids.map((id) => {
      const v = avatarVoice(id, WINDOWS);
      return `${v.voice?.name}|${v.pitch}|${v.rate}`;
    }),
  );
  // 3 vozes × 7 tons × 4 ritmos = 84: sorteando 30, o esperado é ~25 distintas (aniversário).
  assert.ok(combos.size >= 21, `só ${combos.size} combinações em 30`);
  const pitches = new Set(ids.map((id) => avatarVoice(id, WINDOWS).pitch));
  assert.ok(pitches.size >= 5);
  for (const id of ids) {
    const v = avatarVoice(id, WINDOWS);
    assert.ok(v.pitch >= 0.8 && v.pitch <= 1.34);
    assert.ok(RATES.includes(v.rate as (typeof RATES)[number]));
  }
});

test("hash estável (o tom não muda entre aparelhos)", () => {
  assert.equal(hash32("abc"), hash32("abc"));
  assert.notEqual(hash32("abc"), hash32("abd"));
});
