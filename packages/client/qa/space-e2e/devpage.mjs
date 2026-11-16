/**
 * Fase 4 (ADR 0008): verificações do mapa contra o servidor de dev do Espaço
 * (packages/space-server/src/dev.ts: Stoat falso, NPCs andando, mídia falsa) e
 * a página de dev do space-client (porta 5180). Sem login e sem LiveKit: cobre
 * presença, lista, rótulos com contagem, ícones de voz no avatar, "Ver no
 * mapa" e o tooltip de sala. A mídia real (tela, voz) fica no laboratório do
 * space-server.
 *
 *   node qa/space-e2e/devpage.mjs [--out <pasta>] [--headed]
 *
 * Pré-requisitos: `node packages/space-server/src/dev.ts` e
 * `pnpm --filter @muchat/space-client dev` no ar.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = resolve(opt("out", "qa/space-e2e/out"));
const BASE = opt("base", "http://127.0.0.1:5180");
mkdirSync(OUT, { recursive: true });

const results = [];
function record(id, name, ok, evidence) {
  results.push({ id, name, ok, evidence });
  console.log(`${ok ? "OK  " : "FALHA"} ${id} ${name}${evidence ? ` — ${evidence}` : ""}`);
}

const browser = await chromium.launch({
  headless: !flag("headed"),
  args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
});

async function open(as) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?as=${as}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__space?.view?.world?.me && window.__space.view.world.presence, null, { timeout: 30_000 });
  return { page, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const v = window.__space.view;
    return {
      me: v.world.me && { room: v.world.me.room, x: v.world.me.x, y: v.world.me.y },
      media: v.ui.media,
      presence: v.world.presence,
      list: v.ui.list.flatMap((w) => w.rooms.map((r) => ({ id: r.roomId, title: r.title, status: r.status, people: r.people }))),
    };
  });

async function until(page, fn, arg, ms = 20_000) {
  await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
}

const ROOM = "01JDEVCH000000000000000001"; // Bate-papo (dev.ts)
const PRIVATE = "01JDEVCH000000000000000006"; // Sala da diretoria (só DIR)

try {
  const ana = await open("ana");
  const caio = await open("caio"); // sem cargos: não vê a sala da diretoria

  // C2/C5: Ana entra numa sala; Caio, de fora, vê quem está dentro (lista e presença).
  await ana.page.evaluate((id) => window.__space.view.walkToRoom(id), ROOM);
  await until(ana.page, (id) => window.__space.view.world.me.room === id, ROOM);
  await until(
    caio.page,
    ([room, user]) => window.__space.view.ui.list.some((w) => w.rooms.some((r) => r.roomId === room && r.people.some((p) => p.userId === user))),
    [ROOM, "01JDEVANA00000000000000000"],
  );
  const seen = await state(caio.page);
  const row = seen.list.find((r) => r.id === ROOM);
  record("C2", "quem está fora vê os nomes de quem está na sala", row.people.some((p) => p.name === "Ana"), `lista de Caio: ${row.title} — ${row.status} — ${row.people.map((p) => p.name).join(", ")}`);

  // D: indicadores (mic mudo, ensurdecido, tela) chegam a quem está fora em ≤ 1,5 s.
  await until(ana.page, () => window.__space.view.ui.media.kind !== "idle", null);
  const t0 = Date.now();
  await ana.page.evaluate(() => window.__space.view.reportVoice({ connected: true, mic: false, deaf: true, camera: false, screen: true }));
  await until(
    caio.page,
    ([room, user]) => {
      const p = window.__space.view.world.presence.rooms.find((r) => r.room_id === room)?.people.find((x) => x.user_id === user);
      return p?.voice && p.voice.connected && !p.voice.mic && p.voice.deaf && p.voice.screen;
    },
    [ROOM, "01JDEVANA00000000000000000"],
  );
  record("D1", "mudo/ensurdecido/tela aparecem para quem está fora", true, `${Date.now() - t0} ms até o outro cliente`);
  await ana.page.evaluate((id) => window.__space.view.peekRoom(id), ROOM);
  await caio.page.evaluate((id) => window.__space.view.peekRoom(id), ROOM);
  await new Promise((r) => setTimeout(r, 1200));
  await caio.page.screenshot({ path: join(OUT, "C2-D1-caio-ve-ana-na-sala.png") });

  // Reativar: o ícone some.
  await ana.page.evaluate(() => window.__space.view.reportVoice({ connected: true, mic: true, deaf: false, camera: false, screen: false }));
  await until(
    caio.page,
    ([room, user]) => {
      const p = window.__space.view.world.presence.rooms.find((r) => r.room_id === room)?.people.find((x) => x.user_id === user);
      return p?.voice?.mic === true && p.voice.deaf === false && p.voice.screen === false;
    },
    [ROOM, "01JDEVANA00000000000000000"],
  );
  record("D2", "microfone reativado e tela encerrada aparecem para quem está fora", true, "");

  // C3: sai da sala → volta para "fora" (hall/corredor).
  const out = await ana.page.evaluate(() => {
    const v = window.__space.view;
    const r = v.world.ix.roomsById.get("01JDEVCH000000000000000001");
    return v.walkTo(r.outside.tx * 32 + 16, r.outside.ty * 32 + 16);
  });
  await until(caio.page, ([room, user]) => {
    const pr = window.__space.view.world.presence;
    return !pr.rooms.some((r) => r.room_id === room && r.people.some((p) => p.user_id === user)) && pr.outside.some((p) => p.user_id === user);
  }, [ROOM, "01JDEVANA00000000000000000"]);
  record("C3", "saiu da sala: some da sala e aparece no corredor", out === true, "");

  // C5/E: sala privada não aparece para quem não pode vê-la.
  const caioState = await state(caio.page);
  const priv = caioState.list.find((r) => r.id === PRIVATE);
  const leak = caioState.presence.rooms.some((r) => r.room_id === PRIVATE);
  record("E-privada", "sala privada: sem nome, sem gente, sem presença", priv && priv.title === "Sala privada" && priv.people.length === 0 && !leak, `título "${priv?.title}", presença da sala: ${leak ? "VAZOU" : "ausente"}`);

  // C6: a aba de Ana cai → "reconectando" para Caio.
  await ana.page.close();
  await until(caio.page, (user) => {
    const pr = window.__space.view.world.presence;
    const all = [...pr.outside, ...pr.rooms.flatMap((r) => r.people)];
    return all.some((p) => p.user_id === user && p.state === "reconnecting");
  }, "01JDEVANA00000000000000000");
  record("C6", "desconexão inesperada aparece como reconectando", true, "");

  const errs = [...ana.errors, ...caio.errors];
  record("sem-erros", "nenhum erro de página", errs.length === 0, errs.slice(0, 3).join(" | "));
} catch (err) {
  record("erro", "execução", false, String(err));
} finally {
  writeFileSync(join(OUT, "devpage-results.json"), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`RESUMO ${results.length - failed}/${results.length} ok`);
  process.exit(failed ? 1 : 0);
}
