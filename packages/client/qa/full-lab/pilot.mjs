#!/usr/bin/env node
/* global console, process */
/**
 * Piloto do laboratório completo: Ana, Bia e Caio no app de verdade
 * (http://localhost:5173, packages/space-server/lab/full), cada um no seu
 * contexto do Chromium com microfone, câmera e tela FALSOS. Fica de pé e recebe
 * comandos por HTTP em 127.0.0.1:5199, para alguém (ou um script) navegar passo a
 * passo e tirar capturas:
 *
 *   GET  /status
 *   POST /act   {"u":"ana","op":"click","text":"Palco"}          (texto visível)
 *   POST /act   {"u":"ana","op":"click","label":"Ampliar o palco"} (aria-label)
 *   POST /act   {"u":"ana","op":"click","css":"…"} | {"op":"key","key":"F"}
 *   POST /act   {"u":"ana","op":"fill","label":"…","value":"…"}
 *   POST /act   {"u":"ana","op":"goto","path":"/server/…/space"}
 *   POST /act   {"u":"ana","op":"eval","js":"document.title"}
 *   POST /act   {"u":"ana","op":"shot","name":"palco-lateral"}   → out/<n>.png
 *   POST /act   {"u":"ana","op":"size","w":1280,"h":720}
 *   POST /act   {"u":"ana","op":"frame","url":"youtube","js":"document.querySelector('video').currentTime"}
 *
 * As senhas de teste vêm de state.local.json (gerado pela semente) e nunca são
 * impressas. Uso: node qa/full-lab/pilot.mjs [--users ana,bia,caio] [--headed]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const HERE = resolve("qa/full-lab");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const BASE = opt("base", "http://localhost:5173");
const STATE = JSON.parse(
  readFileSync(resolve("../space-server/lab/full/state.local.json"), "utf8"),
);
const names = opt("users", "ana,bia,caio").split(",");

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

/** @type {Record<string, import("@playwright/test").Page>} */
const pages = {};
const logs = {};

async function login(name) {
  const u = STATE.users[name];
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    permissions: ["microphone", "camera"],
    locale: "pt-BR",
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  logs[name] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      logs[name].push(`${m.type()} ${m.text()}`.slice(0, 300));
    if (logs[name].length > 200) logs[name].shift();
  });
  page.on("pageerror", (e) =>
    logs[name].push(`pageerror ${e.message}`.slice(0, 300)),
  );
  await page.goto(`${BASE}/login/auth`, { waitUntil: "domcontentloaded" });
  // Landing card first ("Log In" / "Sign Up"), then the form: email + password
  // (the lab's Stoat has no captcha or email check).
  const email = page
    .locator('input[type="email"], input[name="email"]')
    .first();
  const enter = page.getByText(/^(Log In|Entrar)$/).first();
  const until = Date.now() + 120_000;
  while (!(await email.isVisible().catch(() => false))) {
    if (Date.now() > until) {
      await page.screenshot({ path: join(OUT, `login-falhou-${name}.png`) });
      throw new Error(
        `${name}: formulário de login não apareceu (${page.url()})`,
      );
    }
    if (await enter.isVisible().catch(() => false))
      await enter.click({ timeout: 2_000, force: true }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
  await email.fill(u.email);
  await page.locator('input[type="password"]').first().fill(u.password);
  await page.locator('input[type="password"]').first().press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
  pages[name] = page;
  console.log(`${name}: dentro (${page.url()})`);
}

for (const n of names) await login(n);

async function act(body) {
  const page = pages[body.u];
  if (!page) throw new Error(`usuário desconhecido: ${body.u}`);
  const timeout = body.timeout ?? 10_000;
  switch (body.op) {
    case "goto":
      await page.goto(BASE + body.path, { waitUntil: "domcontentloaded" });
      return page.url();
    case "click": {
      const loc = body.label
        ? page.getByLabel(body.label, { exact: body.exact ?? false })
        : body.role
          ? page.getByRole(body.role, {
              name: body.name,
              exact: body.exact ?? false,
            })
          : body.text
            ? page.getByText(body.text, { exact: body.exact ?? false })
            : page.locator(body.css);
      await loc.nth(body.nth ?? 0).click({ timeout, position: body.position });
      return "ok";
    }
    case "mouse":
      await page.mouse.click(body.x, body.y);
      return "ok";
    case "fill": {
      const loc = body.label
        ? page.getByLabel(body.label)
        : page.locator(body.css);
      await loc.first().fill(body.value, { timeout });
      if (body.enter) await loc.first().press("Enter");
      return "ok";
    }
    case "key":
      await page.keyboard.press(body.key);
      return "ok";
    case "focus":
      await page.locator(body.css).first().focus();
      return "ok";
    case "wait":
      await page.waitForTimeout(body.ms ?? 1000);
      return "ok";
    case "eval":
      return await page.evaluate(body.js);
    case "size":
      await page.setViewportSize({ width: body.w, height: body.h });
      return "ok";
    case "shot": {
      const file = join(OUT, `${body.name ?? `${body.u}-${Date.now()}`}.png`);
      await page.screenshot({ path: file, fullPage: false });
      return file;
    }
    case "frame": {
      // Evaluate inside the first frame whose URL contains body.url (e.g. the
      // YouTube player): cross-origin frames are reachable from Playwright.
      const f = page.frames().find((fr) => fr.url().includes(body.url));
      if (!f) return null;
      return await f.evaluate(body.js);
    }
    case "logs":
      return logs[body.u].slice(-(body.n ?? 30));
    case "text":
      return (
        await page
          .locator(body.css ?? "body")
          .first()
          .innerText()
      ).slice(0, body.max ?? 4000);
    default:
      throw new Error(`op desconhecida: ${body.op}`);
  }
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/status") {
      const st = {};
      for (const [n, p] of Object.entries(pages)) st[n] = p.url();
      res.end(JSON.stringify(st));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const out = await act(JSON.parse(raw));
    res.end(JSON.stringify({ ok: true, out }));
  } catch (e) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        ok: false,
        error: String(e?.message ?? e).slice(0, 800),
      }),
    );
  }
}).listen(5199, "127.0.0.1", () =>
  console.log("piloto pronto em 127.0.0.1:5199"),
);

for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    await browser.close().catch(() => undefined);
    process.exit(0);
  });
