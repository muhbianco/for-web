#!/usr/bin/env node
/* global process */
/**
 * O servidor do Espaço (código deste worktree) contra o laboratório completo:
 * Stoat, Mongo, Redis e LiveKit locais no WSL. Lê o token do bot de
 * state.local.json e as chaves do LiveKit de .keys (os dois gerados aqui, só do
 * laboratório). Porta 8097 (o servidor de dev usa a 8095).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ip = readFileSync(join(HERE, ".wsl-ip"), "utf8").trim();
const state = JSON.parse(readFileSync(join(HERE, "state.local.json"), "utf8"));
const keys = Object.fromEntries(
  readFileSync(join(HERE, ".keys"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("=", 2)),
);
const port = process.env.FULL_LAB_SPACE_PORT ?? "8097";

const child = spawn(
  process.execPath,
  [join(HERE, "..", "..", "src", "main.ts")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      SPACE_BOT_TOKEN: state.bot.token,
      STOAT_API_URL: `http://${ip}:14702`,
      STOAT_WS_URL: `ws://${ip}:14703`,
      MONGO_URL: `mongodb://${ip}:27018`,
      REDIS_URL: `redis://${ip}:16379`,
      LIVEKIT_URL: `http://${ip}:17880`,
      LIVEKIT_PUBLIC_URL: "ws://localhost:5173/livekit",
      LIVEKIT_SPACE_KEY: keys.LAB_LIVEKIT_KEY,
      LIVEKIT_SPACE_SECRET: keys.LAB_LIVEKIT_SECRET,
      SPACE_ENABLED_SERVERS: "*",
      SPACE_ALLOWED_ORIGINS: "http://localhost:5173",
      SPACE_PORT: port,
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
