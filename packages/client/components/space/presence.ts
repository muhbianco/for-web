import {
  type Accessor,
  type Setter,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";

import {
  type MoveResult,
  type Presence,
  EMPTY_PRESENCE,
  PresenceLink,
} from "@muchat/space-client/presence";
import type { Client } from "stoat.js";

import { clientKind, isSpaceServer, sessionToken } from "./config";

/**
 * Who is in each room of a server's space, for the server sidebar (ADR 0008):
 * one watch-only connection per server, shared by every room of its channel
 * list, kept a little after the last user goes (switching servers back and
 * forth does not reconnect), never opened for servers without the space.
 */
interface Entry {
  link: PresenceLink;
  refs: number;
  closeTimer: ReturnType<typeof setTimeout> | undefined;
  presence: Accessor<Presence>;
  setPresence: Setter<Presence>;
  unsubscribe: () => void;
}

const entries = new Map<string, Entry>();
const LINGER_MS = 20_000;

function acquire(client: Client, serverId: string): Entry | null {
  const existing = entries.get(serverId);
  if (existing) {
    if (existing.closeTimer) clearTimeout(existing.closeTimer);
    existing.closeTimer = undefined;
    existing.refs++;
    return existing;
  }
  const token = sessionToken(client);
  if (!token) return null;
  const [presence, setPresence] = createSignal<Presence>(EMPTY_PRESENCE);
  const link = new PresenceLink({
    baseUrl: location.origin,
    sessionToken: token,
    serverId,
    client: clientKind(),
  });
  const unsubscribe = link.subscribe((p) => setPresence(p));
  link.start();
  const entry: Entry = {
    link,
    refs: 1,
    closeTimer: undefined,
    presence,
    setPresence,
    unsubscribe,
  };
  entries.set(serverId, entry);
  return entry;
}

function release(serverId: string, entry: Entry) {
  entry.refs--;
  if (entry.refs > 0) return;
  entry.closeTimer = setTimeout(() => {
    if (entries.get(serverId) !== entry || entry.refs > 0) return;
    entries.delete(serverId);
    entry.unsubscribe();
    entry.link.stop();
  }, LINGER_MS);
}

/** Live presence of a server's space; empty for servers without it. */
export function useSpacePresence(
  client: () => Client,
  serverId: () => string | undefined,
): Accessor<Presence> {
  const [entry, setEntry] = createSignal<Entry | null>(null);
  createEffect(() => {
    const id = serverId();
    if (!id || !isSpaceServer(id)) {
      setEntry(null);
      return;
    }
    const e = acquire(client(), id);
    setEntry(e);
    if (e) onCleanup(() => release(id, e));
  });
  return () => entry()?.presence() ?? EMPTY_PRESENCE;
}

/**
 * Leva alguém para uma sala do Espaço (o arrastar da barra lateral, 27/11/2026). Usa a conexão
 * só de olhar que a barra lateral já mantém; o servidor do Espaço confere a permissão (Mover
 * membros) e se a pessoa pode estar na sala, e a chamada dela vai junto.
 */
export async function moveInSpace(
  client: Client,
  serverId: string,
  userId: string,
  roomId: string,
): Promise<MoveResult> {
  if (!isSpaceServer(serverId)) return { ok: false, code: "not_space" };
  const entry = acquire(client, serverId);
  if (!entry) return { ok: false, code: "unauthenticated" };
  try {
    return await entry.link.moveMember(userId, roomId);
  } finally {
    release(serverId, entry);
  }
}
