#!/usr/bin/env node
/* global process */
/**
 * O app (vite dev) apontado para o laboratório completo, em http://localhost:5173.
 * O código é o deste worktree; o vite encaminha /api, /ws, /livekit e
 * /_muchat/space (qa/full-lab/vite.config.ts).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..", "..", "..", "client");
// --lab-dir <path> (or FULL_LAB_DIR): the lab folder with .wsl-ip and
// state.local.json, when it was set up in another worktree.
const at = process.argv.indexOf("--lab-dir");
if (at >= 0) process.env.FULL_LAB_DIR = process.argv[at + 1];
// Who the app opens as (FULL_LAB_USER=ana|bia|caio): the dev build signs in
// with the session the seed created (VITE_TOKEN), no password typed anywhere.
// One person per origin: for several people at once use qa/full-lab/pilot.mjs.
// Without FULL_LAB_USER the app asks for login (the pilot logs each person in).
const who = process.env.FULL_LAB_USER;
const u = who
  ? JSON.parse(
      readFileSync(
        join(process.env.FULL_LAB_DIR ?? HERE, "state.local.json"),
        "utf8",
      ),
    ).users[who]
  : null;

// FULL_LAB_MODE=preview serves the production build (dist/, made with
// `vite build` and these same VITE_* values) instead of the dev server.
// FULL_LAB_CLIENT_PORT (default 5173): another port, for a second lab beside the first.
const CLIENT_PORT = process.env.FULL_LAB_CLIENT_PORT ?? "5173";
const preview =
  process.env.FULL_LAB_MODE === "preview" || process.argv.includes("--preview");
const child = spawn(
  process.execPath,
  [
    join(CLIENT, "node_modules", "vite", "bin", "vite.js"),
    ...(preview ? ["preview"] : []),
    "--config",
    "qa/full-lab/vite.config.ts",
  ],
  {
    cwd: CLIENT,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_API_URL: `http://localhost:${CLIENT_PORT}/api`,
      VITE_DEV_HOST: `localhost:${CLIENT_PORT}`,
      VITE_API_URL: `http://localhost:${CLIENT_PORT}/api`,
      VITE_HOST: `localhost:${CLIENT_PORT}`,
      // The mobile audit (qa/full-lab/mobile-audit.mjs) drives the view through
      // window.__spaceView; production builds never set it.
      VITE_SPACE_TEST_HOOKS: "1",
      ...(u
        ? {
            VITE_TOKEN: u.token,
            VITE_USER_ID: u.id,
            VITE_SESSION_ID: u.sessionId,
          }
        : {}),
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
