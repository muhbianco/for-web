/* global Buffer, process, console */
// Token de acesso do LiveKit (JWT HS256) sem dependência externa.
// Mesmo formato do livekit-server-sdk: iss = chave, sub = identity, claim `video`.
// Usado no laboratório local e, na hel1, dentro de `node:22-alpine` lendo a chave
// do livekit.yml (ver hel1/mint-tokens.sh). Nunca imprime a chave.
import { createHmac } from "node:crypto";

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * @param {object} o
 * @param {string} o.apiKey
 * @param {string} o.apiSecret
 * @param {string} o.identity
 * @param {string} o.room
 * @param {string} [o.name]
 * @param {number} [o.ttlSeconds=3600]
 * @param {boolean} [o.canPublish=true]
 * @param {boolean} [o.canSubscribe=true]
 */
export function mintToken(o) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: o.apiKey,
    sub: o.identity,
    jti: o.identity,
    name: o.name ?? o.identity,
    nbf: now - 10,
    exp: now + (o.ttlSeconds ?? 3600),
    video: {
      room: o.room,
      roomJoin: true,
      canPublish: o.canPublish ?? true,
      canSubscribe: o.canSubscribe ?? true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    },
  };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", o.apiSecret)
    .update(`${head}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${head}.${body}.${sig}`;
}

// CLI: node token.mjs <room> <identity> [ttlSeconds] — chave/segredo vêm do ambiente
// (LIVEKIT_API_KEY / LIVEKIT_API_SECRET) e o token sai no stdout.
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("token.mjs")) {
  const [room, identity, ttl] = process.argv.slice(2);
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!room || !identity || !apiKey || !apiSecret) {
    console.error("uso: LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… node token.mjs <room> <identity> [ttl]");
    process.exit(2);
  }
  process.stdout.write(
    mintToken({ apiKey, apiSecret, room, identity, ttlSeconds: ttl ? Number(ttl) : 3600 }),
  );
}
