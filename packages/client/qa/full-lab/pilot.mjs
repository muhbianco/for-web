#!/usr/bin/env node
/* global console, process, URL */
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
 * [--devices caio=phone,ana=tablet] (aparelhos em qa/full-lab/devices.mjs: o
 * contexto ganha a tela, o toque e o user agent do APK, e a ponte MuchatNative).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

import { openPerson } from "./person.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const HERE = resolve("qa/full-lab");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const BASE = opt("base", "http://localhost:5173");
// FULL_LAB_DIR: the lab folder that holds the generated files (.wsl-ip, .keys,
// state.local.json). Set it to run this worktree's code against a lab set up in
// another worktree, without copying its secrets around.
const LAB = process.env.FULL_LAB_DIR ?? resolve("../space-server/lab/full");
const STATE = JSON.parse(readFileSync(join(LAB, "state.local.json"), "utf8"));
const names = opt("users", "ana,bia,caio").split(",");
/** Aparelho de cada pessoa (`--devices caio=phone`); sem a pessoa na lista, o computador. */
const deviceOf = Object.fromEntries(
  (opt("devices", "") || "")
    .split(",")
    .filter(Boolean)
    .map((p) => p.split("=")),
);
// --fake-audio <wav>: the fake mic plays this file (e.g. the voice lab's PT-BR
// reference) instead of Chromium's beep, which DeepFilter removes as noise.
const fakeAudio = opt("fake-audio", undefined);
// --init-script <js>: runs in every page before the app (test hooks that must
// see the first getUserMedia / RTCPeerConnection, e.g. the voice plan check).
const initScript = opt("init-script", undefined);

const browser = await chromium.launch({
  headless: !args.includes("--headed"),
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    ...(fakeAudio
      ? [`--use-file-for-fake-audio-capture=${resolve(fakeAudio)}`]
      : []),
    "--auto-select-desktop-capture-source=Entire screen",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    // --desktop-flags: as chaves do app do PC (muchat/desktop/main.js): composição em software e
    // sem service worker, para reproduzir o que só acontece no Electron.
    // --cdp-port <n>: porta de depuração (pausar em exceção, ler a pilha).
    ...(opt("cdp-port", "") ? [`--remote-debugging-port=${opt("cdp-port", "")}`] : []),
    ...(args.includes("--desktop-flags")
      ? ["--disable-gpu-compositing", "--disable-features=ServiceWorker"]
      : []),
  ],
});

/** @type {Record<string, import("@playwright/test").Page>} */
const pages = {};
const logs = {};

async function login(name) {
  const p = await openPerson(browser, {
    name,
    user: STATE.users[name],
    base: BASE,
    out: OUT,
    device: deviceOf[name],
    initScript,
  });
  pages[name] = p.page;
  logs[name] = p.logs;
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
      // count 2: clique duplo de verdade (dblclick).
      await page.mouse.click(body.x, body.y, { clickCount: body.count ?? 1 });
      return "ok";
    case "hover":
      // Mouse parado em cima (abre a dica de item depois de 300 ms).
      await page.mouse.move(body.x, body.y, { steps: 4 });
      return "ok";
    case "tap":
      // Toque de verdade (touchstart/touchend), como no celular.
      await page.touchscreen.tap(body.x, body.y);
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
      // `clip` ({x, y, width, height}) recorta um pedaço da tela para ver de perto.
      await page.screenshot({ path: file, fullPage: false, clip: body.clip });
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
