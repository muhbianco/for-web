import assert from "node:assert/strict";
import test from "node:test";

import { audibleSpeakers, speakingShown } from "./speakingShown.ts";

// 28/11/2026: after a mute the ring stayed on 0.5–1.2 s next to the muted
// badge (LiveKit's speaker list lags the mute; the audio stopped in ≤150 ms).
test("speakingShown: the ring needs speech, an open mic and sound on", () => {
  assert.equal(
    speakingShown({ speaking: true, micMuted: false, deafened: false }),
    true,
  );
  assert.equal(
    speakingShown({ speaking: true, micMuted: true, deafened: false }),
    false,
    "muted: the server is still catching up",
  );
  assert.equal(
    speakingShown({ speaking: true, micMuted: false, deafened: true }),
    false,
  );
  assert.equal(
    speakingShown({ speaking: false, micMuted: false, deafened: false }),
    false,
  );
});

const me = { id: "me", isLocal: true, isMicrophoneEnabled: true };
const bia = { id: "bia", isLocal: false, isMicrophoneEnabled: true };
const caio = { id: "caio", isLocal: false, isMicrophoneEnabled: false };
const ids = (ps: { id: string }[]) => ps.map((p) => p.id);

test("audibleSpeakers keeps whoever has the mic open", () => {
  assert.deepEqual(ids(audibleSpeakers([me, bia], true)), ["me", "bia"]);
});

test("audibleSpeakers drops a remote whose mic track is muted", () => {
  assert.deepEqual(ids(audibleSpeakers([bia, caio], true)), ["bia"]);
});

test("audibleSpeakers drops ourselves as soon as the Voice state says muted", () => {
  // LiveKit may still report the track enabled for a moment after the click.
  assert.deepEqual(ids(audibleSpeakers([me, bia], false)), ["bia"]);
  assert.deepEqual(
    audibleSpeakers([{ ...me, isMicrophoneEnabled: false }], true),
    [],
  );
});
