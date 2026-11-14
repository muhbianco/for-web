/**
 * Port of Stoat's authoritative server-channel permission calculation
 * (stoatchat/stoatchat@v0.15.5 crates/core/permissions/src/impl.rs:113-150 and
 * crates/core/database/src/util/permissions.rs:154-202). The web client's
 * stoat.js copy applies the channel default AFTER server roles; the backend
 * applies it BEFORE them, and zeroes everything without ViewChannel. The space
 * server decides entry with this, so it follows the backend (ADR 0004).
 */

/** Channel permission bits used by the space (definitions in stoat.js/backend). */
export const Perm = {
  ManageChannel: 1n << 0n,
  ManageServer: 1n << 1n,
  ViewChannel: 1n << 20n,
  ReadMessageHistory: 1n << 21n,
  SendMessage: 1n << 22n,
  Connect: 1n << 30n,
  Speak: 1n << 31n,
  Video: 1n << 32n,
  MuteMembers: 1n << 33n,
  DeafenMembers: 1n << 34n,
  MoveMembers: 1n << 35n,
  Listen: 1n << 36n,
  GrantAllSafe: 0x000f_ffff_ffff_ffffn,
} as const;

export const ALLOW_IN_TIMEOUT = Perm.ViewChannel | Perm.ReadMessageHistory;

/** Wire shape of an allow/deny pair (`{a, d}` in the Stoat API). */
export interface OverrideField {
  a: number;
  d: number;
}

export interface PermServer {
  ownerId: string;
  /** `default_permissions` (u64 as a JSON number). */
  defaultPermissions: number;
  roles: ReadonlyMap<string, { rank: number; permissions: OverrideField }>;
}

export interface PermChannel {
  defaultPermissions?: OverrideField | null;
  rolePermissions?: Readonly<Record<string, OverrideField>> | null;
}

export interface PermMember {
  roles: readonly string[];
  /** Unix ms; timed out while in the future. */
  timeoutUntil?: number | null;
  canPublish?: boolean;
  canReceive?: boolean;
}

export interface PermUser {
  id: string;
  privileged?: boolean;
}

const big = (n: number | undefined | null): bigint => {
  if (n == null || !Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.trunc(n));
};

function apply(perm: bigint, o: OverrideField | null | undefined): bigint {
  if (!o) return perm;
  return (perm | big(o.a)) & ~big(o.d);
}

/** Roles sorted like the backend: rank descending, so rank 0 applies last and wins. */
function orderedRoleIds(server: PermServer, member: PermMember): string[] {
  return member.roles
    .filter((id) => server.roles.has(id))
    .sort((a, b) => (server.roles.get(b)?.rank ?? 0) - (server.roles.get(a)?.rank ?? 0));
}

/**
 * Permissions of `user` on a server TextChannel. `member` null = not a member.
 */
export function channelPermissions(input: {
  user: PermUser;
  server: PermServer;
  channel: PermChannel;
  member: PermMember | null;
  nowMs: number;
}): bigint {
  const { user, server, channel, member, nowMs } = input;
  if (user.privileged) return Perm.GrantAllSafe;
  if (server.ownerId === user.id) return Perm.GrantAllSafe;
  if (!member) return 0n;

  let perm = big(server.defaultPermissions);
  perm = apply(perm, channel.defaultPermissions);
  const roles = orderedRoleIds(server, member);
  for (const id of roles) perm = apply(perm, server.roles.get(id)?.permissions);
  for (const id of roles) perm = apply(perm, channel.rolePermissions?.[id]);

  if (member.canPublish === false) perm &= ~(Perm.Speak | Perm.Video);
  if (member.canReceive === false) perm &= ~Perm.Listen;
  if (member.timeoutUntil != null && member.timeoutUntil > nowMs) perm &= ALLOW_IN_TIMEOUT;
  if ((perm & Perm.ViewChannel) !== Perm.ViewChannel) return 0n;
  return perm;
}

/**
 * Permissions of `user` on the server itself (no channel): the backend's
 * calculate_server_permissions (crates/core/permissions/src/impl.rs). Used
 * for ManageServer, which decides who may change the space's decoration
 * settings (ADR 0007).
 */
export function serverPermissions(input: {
  user: PermUser;
  server: PermServer;
  member: PermMember | null;
  nowMs: number;
}): bigint {
  const { user, server, member, nowMs } = input;
  if (user.privileged) return Perm.GrantAllSafe;
  if (server.ownerId === user.id) return Perm.GrantAllSafe;
  if (!member) return 0n;
  let perm = big(server.defaultPermissions);
  for (const id of orderedRoleIds(server, member)) perm = apply(perm, server.roles.get(id)?.permissions);
  if (member.timeoutUntil != null && member.timeoutUntil > nowMs) perm &= ALLOW_IN_TIMEOUT;
  return perm;
}

export const has = (perm: bigint, bit: bigint): boolean => (perm & bit) === bit;
