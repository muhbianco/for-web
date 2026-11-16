#!/usr/bin/env node
/* global console, process, fetch, setTimeout */
/**
 * Semente do laboratório completo: contas de teste, um servidor com salas e o bot
 * do Espaço, no Stoat LOCAL (compose.yml desta pasta). Idempotente: o que já existe
 * em state.local.json é reaproveitado.
 *
 *   node packages/space-server/lab/full/seed.mjs
 *
 * Grava em state.local.json (gitignored) as senhas geradas e os tokens. Nada é
 * impresso além de ids e nomes.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, "state.local.json");
const ip = readFileSync(join(HERE, ".wsl-ip"), "utf8").trim();
const API = `http://${ip}:14702`;

/** Bits do Stoat que o Espaço usa (space-core/src/perm/stoat.ts). */
const P = {
  ViewChannel: 2n ** 20n,
  ReadMessageHistory: 2n ** 21n,
  SendMessage: 2n ** 22n,
  ManageMessages: 2n ** 23n,
  InviteOthers: 2n ** 25n,
  SendEmbeds: 2n ** 26n,
  UploadFiles: 2n ** 27n,
  React: 2n ** 29n,
  Connect: 2n ** 30n,
  Speak: 2n ** 31n,
  Video: 2n ** 32n,
  MuteMembers: 2n ** 33n,
  Listen: 2n ** 36n,
  ChangeNickname: 2n ** 10n,
  ChangeAvatar: 2n ** 11n,
  ControlSpaceTv: 2n ** 45n,
  InteractSpaceObjects: 2n ** 46n,
};
const MEMBER =
  P.ViewChannel |
  P.ReadMessageHistory |
  P.SendMessage |
  P.InviteOthers |
  P.SendEmbeds |
  P.UploadFiles |
  P.React |
  P.Connect |
  P.Speak |
  P.Video |
  P.Listen |
  P.ChangeNickname |
  P.ChangeAvatar |
  P.ControlSpaceTv |
  P.InteractSpaceObjects;

const state = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, "utf8"))
  : { users: {} };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

async function call(method, path, body, token, bot) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers[bot ? "X-Bot-Token" : "X-Session-Token"] = token;
  // The API rate-limits per bucket and says how long to wait: wait and retry.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (res.status === 429 && attempt < 5) {
      const wait = Number(JSON.parse(text || "{}").retry_after ?? 2000);
      await new Promise((r) => setTimeout(r, Math.min(wait, 15_000) + 200));
      continue;
    }
    const data = text ? JSON.parse(text) : null;
    if (!res.ok)
      throw new Error(
        `${method} ${path} → ${res.status} ${text.slice(0, 200)}`,
      );
    return data;
  }
}

async function user(name, display) {
  let u = state.users[name];
  if (!u) {
    u = {
      email: `${name}@lab.test`,
      password: randomBytes(15).toString("base64url"),
    };
    await call("POST", "/auth/account/create", {
      email: u.email,
      password: u.password,
    });
    state.users[name] = u;
    save();
  }
  if (!u.token || !u.sessionId) {
    const s = await call("POST", "/auth/session/login", {
      email: u.email,
      password: u.password,
      friendly_name: "full-lab",
    });
    u.token = s.token;
    u.id = s.user_id;
    u.sessionId = s._id;
    save();
  }
  const hello = await call("GET", "/onboard/hello", undefined, u.token);
  if (hello.onboarding)
    await call("POST", "/onboard/complete", { username: name }, u.token);
  if (display) {
    await call("PATCH", "/users/@me", { display_name: display }, u.token).catch(
      () => undefined,
    );
  }
  console.log(`conta ${name}: ${u.id}`);
  return u;
}

const ana = await user("ana", "Ana");
const bia = await user("bia", "Bia");
const caio = await user("caio", "Caio");

if (!state.serverId) {
  const created = await call(
    "POST",
    "/servers/create",
    { name: "Espaço Lab" },
    ana.token,
  );
  state.serverId = created.server._id;
  save();
}
const sid = state.serverId;
console.log(`servidor: ${sid}`);

// Salas (canais de voz) e um canal de texto. Uma sala privada.
state.channels ??= {};
async function channel(key, name, type) {
  if (state.channels[key]) return state.channels[key];
  const c = await call(
    "POST",
    `/servers/${sid}/channels`,
    { type, name },
    ana.token,
  );
  state.channels[key] = c._id;
  save();
  return c._id;
}
await channel("sala", "Sala de estar", "Voice");
await channel("cinema", "Cinema", "Voice");
await channel("reuniao", "Reunião", "Voice");
const privada = await channel("diretoria", "Diretoria", "Voice");
console.log(`salas: ${Object.keys(state.channels).join(", ")}`);

// Cargo de moderação (MuteMembers, como na produção para encerrar tela de outro).
if (!state.modRole) {
  const r = await call(
    "POST",
    `/servers/${sid}/roles`,
    { name: "Moderação" },
    ana.token,
  );
  state.modRole = r.id;
  save();
}
await call(
  "PUT",
  `/servers/${sid}/permissions/${state.modRole}`,
  { permissions: { allow: Number(P.MuteMembers | P.ManageMessages), deny: 0 } },
  ana.token,
);

// Convite e entrada de Bia e Caio.
if (!state.invite) {
  const inv = await call(
    "POST",
    `/channels/${state.channels.sala}/invites`,
    undefined,
    ana.token,
  );
  state.invite = inv._id;
  save();
}
for (const u of [bia, caio]) {
  await call("POST", `/invites/${state.invite}`, undefined, u.token).catch(
    (e) => {
      if (!/AlreadyInServer|409/.test(String(e))) throw e;
    },
  );
}
await call(
  "PATCH",
  `/servers/${sid}/members/${bia.id}`,
  { roles: [state.modRole] },
  ana.token,
);

// Sala privada: @everyone não vê; o cargo de moderação vê.
await call(
  "PUT",
  `/channels/${privada}/permissions/default`,
  { permissions: { allow: 0, deny: Number(P.ViewChannel) } },
  ana.token,
);
await call(
  "PUT",
  `/channels/${privada}/permissions/${state.modRole}`,
  { permissions: { allow: Number(P.ViewChannel), deny: 0 } },
  ana.token,
);

// Bot do Espaço.
if (!state.bot) {
  const b = await call(
    "POST",
    "/bots/create",
    { name: "espacolab" },
    ana.token,
  );
  state.bot = { id: b._id ?? b.bot?._id, token: b.token ?? b.bot?.token };
  save();
}
await call(
  "POST",
  `/bots/${state.bot.id}/invite`,
  { server: sid },
  ana.token,
).catch((e) => {
  if (!/AlreadyInServer|409/.test(String(e))) throw e;
});
console.log(`bot: ${state.bot.id}`);

// Permissões padrão do servidor: as de membro + os bits 45/46 do Espaço (o que a
// migração da fase 4 liga na produção). A API oficial pode recusar bits que não
// conhece; nesse caso o setup grava direto no Mongo (README).
try {
  await call(
    "PUT",
    `/servers/${sid}/permissions/default`,
    { permissions: Number(MEMBER) },
    ana.token,
  );
  state.defaultPermsViaApi = true;
} catch (e) {
  state.defaultPermsViaApi = false;
  console.log(
    `permissões padrão pela API recusadas: ${String(e).slice(0, 120)}`,
  );
}
state.memberBits = String(MEMBER);
save();
console.log("semente ok");
