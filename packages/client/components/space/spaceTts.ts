import { createSignal } from "solid-js";

import type { SpaceView } from "@muchat/space-client";
import type { Client, Message } from "stoat.js";

import {
  claimTts,
  parseTtsCommand,
  speakTts,
  ttsSupported,
} from "@revolt/rtc/tts";

import { hallChannelOf } from "./chat/spaceChat";
import { avatarVoice } from "./ttsVoice";

/**
 * O TTS do Espaço (27/11/2026), separado do TTS da chamada:
 * - sempre ligado (a opção "TTS" das configurações vale para as outras chamadas, não para o mapa);
 * - fala o `/tts` de quem está na MESMA zona que você (sua sala, ou o saguão), como o balão;
 * - cada avatar tem a sua voz (ttsVoice.ts) e cada pessoa tem o seu volume de TTS, à parte do
 *   volume da voz dela (menu do botão direito);
 * - respeita o "ensurdecer" e quem você bloqueou; nunca lê bot.
 *
 * Usa a voz do aparelho (Web Speech API), como o TTS da chamada: nada vai para o LiveKit, nada
 * passa pelo microfone nem pela cadeia de voz. Vive com a sessão do Espaço (mapa aberto, ou a
 * chamada da sala mantida com o mapa fechado).
 */

/** Mensagens sendo faladas agora: a carinha do balão mexe a boca enquanto estão aqui. */
const [speaking, setSpeaking] = createSignal<ReadonlySet<string>>(new Set());
export const ttsSpeaking = speaking;

function mark(id: string, on: boolean) {
  const next = new Set(speaking());
  if (on) next.add(id);
  else next.delete(id);
  setSpeaking(next);
}

/** Falas na fila do Espaço; acima disso a nova é descartada (ninguém soterra a sala de TTS). */
const MAX_QUEUED = 5;

export interface SpaceTtsDeps {
  serverId: string;
  view: SpaceView;
  client: () => Client;
  /** Ensurdecido na chamada: não fala nada. */
  deafened: () => boolean;
  /** Volume geral de saída e o volume de TTS de cada pessoa (0–1). */
  output: () => number;
  volumeOf: (userId: string) => number;
}

const clamp01 = (v: number) =>
  Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;

/** Liga o TTS do Espaço de um servidor; devolve o desligar. */
export function attachSpaceTts(d: SpaceTtsDeps): () => void {
  // As salas e o saguão deste servidor são do Espaço: o TTS da chamada não os lê de novo.
  const release = claimTts(
    (channelId) => d.client().channels.get(channelId)?.serverId === d.serverId,
  );
  let queued = 0;

  const zoneChannel = (room: string | null | undefined) =>
    room === undefined
      ? undefined
      : room === null
        ? hallChannelOf(d.client(), d.serverId)?.id
        : room;

  const onMessage = (m: Message) => {
    if (m.channel?.serverId !== d.serverId) return;
    if (!m.authorId || m.systemMessage) return;
    const author = m.author;
    if (author?.bot || author?.relationship === "Blocked") return;
    const text = parseTtsCommand(m.contentPlain);
    if (!text || d.deafened() || !ttsSupported()) return;
    const me = d.client().user?.id;
    const mine = zoneChannel(me ? d.view.roomOf(me) : undefined);
    const theirs = zoneChannel(d.view.roomOf(m.authorId));
    // Fala onde a pessoa está, para quem está lá (a mesma regra do balão com texto).
    if (!mine || mine !== m.channelId || theirs !== m.channelId) return;
    const volume = clamp01(d.output()) * clamp01(d.volumeOf(m.authorId));
    if (volume <= 0 || queued >= MAX_QUEUED) return;
    const who = m.authorId;
    const { pitch, rate } = avatarVoice(who, []);
    queued++;
    let done = false;
    // O Chromium às vezes não avisa o fim: a fila não pode travar por isso.
    const guard = setTimeout(() => finish(), 15_000 + text.length * 150);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      queued = Math.max(0, queued - 1);
      mark(m.id, false);
    };
    speakTts(text, {
      volume,
      pitch,
      rate,
      voice: (voices) => avatarVoice(who, voices).voice,
      onStart: () => mark(m.id, true),
      onEnd: finish,
    }).catch((err) => {
      finish();
      console.warn("[space] tts failed", err);
    });
  };

  const client = d.client();
  client.addListener("messageCreate", onMessage);
  return () => {
    client.removeListener("messageCreate", onMessage);
    release();
  };
}
