import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

// Dev page for the space view against the local dev space server
// (packages/space-server/src/dev.ts). Same paths as production thanks to the
// proxy: /_muchat/space/* → the space server with the prefix cut, like Caddy.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: {
      "/_muchat/space": {
        target: "http://127.0.0.1:8095",
        ws: true,
        rewrite: (p) => p.replace(/^\/_muchat\/space/, ""),
      },
    },
  },
});
