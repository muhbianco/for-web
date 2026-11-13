import { z } from "zod";

/**
 * Lease written by the spatial server for every authorized room entry and read
 * by the livekit-gate before letting a signal connection reach a managed room.
 * The gate reads `user_id`, `room_name` and `exp`; keep those names stable.
 */
export const LeaseV1 = z.object({
  v: z.literal(1),
  user_id: z.string().min(1),
  identity: z.string().min(1),
  room_name: z.string().min(1),
  room_id: z.string().min(1),
  server_id: z.string().min(1),
  grant_seq: z.number().int().nonnegative(),
  /** Unix seconds. */
  exp: z.number().int().positive(),
});
export type LeaseV1 = z.infer<typeof LeaseV1>;

export const LEASE_KEY_PREFIX = "muchat:space:lease:";
export const USER_LEASE_KEY_PREFIX = "muchat:space:user-lease:";
export const SPATIAL_ENABLED_KEY_PREFIX = "muchat:space:enabled:";

/** Lease lifetime in Redis; renewed while the person stays in the room. */
export const LEASE_TTL_SECONDS = 120;
export const LEASE_RENEW_SECONDS = 30;

export const leaseKey = (identity: string): string => LEASE_KEY_PREFIX + identity;
export const userLeaseKey = (userId: string): string =>
  USER_LEASE_KEY_PREFIX + userId;
export const spatialEnabledKey = (serverId: string): string =>
  SPATIAL_ENABLED_KEY_PREFIX + serverId;
