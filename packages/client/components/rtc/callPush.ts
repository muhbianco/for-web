import type { Channel, Client, User } from "stoat.js";

export const PUSH_PREFIX = "/_muchat/push/v1";

function sessionHeaders(client: Client): Record<string, string> {
  const [key, value] = client.authenticationHeader;
  return {
    "Content-Type": "application/json",
    [key]: value,
  };
}

export async function registerPushToken(
  client: Client,
  token: string,
): Promise<void> {
  if (!token) return;
  await fetch(`${PUSH_PREFIX}/register`, {
    method: "POST",
    headers: sessionHeaders(client),
    body: JSON.stringify({ token }),
  });
}

export async function notifyPushRing(
  channel: Channel,
  calleeId: string,
): Promise<void> {
  const client = channel.client;
  const caller = client.user;
  await fetch(`${PUSH_PREFIX}/ring`, {
    method: "POST",
    headers: sessionHeaders(client),
    body: JSON.stringify({
      channel_id: channel.id,
      callee_id: calleeId,
      caller_name: caller?.displayName ?? caller?.username ?? "Muchat",
    }),
  });
}

export async function notifyPushCancel(
  client: Client,
  channelId: string,
  calleeId: string,
): Promise<void> {
  await fetch(`${PUSH_PREFIX}/cancel`, {
    method: "POST",
    headers: sessionHeaders(client),
    body: JSON.stringify({ channel_id: channelId, callee_id: calleeId }),
  });
}

export function privateCallTargets(channel: Channel): string[] {
  if (channel.type === "DirectMessage" && channel.recipient) {
    return [channel.recipient.id];
  }
  if (channel.type === "Group") {
    const me = channel.client.user?.id;
    return channel.recipientIds
      ? [...channel.recipientIds].filter((id) => id !== me)
      : [];
  }
  return [];
}

export async function startPrivateCall(
  voice: {
    connect: (
      channel: Channel,
      auth?: { url: string; token: string },
      opts?: { recipients?: string[] },
    ) => Promise<void>;
  },
  user: User,
): Promise<Channel> {
  const channel = await user.openDM();
  await voice.connect(channel, undefined, { recipients: [user.id] });
  return channel;
}
