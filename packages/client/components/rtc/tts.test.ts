import assert from "node:assert/strict";
import test from "node:test";

import {
  TTS_MAX_CHARS,
  type TtsVoiceLike,
  isTtsCommand,
  parseTtsCommand,
  pickTtsVoice,
  stripTtsPrefix,
} from "./tts.ts";

test("recognises the /tts prefix case-insensitively and only as a word", () => {
  assert.equal(isTtsCommand("/tts olá"), true);
  assert.equal(isTtsCommand("  /TTS olá"), true);
  assert.equal(isTtsCommand("/tts"), true);
  assert.equal(isTtsCommand("/ttsx olá"), false);
  assert.equal(isTtsCommand("olá /tts"), false);
  assert.equal(isTtsCommand(""), false);
  assert.equal(isTtsCommand(undefined), false);
});

test("strips the prefix but keeps markdown for rendering", () => {
  assert.equal(stripTtsPrefix("/tts **olá** <@01ABC>"), "**olá** <@01ABC>");
  assert.equal(stripTtsPrefix("/tts    "), null);
  assert.equal(stripTtsPrefix("bom dia"), null);
});

test("parses the spoken text and drops noise", () => {
  assert.equal(parseTtsCommand("/tts olá   pessoal"), "olá pessoal");
  assert.equal(
    parseTtsCommand("/tts olha isso https://example.com/x?y=1 legal"),
    "olha isso legal",
  );
  assert.equal(
    parseTtsCommand("/tts oi :01HZX8Y2K3M4N5P6Q7R8S9T0VW: tudo bem"),
    "oi tudo bem",
  );
  assert.equal(parseTtsCommand("/tts https://example.com"), null);
  assert.equal(parseTtsCommand("/tts"), null);
  assert.equal(parseTtsCommand("mensagem normal"), null);
});

test("caps the spoken text length", () => {
  const long = "a".repeat(TTS_MAX_CHARS + 50);
  const parsed = parseTtsCommand(`/tts ${long}`);
  assert.ok(parsed);
  assert.equal(parsed.length, TTS_MAX_CHARS);
});

const voice = (
  name: string,
  lang: string,
  extra: Partial<TtsVoiceLike> = {},
): TtsVoiceLike => ({
  name,
  lang,
  default: false,
  localService: true,
  ...extra,
});

test("prefers an exact pt-BR voice, neural/online first", () => {
  const voices = [
    voice("Microsoft David - English (United States)", "en-US", {
      default: true,
    }),
    voice("Microsoft Maria - Portuguese (Brazil)", "pt-BR"),
    voice("Microsoft Francisca Online (Natural) - Portuguese (Brazil)", "pt-BR", {
      localService: false,
    }),
    voice("Google português do Brasil", "pt_BR", { localService: false }),
  ];
  assert.equal(
    pickTtsVoice(voices, "pt-BR")?.name,
    "Microsoft Francisca Online (Natural) - Portuguese (Brazil)",
  );
});

test("falls back to the same base language, then to nothing", () => {
  const voices = [
    voice("Microsoft David - English (United States)", "en-US", {
      default: true,
    }),
    voice("Microsoft Helia - Portuguese (Portugal)", "pt-PT"),
  ];
  assert.equal(
    pickTtsVoice(voices, "pt-BR")?.name,
    "Microsoft Helia - Portuguese (Portugal)",
  );
  assert.equal(pickTtsVoice([voices[0]], "pt-BR"), undefined);
});
