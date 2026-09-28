import { createSignal } from "solid-js";

import type { Client } from "stoat.js";

/**
 * Whether this account is a supporter, and therefore what quality it may
 * publish.
 *
 * Read from the VIP sidecar, which resolves it against the api.muhbianco
 * MariaDB — the only source of truth. Nothing is stored here beyond the last
 * answer.
 *
 * This gate is honest, not secure: someone who opens the devtools can flip the
 * signal and publish 1080p. That is a deliberate trade for a private instance
 * of friends — enforcing it would mean minting per-tier LiveKit tokens in the
 * Rust backend, an hour of build per change. If it ever gets abused, the
 * server-side version is a known, separate piece of work.
 */

export const VIP_PREFIX = "/_muchat/vip/v1";

export interface Entitlements {
  tier: "free" | "vip";
  /** ISO timestamp the VIP expires at, when there is one. */
  vipUntil?: string;
}

export const FREE: Entitlements = { tier: "free" };

const [entitlements, setEntitlements] = createSignal<Entitlements>(FREE);

/** Current tier. Free until proven otherwise. */
export const useEntitlements = entitlements;

export function isVip(): boolean {
  return entitlements().tier === "vip";
}

/**
 * Asks the sidecar who this is.
 *
 * Any failure resolves to free. Denying by mistake costs a greyed-out option
 * for a moment; granting by mistake hands out what was not paid for — and the
 * person who did pay gets their tier back on the next call, without noticing.
 */
export async function refreshEntitlements(
  client: Client,
): Promise<Entitlements> {
  let next: Entitlements = FREE;
  try {
    const [key, value] = client.authenticationHeader;
    const response = await fetch(`${VIP_PREFIX}/me`, {
      headers: { Accept: "application/json", [key]: value },
    });
    if (response.ok) {
      const body: unknown = await response.json();
      next = parseEntitlements(body);
    }
  } catch (error) {
    // Offline, sidecar down, CORS: all of them mean "no proof of VIP".
    console.warn("[voice] entitlements", error);
  }
  setEntitlements(next);
  return next;
}

/** Only a literal `true` is VIP; `"sim"` must not pass as truthy. */
export function parseEntitlements(body: unknown): Entitlements {
  if (!body || typeof body !== "object") return FREE;
  const data = body as { active?: unknown; vip_until?: unknown };
  if (data.active !== true) return FREE;
  return {
    tier: "vip",
    vipUntil: typeof data.vip_until === "string" ? data.vip_until : undefined,
  };
}

/** Back to free, e.g. on logout, so a tier never outlives its session. */
export function clearEntitlements(): void {
  setEntitlements(FREE);
}

export async function openSupportCheckout(
  client: Client,
  options: {
    amountCents: number;
    frequency: "once" | "monthly";
    payerEmail?: string;
    displayName?: string;
  },
): Promise<string | undefined> {
  const [key, value] = client.authenticationHeader;
  const response = await fetch(`${VIP_PREFIX}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [key]: value },
    body: JSON.stringify({
      amount_cents: options.amountCents,
      frequency: options.frequency,
      payer_email: options.payerEmail,
      display_name: options.displayName,
    }),
  });
  if (!response.ok) return undefined;
  const body: unknown = await response.json();
  const url = (body as { checkout_url?: unknown })?.checkout_url;
  return typeof url === "string" ? url : undefined;
}
