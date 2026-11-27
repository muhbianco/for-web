/**
 * A voz de cada avatar no TTS do Espaço (27/11/2026). O aparelho tem poucas vozes em português
 * (no Windows, Maria, Daniel, Francisca e a do Google), então a voz sai de três escolhas tiradas
 * do id da pessoa: qual voz do aparelho, o tom e o ritmo. O tom e o ritmo são os mesmos em todo
 * aparelho; a voz-base depende das vozes que cada aparelho tem.
 *
 * Puro (sem DOM): testado com node:test.
 */

/** O que importa de uma voz do aparelho (SpeechSynthesisVoice). */
export interface VoiceLike {
  name: string;
  lang: string;
}

export interface AvatarVoice<V extends VoiceLike = VoiceLike> {
  /** Voz do aparelho (undefined: a padrão do motor). */
  voice: V | undefined;
  /** Tom (1 = natural) e ritmo (1 = normal). */
  pitch: number;
  rate: number;
}

/** Tons espaçados o bastante para o ouvido separar, sem ficar caricato. */
export const PITCHES = [0.8, 0.9, 0.98, 1.06, 1.14, 1.24, 1.34] as const;
/** Ritmos perto do natural: rápido demais vira robô, lento demais cansa. */
export const RATES = [0.94, 1, 1.06, 1.12] as const;

/**
 * FNV-1a de 32 bits com a mistura final do Murmur3: estável entre aparelhos, sem dependência, e
 * com os bits bem espalhados (ids do Stoat que nascem juntos diferem só no fim).
 */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const norm = (lang: string) => lang.replace("_", "-").toLowerCase();

/** As vozes que servem para o português do Brasil (exatas primeiro; depois qualquer português). */
export function portugueseVoices<V extends VoiceLike>(
  voices: readonly V[],
  lang = "pt-BR",
): V[] {
  const target = norm(lang);
  const base = target.split("-")[0]!;
  const exact = voices.filter((v) => norm(v.lang) === target);
  if (exact.length)
    return [...exact].sort((a, b) => a.name.localeCompare(b.name));
  return voices
    .filter((v) => norm(v.lang).split("-")[0] === base)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A voz de um avatar: a mesma sempre que a mesma pessoa fala neste aparelho. */
export function avatarVoice<V extends VoiceLike>(
  userId: string,
  voices: readonly V[],
  lang = "pt-BR",
): AvatarVoice<V> {
  const h = hash32(userId);
  const list = portugueseVoices(voices, lang);
  return {
    voice: list.length ? list[h % list.length] : undefined,
    pitch: PITCHES[(h >>> 8) % PITCHES.length]!,
    rate: RATES[(h >>> 16) % RATES.length]!,
  };
}
