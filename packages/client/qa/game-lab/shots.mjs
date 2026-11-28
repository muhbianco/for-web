/* global process, console */
// Capturas das telas do Idle Hunt v5 no laboratório (qa/game-lab), em desktop e celular.
//
//   node qa/game-lab/shots.mjs --out <pasta> [--base http://127.0.0.1:5191/qa/game-lab/index.html] [--only ficha]
//
// Precisa do vite do client no ar (a página do laboratório). "Reduzir movimento" ligado: a foto
// não pega animação no meio, e a cena da corrida fica no quadro parado (`speed=0`).
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg("base", "http://127.0.0.1:5191/qa/game-lab/index.html");
const OUT = arg("out", "qa/game-lab/out");
const ONLY = arg("only", "");

const DEVICES = {
  desktop: { viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 },
  celular: {
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

const tab = (id) => async (p) => {
  await p.locator(`[role=dialog] [data-tab="${id}"]`).first().click();
};
const first = (sel) => async (p) => {
  await p.locator(sel).first().click();
};
const text = (role, name) => async (p) => {
  await p.getByRole(role, { name }).first().click();
};
const seq =
  (...fns) =>
  async (p) => {
    for (const f of fns) {
      await f(p);
      await p.waitForTimeout(250);
    }
  };
const scrollTo = (sel) => async (p) => {
  await p
    .locator(sel)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
};

/**
 * Arrasta a janela pela alça (a barra do título) com o mouse. No celular a janela não tem alça
 * (é folha de baixo): não faz nada, e a captura mostra que ficou no lugar.
 */
const drag = (dx, dy) => async (p) => {
  const bar = p.locator("[data-draggable]").first();
  if ((await bar.count()) === 0) return;
  const box = await bar.boundingBox();
  if (!box) return;
  // Um ponto da barra fora de botões: o meio do título.
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 20);
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await p.mouse.move(x + dx, y + dy, { steps: 4 });
  await p.mouse.up();
};

/**
 * Abre o detalhe do item (ItemTip): no desktop, o mouse parado em cima; no celular, o toque longo
 * (o dedo fica no item: o detalhe só fecha no próximo toque).
 */
const tipOn =
  (sel, n = 0) =>
  async (p) => {
    const el = p.locator(sel).nth(n);
    await el.scrollIntoViewIfNeeded();
    if ((p.viewportSize()?.width ?? 1280) > 600) {
      await el.hover();
    } else {
      await el.evaluate((node) => {
        const b = node.getBoundingClientRect();
        node.dispatchEvent(
          new globalThis.PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerType: "touch",
            pointerId: 1,
            isPrimary: true,
            clientX: b.left + b.width / 2,
            clientY: b.top + b.height / 2,
          }),
        );
      });
    }
    await p.waitForTimeout(800);
  };

const SHOTS = [
  { name: "01-novo-aviso", s: "novo" },
  {
    name: "02-novo-escolha",
    s: "novo",
    act: seq(text("button", /Feiticeiro|Mago/), scrollTo("[aria-live=polite]")),
  },
  { name: "03-nivel1", s: "nivel1", act: tab("equip") },
  {
    name: "04-ficha-equipamento",
    s: "ficha",
    act: seq(tab("equip"), first("[role=dialog] [role=listitem]")),
  },
  {
    name: "05-ficha-equipamento-detalhe",
    s: "ficha",
    act: seq(
      tab("equip"),
      first("[role=dialog] [role=listitem]"),
      scrollTo("[aria-label='Se vestir']"),
    ),
  },
  {
    name: "06-ficha-cinto",
    s: "ficha",
    act: seq(tab("equip"), scrollTo("[aria-label='Cinto']")),
  },
  {
    name: "07-ficha-atributos",
    s: "ficha",
    act: seq(
      tab("attrs"),
      text("button", /Subir VIT: o próximo/),
      text("button", /Subir VIT: o próximo/),
    ),
  },
  {
    name: "08-ficha-atributos-monstros",
    s: "ficha",
    act: seq(
      tab("attrs"),
      text("button", /Subir INT: o próximo/),
      scrollTo("table"),
    ),
  },
  { name: "09-ficha-habilidades", s: "ficha", act: tab("skills") },
  {
    name: "10-ficha-habilidades-ia",
    s: "ficha",
    act: seq(tab("skills"), text("button", /^Editar$/), scrollTo("select")),
  },
  { name: "11-mercador-pocoes", s: "mercador" },
  { name: "12-mercador-equipamento", s: "mercador", act: tab("itens") },
  {
    name: "13-mercador-vender",
    s: "mercador",
    act: seq(tab("vender"), first("[role=dialog] [role=option]"), (p) =>
      p.locator("[role=dialog] [role=option]").nth(3).click(),
    ),
  },
  { name: "14-mercador-municao", s: "mercador-cacador", act: tab("municao") },
  {
    name: "15-ferreiro-refinar",
    s: "ferreiro",
    act: seq(
      first("[role=dialog] [role=option]"),
      scrollTo("[role=dialog] [role=option][aria-selected=true]"),
    ),
  },
  {
    name: "16-ferreiro-desmontar",
    s: "ferreiro",
    act: seq(tab("desmontar"), first("[role=dialog] [role=option]")),
  },
  { name: "17-mula", s: "banqueiro" },
  { name: "18-bau", s: "bau" },
  {
    name: "19-mula-transferir",
    s: "banqueiro",
    act: seq(
      (p) =>
        p.locator("[role=dialog] select").first().selectOption({ index: 1 }),
      first("[role=dialog] [role=option]"),
    ),
  },
  { name: "20-mestre", s: "mestre" },
  { name: "21-mestre-evoluir", s: "mestre-evoluir" },
  { name: "22-dojo", s: "dojo" },
  { name: "23-tv-apps", s: "tv" },
  { name: "24-tv-catalogo", s: "tv", act: first("[data-app=idle]") },
  { name: "25-tv-meu-grupo", s: "tv-grupo", act: first("[data-app=idle]") },
  { name: "26-corrida-sala", s: "corrida&speed=0" },
  { name: "27-corrida-chefe-cataclismo", s: "corrida-chefe&speed=0" },
  { name: "28-corrida-fim", s: "corrida-fim&speed=0" },
  { name: "29-mapa-faixas", s: "mapa", act: (p) => p.keyboard.press("Escape") },
  // Janelas arrastáveis (25/11/2026): a alça na barra, a janela solta no canto (presa à área).
  { name: "30-janela-mestre-arrastada", s: "mestre", act: drag(-400, 300) },
  { name: "31-janela-ficha-arrastada", s: "ficha", act: drag(500, -200) },
  {
    name: "32-janela-corrida-arrastada",
    s: "corrida&speed=0",
    act: drag(-200, -300),
  },
  { name: "33-janela-avisos", s: "avisos" },
  { name: "34-janela-avisos-arrastada", s: "avisos", act: drag(300, 200) },
  // O detalhe do item ao parar em cima (25/11/2026): cada tela que mostra item.
  {
    name: "35-tip-bau",
    s: "bau",
    act: tipOn("[role=dialog] [role=option]", 0),
  },
  {
    name: "36-tip-bau-mochila",
    s: "bau",
    act: tipOn("[role=dialog] [role=option]", 22),
  },
  {
    name: "37-tip-transferir",
    s: "banqueiro",
    act: tipOn("[role=dialog] [role=option]", 3),
  },
  {
    name: "38-tip-ficha-mochila",
    s: "ficha",
    act: seq(tab("equip"), tipOn("[role=dialog] [role=listitem]", 4)),
  },
  {
    name: "39-tip-ficha-vestido",
    s: "ficha",
    act: seq(
      tab("equip"),
      tipOn("[role=dialog] [aria-pressed][aria-label^='Arma']"),
    ),
  },
  {
    name: "40-tip-mercador-vender",
    s: "mercador",
    act: seq(tab("vender"), tipOn("[role=dialog] [role=option]", 6)),
  },
  {
    name: "41-tip-ferreiro",
    s: "ferreiro",
    act: tipOn("[role=dialog] [role=option]", 2),
  },
  {
    name: "42-tip-corrida-fim",
    s: "corrida-fim&speed=0",
    act: tipOn("[data-covers-map] [role=img][tabindex='0']", 0),
  },
  // O detalhe da skill ao parar em cima (25/11/2026): a lista e os slots da ficha, a barra da corrida.
  {
    name: "43-skill-ficha-lista",
    s: "ficha",
    act: seq(
      tab("skills"),
      tipOn("[aria-label='Skills da classe'] button[aria-pressed]", 2),
    ),
  },
  {
    name: "44-skill-ficha-slot",
    s: "ficha",
    act: seq(
      tab("skills"),
      tipOn("[aria-label='Slots da corrida'] button:not([aria-label])", 3),
    ),
  },
  {
    name: "45-skill-corrida",
    s: "corrida-chefe&speed=0",
    act: tipOn("ul[aria-label^='Habilidades'] > li", 2),
  },
  // A escolha de DG na TV (26/11/2026): recomendadas, catálogo com "Concluída", detalhe com as chances.
  {
    name: "46-dg-catalogo-regiao",
    s: "tv",
    act: seq(first("[data-app=idle]"), scrollTo("[aria-expanded=true]")),
  },
  {
    name: "47-dg-detalhe-masmorra",
    s: "tv",
    act: seq(first("[data-app=idle]"), first("button[data-kind=masmorra]")),
  },
  {
    name: "48-dg-detalhe-de-onde-vem",
    s: "tv",
    act: seq(
      first("[data-app=idle]"),
      first("button[data-kind=masmorra]"),
      first("[role=dialog] details > summary"),
      scrollTo("[role=dialog] details"),
    ),
  },
  {
    name: "49-dg-chefe-trancado",
    s: "tv",
    act: seq(first("[data-app=idle]"), first("button[data-kind=regional]")),
  },
  { name: "50-dg-chefe-grupo", s: "tv-chefe", act: first("[data-app=idle]") },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let n = 0;
const fails = [];
for (const [dev, opts] of Object.entries(DEVICES)) {
  const ctx = await browser.newContext({
    ...opts,
    reducedMotion: "reduce",
    colorScheme: "dark",
    locale: "pt-BR",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const shot of SHOTS) {
    if (ONLY && !shot.name.includes(ONLY)) continue;
    try {
      await page.goto(`${BASE}#s=${shot.s}`, { waitUntil: "load" });
      // Roda na página (Playwright); o eslint do CI lê este .mjs como Node, daí o globalThis.
      await page.evaluate(() => globalThis.localStorage.clear());
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector("[role=dialog], .chips", { timeout: 15000 });
      await page.waitForTimeout(900);
      if (shot.act) await shot.act(page);
      await page.waitForTimeout(700);
      const file = join(OUT, `${shot.name}-${dev}.png`);
      await page.screenshot({ path: file });
      n++;
      console.log("ok", file);
    } catch (e) {
      fails.push(`${shot.name}-${dev}: ${String(e).split("\n")[0]}`);
      console.log("FALHOU", shot.name, dev, String(e).split("\n")[0]);
    }
  }
  if (errors.length)
    console.log(`erros de página (${dev}):`, errors.slice(0, 5));
  await ctx.close();
}
await browser.close();
console.log(`${n} capturas; ${fails.length} falhas`);
if (fails.length) process.exitCode = 1;
