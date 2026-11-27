/* global process, console */
// A penalidade da armadura um peso acima fica evidente (27/11/2026, o dono: "o único lugar que eu vi
// foi no Arsenal").
//
//   node qa/game-lab/overweight-check.mjs [--base http://127.0.0.1:5192/qa/game-lab/index.html] [--shots pasta]
//
// 1) Na ficha do mago 45 ("ficha-perks"), a armadura média da mochila (um peso acima do mago): a dica
//    do item tem o aviso com velocidade, recarga e MATQ.
// 2) No Arsenal (estante), o ◐ da tabela "Quem usa o quê" tem a legenda com os mesmos números.
// Precisa do vite do client no ar.
import { chromium } from "@playwright/test";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg("base", "http://127.0.0.1:5192/qa/game-lab/index.html");
const SHOTS = arg("shots", "");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
const failures = [];
const PENALTY = /−4% de velocidade de ataque, −4% de recarga e −7,5% de MATQ/;

// 1) A dica do item.
await page.goto(`${BASE}#s=ficha-perks`);
await page.reload();
await page.getByRole("tab", { name: /Equipamento/ }).click();
const cell = page.locator('[aria-label="Mochila"] [aria-label^="Épico Armadura +7"]').first();
await cell.waitFor({ timeout: 20000 });
await cell.hover();
const tip = page.locator("[role=tooltip]").first();
await tip.waitFor({ timeout: 5000 });
await page.waitForTimeout(600);
const tipText = await tip.innerText();
if (!/um peso acima do da sua classe/.test(tipText) || !PENALTY.test(tipText))
  failures.push(`dica do item sem a penalidade: "${tipText.slice(0, 160)}"`);
else console.log("dica do item: aviso do peso acima com velocidade, recarga e MATQ");
if (SHOTS) await tip.screenshot({ path: `${SHOTS}/peso-acima-dica.png` });

// 2) O Arsenal.
await page.goto(`${BASE}#s=estante`);
await page.reload();
const legend = page.getByText(/◐ veste um peso acima/).first();
await legend.waitFor({ timeout: 20000 });
const legendText = await legend.innerText();
if (!PENALTY.test(legendText)) failures.push(`legenda do Arsenal sem os números: "${legendText}"`);
else console.log("Arsenal: legenda do ◐ com os números");
if (SHOTS) {
  await legend.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 140);
  await page.waitForTimeout(300);
  await page.locator("[role=dialog]").first().screenshot({ path: `${SHOTS}/peso-acima-arsenal.png` });
}

await browser.close();
if (errors.length) failures.push(`erros na página: ${errors.join(" | ")}`);
if (failures.length > 0) {
  console.log(`FALHOU (${failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("ok: a penalidade do peso acima aparece na dica do item e no Arsenal");
