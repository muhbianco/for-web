/* global console, URL */
/**
 * Uma pessoa do laboratório completo num contexto próprio do Chromium, já dentro do
 * app (login pelo formulário, como gente). Usado pelo piloto e pelo roteiro de
 * celular e tablet. As senhas de teste vêm de state.local.json e nunca são impressas.
 */
import { join, resolve } from "node:path";

import { deviceContext, fakeBridge, isAppDevice } from "./devices.mjs";

/**
 * @param {import("@playwright/test").Browser} browser
 * @param {{ name: string, user: { email: string, password: string }, base: string,
 *   out: string, device?: string, initScript?: string }} o
 */
export async function openPerson(browser, o) {
  const device = o.device ?? "desktop";
  const ctx = await browser.newContext({
    ...deviceContext(device),
    permissions: ["microphone", "camera"],
    locale: "pt-BR",
    colorScheme: "dark",
  });
  if (isAppDevice(device)) await ctx.addInitScript(fakeBridge);
  if (o.initScript) await ctx.addInitScript({ path: resolve(o.initScript) });
  // The test passwords must never leave the lab: a build made without the lab's
  // VITE_API_URL talks to the public Stoat (api.stoat.chat) and would send them
  // there (it happened on 22/11/2026). Any /auth/ call to a non-local host is
  // aborted before it goes out.
  const blockedAuth = [];
  await ctx.route("**/auth/**", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "localhost" || host === "127.0.0.1") return route.continue();
    blockedAuth.push(host);
    return route.abort("blockedbyclient");
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      logs.push(`${m.type()} ${m.text()}`.slice(0, 300));
    if (logs.length > 200) logs.shift();
  });
  page.on("pageerror", (e) =>
    logs.push(`pageerror ${e.message}`.slice(0, 300)),
  );
  await page.goto(`${o.base}/login/auth`, { waitUntil: "domcontentloaded" });
  // Landing card first ("Log In" / "Sign Up"), then the form: email + password
  // (the lab's Stoat has no captcha or email check).
  const email = page
    .locator('input[type="email"], input[name="email"]')
    .first();
  const enter = page.getByText(/^(Log In|Entrar)$/).first();
  const until = Date.now() + 120_000;
  while (!(await email.isVisible().catch(() => false))) {
    if (Date.now() > until) {
      await page.screenshot({
        path: join(o.out, `login-falhou-${o.name}.png`),
      });
      throw new Error(
        `${o.name}: formulário de login não apareceu (${page.url()})`,
      );
    }
    if (await enter.isVisible().catch(() => false))
      await enter.click({ timeout: 2_000, force: true }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
  await email.fill(o.user.email);
  await page.locator('input[type="password"]').first().fill(o.user.password);
  await page.locator('input[type="password"]').first().press("Enter");
  // The first load of the dev server compiles for a while: wait long.
  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 120_000,
    })
    .catch(async (e) => {
      await page.screenshot({
        path: join(o.out, `login-falhou-${o.name}.png`),
      });
      if (blockedAuth.length)
        throw new Error(
          `${o.name}: o app chamou ${blockedAuth[0]} em vez do laboratório (build sem VITE_API_URL do laboratório?); o login foi bloqueado antes de sair`,
        );
      throw e;
    });
  console.log(`${o.name} (${device}): dentro (${page.url()})`);
  return { ctx, page, logs, device };
}
