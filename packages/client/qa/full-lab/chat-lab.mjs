#!/usr/bin/env node
/* global console, process, URL, setTimeout, fetch, window, document, getComputedStyle, PerformanceObserver, localStorage, requestAnimationFrame */
/**
 * Laboratório do chat do Espaço (27/11/2026): Ana, Bia e Caio conversam no mapa como gente,
 * no app de verdade (build do laboratório), e cada passo mede o que decide se o chat é
 * confortável de usar:
 * - legibilidade: tamanho da letra na tela, contraste, largura do balão, linhas;
 * - atribuição: a ponta do balão aponta para a cabeça de quem falou;
 * - sobreposição: nenhum balão cobre outro, nem com todos falando no mesmo ponto;
 * - ritmo: quanto tempo o balão fica (tempo de leitura) e a velocidade da esteira;
 * - modo: digitar nunca anda nem aciona atalho do mapa; Esc e Enter vazio voltam ao mapa;
 * - fidelidade: a mensagem está no canal de texto (API do Stoat), editar troca o balão,
 *   apagar tira o balão na hora, bloqueado/fora do mapa vira linha;
 * - celular e "reduzir movimento";
 * - custo: sem balão, o mapa nem calcula cabeças; com balão, quadros longos (LoAF) iguais
 *   aos de sem balão.
 *
 * Uso (em packages/client, com chat-lab-space e chat-lab-client-build no ar):
 *   FULL_LAB_DIR=<pasta do lab> node qa/full-lab/chat-lab.mjs [--run nome] [--headed]
 * Saída: qa/full-lab/out/chat/<rodada>/report.html (+ report.json e as capturas).
 * As senhas e tokens de teste vêm de state.local.json e nunca são impressos.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

import { openPerson } from "./person.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const BASE = opt("base", "http://localhost:5173");
const LAB = process.env.FULL_LAB_DIR ?? resolve("../space-server/lab/full");
const STATE = JSON.parse(readFileSync(join(LAB, "state.local.json"), "utf8"));
const RUN = opt(
  "run",
  new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"),
);
const OUT = join(resolve("qa/full-lab/out/chat"), RUN);
mkdirSync(OUT, { recursive: true });
const SPACE = `/server/${STATE.serverId}/space`;
const ROOM = STATE.channels.sala;
const OTHER = STATE.channels.cinema;

/** Medidas que o desenho promete (chat/bubbles.ts). */
const PROMISE = {
  fontPx: 13,
  maxWidth: 248,
  contrast: 7, // WCAG AAA para texto normal
  tickerMaxPxS: 110,
  tickerCps: [12, 18],
  latencyMs: 1500,
};

const steps = [];
let current = null;
function step(id, title) {
  current = { id, title, checks: [], shots: [], notes: [] };
  steps.push(current);
  console.log(`\n# ${id}: ${title}`);
}
function check(name, ok, detail = "") {
  current.checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log(
    `  ${ok ? "ok  " : "FALHA"} ${name}${detail ? ` — ${detail}` : ""}`,
  );
}
function note(text) {
  current.notes.push(text);
  console.log(`  · ${text}`);
}
async function shot(page, name) {
  const file = `${current.id}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  current.shots.push(file);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- API do Stoat (o canal de texto de verdade) -----------------------------------------------

async function api(path, init = {}, who = "ana") {
  const token = who === "bot" ? STATE.bot.token : STATE.users[who].token;
  const header = who === "bot" ? "x-bot-token" : "x-session-token";
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      [header]: token,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const lastMessages = async (channel, n = 10) =>
  (await api(`/channels/${channel}/messages?limit=${n}&sort=Latest`)).body ??
  [];

// ---- a página do Espaço -----------------------------------------------------------------------

async function enterSpace(person) {
  const { page } = person;
  await page.context().addInitScript(() => {
    // O diálogo do áudio já foi visto neste aparelho (o laboratório não tem LiveKit).
    localStorage.setItem("muchat.space.audio-checked", "1");
  });
  await page.goto(`${BASE}${SPACE}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__spaceView?.world?.me, null, {
    timeout: 60_000,
  });
  // Primeiro acesso (paleta): pula.
  const skip = page
    .getByRole("button", { name: /Pular|Começar|Entrar no espaço/ })
    .first();
  if (await skip.isVisible().catch(() => false))
    await skip.click().catch(() => undefined);
  // O que o jogo deixou aberto de outra rodada (corrida, largada): fecha.
  for (let i = 0; i < 6; i++) {
    const closed = await page.evaluate(() => window.muchatBack?.() === true);
    if (!closed) break;
  }
  // O aviso "Muchat fica melhor no app" só existe em localhost (nunca no APK nem em produção):
  // fecha, senão cobre o canto do painel.
  const promo = page.getByText("fica melhor no app").first();
  if (await promo.isVisible().catch(() => false)) {
    const box = promo.locator("xpath=ancestor::*[.//button][1]");
    await box
      .getByRole("button")
      .last()
      .click()
      .catch(() => undefined);
  }
  await page.waitForTimeout(500);
}

const meOf = (page) =>
  page.evaluate(() => {
    const m = window.__spaceView.world.me;
    return { id: m.userId, x: m.x, y: m.y, room: m.room };
  });

async function walkToRoom(page, roomId) {
  await page.evaluate((id) => window.__spaceView.walkToRoom(id), roomId);
  await page.waitForFunction(
    (id) => window.__spaceView.world.me.room === id,
    roomId,
    {
      timeout: 30_000,
    },
  );
  await page.waitForTimeout(400);
}

/** Anda até um ponto (px do mundo) e espera parar. */
async function walkTo(page, x, y) {
  await page.evaluate(([a, b]) => window.__spaceView.walkTo(a, b), [x, y]);
  await page.waitForFunction(() => !window.__spaceView.world.me.moving, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(400);
}

/** Um ponto livre perto do centro da sala (para todos pararem juntos). */
const roomSpot = (page, roomId, dx = 0) =>
  page.evaluate(
    ([id, d]) => {
      const r = window.__spaceView.world.ix.roomsById.get(id);
      return { x: (r.inside.tx + d) * 32 + 16, y: (r.inside.ty + 1) * 32 + 16 };
    },
    [roomId, dx],
  );

async function focusMap(page) {
  await page.locator('[role="application"]').first().focus();
}

/** Fala pelo campo do mapa: Enter abre, digita, Enter envia. */
async function say(page, text) {
  await focusMap(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(120);
  await page.keyboard.type(text, { delay: 8 });
  await page.keyboard.press("Enter");
}

/** Os balões que a pessoa vê, com a geometria e o estilo calculado. */
const bubblesOn = (page) =>
  page.evaluate(() => {
    const layer = document.querySelector("[data-space-bubbles]");
    const cols = [...(layer?.children ?? [])].filter(
      (c) => c.style.visibility === "visible",
    );
    const area = layer?.getBoundingClientRect();
    return cols.map((c) => {
      const r = c.getBoundingClientRect();
      const items = [...c.children].map((b) => {
        const s = getComputedStyle(b);
        const br = b.getBoundingClientRect();
        return {
          kind: b.dataset.kind,
          text: b.textContent?.trim() ?? "",
          ticker: b.hasAttribute("data-ticker"),
          older: b.hasAttribute("data-older"),
          mine: b.hasAttribute("data-mine"),
          fontPx: parseFloat(s.fontSize),
          lineHeight: parseFloat(s.lineHeight),
          color: s.color,
          bg: s.backgroundColor,
          width: br.width,
          height: br.height,
        };
      });
      return {
        left: r.left - (area?.left ?? 0),
        top: r.top - (area?.top ?? 0),
        width: r.width,
        height: r.height,
        // A ponta é do balão de baixo: a borda dele mais o --tail-x dele.
        tailX: (() => {
          const last = c.lastElementChild;
          if (!last) return 0;
          const lr = last.getBoundingClientRect();
          return (
            lr.left -
            r.left +
            (parseFloat(last.style.getPropertyValue("--tail-x")) ||
              lr.width / 2)
          );
        })(),
        lift: parseFloat(c.style.getPropertyValue("--lift")) || 0,
        named: c.hasAttribute("data-named"),
        items,
      };
    });
  });

/** Onde a cabeça de alguém está na tela de quem olha (o mesmo cálculo do mapa). */
const headOn = (page, userId) =>
  page.evaluate((id) => {
    const r = window.__spaceView.renderer;
    const a = r.avatars.get(id);
    if (!a) return null;
    return {
      x: Math.round(r.stage.position.x + a.root.position.x * r.zoom),
      feetY: Math.round(r.stage.position.y + a.root.position.y * r.zoom),
      zoom: r.zoom,
    };
  }, userId);

function luminance(rgb) {
  const [r, g, b] = rgb
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (fg, bg) => {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

function overlaps(cols) {
  let n = 0;
  for (let i = 0; i < cols.length; i++)
    for (let j = i + 1; j < cols.length; j++) {
      const a = cols[i];
      const b = cols[j];
      if (
        a.left < b.left + b.width &&
        b.left < a.left + a.width &&
        a.top < b.top + b.height &&
        b.top < a.top + a.height
      )
        n++;
    }
  return n;
}

/** Espera um balão com esse texto aparecer na tela de quem olha; devolve em quantos ms. */
async function waitBubble(page, text, timeout = 6000) {
  const t0 = Date.now();
  await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('[data-kind="say"]')].some(
        (b) =>
          b.textContent?.includes(t) &&
          b.closest('[style*="visibility: visible"]'),
      ),
    text,
    { timeout },
  );
  return Date.now() - t0;
}

/** Instala os contadores de custo: quadros longos (LoAF) e chamadas do mapa ao chat. */
async function installMeters(page) {
  await page.evaluate(() => {
    // heads: quadros em que o mapa seguiu cabeças; emits: vezes que chamou o chat (algo mexeu).
    const m = { loaf: [], heads: 0, emits: 0 };
    window.__chatMeters = m;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) m.loaf.push(e.duration);
      }).observe({ type: "long-animation-frame", buffered: false });
    } catch {
      m.loaf = null;
    }
    const r = window.__spaceView.renderer;
    const orig = r.emitHeads.bind(r);
    r.emitHeads = () => {
      if (r.headListener && r.headIds.size) m.heads++;
      const before = r.headKey;
      orig();
      if (r.headKey !== before) m.emits++;
    };
  });
}
const readMeters = (page) =>
  page.evaluate(() => {
    const m = window.__chatMeters;
    const out = {
      loaf: m.loaf ? [...m.loaf] : null,
      heads: m.heads,
      emits: m.emits,
    };
    m.loaf = m.loaf ? [] : null;
    m.heads = 0;
    m.emits = 0;
    return out;
  });

// ---- a rodada ---------------------------------------------------------------------------------

const browser = await chromium.launch({
  headless: !args.includes("--headed"),
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const people = {};
const report = { run: RUN, at: new Date().toISOString(), steps };
try {
  for (const name of ["ana", "bia", "caio"]) {
    people[name] = await openPerson(browser, {
      name,
      user: STATE.users[name],
      base: BASE,
      out: OUT,
    });
    await people[name].page.setViewportSize({ width: 1440, height: 900 });
  }
  const { ana, bia, caio } = people;
  const id = {};
  for (const [n, p] of Object.entries(people)) {
    await enterSpace(p);
    id[n] = (await meOf(p.page)).id;
  }

  // 1. Todos na mesma sala, perto um do outro.
  step("01-sala", "Os três entram na mesma sala e param perto");
  for (const [n, d] of [
    ["ana", 0],
    ["bia", 2],
    ["caio", 4],
  ]) {
    const p = people[n].page;
    await walkToRoom(p, ROOM);
    const spot = await roomSpot(p, ROOM, d);
    await walkTo(p, spot.x, spot.y);
  }
  await installMeters(ana.page);
  await wait(1500);
  const idle = await readMeters(ana.page);
  check(
    "parado e sem balão, o mapa não calcula cabeças",
    idle.heads === 0,
    `chamadas: ${idle.heads}`,
  );
  await shot(ana.page, "ana-antes");

  // 2. Primeira fala: legibilidade, atribuição, latência, e a mensagem no canal.
  step(
    "02-primeira-fala",
    "Ana diz oi pelo campo do mapa (Enter, digita, Enter)",
  );
  const hello = "Oi, gente! Bora começar?";
  const tSend = Date.now();
  await say(ana.page, hello);
  const latency = await waitBubble(bia.page, hello).then(
    () => Date.now() - tSend,
  );
  check(
    "o balão aparece para a Bia rápido",
    latency <= PROMISE.latencyMs,
    `${latency} ms do Enter da Ana`,
  );
  await waitBubble(ana.page, hello);
  // Mede depois da entrada (180 ms, a escala de 0,94 desloca as bordas).
  await wait(300);
  const onBia = await bubblesOn(bia.page);
  const col = onBia.find((c) => c.items.some((b) => b.text.includes(hello)));
  const b = col?.items.find((x) => x.text.includes(hello));
  check(
    "letra do balão no tamanho do chat",
    b && b.fontPx >= PROMISE.fontPx,
    `${b?.fontPx}px / linha ${b?.lineHeight}px`,
  );
  const cr = b ? contrast(b.color, b.bg) : 0;
  check("contraste AAA (≥ 7:1)", cr >= PROMISE.contrast, `${cr.toFixed(1)}:1`);
  check(
    "largura dentro do limite",
    b && b.width <= PROMISE.maxWidth,
    `${b?.width.toFixed(0)}px`,
  );
  const head = await headOn(bia.page, id.ana);
  const tailAbsX = col ? col.left + col.tailX : -1;
  check(
    "a ponta aponta para a cabeça da Ana",
    head && Math.abs(tailAbsX - head.x) <= 2,
    `ponta x=${tailAbsX.toFixed(0)}, cabeça x=${head?.x}`,
  );
  check(
    "o balão fica acima da cabeça (não cobre o avatar)",
    head && col && col.top + col.height <= head.feetY - 32 * head.zoom,
    `pé do balão y=${col ? (col.top + col.height).toFixed(0) : "?"}, topo do sprite y=${head ? head.feetY - 32 * head.zoom : "?"}`,
  );
  const inChannel = (await lastMessages(ROOM, 5)).some(
    (m) => m.content === hello,
  );
  check("a mensagem está no canal de texto da sala (API do Stoat)", inChannel);
  const focusAfter = await ana.page.evaluate(
    () => !!document.activeElement?.closest(".cm-editor"),
  );
  check(
    "depois de enviar, o campo continua com o foco (a conversa segue)",
    focusAfter,
  );
  await shot(bia.page, "bia-ve-ana");
  await shot(ana.page, "ana-ve-a-propria");
  const busy = await readMeters(ana.page);
  note(
    `com balão: o mapa chamou o chat ${busy.heads}× em ~${((Date.now() - tSend) / 1000).toFixed(1)} s`,
  );

  // 3. Modo: com o campo aberto, letras não andam e atalhos do mapa não disparam.
  step(
    "03-modo",
    "Com o campo aberto, W A S D, M e E são texto; Esc volta ao mapa",
  );
  const before = await meOf(ana.page);
  await ana.page.keyboard.type("wasdme", { delay: 30 });
  await wait(400);
  const after = await meOf(ana.page);
  check(
    "o avatar não andou",
    before.x === after.x && before.y === after.y,
    `(${before.x},${before.y}) → (${after.x},${after.y})`,
  );
  const typed = await ana.page.evaluate(
    () => document.querySelector(".cm-content")?.textContent ?? "",
  );
  check(
    "as letras foram para o campo",
    typed.includes("wasdme"),
    JSON.stringify(typed),
  );
  await shot(ana.page, "campo-com-texto");
  // Limpa o rascunho e volta com Esc.
  await ana.page.keyboard.press("Control+A");
  await ana.page.keyboard.press("Backspace");
  await ana.page.keyboard.press("Escape");
  await wait(200);
  const onMap = await ana.page.evaluate(
    () => document.activeElement?.getAttribute("role") === "application",
  );
  check("Esc devolve o foco ao mapa", onMap);
  await ana.page.keyboard.down("d");
  await wait(350);
  await ana.page.keyboard.up("d");
  await wait(300);
  const moved = await meOf(ana.page);
  check(
    "no mapa, D anda de novo",
    moved.x !== after.x || moved.y !== after.y,
    `(${after.x}) → (${moved.x})`,
  );
  await walkTo(ana.page, before.x, before.y);
  // Enter com o campo vazio também volta.
  await focusMap(ana.page);
  await ana.page.keyboard.press("Enter");
  await wait(150);
  await ana.page.keyboard.press("Enter");
  await wait(150);
  const back = await ana.page.evaluate(
    () => document.activeElement?.getAttribute("role") === "application",
  );
  check("Enter com o campo vazio volta ao mapa", back);

  // 4. Conversa rápida: três falando, sem sobreposição; a pilha de cada um.
  step(
    "04-conversa",
    "Bia e Caio respondem em sequência (três balões juntos, pilha da Bia)",
  );
  await say(bia.page, "Bora!");
  await wait(250);
  await say(caio.page, "Tô dentro, só pegar um café ☕");
  await wait(250);
  await say(bia.page, "Alguém viu o relatório de ontem?");
  await waitBubble(ana.page, "relatório de ontem");
  await wait(400);
  const busyCols = await bubblesOn(ana.page);
  check(
    "nenhum balão cobre outro",
    overlaps(busyCols) === 0,
    `${busyCols.length} pilhas, ${overlaps(busyCols)} sobreposições`,
  );
  const biaCol = busyCols.find((c) =>
    c.items.some((x) => x.text.includes("relatório")),
  );
  check(
    "a pilha da Bia tem a fala antiga esmaecida em cima",
    biaCol && biaCol.items.length >= 2 && biaCol.items[0].older,
    `${biaCol?.items.length} balões`,
  );
  for (const c of busyCols) {
    const who = c.items.at(-1)?.text.slice(0, 18);
    note(
      `pilha "${who}…": x=${c.left.toFixed(0)} y=${c.top.toFixed(0)} ${c.width.toFixed(0)}×${c.height.toFixed(0)} lift=${c.lift}`,
    );
  }
  await shot(ana.page, "tres-falando");

  // 5. Mesmo ponto: todos param no mesmo tile (o "Ir para" leva todos à mesma porta).
  step("05-mesmo-ponto", "Os três no mesmo ponto e falando ao mesmo tempo");
  const spot = await roomSpot(ana.page, ROOM, 1);
  for (const n of ["ana", "bia", "caio"])
    await walkTo(people[n].page, spot.x, spot.y);
  await Promise.all([
    say(ana.page, "Teste de muita gente junta"),
    say(bia.page, "Também tô aqui"),
    say(caio.page, "E eu!"),
  ]);
  await waitBubble(bia.page, "E eu!");
  await wait(500);
  const stacked = await bubblesOn(bia.page);
  check(
    "mesmo empilhados no mesmo ponto, nenhum balão cobre outro",
    overlaps(stacked) === 0,
    `${stacked.length} pilhas`,
  );
  const lifted = stacked.filter((c) => c.lift > 0).length;
  note(`${lifted} pilha(s) subiram com a linha ligando à cabeça`);
  check(
    "toda pilha que subiu mostra o nome de quem falou",
    stacked.filter((c) => c.lift > 0).every((c) => c.named),
    `${stacked.filter((c) => c.named).length} com nome`,
  );
  await shot(bia.page, "mesmo-ponto");
  // Espalha de novo.
  for (const [n, d] of [
    ["ana", 0],
    ["bia", 2],
    ["caio", 4],
  ]) {
    const s = await roomSpot(people[n].page, ROOM, d);
    await walkTo(people[n].page, s.x, s.y);
  }

  // 6. Esteira: mensagem longa.
  step("06-esteira", "Caio manda uma mensagem longa (vira esteira)");
  const long =
    "Pessoal, só pra avisar: amanhã a reunião muda para as 15h porque o cliente pediu mais tempo, e quem não puder vir avisa aqui no canal que eu mando o resumo com as decisões e os próximos passos depois.";
  await say(caio.page, long);
  await waitBubble(ana.page, "Pessoal, só pra avisar");
  const tk = await ana.page.evaluate(() => {
    const b = [
      ...document.querySelectorAll('[data-kind="say"][data-ticker]'),
    ].at(-1);
    const track = b?.querySelector("span span");
    const anim = track?.getAnimations()[0];
    const t = anim?.effect?.getTiming();
    const kf = anim?.effect?.getKeyframes();
    const dist = kf
      ? -parseFloat(String(kf.at(-1).transform).replace("translateX(", ""))
      : 0;
    return {
      ok: !!b,
      width: b?.getBoundingClientRect().width,
      height: b?.getBoundingClientRect().height,
      chars: track?.textContent.length,
      textPx: track?.getBoundingClientRect().width,
      duration: t?.duration,
      delay: t?.delay,
      dist,
    };
  });
  check(
    "a mensagem longa virou esteira (uma linha correndo)",
    tk.ok && tk.height < 56,
    `${tk.width?.toFixed(0)}×${tk.height?.toFixed(0)}px`,
  );
  check(
    "a esteira tem a largura de um balão",
    tk.width <= PROMISE.maxWidth,
    `${tk.width?.toFixed(0)}px`,
  );
  const pxs = tk.dist / (tk.duration / 1000);
  const cps = pxs / (tk.textPx / tk.chars);
  check(
    "velocidade confortável (≤ 110 px/s)",
    pxs <= PROMISE.tickerMaxPxS,
    `${pxs.toFixed(0)} px/s`,
  );
  check(
    "ritmo de leitura (12–18 caracteres/s)",
    cps >= PROMISE.tickerCps[0] && cps <= PROMISE.tickerCps[1],
    `${cps.toFixed(1)} car/s`,
  );
  check(
    "espera no começo para achar o início",
    tk.delay >= 1000,
    `${tk.delay} ms`,
  );
  note(
    `esteira: ${tk.chars} caracteres, ${(tk.duration / 1000).toFixed(1)} s andando + esperas`,
  );
  await shot(ana.page, "esteira-inicio");
  await wait(tk.delay + tk.duration / 2);
  await shot(ana.page, "esteira-meio");
  await wait(tk.duration / 2 + 300);
  await shot(ana.page, "esteira-fim");
  const ended = await ana.page.evaluate(
    () => [...document.querySelectorAll("[data-ticker]")].at(-1)?.dataset.phase,
  );
  check(
    "no fim o texto para com a última palavra à vista",
    ended === "end",
    `fase: ${ended}`,
  );
  const inCh = (await lastMessages(ROOM, 5)).find((m) => m.content === long);
  check("a mensagem inteira está no canal", !!inCh);

  // 7. Digitando.
  step(
    "07-digitando",
    "Bia começa a escrever sem enviar: os três pontos sobre ela",
  );
  await focusMap(bia.page);
  await bia.page.keyboard.press("Enter");
  await bia.page.keyboard.type("hmm deixa eu ver", { delay: 40 });
  const typingSeen = await ana.page
    .waitForFunction(
      () => !!document.querySelector('[data-kind="typing"]'),
      null,
      { timeout: 4000 },
    )
    .then(
      () => true,
      () => false,
    );
  check("a Ana vê que a Bia está digitando", typingSeen);
  await shot(ana.page, "bia-digitando");
  await bia.page.keyboard.press("Control+A");
  await bia.page.keyboard.press("Backspace");
  await bia.page.keyboard.press("Escape");

  // 8. Editar e apagar.
  step(
    "08-editar-apagar",
    "Ana edita e depois apaga uma fala: o balão acompanha na hora",
  );
  await say(ana.page, "Reunião às 14h");
  await waitBubble(bia.page, "Reunião às 14h");
  const mine = (await lastMessages(ROOM, 5)).find(
    (m) => m.content === "Reunião às 14h",
  );
  await api(`/channels/${ROOM}/messages/${mine._id}`, {
    method: "PATCH",
    body: JSON.stringify({ content: "Reunião às 15h" }),
  });
  const edited = await waitBubble(bia.page, "Reunião às 15h", 4000).then(
    () => true,
    () => false,
  );
  check("editar troca o texto do balão", edited);
  await api(`/channels/${ROOM}/messages/${mine._id}`, { method: "DELETE" });
  const gone = await bia.page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll('[data-kind="say"]')].some((b) =>
          b.textContent?.includes("Reunião às 15h"),
        ),
      null,
      { timeout: 3000 },
    )
    .then(
      () => true,
      () => false,
    );
  check("apagar tira o balão na hora (moderação)", gone);

  // 9. Fala de quem não está no mapa (o bot, ou alguém pelo canal): linha perto do campo.
  step("09-fora-do-mapa", "Alguém fora do mapa escreve no canal da sala");
  const botPost = await api(
    `/channels/${ROOM}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content: "Lembrete: a sala fecha às 18h." }),
    },
    "bot",
  );
  if (botPost.status >= 300)
    note(`o bot não pôde escrever (${botPost.status}): passo sem dado`);
  else {
    const fed = await ana.page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("button, div")].some(
            (e) =>
              e.textContent?.includes("Lembrete: a sala fecha") &&
              !e.closest("[data-kind]"),
          ),
        null,
        { timeout: 4000 },
      )
      .then(
        () => true,
        () => false,
      );
    check("aparece perto do campo, no histórico ou numa linha (não some)", fed);
    await shot(ana.page, "linha-fora-do-mapa");
  }

  // 10. Painel do chat: o canal de texto dentro do Espaço.
  step(
    "10-painel",
    "Ana abre o Chat: o canal da sala ao lado do mapa, com o histórico",
  );
  await ana.page.locator("[data-chat-toggle]").first().click();
  await ana.page.waitForSelector('aside[aria-label^="Chat de"]', {
    timeout: 5000,
  });
  await wait(1200);
  const history = await ana.page.evaluate(
    () =>
      document.querySelector('aside[aria-label^="Chat de"]')?.textContent ?? "",
  );
  check(
    "o histórico da sala aparece no painel",
    history.includes("Pessoal, só pra avisar") && history.includes("Bora"),
  );
  const dockGone = await ana.page.evaluate(
    () => !document.querySelector('[data-variant="map"]'),
  );
  check("um campo só na tela (o do mapa some com o painel aberto)", dockGone);
  await focusMap(ana.page);
  await ana.page.keyboard.press("Enter");
  await ana.page.keyboard.type("Mandando pelo painel", { delay: 8 });
  await ana.page.keyboard.press("Enter");
  const fromPanel = await waitBubble(bia.page, "Mandando pelo painel").then(
    () => true,
    () => false,
  );
  check("Enter no mapa foca o campo do painel, e a fala vira balão", fromPanel);
  await shot(ana.page, "painel-aberto");

  // 11. Outra sala pela lista, sem sair do mapa.
  step(
    "11-outra-sala",
    "Ana lê o chat do Cinema pela lista de salas, sem andar até lá",
  );
  await ana.page
    .getByRole("button", { name: /lista de salas/ })
    .first()
    .click();
  await ana.page
    .getByRole("button", { name: /^Chat de Cinema/ })
    .first()
    .click();
  await ana.page.waitForSelector('aside[aria-label="Chat de Cinema"]', {
    timeout: 5000,
  });
  const banner = await ana.page
    .getByText("Você está lendo outra sala")
    .isVisible()
    .catch(() => false);
  check("o painel avisa que é outra sala", banner);
  const panelComposer = ana.page.locator(
    'aside[aria-label="Chat de Cinema"] .cm-content',
  );
  await panelComposer.click();
  await ana.page.keyboard.type("Alguém no cinema?", { delay: 8 });
  await ana.page.keyboard.press("Enter");
  await wait(1200);
  const noBubble = !(await bia.page.evaluate(() =>
    [...document.querySelectorAll('[data-kind="say"]')].some((b) =>
      b.textContent?.includes("Alguém no cinema?"),
    ),
  ));
  check("mensagem para outra sala não vira balão no mapa", noBubble);
  check(
    "ela está no canal do Cinema",
    (await lastMessages(OTHER, 5)).some(
      (m) => m.content === "Alguém no cinema?",
    ),
  );
  await shot(ana.page, "outra-sala");
  await ana.page
    .getByRole("button", { name: /^Voltar para/ })
    .first()
    .click();
  await wait(400);
  const followBack = await ana.page.evaluate(
    () =>
      !!document.querySelector('aside[aria-label^="Chat de"]') &&
      !document.body.textContent.includes("Você está lendo outra sala"),
  );
  check("'Voltar para' devolve o painel à sala de onde ela está", followBack);
  await ana.page.getByRole("button", { name: "Fechar o chat" }).click();

  // 12. Quem fala em outra zona: o sinal sem o texto.
  step(
    "12-outra-zona",
    "Caio sai para o hall e fala lá: a Ana vê só o sinal de conversa",
  );
  const hall = await caio.page.evaluate(() => {
    const h = window.__spaceView.world.map.hall;
    return { x: ((h.x0 + h.x1 + 1) / 2) * 32, y: ((h.y0 + h.y1 + 1) / 2) * 32 };
  });
  await walkTo(caio.page, hall.x, hall.y);
  const caioRoom = (await meOf(caio.page)).room;
  check("Caio está no hall", caioRoom === null, `room=${caioRoom}`);
  await say(caio.page, "Alguém no hall?");
  const hallText = await waitBubble(caio.page, "Alguém no hall?").then(
    () => true,
    () => false,
  );
  check("no hall a fala vira balão para quem está no hall", hallText);
  await wait(800);
  const anaSees = await ana.page.evaluate(() => ({
    text: [...document.querySelectorAll('[data-kind="say"]')].some((b) =>
      b.textContent?.includes("Alguém no hall?"),
    ),
    mark: !!document.querySelector('[data-kind="elsewhere"]'),
  }));
  check("a Ana, na sala, não lê o texto do hall", !anaSees.text);
  note(
    anaSees.mark
      ? "a Ana vê o sinal de conversa sobre o Caio"
      : "o Caio está fora da tela da Ana (sem sinal)",
  );
  await shot(ana.page, "outra-zona");
  await shot(caio.page, "caio-no-hall");

  // 13. Reduzir movimento: a esteira vira texto parado.
  step(
    "13-reduzir-movimento",
    "Bia com 'reduzir movimento' ligado recebe uma mensagem longa",
  );
  await bia.page.emulateMedia({ reducedMotion: "reduce" });
  await bia.page.reload({ waitUntil: "domcontentloaded" });
  await bia.page.waitForFunction(() => !!window.__spaceView?.world?.me, null, {
    timeout: 60_000,
  });
  await wait(1500);
  await say(ana.page, long.replace("Pessoal", "Repetindo"));
  await waitBubble(bia.page, "Repetindo, só pra avisar");
  const reduced = await bia.page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-kind="say"]')].find((x) =>
      x.textContent?.includes("Repetindo"),
    );
    return {
      ticker: b?.hasAttribute("data-ticker"),
      anims: b ? b.getAnimations({ subtree: true }).length : -1,
      more: b?.textContent?.includes("continua no chat"),
    };
  });
  check(
    "sem esteira andando (texto parado, 3 linhas)",
    !reduced.ticker && reduced.anims === 0,
    `animações: ${reduced.anims}`,
  );
  check("o balão avisa que continua no chat", reduced.more);
  await shot(bia.page, "reduzir-movimento");

  // 14. Custo: quadros longos com conversa × sem conversa.
  step(
    "14-custo",
    "Custo na thread principal (a da voz): quadros longos com e sem balões",
  );
  // Espera a tela esvaziar (os balões vencem), e só então mede a janela quieta.
  await ana.page.waitForFunction(
    () => document.querySelector("[data-space-bubbles]")?.children.length === 0,
    null,
    { timeout: 40_000 },
  );
  await readMeters(ana.page);
  await wait(8000);
  const quiet = await readMeters(ana.page);
  for (let i = 0; i < 8; i++) {
    await say([bia, caio][i % 2].page, `mensagem ${i + 1} da rajada`);
    await wait(500);
  }
  await wait(4000);
  const burst = await readMeters(ana.page);
  if (!quiet.loaf) note("o Chromium não mede LoAF aqui");
  else {
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    note(
      `sem balões (8 s): ${quiet.loaf.length} quadros longos, ${sum(quiet.loaf).toFixed(0)} ms; quadros seguindo cabeças ${quiet.heads}, chamadas ao chat ${quiet.emits}`,
    );
    note(
      `rajada de 8 falas (8 s): ${burst.loaf.length} quadros longos, ${sum(burst.loaf).toFixed(0)} ms; quadros seguindo cabeças ${burst.heads}, chamadas ao chat ${burst.emits}`,
    );
    check(
      "a rajada não cria quadro longo acima de 100 ms",
      burst.loaf.every((d) => d < 100),
      `maior: ${Math.max(0, ...burst.loaf).toFixed(0)} ms`,
    );
  }
  check(
    "sem balões e parado, o mapa não segue cabeças nem chama o chat",
    quiet.heads === 0 && quiet.emits === 0,
    `${quiet.heads} quadros, ${quiet.emits} chamadas`,
  );
  check(
    "com balões, o chat só é chamado quando algo se mexe (não a cada quadro)",
    burst.emits < burst.heads / 2,
    `${burst.emits} de ${burst.heads} quadros`,
  );

  // 15. Celular: o chip "Conversar" abre a folha com o teclado.
  step("15-celular", "Caio no celular: Conversar → folha do chat → envia");
  await caio.ctx.close();
  const phone = await openPerson(browser, {
    name: "caio",
    user: STATE.users.caio,
    base: BASE,
    out: OUT,
    device: "phone",
  });
  people.caio = phone;
  await enterSpace(phone);
  await walkToRoom(phone.page, ROOM);
  await shot(phone.page, "celular-mapa");
  const chip = phone.page.getByRole("button", { name: "Conversar" }).first();
  check(
    "o chip Conversar está no pé da tela",
    await chip.isVisible().catch(() => false),
  );
  await chip.tap().catch(() => chip.click());
  await phone.page.waitForSelector('aside[aria-label^="Chat de"]', {
    timeout: 5000,
  });
  await wait(600);
  const focusedOnPhone = await phone.page.evaluate(
    () => !!document.activeElement?.closest(".cm-editor"),
  );
  check("o campo abre com o foco (o teclado sobe)", focusedOnPhone);
  await phone.page.keyboard.type("Cheguei pelo celular", { delay: 10 });
  const send = phone.page.getByRole("button", { name: "Enviar" }).first();
  check(
    "há botão de enviar (no toque, Enter quebra linha)",
    await send.isVisible().catch(() => false),
  );
  await send.tap().catch(() => send.click());
  const phoneBubble = await waitBubble(ana.page, "Cheguei pelo celular").then(
    () => true,
    () => false,
  );
  check("a fala do celular vira balão para a Ana", phoneBubble);
  await shot(phone.page, "celular-folha");
  const sheet = await phone.page.evaluate(() => {
    const a = document
      .querySelector('aside[aria-label^="Chat de"]')
      ?.getBoundingClientRect();
    return a ? { top: a.top, h: a.height, vh: window.innerHeight } : null;
  });
  await wait(600);
  const caioHead = await headOn(phone.page, id.caio);
  check(
    "com a folha aberta, a câmera mostra o Caio acima dela (os balões dele à vista)",
    caioHead && sheet && caioHead.feetY < sheet.top && caioHead.feetY > 40,
    caioHead && sheet
      ? `pé do avatar y=${caioHead.feetY}, folha a partir de ${sheet.top.toFixed(0)}`
      : "",
  );
  await shot(phone.page, "celular-folha-camera");
  check(
    "a folha deixa o topo do mapa à vista (balões continuam visíveis)",
    sheet && sheet.top > sheet.vh * 0.2,
    sheet ? `folha a partir de ${sheet.top.toFixed(0)}px de ${sheet.vh}` : "",
  );

  // 16. Telas: 1280×720 e tablet deitado (painel por cima do mapa).
  step("16-telas", "O mesmo chat em 1280×720 e com o painel em folha (tablet)");
  await ana.page.setViewportSize({ width: 1280, height: 720 });
  await say(bia.page, "Testando numa tela menor");
  await waitBubble(ana.page, "Testando numa tela menor");
  await shot(ana.page, "1280x720");
  await ana.page.setViewportSize({ width: 900, height: 700 });
  await ana.page
    .locator("[data-chat-toggle]")
    .first()
    .click()
    .catch(() => undefined);
  await wait(800);
  await shot(ana.page, "estreito-painel");
  await ana.page.setViewportSize({ width: 1440, height: 900 });

  // 17. O histórico sobre o campo (27/11/2026) e o botão que o oculta até ser clicado de novo.
  step(
    "17-historico",
    "Histórico sobre o campo: a conversa da sala, ao vivo, e o botão de ocultar que vale até clicar de novo",
  );
  const closeChat = ana.page.getByRole("button", { name: "Fechar o chat" });
  if (await closeChat.isVisible().catch(() => false)) await closeChat.click();
  await wait(800);
  const hist = ana.page.locator("[data-space-history]");
  const histShown = () => hist.isVisible().catch(() => false);
  check(
    "o histórico aparece sobre o campo (à vista por padrão)",
    await histShown(),
  );
  await ana.page
    .waitForFunction(
      () =>
        !document
          .querySelector("[data-space-history]")
          ?.textContent?.includes("Carregando"),
      null,
      { timeout: 6000 },
    )
    .catch(() => undefined);
  const histText = (await hist.textContent().catch(() => "")) ?? "";
  check(
    "traz a conversa da sala, também a de antes de abrir (busca no canal)",
    histText.includes("Testando numa tela menor") &&
      histText.includes("Cheguei pelo celular"),
  );
  check(
    "mostra a fala de quem escreveu fora do mapa",
    histText.includes("Lembrete: a sala fecha"),
  );
  await say(bia.page, "Chegou no histórico?");
  const live = await ana.page
    .waitForFunction(
      () =>
        document
          .querySelector("[data-space-history]")
          ?.textContent?.includes("Chegou no histórico?"),
      null,
      { timeout: 4000 },
    )
    .then(
      () => true,
      () => false,
    );
  check("a fala nova entra no histórico na hora", live);
  await wait(400);
  const geo = await ana.page.evaluate(() => {
    const card = document.querySelector("[data-space-history]");
    const scroller = card?.firstElementChild;
    return {
      top: card?.getBoundingClientRect().top ?? 0,
      // column-reverse: 0 é o fim da conversa.
      atEnd: scroller ? Math.abs(scroller.scrollTop) < 4 : false,
    };
  });
  check("o histórico fica no fim da conversa", geo.atEnd);
  const anaHead = await headOn(ana.page, id.ana);
  check(
    "o histórico não cobre o seu avatar",
    anaHead && anaHead.feetY < geo.top,
    anaHead
      ? `pé do avatar y=${anaHead.feetY}, histórico a partir de ${geo.top.toFixed(0)}`
      : "",
  );
  await shot(ana.page, "historico-a-vista");
  await ana.page.locator("[data-history-toggle]").click();
  await wait(300);
  check("o botão oculta o histórico", !(await histShown()));
  await shot(ana.page, "historico-oculto");
  const reloadAna = async () => {
    await ana.page.reload({ waitUntil: "domcontentloaded" });
    await ana.page.waitForFunction(
      () => !!window.__spaceView?.world?.me,
      null,
      {
        timeout: 60_000,
      },
    );
    await wait(2000);
  };
  await reloadAna();
  check(
    "oculto continua oculto depois de recarregar",
    (await ana.page.locator("[data-history-toggle]").count()) > 0 &&
      !(await histShown()),
  );
  await ana.page.locator("[data-history-toggle]").click();
  await wait(400);
  check("clicar de novo mostra o histórico", await histShown());
  await reloadAna();
  check("e ele continua à vista depois de recarregar", await histShown());
} catch (err) {
  console.error(err);
  if (current)
    check("o passo terminou", false, String(err?.message ?? err).slice(0, 300));
  for (const [n, p] of Object.entries(people))
    await p.page
      .screenshot({ path: join(OUT, `erro-${n}.png`) })
      .catch(() => undefined);
} finally {
  for (const [n, p] of Object.entries(people)) {
    const errs = p.logs.filter((l) => l.startsWith("pageerror"));
    if (errs.length) report[`erros-${n}`] = errs.slice(0, 20);
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, "report.html"), html(report));
  const total = steps.flatMap((s) => s.checks);
  const bad = total.filter((c) => !c.ok);
  console.log(
    `\n${total.length - bad.length}/${total.length} verificações ok → ${join(OUT, "report.html")}`,
  );
  await browser.close();
}

function html(r) {
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const all = r.steps.flatMap((s) => s.checks);
  const ok = all.filter((c) => c.ok).length;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Chat do Espaço · laboratório</title>
<style>
:root{color-scheme:dark;--bg:#111118;--card:#1b1b24;--fg:#ecebf3;--mut:#a3a1b3;--ok:#4ade80;--bad:#f87171}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}.sum{color:var(--mut);margin-bottom:20px}
section{background:var(--card);border-radius:12px;padding:16px;margin-bottom:16px}
h2{font-size:15px;margin:0 0 8px}ul{margin:0 0 8px;padding-left:18px}
li.ok::marker{color:var(--ok)}li.bad::marker{color:var(--bad)}li.bad{color:var(--bad)}
.d{color:var(--mut)}.n{color:var(--mut);font-style:italic}
.shots{display:flex;gap:8px;flex-wrap:wrap}.shots img{max-width:min(100%,560px);border-radius:8px;border:1px solid #2c2c38}
</style>
<h1>Chat do Espaço — laboratório de uso</h1>
<div class="sum">Rodada ${esc(r.run)} · ${ok}/${all.length} verificações ok</div>
${r.steps
  .map(
    (s) => `<section><h2>${esc(s.id)} · ${esc(s.title)}</h2><ul>${s.checks
      .map(
        (c) =>
          `<li class="${c.ok ? "ok" : "bad"}">${esc(c.name)} <span class="d">${esc(c.detail)}</span></li>`,
      )
      .join(
        "",
      )}${s.notes.map((n) => `<li class="n">${esc(n)}</li>`).join("")}</ul>
<div class="shots">${s.shots.map((f) => `<a href="${esc(f)}"><img src="${esc(f)}" loading="lazy"></a>`).join("")}</div></section>`,
  )
  .join("")}
</html>`;
}
