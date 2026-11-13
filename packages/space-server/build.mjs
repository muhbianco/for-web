// Bundles the space server into one CommonJS file for the container image.
//
// Why a bundle: @muchat/space-core is TypeScript source, and Node only strips
// types outside node_modules; in the image it would land inside node_modules.
// Bundling also leaves the runtime image without node_modules or pnpm.
// Optional native add-ons of the drivers (kerberos, snappy, bufferutil, …)
// are required inside try/catch by those drivers; esbuild leaves them out and
// they load as "not installed", exactly as in a plain npm install.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "dist/main.cjs",
  sourcemap: "linked",
  legalComments: "eof",
  logLevel: "info",
});
