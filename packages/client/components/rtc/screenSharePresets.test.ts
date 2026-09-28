import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SCREEN_SHARE_FPS,
  SCREEN_SHARE_FRAME_RATES,
  TEXT_SCREEN_SHARE_FPS,
  frameRatesForTier,
  normaliseFrameRate,
  qualitiesForTier,
  screenShareDegradation,
  screenShareEncoding,
  screenShareLabel,
  tierAllowsFrameRate,
  tierAllowsQuality,
} from "./screenSharePresets.ts";

test("the picked frame rate reaches the encoding", () => {
  // The bug this module exists for: 60 used to be captured and published as 30.
  assert.equal(screenShareEncoding("high", 60).maxFramerate, 60);
  assert.equal(screenShareEncoding("low", 60).maxFramerate, 60);
  assert.equal(screenShareEncoding("high", 15).maxFramerate, 15);
});

test("bitrate grows with the frame rate", () => {
  for (const quality of ["low", "high"] as const) {
    let previous = 0;
    for (const fps of SCREEN_SHARE_FRAME_RATES) {
      const bitrate = screenShareEncoding(quality, fps).maxBitrate!;
      assert.ok(
        bitrate > previous,
        `${quality} at ${fps}fps should beat ${previous}`,
      );
      previous = bitrate;
    }
  }
});

test("30 fps keeps livekit's original bitrates, so nothing changes by default", () => {
  assert.equal(screenShareEncoding("low", 30).maxBitrate, 2_000_000);
  assert.equal(screenShareEncoding("high", 30).maxBitrate, 5_000_000);
});

test("source mode ignores the frame rate control", () => {
  assert.equal(normaliseFrameRate("text", 60), TEXT_SCREEN_SHARE_FPS);
  assert.equal(
    screenShareEncoding("text", 60).maxFramerate,
    TEXT_SCREEN_SHARE_FPS,
  );
  assert.equal(screenShareLabel("text", 60), "Source 5FPS");
});

test("an unknown frame rate falls back instead of producing undefined bitrate", () => {
  assert.equal(normaliseFrameRate("high", 144), DEFAULT_SCREEN_SHARE_FPS);
  assert.equal(normaliseFrameRate("high", undefined), DEFAULT_SCREEN_SHARE_FPS);
  assert.ok(screenShareEncoding("high", 144).maxBitrate! > 0);
});

test("labels say what is actually published", () => {
  assert.equal(screenShareLabel("low", 30), "720p 30FPS");
  assert.equal(screenShareLabel("high", 60), "1080p 60FPS");
});

test("free para em 720p30, VIP abre o resto", () => {
  assert.deepEqual(qualitiesForTier("free"), ["low"]);
  assert.deepEqual(qualitiesForTier("vip"), ["low", "high", "text"]);
  assert.deepEqual([...frameRatesForTier("free")], [15, 30]);
  assert.deepEqual(
    [...frameRatesForTier("vip")],
    [...SCREEN_SHARE_FRAME_RATES],
  );
});

test("free não publica 60 fps mesmo se o valor vier salvo", () => {
  // O caso real: o usuário escolheu 60 enquanto era VIP, o VIP venceu, e o
  // valor continua no picker. A trava tem que estar aqui, não só na UI.
  assert.equal(normaliseFrameRate("low", 60, "free"), DEFAULT_SCREEN_SHARE_FPS);
  assert.equal(screenShareEncoding("low", 60, "free").maxFramerate, 30);
  assert.equal(screenShareEncoding("low", 60, "vip").maxFramerate, 60);
});

test("free ainda escolhe entre os fps que tem", () => {
  assert.equal(normaliseFrameRate("low", 15, "free"), 15);
  assert.equal(normaliseFrameRate("low", 30, "free"), 30);
});

test("as permissões por tier respondem o que a UI precisa desenhar", () => {
  assert.equal(tierAllowsQuality("free", "low"), true);
  assert.equal(tierAllowsQuality("free", "high"), false);
  assert.equal(tierAllowsQuality("free", "text"), false);
  assert.equal(tierAllowsQuality("vip", "high"), true);
  assert.equal(tierAllowsFrameRate("free", 60), false);
  assert.equal(tierAllowsFrameRate("vip", 60), true);
});

test("o rótulo não promete o que o tier não entrega", () => {
  assert.equal(screenShareLabel("low", 60, "free"), "720p 30FPS");
  assert.equal(screenShareLabel("low", 60, "vip"), "720p 60FPS");
});

test("source continua ignorando fps em qualquer tier", () => {
  assert.equal(normaliseFrameRate("text", 60, "free"), TEXT_SCREEN_SHARE_FPS);
  assert.equal(normaliseFrameRate("text", 60, "vip"), TEXT_SCREEN_SHARE_FPS);
});

test("60 fps segura a fluidez; texto segura a nitidez", () => {
  // livekit manda maintain-resolution em todo screenshare. Num jogo a 60 isso
  // é exatamente como se consegue o slideshow que o fps queria evitar.
  assert.equal(screenShareDegradation("low", 60, "vip"), "maintain-framerate");
  assert.equal(screenShareDegradation("high", 60, "vip"), "maintain-framerate");
  assert.equal(
    screenShareDegradation("text", 60, "vip"),
    "maintain-resolution",
  );
  assert.equal(screenShareDegradation("low", 30, "vip"), "balanced");
});

test("free nunca cai em maintain-framerate, porque nunca chega a 60", () => {
  assert.equal(screenShareDegradation("low", 60, "free"), "balanced");
});
