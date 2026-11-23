#!/usr/bin/env node
/* global console, process, document, window, getComputedStyle, innerWidth, innerHeight, HTMLElement, setTimeout */
/**
 * Laboratório de celular e tablet do Espaço (23/11/2026). O APK do Muchat é um
 * WebView que abre o site: o Espaço tem de funcionar com o dedo, numa tela pequena,
 * em pé e deitada. Este roteiro entra no laboratório completo
 * (packages/space-server/lab/full) com uma pessoa em cada aparelho de devices.mjs,
 * passa pelos fluxos do Espaço e, a cada passo, tira uma captura e audita a tela:
 *
 *  - rolagem lateral da página (alta);
 *  - botão ou campo cortado pela borda sem rolagem que o alcance (alta);
 *  - botão coberto por outra coisa (o toque cai no que está por cima) (média);
 *  - alvo de toque pequeno: < 24 px (alta), < 40 px (média; o Android pede 48 dp);
 *  - conteúdo cortado na horizontal dentro de uma caixa sem rolagem (média);
 *  - quanto do mapa sobra visível (o Espaço é o mapa).
 *
 * Sai em qa/full-lab/out/mobile/<rodada>/: report.html (as capturas lado a lado
 * com os achados), results.json e as PNGs por aparelho.
 *
 * Uso (na pasta packages/client, com o laboratório e o app de pé):
 *   FULL_LAB_DIR=<pasta do lab> node qa/full-lab/mobile-audit.mjs \
 *     [--devices phone,phone-small,phone-land,tablet,tablet-land] [--user caio]
 *     [--room "Sala de estar"] [--with-share] [--run nome] [--headed]
 *
 * --with-share: a Bia (no computador) entra na mesma sala e compartilha a tela,
 * para ver o palco e o avatar "AO VIVO" no celular.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { chromium } from "@playwright/test";

import { DEVICES } from "./devices.mjs";
import { openPerson } from "./person.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const BASE = opt("base", "http://localhost:5173");
const LAB = process.env.FULL_LAB_DIR ?? resolve("../space-server/lab/full");
const STATE = JSON.parse(readFileSync(join(LAB, "state.local.json"), "utf8"));
const devices = opt(
  "devices",
  "phone,phone-small,phone-land,tablet,tablet-land",
).split(",");
const who = opt("user", "caio");
const ROOM = opt("room", "Sala de estar");
const RUN = opt(
  "run",
  new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"),
);
const OUT = join(resolve("qa/full-lab/out/mobile"), RUN);
mkdirSync(OUT, { recursive: true });
const SPACE = `/server/${STATE.serverId}/space`;

const browser = await chromium.launch({
  headless: !args.includes("--headed"),
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});

// ---- ações -------------------------------------------------------------------

/**
 * Aparelho de toque da rodada: os toques vão como toque (`tap`), não como clique
 * de mouse. Com mouse, um botão com dica a mostra ao passar por cima; com o dedo,
 * não (o celular de verdade).
 */
let TOUCH = false;

/** @param {import("@playwright/test").Locator} loc */
async function press(loc, timeout = 8_000) {
  if (TOUCH) await loc.tap({ timeout });
  else await loc.click({ timeout });
}

/** @param {import("@playwright/test").Page} page */
async function gotoSpace(page) {
  await page.goto(BASE + SPACE, { waitUntil: "domcontentloaded" });
  await page
    .locator('[role="application"] canvas')
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2_500);
}

/** Botão pelo nome acessível (o ícone do Material vem junto no texto: "co_present Palco"). */
async function clickButton(page, name) {
  const re = new RegExp(`(^|\\s)${name}$`);
  await press(page.getByRole("button", { name: re }).first());
}

/**
 * Botão pelo começo do rótulo: a dica (`use:floating`) troca o aria-label pelo
 * texto dela ("Fechar o palco (Esc): …").
 */
async function clickLabel(page, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await press(page.getByLabel(new RegExp(`^${esc}`)).first());
}

/** O diálogo "Seu áudio" (primeira vez neste aparelho): "Pronto". */
async function dismissAudio(page) {
  const done = page
    .getByRole("button", { name: "Pronto", exact: true })
    .first();
  if (!(await done.isVisible().catch(() => false)))
    await done
      .scrollIntoViewIfNeeded({ timeout: 3_000 })
      .catch(() => undefined);
  await press(done);
  await page.waitForTimeout(1_000);
}

/** O voltar do Android: o APK pergunta à página (window.muchatBack) antes de sair. */
async function androidBack(page) {
  const handled = await page.evaluate(() => window.muchatBack?.() ?? null);
  if (handled !== true)
    throw new Error(`o voltar não fechou nada (muchatBack → ${handled})`);
  await page.waitForTimeout(500);
}

async function location(page) {
  return (
    await page
      .locator("strong")
      .first()
      .innerText()
      .catch(() => "")
  ).trim();
}

/** Abre a lista de salas (se estiver fechada). */
async function showList(page) {
  const show = page
    .getByLabel("Mostrar lista de salas", { exact: true })
    .first();
  if (await show.isVisible().catch(() => false)) await press(show);
}

/** Fecha a lista de salas (se estiver aberta). */
async function hideList(page) {
  const hide = page
    .getByLabel("Esconder lista de salas", { exact: true })
    .first();
  if (await hide.isVisible().catch(() => false)) await press(hide);
}

/**
 * Entra na sala pela lista ("Ir para …") e espera o cabeçalho mudar. O avatar fica
 * onde a rodada anterior o deixou: se ele já está na sala, o passo está feito.
 */
async function enterRoom(page, title) {
  if ((await location(page)) === title) return;
  const go = page.getByLabel(`Ir para ${title}`, { exact: true }).first();
  if (!(await go.isVisible().catch(() => false))) {
    const show = page
      .getByLabel("Mostrar lista de salas", { exact: true })
      .first();
    if (await show.isVisible().catch(() => false)) await press(show);
  }
  await press(go);
  const until = Date.now() + 25_000;
  while ((await location(page)) !== title) {
    if (Date.now() > until)
      throw new Error(
        `não chegou em ${title} (está em "${await location(page)}")`,
      );
    await page.waitForTimeout(500);
  }
  // The room's call takes a few seconds to come up.
  await page
    .locator('[role="status"][data-kind="connected"]')
    .first()
    .waitFor({ timeout: 25_000 })
    .catch(() => undefined);
  await page.waitForTimeout(1_000);
}

/**
 * Toca no mapa a uns três passos do avatar (a câmera o segue: ele fica no meio do
 * mapa) e confere se o mapa se mexeu. Tenta direções diferentes: parede e móvel
 * não deixam chegar.
 */
async function tapMap(page) {
  const canvas = page.locator('[role="application"] canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("mapa sem caixa");
  const touch = (await page.evaluate(() => "ontouchstart" in window)) === true;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const d = Math.min(box.width, box.height) * 0.3;
  for (const [dx, dy] of [
    [d, 0],
    [-d, 0],
    [0, d],
    [0, -d],
    [d, d],
    [-d, -d],
  ]) {
    const before = await canvas.screenshot().catch(() => null);
    if (touch) await page.touchscreen.tap(cx + dx, cy + dy);
    else await page.mouse.click(cx + dx, cy + dy);
    await page.waitForTimeout(2_000);
    const after = await canvas.screenshot().catch(() => null);
    if (!before || !after || !before.equals(after)) return;
  }
  throw new Error("nenhum toque no mapa fez o avatar andar");
}

// ---- auditoria (roda na página) ------------------------------------------------

function auditPage() {
  const vw = innerWidth;
  const vh = innerHeight;
  const issues = [];
  const add = (sev, kind, what, extra) =>
    issues.push({ sev, kind, what, ...(extra ?? {}) });
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1)
    add(
      "alta",
      "rolagem-lateral",
      `a página tem ${doc.scrollWidth - vw}px a mais na largura`,
    );

  const nameOf = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.value ||
      el.tagName
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50);
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (
      cs.visibility === "hidden" ||
      cs.display === "none" ||
      Number(cs.opacity) === 0
    )
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const scrollParent = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const oy =
        /(auto|scroll)/.test(cs.overflowY) &&
        p.scrollHeight > p.clientHeight + 1;
      const ox =
        /(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1;
      if (oy || ox) return p;
    }
    return null;
  };
  // Fora da tela de propósito (o player da TV estacionado, o card da chamada guardado).
  const parked = (r) =>
    r.right < -40 || r.left > vw + 40 || r.bottom < -40 || r.top > vh + 40;

  const sel =
    'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="checkbox"], input:not([type="hidden"]), select, textarea';
  const seen = new Set();
  let controls = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (parked(r)) continue;
    controls++;
    const name = nameOf(el);
    const key = `${name}|${Math.round(r.left)}|${Math.round(r.top)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const box =
      /^(checkbox|radio)$/.test(el.type) && el.closest("label")
        ? el.closest("label").getBoundingClientRect()
        : r;
    const size = `${Math.round(box.width)}×${Math.round(box.height)}`;
    const min = Math.min(box.width, box.height);
    // Range inputs are thin by design; their thumb is the target.
    const thin = el.type === "range";
    if (!thin && min < 24) add("alta", "alvo-pequeno", name, { size });
    else if (!thin && min < 40) add("media", "alvo-pequeno", name, { size });
    const outside =
      r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1;
    if (outside && !scrollParent(el))
      add("alta", "cortado", name, {
        size,
        at: `${Math.round(r.left)},${Math.round(r.top)}`,
      });
    // O que está por cima do meio do controle (dentro da tela).
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) {
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        const over = top.closest(sel) ?? top;
        // A big non-interactive layer on top (the map, the main column over the app's
        // drawer on phones) means the control is behind the page, not under a popup.
        const or = over.getBoundingClientRect();
        const layer =
          !over.matches(sel) && (or.width * or.height) / (vw * vh) > 0.45;
        // Behind the app's main content (the channel drawer of a phone, closed).
        const main = document.querySelector(".app_body");
        // Geometrically under the main content but not in it: the app's drawer,
        // closed, behind the page (the call card covers it from its own portal).
        const mr = main?.getBoundingClientRect();
        const underMain =
          !!mr &&
          !main.contains(el) &&
          cx >= mr.left &&
          cx <= mr.right &&
          cy >= mr.top &&
          cy <= mr.bottom;
        const behind =
          (!!main && main.contains(over) && !main.contains(el)) || underMain;
        // Under an open dialog by design (the dialog is in front, modal).
        const modal = over.closest('[role="dialog"], [aria-modal="true"]');
        const underModal = !!modal && !modal.contains(el);
        // The dev build's floating "Devtools" button (absent in production).
        const devtools = /^Devtools/.test(nameOf(over));
        if (!layer && !behind && !underModal && !devtools)
          add("media", "coberto", name, {
            by: nameOf(over).slice(0, 40) || over.tagName,
          });
      }
    }
  }

  // Caixas que cortam o conteúdo na horizontal (texto ou botões somem sem rolagem).
  let clipped = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (clipped >= 8) break;
    if (!(el instanceof HTMLElement) || el.children.length === 0) continue;
    // Só para o leitor de tela (1 px, recortado): escondido de propósito.
    if (el.clientWidth <= 2 || el.clientHeight <= 2) continue;
    const cs = getComputedStyle(el);
    if (!/(hidden|clip)/.test(cs.overflowX) || cs.textOverflow === "ellipsis")
      continue;
    if (el.scrollWidth <= el.clientWidth + 2 || el.clientWidth === 0) continue;
    if (!visible(el) || parked(el.getBoundingClientRect())) continue;
    if (el.closest('[role="application"]')) continue;
    clipped++;
    add("media", "corte-horizontal", nameOf(el).slice(0, 40) || el.tagName, {
      hidden: `${el.scrollWidth - el.clientWidth}px`,
    });
  }

  // Quanto do mapa aparece (amostra numa grade de pontos).
  const canvas = document.querySelector('[role="application"] canvas');
  let mapPct = 0;
  if (canvas) {
    let hit = 0;
    let n = 0;
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 20; j++) {
        n++;
        const el = document.elementFromPoint(
          ((i + 0.5) * vw) / 12,
          ((j + 0.5) * vh) / 20,
        );
        if (el === canvas) hit++;
      }
    mapPct = Math.round((100 * hit) / n);
  }
  return { vw, vh, controls, mapPct, issues };
}

// ---- roteiro -----------------------------------------------------------------

async function runDevice(device) {
  TOUCH = DEVICES[device].hasTouch;
  const p = await openPerson(browser, {
    name: who,
    user: STATE.users[who],
    base: BASE,
    out: OUT,
    device,
  });
  const page = p.page;
  mkdirSync(join(OUT, device), { recursive: true });
  const steps = [];
  const step = async (id, label, fn) => {
    let ok = true;
    let error = null;
    const t0 = Date.now();
    try {
      await fn(page);
    } catch (e) {
      ok = false;
      error = String(e?.message ?? e)
        .split("\n")[0]
        .slice(0, 300);
    }
    await page.waitForTimeout(700);
    const audit = await page
      .evaluate(auditPage)
      .catch((e) => ({ error: String(e), issues: [] }));
    const file = join(
      OUT,
      device,
      `${String(steps.length + 1).padStart(2, "0")}-${id}.png`,
    );
    await page.screenshot({ path: file }).catch(() => undefined);
    steps.push({
      id,
      label,
      ok,
      error,
      ms: Date.now() - t0,
      audit,
      shot: relative(OUT, file).replace(/\\/g, "/"),
    });
    console.log(
      `  ${device} · ${label}: ${ok ? "ok" : `FALHOU (${error})`} · ${audit.issues?.length ?? "?"} achados · mapa ${audit.mapPct ?? "?"}%`,
    );
  };

  await step("abrir", "Abrir o Espaço", gotoSpace);
  await step("audio-fechar", "Fechar o diálogo do áudio", dismissAudio);
  // Chegou no meio de uma corrida (a da rodada anterior): o painel abre sozinho.
  if (
    await page
      .evaluate(() => !!window.__spaceView?.state.runOpen)
      .catch(() => false)
  )
    await step("corrida-aberta", "Fechar a corrida que abriu sozinha", (pg) =>
      pg.evaluate(() => window.__spaceView?.closeRun()),
    );
  await step("hall", "Espaço depois do diálogo", async () => {});
  await step("lista", "Lista de salas aberta", showList);
  await step("sem-lista", "Lista de salas fechada", hideList);
  await step("andar", "Tocar no mapa para andar", tapMap);
  await step("sala", `Entrar em ${ROOM} pela lista`, (pg) =>
    enterRoom(pg, ROOM),
  );
  await step("palco", "Abrir o palco", (pg) =>
    press(pg.getByRole("button", { name: /^Palco( |$)/ }).first()),
  );
  // No celular o palco já cobre o mapa: "Ampliar" só existe fora dele.
  if (!DEVICES[device].isMobile || device.startsWith("tablet"))
    await step("palco-ampliar", "Ampliar o palco", (pg) =>
      clickLabel(pg, "Ampliar o palco"),
    );
  await step("palco-fechar", "Fechar o palco", (pg) =>
    clickLabel(pg, "Fechar o palco"),
  );
  await step("lista-voltar", "Voltar do Android fecha a lista", async (pg) => {
    await showList(pg);
    await androidBack(pg);
  });
  await step("heroi", "Ficha do herói", (pg) => clickButton(pg, "Herói"));
  await step(
    "heroi-fechar",
    "Voltar do Android fecha a ficha do herói",
    androidBack,
  );
  // Os diálogos do jogo, abertos pela visão (o mapa do laboratório não tem mercador
  // nem boneco): só o layout conta aqui; o servidor recusa as compras sem o NPC.
  const game = (key, value) => (pg) =>
    pg.evaluate(
      ([k, v]) => {
        const view = window.__spaceView;
        if (!view)
          throw new Error(
            "sem __spaceView: o app precisa de VITE_SPACE_TEST_HOOKS=1",
          );
        view.patch({ [k]: { ...v, n: Date.now() } });
      },
      [key, value],
    );
  // Fecha como o voltar do Android (o APK chama window.muchatBack()).
  const shut = () => androidBack;
  await step(
    "mercador",
    "Mercador",
    game("npcRequest", {
      instance: "lab-mercador",
      title: "Mercador",
      npc: "mercador",
    }),
  );
  await step("mercador-vender", "Mercador: aba Vender", (pg) =>
    press(pg.getByRole("tab", { name: /Vender/ }).first()),
  );
  await step("mercador-fechar", "Fechar o mercador", shut("closeNpcRequest"));
  await step(
    "banqueiro",
    "Banqueiro",
    game("npcRequest", {
      instance: "lab-banqueiro",
      title: "Banqueiro",
      npc: "banqueiro",
    }),
  );
  await step("banqueiro-fechar", "Fechar o banqueiro", shut("closeNpcRequest"));
  await step(
    "tv-menu",
    "Menu da TV (Idle Hunt)",
    game("tvMenu", { instance: "lab-tv", title: "TV da sala" }),
  );
  await step("tv-menu-fechar", "Fechar o menu da TV", shut("closeTvMenu"));
  await step(
    "treino",
    "Boneco de treino",
    game("trainRequest", { instance: "lab-boneco", title: "Boneco de treino" }),
  );
  await step("treino-fechar", "Fechar o treino", shut("closeTrainRequest"));
  // Idle Hunt pela TV de verdade da sala: montar o grupo, começar e ver a corrida.
  // Nos aparelhos seguintes o herói ainda está na corrida anterior: abre a que roda.
  // Anda até a TV da sala (o servidor só monta grupo perto dela) e usa a TV como
  // a pessoa faz: o menu abre com a TV de verdade.
  const toTv = (pg) =>
    pg.evaluate(async () => {
      const v = window.__spaceView;
      const room = v?.state.media?.roomId;
      const tv = (v?.world.decor?.items ?? []).find(
        (i) =>
          /^(tv-stand|tv-wall|projector-screen)$/.test(i.item) &&
          v.world.zones?.byKey.get(i.zone)?.roomId === room,
      );
      if (!tv) throw new Error("a sala não tem TV");
      const sp = v.renderer.decor.get(tv.id);
      if (!sp) throw new Error("a TV não está desenhada");
      const T = 32;
      const cx = sp.x + sp.width / 2;
      for (const [dx, dy] of [
        [0, T / 2],
        [0, T * 1.5],
        [-T, T / 2],
        [T, T / 2],
      ]) {
        if (!v.mover.walkTo(cx + dx, sp.y + dy)) continue;
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 250));
          if (v.prompt?.inst?.id === tv.id) {
            v.interact();
            return;
          }
        }
      }
      throw new Error("não chegou perto da TV");
    });
  await step("idle", "Idle Hunt: dungeons", async (pg) => {
    await toTv(pg);
    await pg.waitForTimeout(800);
    await press(
      pg.getByRole("listitem").filter({ hasText: "Idle Hunt" }).first(),
    );
  });
  await step("idle-grupo", "Idle Hunt: grupo montado", (pg) =>
    press(pg.getByRole("button", { name: "Montar grupo" }).first()),
  );
  await step("corrida", "Corrida na dungeon", async (pg) => {
    const start = pg
      .getByRole("button", { name: "Começar", exact: true })
      .first();
    if (await start.isVisible().catch(() => false)) await press(start);
    await pg.waitForTimeout(4_000);
    // Sem o painel aberto (herói já numa corrida): abre a que está rodando.
    await pg.evaluate(() => {
      const v = window.__spaceView;
      if (v && !v.state.runOpen) {
        const id = Object.keys(v.state.runs ?? {})[0];
        if (id) v.watchRun(id);
      }
    });
    await pg.waitForTimeout(2_000);
  });
  await step("corrida-fechar", "Fechar a corrida", shut("closeRun"));
  const logs = p.logs
    .filter((l) => !/Failed to load resource/.test(l))
    .slice(-15);
  await p.ctx.close();
  return { device, label: DEVICES[device].label, steps, logs };
}

let companion = null;
if (args.includes("--with-share")) {
  companion = await openPerson(browser, {
    name: "bia",
    user: STATE.users.bia,
    base: BASE,
    out: OUT,
  });
  await gotoSpace(companion.page);
  await dismissAudio(companion.page).catch(() => undefined);
  await enterRoom(companion.page, ROOM);
  // Screen sharing needs the room's call up: wait for it.
  await companion.page
    .getByText("Áudio da sala conectado")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => console.log("AVISO: o áudio da Bia não conectou"));
  // The map takes the shortcuts: focus it first.
  await companion.page.locator('[role="application"]').first().focus();
  await companion.page.keyboard.press("Shift+S");
  const live = companion.page.getByText(/ao vivo/).first();
  await live.waitFor({ timeout: 15_000 }).catch(() => undefined);
  console.log(
    (await live.isVisible().catch(() => false))
      ? `bia compartilhando a tela em ${ROOM}`
      : "AVISO: a tela da Bia não começou",
  );
}

const results = [];
for (const d of devices) {
  console.log(`== ${d}`);
  try {
    results.push(await runDevice(d));
  } catch (e) {
    results.push({
      device: d,
      label: DEVICES[d]?.label ?? d,
      steps: [],
      logs: [],
      fatal: String(e?.message ?? e).slice(0, 400),
    });
  }
}
await companion?.ctx.close();
await browser.close();

writeFileSync(
  join(OUT, "results.json"),
  JSON.stringify({ run: RUN, base: BASE, room: ROOM, results }, null, 2),
);
writeFileSync(join(OUT, "report.html"), report(results));
console.log(`relatório: ${join(OUT, "report.html")}`);

// ---- relatório ----------------------------------------------------------------

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function report(rs) {
  const count = (sev) =>
    rs.reduce(
      (n, r) =>
        n +
        r.steps.reduce(
          (m, s) =>
            m + (s.audit.issues ?? []).filter((i) => i.sev === sev).length,
          0,
        ),
      0,
    );
  const fails = rs.reduce((n, r) => n + r.steps.filter((s) => !s.ok).length, 0);
  const cards = rs
    .map((r) => {
      const steps = r.steps
        .map((s) => {
          const issues = (s.audit.issues ?? [])
            .map(
              (i) =>
                `<li class="${i.sev}"><b>${esc(i.kind)}</b> ${esc(i.what)}${i.size ? ` <i>${esc(i.size)}</i>` : ""}${i.by ? ` <i>por ${esc(i.by)}</i>` : ""}${i.hidden ? ` <i>${esc(i.hidden)}</i>` : ""}</li>`,
            )
            .join("");
          return `<figure class="${s.ok ? "" : "fail"}">
  <figcaption><b>${esc(s.label)}</b> · mapa ${s.audit.mapPct ?? "?"}%${s.ok ? "" : `<br><span class="err">${esc(s.error)}</span>`}</figcaption>
  <a href="${esc(s.shot)}"><img loading="lazy" src="${esc(s.shot)}" alt="${esc(s.label)}"></a>
  <ul>${issues || "<li class=ok>sem achados</li>"}</ul>
</figure>`;
        })
        .join("\n");
      return `<section><h2>${esc(r.label)}</h2>${r.fatal ? `<p class="err">${esc(r.fatal)}</p>` : ""}<div class="row">${steps}</div>${r.logs?.length ? `<details><summary>console (${r.logs.length})</summary><pre>${esc(r.logs.join("\n"))}</pre></details>` : ""}</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Espaço no celular — ${esc(RUN)}</title>
<style>
:root{color-scheme:dark;--bg:#14151c;--card:#1f2130;--fg:#e8e8f0;--mut:#9aa0b4;--alta:#ff6b6b;--media:#ffb84d;--ok:#5ad19a}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.sum span{display:inline-block;margin-right:16px}.row{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}
figure{margin:0;flex:0 0 260px;background:var(--card);border-radius:12px;padding:8px}figure.fail{outline:2px solid var(--alta)}
figcaption{font-size:13px;margin-bottom:6px}img{width:100%;border-radius:8px;background:#000}
ul{margin:6px 0 0;padding-left:16px;font-size:12px;max-height:220px;overflow:auto}li.alta{color:var(--alta)}li.media{color:var(--media)}li.ok{color:var(--ok)}
.err{color:var(--alta)}i{color:var(--mut);font-style:normal}pre{white-space:pre-wrap;font-size:11px;color:var(--mut)}
</style>
<h1>Espaço no celular e no tablet</h1>
<p class="sum"><span>rodada ${esc(RUN)}</span><span>pessoa ${esc(who)}</span><span>sala ${esc(ROOM)}</span>
<span style="color:var(--alta)">${count("alta")} achados altos</span><span style="color:var(--media)">${count("media")} médios</span><span>${fails} passos falharam</span></p>
${cards}
</html>`;
}
