/**
 * Cenário A da fase 4 (ADR 0008): Smart TV com YouTube REAL, três clientes.
 * Servidor de dev do Espaço (packages/space-server/src/dev.ts: Ana é dona,
 * Bia é diretoria, Caio não tem cargo; no Café ninguém sem cargo controla a TV)
 * e a página de dev do space-client, que usa o mesmo TvSync + YouTubePlayer
 * do app. Volume local zerado. Prova por getCurrentTime() de cada player.
 *
 *   node qa/space-e2e/tv.mjs [--out <pasta>] [--headed]
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

const VID = "M7lc1UVf-VE"; // IFrame API demo video (embeddable)
const VID2 = "aqz-KE-bpKQ"; // Big Buck Bunny (embeddable)
const MISSING = "aaaaaaaaaaa"; // well-formed id of no video
// Candidates for "owner disabled embedding" (not guaranteed: recorded as found).
const NOT_EMBEDDABLE = ["dQw4w9WgXcQ", "9bZkp7q19f0"]; // label music videos: error 150 seen on 16/11/2026
const BATE_PAPO = "01JDEVCH000000000000000001";
const CAFE = "01JDEVCH000000000000000002";

const results = [];
function record(id, name, ok, evidence) {
  results.push({ id, name, ok, evidence });
  console.log(`${ok ? "OK  " : "FALHA"} ${id} ${name}${evidence ? ` — ${evidence}` : ""}`);
}

const browser = await chromium.launch({
  headless: !flag("headed"),
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});

async function open(as) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?as=${as}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__space?.view?.world?.me && window.__space.view.world.presence, null, { timeout: 30_000 });
  return { page, errors, as };
}

const until = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 200 });

async function walkIn(c, room) {
  await c.page.evaluate((id) => window.__space.view.walkToRoom(id), room);
  await until(c.page, (id) => window.__space.view.world.me.room === id, room);
  await until(c.page, () => window.__space.view.ui.tv?.hasTv === true);
}

async function walkOut(c, room) {
  await c.page.evaluate((id) => {
    const v = window.__space.view;
    const r = v.world.ix.roomsById.get(id);
    v.walkTo(r.outside.tx * 32 + 16, r.outside.ty * 32 + 16);
  }, room);
  await until(c.page, () => window.__space.view.world.me.room === null);
}

const tvTime = (c) => c.page.evaluate(() => window.__tv.player()?.time() ?? -1);
const tvPlayerState = (c) => c.page.evaluate(() => window.__tv.player()?.state() ?? "none");
const tvState = (c) => c.page.evaluate(() => window.__space.view.ui.tv?.state ?? null);
const playing = (c) => until(c.page, () => window.__tv.player()?.state() === "playing", null, 45_000);

async function spread(clients) {
  const times = await Promise.all(clients.map(tvTime));
  return { times: times.map((t) => t.toFixed(2)), spread: Math.max(...times) - Math.min(...times) };
}

try {
  const ana = await open("ana");
  const bia = await open("bia");
  const caio = await open("caio");

  // A1–A3: Ana abre a TV da sala e coloca um vídeo; Bia, na mesma sala, vê o mesmo.
  await walkIn(ana, BATE_PAPO);
  await walkIn(bia, BATE_PAPO);
  await until(ana.page, () => !!window.__tv.player());
  await ana.page.evaluate((v) => window.__space.view.tvLoad(v), VID);
  await Promise.all([playing(ana), playing(bia)]);
  await new Promise((r) => setTimeout(r, 6_000));
  let s = await spread([ana, bia]);
  record("A3", "a reprodução começa para todos da sala, sincronizada", s.spread < 1.0, `tempos ${s.times.join(" / ")} s, diferença ${s.spread.toFixed(2)} s`);
  await ana.page.screenshot({ path: join(OUT, "A3-ana-tv.png") });

  // A4: Bia pausa → pausa para todos.
  await bia.page.evaluate(() => window.__space.view.tvPause(window.__tv.player().time()));
  await Promise.all([ana, bia].map((c) => until(c.page, () => window.__tv.player()?.state() === "paused", null, 10_000)));
  s = await spread([ana, bia]);
  record("A4", "pausar pausa para todos (mesma posição)", s.spread < 0.8, `tempos ${s.times.join(" / ")} s`);

  // A5: Ana retoma.
  await ana.page.evaluate(() => window.__space.view.tvPlay(window.__tv.sync().position()));
  await Promise.all([playing(ana), playing(bia)]);
  await new Promise((r) => setTimeout(r, 3_000));
  s = await spread([ana, bia]);
  record("A5", "retomar retoma para todos", s.spread < 1.0, `tempos ${s.times.join(" / ")} s`);

  // A6/A7: avançar e retroceder (Bia +30 s, depois −10 s).
  const before = (await tvTime(ana));
  await bia.page.evaluate(() => window.__space.view.tvSeek(window.__tv.sync().position() + 30));
  await new Promise((r) => setTimeout(r, 4_000));
  const afterFwd = await Promise.all([ana, bia].map(tvTime));
  record("A6", "avançar 30 s vale para todos", afterFwd.every((t) => t > before + 25), `antes ${before.toFixed(1)} s, depois ${afterFwd.map((t) => t.toFixed(1)).join(" / ")} s`);
  await ana.page.evaluate(() => window.__space.view.tvSeek(Math.max(0, window.__tv.sync().position() - 10)));
  await new Promise((r) => setTimeout(r, 4_000));
  s = await spread([ana, bia]);
  record("A7", "retroceder 10 s vale para todos", s.spread < 1.0, `tempos ${s.times.join(" / ")} s`);

  // A8: volume é individual (nada vai para o servidor).
  const revBefore = (await tvState(ana)).rev;
  await ana.page.evaluate(() => window.__tv.player().setVolume(80));
  await new Promise((r) => setTimeout(r, 1_000));
  const revAfter = (await tvState(bia)).rev;
  record("A8", "volume individual não muda o estado da sala", revBefore === revAfter, `rev ${revBefore} → ${revAfter}`);

  // A9: Caio entra no meio do vídeo.
  await walkIn(caio, BATE_PAPO);
  await playing(caio);
  await new Promise((r) => setTimeout(r, 6_000));
  s = await spread([ana, bia, caio]);
  record("A9", "quem entra durante a reprodução cai no mesmo ponto", s.spread < 1.5, `tempos ${s.times.join(" / ")} s`);

  // A10: Caio sai e volta.
  await walkOut(caio, BATE_PAPO);
  const outState = await tvPlayerState(caio);
  await new Promise((r) => setTimeout(r, 4_000));
  await walkIn(caio, BATE_PAPO);
  await playing(caio);
  await new Promise((r) => setTimeout(r, 5_000));
  s = await spread([ana, caio]);
  record("A10", "sair e voltar retoma no ponto atual", outState !== "playing" && s.spread < 1.5, `fora: ${outState}; de volta: ${s.times.join(" / ")} s`);

  // A11: trocar o conteúdo (um por vez).
  await bia.page.evaluate((v) => window.__space.view.tvLoad(v), VID2);
  await Promise.all([ana, bia, caio].map((c) => until(c.page, (v) => window.__space.view.ui.tv?.state?.ref === v, VID2, 10_000)));
  await Promise.all([playing(ana), playing(bia), playing(caio)]);
  await new Promise((r) => setTimeout(r, 5_000));
  s = await spread([ana, bia, caio]);
  record("A11", "trocar o vídeo troca para todos", s.spread < 1.5, `ref ${VID2}, tempos ${s.times.join(" / ")} s`);

  // A12/E: sem permissão (Café: ninguém sem cargo controla; Bia tem cargo sem esse poder).
  await walkOut(caio, BATE_PAPO);
  await walkIn(caio, CAFE);
  const rights = await caio.page.evaluate(() => window.__space.view.ui.tv.you);
  await caio.page.evaluate((v) => window.__space.view.tvLoad(v), VID);
  await until(caio.page, () => window.__space.view.ui.tvError?.code === "not_allowed", null, 5_000);
  const cafeState = await tvState(caio);
  record("A12", "sem permissão não controla (o servidor recusa)", !rights.control && rights.watch && cafeState === null, `direitos ${JSON.stringify(rights)}, erro not_allowed, TV continua desligada`);

  // A13: vídeo inexistente → mensagem de indisponível no player.
  await walkOut(ana, BATE_PAPO);
  await walkIn(ana, CAFE);
  await ana.page.evaluate((v) => window.__space.view.tvLoad(v), MISSING);
  await until(ana.page, () => window.__tv.errors.length > 0, null, 20_000).catch(() => undefined);
  const missingErrors = await ana.page.evaluate(() => [...window.__tv.errors]);
  record("A13", "vídeo indisponível é reconhecido", missingErrors.length > 0, `erros do player: ${missingErrors.join(", ") || "nenhum"}`);

  // A14: não incorporável (candidatos; o resultado diz qual foi provado).
  const found = [];
  for (const id of NOT_EMBEDDABLE) {
    await ana.page.evaluate(() => (window.__tv.errors.length = 0));
    const rev = (await tvState(ana))?.rev ?? 0;
    await ana.page.evaluate((v) => window.__space.view.tvLoad(v), id);
    await until(ana.page, (r) => (window.__space.view.ui.tv?.state?.rev ?? 0) > r, rev, 5_000).catch(() => undefined);
    await until(ana.page, () => window.__tv.errors.length > 0 || window.__tv.player()?.state() === "playing", null, 20_000).catch(() => undefined);
    const errs = await ana.page.evaluate(() => [...window.__tv.errors]);
    found.push(`${id}: ${errs.length ? `erro ${errs.join("/")}` : await tvPlayerState(ana)}`);
    if (errs.some((e) => e === 101 || e === 150)) break;
  }
  const proven = found.some((f) => /erro (101|150)/.test(f));
  record("A14", "conteúdo não incorporável é reconhecido", proven, proven ? found.join("; ") : `NÃO PROVADO — nenhum candidato devolveu 101/150: ${found.join("; ")}`);

  const errs = [ana, bia, caio].flatMap((c) => c.errors);
  record("sem-erros", "nenhum erro de página", errs.length === 0, errs.slice(0, 3).join(" | "));
} catch (err) {
  record("erro", "execução", false, String(err));
} finally {
  writeFileSync(join(OUT, "tv-results.json"), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`RESUMO ${results.length - failed}/${results.length} ok`);
  process.exit(failed ? 1 : 0);
}
