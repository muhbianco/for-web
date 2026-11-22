import assert from "node:assert/strict";
import test from "node:test";

import {
  NORMALIZER_ATTACK_UP_DB_PER_POLL,
  NORMALIZER_MAX_GAIN_DB,
  NORMALIZER_MIN_FLOOR_POLLS,
  NORMALIZER_NOISE_CEILING_DBFS,
  NORMALIZER_TARGET_DBFS,
  NORMALIZER_UP_DB_PER_POLL,
  SpeechLevelNormalizer,
} from "../state/stores/noiseSuppressionPolicy.ts";

/** Talking with pauses: 3 polls of speech, 2 of room tone, repeated. */
function talk(
  n: SpeechLevelNormalizer,
  speechDb: number,
  floorDb: number,
  polls: number,
) {
  const gains: number[] = [];
  for (let i = 0; i < polls; i++) {
    gains.push(n.observe(i % 5 < 3 ? speechDb : floorDb));
  }
  return gains;
}

test("a normal talker gets no gain", () => {
  const n = new SpeechLevelNormalizer();
  const gains = talk(n, NORMALIZER_TARGET_DBFS, -90, 100);
  assert.equal(Math.max(...gains), 0);
});

test("a quiet talker is brought to the target (lab quiet-24: −45.7 dBFS)", () => {
  const n = new SpeechLevelNormalizer();
  const gains = talk(n, -45.7, -90, 150);
  const final = gains.at(-1)!;
  assert.ok(
    Math.abs(final - (NORMALIZER_TARGET_DBFS + 45.7)) < 1e-6,
    `gain ${final}`,
  );
  // The old make-up gain stopped at +18 dB; this one reaches +22.7.
  assert.ok(final > 18);
});

test("nothing changes before the floor is known", () => {
  const n = new SpeechLevelNormalizer();
  for (let i = 0; i < NORMALIZER_MIN_FLOOR_POLLS - 1; i++) n.observe(-50);
  assert.equal(n.gainDb(), 0);
  assert.equal(n.floorDb(), undefined);
});

test("the first rise is fast, later rises are slow", () => {
  const n = new SpeechLevelNormalizer();
  const gains = talk(n, -60, -95, 200);
  for (let i = 1; i < gains.length; i++) {
    assert.ok(
      gains[i] - gains[i - 1] <= NORMALIZER_ATTACK_UP_DB_PER_POLL + 1e-9,
    );
  }
  assert.equal(gains.at(-1), NORMALIZER_MAX_GAIN_DB, "capped");
  // 30 dB at 3.6 dB per poll: under 3 s of talking (2/5 of polls are pauses
  // but the gain keeps moving on them too).
  assert.ok(gains.indexOf(NORMALIZER_MAX_GAIN_DB) < 15);

  // Converged: the person gets quieter, the gain follows at 6 dB/s only.
  const m = new SpeechLevelNormalizer();
  talk(m, -40, -95, 150);
  const later = talk(m, -50, -95, 150);
  const all = [m.gainDb(), ...later];
  for (let i = 1; i < later.length; i++) {
    assert.ok(later[i] - later[i - 1] <= NORMALIZER_UP_DB_PER_POLL + 1e-9);
  }
  assert.ok(Math.abs(all.at(-1)! - (NORMALIZER_TARGET_DBFS + 50)) < 1e-6);
});

test("a quiet talker is heard within about a second and a half", () => {
  // lab quiet-24 (22/11): at 6 dB/s the first 5 s were erased by DeepFilter.
  const n = new SpeechLevelNormalizer();
  const gains = talk(n, -45.7, -120, 10);
  assert.ok(gains[7] >= 12, `gain after 1.6 s: ${gains[7]}`);
});

test("the gain never lifts the room noise above the ceiling", () => {
  const n = new SpeechLevelNormalizer();
  // Quiet talker in a noisy room: −36 dBFS speech over a −50 dBFS fan wants
  // +13 dB, but the fan may only rise to the ceiling.
  const gains = talk(n, -36, -50, 150);
  assert.equal(gains.at(-1), NORMALIZER_NOISE_CEILING_DBFS - -50);
});

test("a loud talker brings a learned gain down fast", () => {
  const n = new SpeechLevelNormalizer(20);
  const gains = talk(n, -15, -90, 60);
  assert.equal(gains.at(-1), 0);
  const firstDrop = gains.findIndex((g) => g < 20);
  assert.ok(
    firstDrop >= 0 && 20 - gains[firstDrop] > NORMALIZER_UP_DB_PER_POLL,
  );
});

test("silence holds the gain (no decay while nobody talks)", () => {
  const n = new SpeechLevelNormalizer();
  talk(n, -45, -90, 150);
  const before = n.gainDb();
  for (let i = 0; i < 100; i++) n.observe(-90);
  assert.equal(n.gainDb(), before);
});

test("a dead mic is never amplified", () => {
  const n = new SpeechLevelNormalizer();
  talk(n, -80, -110, 150);
  assert.equal(n.gainDb(), 0);
});

test("the initial gain is clamped", () => {
  assert.equal(new SpeechLevelNormalizer(99).gainDb(), NORMALIZER_MAX_GAIN_DB);
  assert.equal(new SpeechLevelNormalizer(-5).gainDb(), 0);
});
