// Empacota a página do laboratório da fase 3 (e2e/spacePage.ts → www/space-lab.js).
// Rode na raiz do for-web antes de construir o harness: pnpm --filter @muchat/space-server lab:bundle
import { build } from "esbuild";

await build({
  entryPoints: [new URL("./e2e/spacePage.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  outfile: new URL("./www/space-lab.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  logLevel: "info",
});
