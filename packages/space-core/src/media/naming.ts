/**
 * Names shared by the spatial server, the livekit-gate (Go, muchat/livekit-gate)
 * and the client. See muchat/docs/espaco/adr/0001 and 0003.
 *
 * - LiveKit room of a virtual room: `msp_<roomId>_<epoch>`. Stoat's own rooms
 *   are named by channel id (a ULID) and never start with `msp_`, which is how
 *   the gate tells managed rooms apart without any lookup.
 * - LiveKit identity of one authorized entry: `sp_<stoatUserId>_<grantSeq>`.
 *   A new identity per entry means a token kept from an earlier entry never
 *   matches the current lease, even while the person is back in the same room.
 */

export const MANAGED_ROOM_PREFIX = "msp_";
export const IDENTITY_PREFIX = "sp_";

/** Stoat ids are ULIDs: 26 chars of Crockford base32, upper case. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID.test(value);
}

function assertUlid(kind: string, value: string): void {
  if (!isUlid(value)) {
    throw new RangeError(`${kind} must be a ULID`);
  }
}

function assertSeq(kind: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${kind} must be a non-negative safe integer`);
  }
}

export function managedRoomName(roomId: string, epoch: number): string {
  assertUlid("roomId", roomId);
  assertSeq("epoch", epoch);
  return `${MANAGED_ROOM_PREFIX}${roomId}_${epoch}`;
}

export function parseManagedRoomName(
  name: string,
): { roomId: string; epoch: number } | null {
  if (!name.startsWith(MANAGED_ROOM_PREFIX)) return null;
  const rest = name.slice(MANAGED_ROOM_PREFIX.length);
  const sep = rest.lastIndexOf("_");
  if (sep <= 0) return null;
  const roomId = rest.slice(0, sep);
  const epochText = rest.slice(sep + 1);
  if (!isUlid(roomId) || !/^(0|[1-9][0-9]{0,15})$/.test(epochText)) return null;
  const epoch = Number(epochText);
  if (!Number.isSafeInteger(epoch)) return null;
  return { roomId, epoch };
}

export function isManagedRoomName(name: string): boolean {
  return name.startsWith(MANAGED_ROOM_PREFIX);
}

export function mediaIdentity(userId: string, grantSeq: number): string {
  assertUlid("userId", userId);
  assertSeq("grantSeq", grantSeq);
  return `${IDENTITY_PREFIX}${userId}_${grantSeq}`;
}

export function parseMediaIdentity(
  identity: string,
): { userId: string; grantSeq: number } | null {
  if (!identity.startsWith(IDENTITY_PREFIX)) return null;
  const rest = identity.slice(IDENTITY_PREFIX.length);
  const sep = rest.lastIndexOf("_");
  if (sep <= 0) return null;
  const userId = rest.slice(0, sep);
  const seqText = rest.slice(sep + 1);
  if (!isUlid(userId) || !/^(0|[1-9][0-9]{0,15})$/.test(seqText)) return null;
  const grantSeq = Number(seqText);
  if (!Number.isSafeInteger(grantSeq)) return null;
  return { userId, grantSeq };
}

/** Every identity a user could have held, for orphan cleanup in a room. */
export function identityBelongsTo(identity: string, userId: string): boolean {
  // LiveKit's v0 `publish` param yields "sub#x"; strip it before matching.
  const base = identity.split("#", 1)[0] ?? "";
  return parseMediaIdentity(base)?.userId === userId;
}
