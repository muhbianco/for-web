import { createSignal } from "solid-js";

import type { Client } from "stoat.js";

/**
 * Which Stoat servers have the space switched on (Muchat Espaço, ADR 0006).
 *
 * Asked to the space service once per session. Any failure — service not
 * deployed yet, offline, another instance — means "none": the sidebar then
 * looks exactly like before. Never the other way round.
 */
export const SPACE_PREFIX = "/_muchat/space/v1";

const [servers, setServers] = createSignal<ReadonlySet<string>>(new Set());
let pending: Promise<void> | null = null;
let loadedAt = 0;
const REFRESH_MS = 10 * 60_000;

export function isSpaceServer(serverId: string): boolean {
  return servers().has(serverId);
}

/** Session token of a signed-in person (never of a bot). */
export function sessionToken(client: Client): string | null {
  const [key, value] = client.authenticationHeader;
  return key === "X-Session-Token" ? value : null;
}

export function refreshSpaceConfig(client: Client): Promise<void> {
  if (pending) return pending;
  if (Date.now() - loadedAt < REFRESH_MS) return Promise.resolve();
  const token = sessionToken(client);
  if (!token) return Promise.resolve();
  pending = (async () => {
    try {
      const res = await fetch(`${SPACE_PREFIX}/config`, {
        headers: { Accept: "application/json", "X-Session-Token": token },
        signal: AbortSignal.timeout(5_000),
      });
      const body: unknown = res.ok ? await res.json() : null;
      const list =
        body &&
        typeof body === "object" &&
        Array.isArray((body as { servers?: unknown }).servers)
          ? ((body as { servers: unknown[] }).servers.filter(
              (s) => typeof s === "string",
            ) as string[])
          : [];
      setServers(new Set(list));
    } catch {
      setServers(new Set<string>());
    } finally {
      loadedAt = Date.now();
      pending = null;
    }
  })();
  return pending;
}

/** Which shell we run in, for the space server's logs and limits. */
export function clientKind(): "web" | "desktop" | "android" {
  if (window.MuchatNative) return "android";
  if (window.native) return "desktop";
  return "web";
}
