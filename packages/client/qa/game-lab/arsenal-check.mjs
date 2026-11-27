/* global process, console */
// A estante do Arsenal abre o Arsenal (regressão de 27/11/2026).
//
//   node qa/game-lab/arsenal-check.mjs [--base http://127.0.0.1:5192/qa/game-lab/index.html]
//
// Aberto pela estante (modo `arsenal`), o painel do quadro de avisos não busca as novidades; o
// "Carregando os avisos…" vinha antes do Arsenal no Switch e o painel ficava preso nele. Aqui a
// estante abre, o Arsenal aparece (título e lendários), o "Carregando" não, e fecha pelo X.
// Precisa do vite do client no ar (a página do laboratório).
import { chromium } from "@playwright/test";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg("base", "http://127.0.0.1:5192/qa/game-lab/index.html");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
const failures = [];

for (const s of ["estante", "avisos"]) {
  await page.goto(`${BASE}#s=${s}`);
  await page.reload();
  const dialog = page.locator("[role=dialog]").first();
  await dialog.waitFor({ timeout: 20_000 });
  if (s === "avisos") {
    // Pelo quadro: a nota do Arsenal tem o botão que abre o Arsenal ali dentro.
    await dialog.getByRole("button", { name: "Abrir o Arsenal" }).click();
  }
  try {
    await dialog.locator("h3", { hasText: "Arsenal" }).waitFor({ timeout: 10_000 });
    await dialog.locator("h4", { hasText: "Lendários" }).waitFor({ timeout: 5_000 });
  } catch {
    failures.push(`${s}: o Arsenal não apareceu (na tela: "${(await dialog.innerText()).slice(0, 120)}")`);
  }
  if ((await dialog.getByText("Carregando os avisos").count()) > 0)
    failures.push(`${s}: ainda mostra "Carregando os avisos…"`);
  await page.getByRole("button", { name: "Fechar" }).first().click();
  await page.waitForTimeout(300);
  if ((await page.locator("[role=dialog]").count()) > 0) failures.push(`${s}: não fechou pelo X`);
}
if (errors.length) failures.push(`erros na página: ${errors.join(" | ")}`);

await browser.close();
if (failures.length > 0) {
  console.log(`FALHOU (${failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("ok: a estante e o quadro abrem o Arsenal, sem \"Carregando\", e fecham pelo X");
