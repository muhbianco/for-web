import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICE_PROFILES,
  matchVoiceProfile,
} from "../state/stores/voiceProfiles.ts";

test("each profile is recognised from its own settings", () => {
  for (const [name, settings] of Object.entries(VOICE_PROFILES)) {
    assert.equal(matchVoiceProfile(settings), name);
  }
});

test("the default settings are the balanced profile", () => {
  // Store defaults: advanced, auto, gate on, AGC on, EC on, bitrate unset.
  assert.equal(
    matchVoiceProfile({
      noiseSupression: "advanced",
      deepFilterSensitivity: "auto",
      voiceGate: true,
      autoGainControl: true,
      echoCancellation: true,
    }),
    "balanced",
  );
});

test("any hand-made change is custom", () => {
  assert.equal(
    matchVoiceProfile({ ...VOICE_PROFILES.balanced, voiceGate: false }),
    "custom",
  );
  assert.equal(
    matchVoiceProfile({
      ...VOICE_PROFILES.natural,
      noiseSupression: "enhanced",
    }),
    "custom",
  );
});
