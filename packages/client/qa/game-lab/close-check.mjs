/* global process, console */
// Fechar as janelas dos NPCs sem quebrar o app (regressão de 27/11/2026).
//
//   node qa/game-lab/close-check.mjs [--base http://127.0.0.1:5192/qa/game-lab/index.html]
//
// O Banqueiro redesenhado lia o estado do herói na limpeza (onCleanup) enquanto a janela era
// descartada; o Solid recalculava ali o Switch que a dona e o limpava duas vezes ("Cannot read
// properties of null (reading '0')" no cleanNode), e a reatividade do app inteiro parava. Aqui
// cada NPC abre, recebe uns cliques, fecha pelo X e por Esc; falha se a página der erro ou se a
// janela continuar na tela. Precisa do vite do client no ar (a página do laboratório).
import { chromium } from "@playwright/test";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg("base", "http://127.0.0.1:5192/qa/game-lab/index.html");

/** Cenários de NPC e o que fazer dentro antes de fechar. */
const CASES = [
  { id: "mercador", act: async () => {} },
  { id: "ferreiro", act: async () => {} },
  { id: "mestre", act: async () => {} },
  {
    id: "banqueiro",
    // Para em cima de um item (abre a dica), clique duplo (vai para o cofre) e troca de aba.
    act: async (p) => {
      const cell = p
        .locator('[aria-label="Itens da mochila"] [role=option]')
        .first();
      await cell.hover();
      await p.waitForTimeout(450);
      await cell.dblclick();
      await p.waitForTimeout(300);
      await p.locator('[role=dialog] [data-tab="ouro"]').first().click();
      await p.locator('[role=dialog] [data-tab="cofre"]').first().click();
    },
  },
  { id: "banqueiro-cheio", act: async () => {} },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));

const dialog = () => page.locator("[role=dialog]");
const failures = [];
/** true: fechou limpo (sem erro e sem janela na tela). */
const check = async (label) => {
  await page.waitForTimeout(400);
  const left = await dialog().count();
  const clean = errors.length === 0 && left === 0;
  if (!clean)
    failures.push(
      `${label}: ${left} janela(s) na tela; erros: ${errors.join(" | ") || "nenhum"}`,
    );
  errors.length = 0;
  return clean;
};

for (const c of CASES) {
  await page.goto(`${BASE}#s=${c.id}`);
  await page.reload();
  await dialog().first().waitFor({ timeout: 20_000 });
  await c.act(page);
  await page.getByRole("button", { name: "Fechar" }).first().click();
  // Travou: a janela ficou por cima de tudo; o resto do caso não dá para fazer.
  if (!(await check(`${c.id} (X)`))) continue;
  // Reabre e fecha por Esc, de dentro da janela.
  await page.locator("button.reopen").click();
  await dialog().first().waitFor({ timeout: 10_000 });
  await c.act(page);
  await dialog().first().locator("h2").focus();
  await page.keyboard.press("Escape");
  await check(`${c.id} (Esc)`);
}

await browser.close();
if (failures.length > 0) {
  console.log(`FALHOU (${failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`ok: ${CASES.length} NPCs fecham pelo X e por Esc sem erro`);
