/**
 * Discord-style `/tts`: the message travels as plain text and every client
 * connected to that voice channel speaks it locally with the Web Speech API.
 * No server round trip, no audio track; the voice is whatever the device has.
 */

export const TTS_COMMAND = "/tts";
export const TTS_LANG = "pt-BR";
/** Chromium silently stops long utterances; keep them short. */
export const TTS_MAX_CHARS = 200;

const RE_TTS_PREFIX = /^\/tts(?=\s|$)/i;
const RE_URL = /https?:\/\/\S+/gi;
/** Custom emoji are `:ULID:`; reading 26 random chars aloud is noise. */
const RE_CUSTOM_EMOJI = /:[0-9A-HJKMNP-TV-Z]{26}:/g;
const RE_WHITESPACE = /\s+/g;

/** Minimal shape so voice selection can be unit tested outside a browser. */
export type TtsVoiceLike = Pick<
  SpeechSynthesisVoice,
  "name" | "lang" | "default" | "localService"
>;

/**
 * Whether the content is a `/tts` command (with or without a body).
 */
export function isTtsCommand(content: string | null | undefined): boolean {
  if (!content) return false;
  return RE_TTS_PREFIX.test(content.trimStart());
}

/**
 * Message body after the `/tts` prefix, markdown untouched, for rendering.
 * Returns null when the content is not a `/tts` command or has no body.
 */
export function stripTtsPrefix(
  content: string | null | undefined,
): string | null {
  if (!content) return null;
  const trimmed = content.trimStart();
  const match = RE_TTS_PREFIX.exec(trimmed);
  if (!match) return null;
  const body = trimmed.slice(match[0].length).trim();
  return body.length ? body : null;
}

/**
 * Text to hand to the synthesizer: prefix removed, URLs and custom emoji
 * dropped, whitespace collapsed, capped at TTS_MAX_CHARS.
 * Pass `message.contentPlain` so mentions already read as names.
 */
export function parseTtsCommand(
  content: string | null | undefined,
): string | null {
  const body = stripTtsPrefix(content);
  if (!body) return null;

  let text = body
    .replace(RE_URL, " ")
    .replace(RE_CUSTOM_EMOJI, " ")
    .replace(RE_WHITESPACE, " ")
    .trim();
  if (!text.length) return null;

  if (text.length > TTS_MAX_CHARS) {
    text = text.slice(0, TTS_MAX_CHARS).trimEnd();
  }
  return text;
}

function normaliseLang(lang: string): string {
  return lang.replace("_", "-").toLowerCase();
}

/**
 * Pick the best voice for a language. Exact locale first, then same base
 * language, preferring neural/online voices when the platform exposes them.
 * Returns undefined when nothing matches so the engine default is used.
 */
export function pickTtsVoice<V extends TtsVoiceLike>(
  voices: readonly V[],
  lang: string = TTS_LANG,
): V | undefined {
  const target = normaliseLang(lang);
  const base = target.split("-")[0];

  const rank = (list: V[]): V | undefined =>
    list.find((voice) => /natural|neural/i.test(voice.name)) ??
    list.find((voice) => /google/i.test(voice.name)) ??
    list.find((voice) => voice.default) ??
    list[0];

  const exact = voices.filter((voice) => normaliseLang(voice.lang) === target);
  if (exact.length) return rank(exact);

  const sameBase = voices.filter(
    (voice) => normaliseLang(voice.lang).split("-")[0] === base,
  );
  if (sameBase.length) return rank(sameBase);

  return undefined;
}

/**
 * Whether this runtime can speak. Android WebView and some embedded shells
 * ship without the API; callers must treat "no" as a silent no-op.
 */
export function ttsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

let pendingVoices: Promise<SpeechSynthesisVoice[]> | undefined;

/**
 * Chromium/Electron populate `getVoices()` asynchronously and signal it via
 * `voiceschanged`. Wait for that (bounded) instead of speaking with no voice.
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);

  if (!pendingVoices) {
    pendingVoices = new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        synth.removeEventListener("voiceschanged", finish);
        pendingVoices = undefined;
        resolve(synth.getVoices());
      };
      const timer = setTimeout(finish, 1500);
      synth.addEventListener("voiceschanged", finish);
    });
  }
  return pendingVoices;
}

function clampVolume(volume: number | undefined): number {
  if (typeof volume !== "number" || Number.isNaN(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

/**
 * Queue an utterance on the device synthesizer. Safe to call when TTS is
 * unsupported (no-op). Utterances queue naturally, so several `/tts` in a
 * row play back to back instead of overlapping.
 */
export async function speakTts(
  text: string,
  opts: { volume?: number; lang?: string } = {},
): Promise<void> {
  if (!ttsSupported()) return;
  const body = text.trim();
  if (!body.length) return;

  const lang = opts.lang ?? TTS_LANG;
  const voices = await loadVoices();
  const synth = window.speechSynthesis;

  const utterance = new SpeechSynthesisUtterance(body);
  utterance.lang = lang;
  utterance.volume = clampVolume(opts.volume);
  utterance.rate = 1;
  utterance.pitch = 1;
  const voice = pickTtsVoice(voices, lang);
  if (voice) utterance.voice = voice;

  // Chromium can wedge in a paused state after tab/background changes.
  if (synth.paused) synth.resume();
  synth.speak(utterance);
}

/**
 * Drop everything queued or playing. Used on deafen and on leaving the call.
 */
export function cancelTts(): void {
  if (!ttsSupported()) return;
  window.speechSynthesis.cancel();
}
