import {
  type Accessor,
  type Setter,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";

import {
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
