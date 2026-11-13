/**
 * Muchat space server: map, presence and movement (Phase 2) and room media
 * (Phase 3, when the space's LiveKit key is configured). Runs in stoat-net
 * behind Caddy `/_muchat/space*`. Configuration by env only.
 */
import { Redis } from "ioredis";
import { MongoClient } from "mongodb";

import { jsonLog as log } from "./log.ts";
import { LiveKitRoomAdmin, LiveKitTokenMinter, RedisLeaseStore } from "./media/adapters.ts";
import { MediaController } from "./media/controller.ts";
import { Sweeper } from "./media/sweeper.ts";
import { MediaHub } from "./space/roomMedia.ts";
import { Registry } from "./space/registry.ts";
import { MongoProfileStore } from "./space/profiles.ts";
import { MongoAssignmentStore } from "./space/store.ts";
import { MemberCache, StoatApi } from "./stoat/api.ts";
import { BonfireClient } from "./stoat/bonfire.ts";
import { StoatCache } from "./stoat/cache.ts";
import { loadStructure, routeBonfireEvent, StructureSync } from "./stoat/structure.ts";
import { Gateway } from "./ws/gateway.ts";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env ${name}`);
  return v;
}

/**
 * Room media: the space's own LiveKit key (never Stoat's), the lease store the
 * livekit-gate reads, and the sweeper. Without the key the space runs as
 * presence only, as in Phase 2.
 */
function startMedia() {
  const key = process.env.LIVEKIT_SPACE_KEY;
  const secret = process.env.LIVEKIT_SPACE_SECRET;
  if (!key || !secret) {
    log.warn("room media off: LIVEKIT_SPACE_KEY / LIVEKIT_SPACE_SECRET not set");
    return null;
  }
  const redis = new Redis(env("REDIS_URL", "redis://redis:6379"), {
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 1,
  });
  let lastRedisError = 0;
  redis.on("error", (err) => {
    // ioredis repeats this on every reconnect attempt: one line per 30 s is enough.
    if (Date.now() - lastRedisError > 30_000) log.warn("redis error", { err: String(err) });
    lastRedisError = Date.now();
  });
  const lk = new LiveKitRoomAdmin(env("LIVEKIT_URL", "http://livekit:7880"), key, secret, 3);
  const leases = new RedisLeaseStore(redis);
  const controller = new MediaController({
    lk,
    leases,
    minter: new LiveKitTokenMinter(key, secret),
    publicUrl: env("LIVEKIT_PUBLIC_URL", "wss://chat.muhbianco.com.br/livekit"),
    events: {
      onRemoveRetryExhausted: (room, identity) => log.info("media removal retries done", { room, identity }),
    },
  });
  const hub = new MediaHub({ media: controller, log });
  const sweeper = new Sweeper({
    lk,
    leases,
    isCurrentRoom: (name) => hub.isCurrentRoom(name),
    onRemoved: (room, identity, reason) => log.info("media swept", { room, identity, reason }),
  });
  hub.startRenewals();
  sweeper.start();
  return {
    hub,
    lk,
    ready: () => redis.status === "ready",
    async stop() {
      // Grants are NOT revoked on shutdown: leases outlive a redeploy (120 s)
      // and the next process adopts them, so calls do not drop.
      sweeper.stop();
      hub.stop();
      controller.stop();
      await redis.quit().catch(() => undefined);
    },
  };
}

async function main() {
  const botToken = env("SPACE_BOT_TOKEN");
  const mongo = new MongoClient(env("MONGO_URL", "mongodb://database:27017"), {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    maxPoolSize: 5,
  });
  await mongo.connect();
  const cache = new StoatCache();
  const api = new StoatApi(env("STOAT_API_URL", "http://api:14702"), botToken);
  const members = new MemberCache(api);
  // Only servers switched on for the space (ADR 0006): comma-separated ids,
  // or "*" in the lab. Phase 2 has no Redis key yet.
  const enabledIds = env("SPACE_ENABLED_SERVERS", "").split(",").map((s) => s.trim()).filter(Boolean);
  const enabled = enabledIds.includes("*") ? () => true : (id: string) => enabledIds.includes(id);
  const media = startMedia();
  const registry = new Registry({
    cache,
    store: new MongoAssignmentStore(mongo),
    members,
    log,
    enabled,
    media: media ? { hub: media.hub, lk: media.lk } : undefined,
  });
  // Structure (servers, channels, roles) from Stoat's database, read-only:
  // the bot's own view hides private rooms. Bonfire tells when to refresh and
  // brings member changes.
  const structure = new StructureSync({
    load: () => loadStructure(mongo.db(env("STOAT_DB", "revolt"))),
    cache,
    log,
  });
  await structure.start();
  const bonfire = new BonfireClient(env("STOAT_WS_URL", "ws://events:14703"), botToken, cache, log, (event) =>
    routeBonfireEvent(event, cache, structure),
  );
  const gateway = new Gateway({
    auth: api,
    members,
    cache,
    runtimes: registry,
    profiles: new MongoProfileStore(mongo),
    allowedOrigins: env("SPACE_ALLOWED_ORIGINS", "https://chat.muhbianco.com.br").split(",").map((s) => s.trim()),
    log,
    ready: (): Record<string, boolean> =>
      media ? { bonfire: bonfire.connected, redis: media.ready() } : { bonfire: bonfire.connected },
  });
  bonfire.start();
  const port = Number(env("SPACE_PORT", "8095"));
  await gateway.listen(port);
  log.info("space server listening", { port, enabled_servers: enabledIds.length, media: Boolean(media) });

  const shutdown = async (signal: string) => {
    log.info("shutting down", { signal });
    bonfire.stop();
    structure.stop();
    await gateway.close().catch(() => undefined);
    await media?.stop();
    await mongo.close().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("fatal", { err: String(err) });
  process.exit(1);
});
