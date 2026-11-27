/* global process, console */
// O detalhe da skill mostra o perk lendário que a fortalece (27/11/2026).
//
//   node qa/game-lab/perk-tip-check.mjs [--base http://127.0.0.1:5192/qa/game-lab/index.html] [--shots pasta]
//
// Na ficha (aba Habilidades) e na barra da corrida, com o mago 45 de perks vestidos (cenários
// "ficha-perks" e "corrida-perks"): o detalhe da 1ª skill dos slots tem de mostrar a seção
// "Fortalecida por lendário" com os itens e pelo menos uma diferença marcada (número ou frase do
// perk). Com --shots, salva uma captura de cada. Precisa do vite do client no ar.
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

/** Para em cima do alvo e devolve o cartão da skill aberto. */
async function tipOf(target) {
  await target.hover();
  const card = page.locator("text=Fortalecida por lendário").first();
  try {
    await card.waitFor({ timeout: 4000 });
  } catch {
    return null;
  }
  return card;
}

async function check(label, open) {
  await open();
  const card = await tipOf(await open.target());
  if (!card) {
    failures.push(`${label}: o detalhe não mostra "Fortalecida por lendário"`);
    return;
  }
  const deltas = await page.locator("li[data-kind=changed], li[data-kind=added]").count();
  if (deltas === 0) failures.push(`${label}: nenhuma frase marcada como fortalecida`);
  const sources = await page.locator("text=/saiu .*/").count();
  if (sources === 0) failures.push(`${label}: os itens do perk não aparecem`);
  console.log(
    `${label}: ${deltas} frase(s) marcada(s), ${sources} origem(ns) de perk`,
  );
  if (SHOTS) {
    // Depois da entrada do detalhe, só a caixa dele (e a tela inteira, para o contexto).
    await page.waitForTimeout(700);
    const tip = page.locator("[role=tooltip]").first();
    await tip.screenshot({ path: `${SHOTS}/${label}-detalhe.png` });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
    await page.waitForTimeout(2000);
    console.log(`  ${label}: o detalhe continua aberto 2 s depois? ${(await tip.count()) > 0 && (await tip.isVisible())}`);
  }
}

// Ficha: aba Habilidades, a 1ª skill dos slots.
const ficha = async () => {
  await page.goto(`${BASE}#s=ficha-perks`);
  await page.reload();
  await page.getByRole("tab", { name: "Habilidades" }).click();
};
ficha.target = async () =>
  page.locator('[aria-label="Slots da corrida"] button').first();
await check("ficha", ficha);

// O Escudo de Mana, 3ª skill dos slots (o perk muda um número, não acrescenta frase).
const ficha3 = async () => ficha();
ficha3.target = async () =>
  page
    .locator('[aria-label="Slots da corrida"]')
    .getByRole("button", { name: "Escudo de Mana" });
await check("ficha-3a-skill", ficha3);

// Corrida: a barra de habilidades do herói.
const corrida = async () => {
  await page.goto(`${BASE}#s=corrida-perks`);
  await page.reload();
  await page.locator('[aria-label^="Habilidades de"]').first().waitFor({ timeout: 20000 });
};
corrida.target = async () =>
  page.locator('[aria-label^="Habilidades de"] > *').first();
await check("corrida", corrida);

await browser.close();
if (errors.length) failures.push(`erros na página: ${errors.join(" | ")}`);
if (failures.length > 0) {
  console.log(`FALHOU (${failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("ok: o detalhe da skill mostra o perk e o que ele muda, na ficha e na corrida");
