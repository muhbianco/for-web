import type { Channel, Client, Server } from "stoat.js";

/**
 * Find which voice channel a user is currently in.
 * If `server` is given, only that server is searched.
 */
export function findVoiceChannel(
  client: Client,
  userId: string,
  server?: Server,
): Channel | undefined {
  const servers = server ? [server] : [...client.servers.values()];
  for (const s of servers) {
    for (const channel of s.channels) {
      if (channel.isVoice && channel.voiceParticipants.has(userId)) {
        return channel;
      }
    }
  }
}

/**
 * O menu de uma pessoa mostra a voz do TTS do Espaço (volume próprio e "Ouvir a voz")? Só para outra
 * pessoa (não você, não bot, não a tela compartilhada) de um servidor com o Espaço.
 *
 * O servidor vem, nesta ordem, de quem abriu o menu (`serverId`: a sala na barra lateral, o quadro da
 * chamada), do membro, ou do canal de voz em que a pessoa está. Na sala de um servidor com o Espaço o
 * Stoat nunca preenche quem está na chamada, e o membro só existe se a lista de membros do servidor já
 * carregou: sem o `serverId` de quem abriu, o bloco aparecia só às vezes e nunca no celular
 * (28/11/2026, o dono: "o menu de contexto novo com volume de TTS sumiu de novo").
 */
export function showsSpaceTts(
  who: { self: boolean; bot: boolean; screenshare: boolean },
  from: { serverId?: string; memberServerId?: string; voiceServerId?: string },
  isSpaceServer: (serverId: string) => boolean,
): boolean {
  if (who.self || who.bot || who.screenshare) return false;
  const serverId = from.serverId ?? from.memberServerId ?? from.voiceServerId;
  return !!serverId && isSpaceServer(serverId);
}
