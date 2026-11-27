/**
 * App em dev contra o laboratório completo (packages/space-server/lab/full):
 * Stoat oficial, LiveKit e o servidor do Espaço locais, tudo na mesma origem
 * (http://localhost:5173), como a produção serve. Rode com
 * `node packages/space-server/lab/full/run-client.mjs`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { mergeConfig } from "vite";

import base from "../../vite.config";

const ip = readFileSync(
  resolve(
    process.env.FULL_LAB_DIR ??
      resolve(__dirname, "../../../space-server/lab/full"),
    ".wsl-ip",
  ),
  "utf8",
).trim();
const spacePort = process.env.FULL_LAB_SPACE_PORT ?? "8097";
// FULL_LAB_CLIENT_PORT: two sessions can run their labs side by side (27/11/2026).
const clientPort = Number(process.env.FULL_LAB_CLIENT_PORT ?? 5173);

// The prefix goes, the rest (query included) stays, always with a leading slash.
const strip = (prefix: string) => (path: string) => {
  const rest = path.replace(new RegExp(`^${prefix}`), "");
  return rest.startsWith("/") ? rest : `/${rest}`;
};

const proxy = {
  "/api": {
    target: `http://${ip}:14702`,
    changeOrigin: true,
    rewrite: strip("/api"),
  },
  // The events socket is /ws?version=1&format=json: match the query too.
  "^/ws(\\?|$)": {
    target: `ws://${ip}:14703`,
    ws: true,
    rewrite: strip("/ws"),
  },
  "/livekit": {
    target: `http://${ip}:17880`,
    ws: true,
    rewrite: strip("/livekit"),
  },
  "/_muchat/space": {
    target: `http://127.0.0.1:${spacePort}`,
    ws: true,
    rewrite: strip("/_muchat/space"),
  },
};

export default mergeConfig(base, {
  // `vite preview` (the production build, FULL_LAB_MODE=preview) uses the same routes.
  preview: { host: "127.0.0.1", port: clientPort, strictPort: true, proxy },
  server: {
    host: "127.0.0.1",
    port: clientPort,
    strictPort: true,
    proxy,
  },
});
