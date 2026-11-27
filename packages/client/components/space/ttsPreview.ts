import { speakTts } from "@revolt/rtc/tts";

import { avatarVoice } from "./ttsVoice";

/**
 * Toca uma frase curta com a voz do TTS de uma pessoa no Espaço (o "Ouvir a voz" do menu do
 * botão direito). Leve de propósito: o menu está no pacote principal e não pode puxar o mapa.
 */
export function previewAvatarVoice(
  userId: string,
  text: string,
  volume: number,
) {
  const { pitch, rate } = avatarVoice(userId, []);
  const v = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  void speakTts(text, {
    volume: v,
    pitch,
    rate,
    voice: (voices) => avatarVoice(userId, voices).voice,
  }).catch(() => undefined);
}
