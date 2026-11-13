/**
 * Muchat space server (Phase 2: map, presence and movement; media in Phase 3).
 * Runs in stoat-net behind Caddy `/_muchat/space*`. Configuration by env only.
 */
import { MongoClient } from "mongodb";

import { jsonLog as log } from "./log.ts";
import { Registry } from "./space/registry.ts";
import { MongoProfileStore } from "./space/profiles.ts";
import { MongoAssignmentStore } from "./space/store.ts";
import { MemberCache, StoatApi } from "./stoat/api.ts";
import { BonfireClient } from "./stoat/bonfire.ts";
import { StoatCache } from "./stoat/cache.ts";
import { Gateway } from "./ws/gateway.ts";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env ${name}`);
  return v;
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
  const registry = new Registry({ cache, store: new MongoAssignmentStore(mongo), members, log, enabled });
  const bonfire = new BonfireClient(env("STOAT_WS_URL", "ws://events:14703"), botToken, cache, log);
  const gateway = new Gateway({
    auth: api,
    members,
    cache,
    runtimes: registry,
    profiles: new MongoProfileStore(mongo),
    allowedOrigins: env("SPACE_ALLOWED_ORIGINS", "https://chat.muhbianco.com.br").split(",").map((s) => s.trim()),
    log,
    ready: () => ({ bonfire: bonfire.connected }),
  });
  bonfire.start();
  const port = Number(env("SPACE_PORT", "8095"));
  await gateway.listen(port);
  log.info("space server listening", { port, enabled_servers: enabledIds.length });

  const shutdown = async (signal: string) => {
    log.info("shutting down", { signal });
    bonfire.stop();
    await gateway.close().catch(() => undefined);
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
