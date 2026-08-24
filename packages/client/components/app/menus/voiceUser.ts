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
