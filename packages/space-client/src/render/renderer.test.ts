import assert from "node:assert/strict";
import { test } from "node:test";

import { Renderer } from "./renderer.ts";

// 14/11/2026: closing one space (`app.destroy(true, { texture: true, … })`)
// released PixiJS's module-wide batch pool and the shared decoration textures.
// A second space kept alive for its room audio then crashed on its next render
// ("Cannot read properties of null (reading 'clear')") and the app showed
// "Não foi possível abrir o mapa neste aparelho"; any space opened afterwards
// drew its decoration with destroyed textures.
test("destroy frees only this renderer: no global pools, no shared textures", () => {
  const r = new Renderer();
  const calls: unknown[][] = [];
  (r.app as unknown as { destroy: (...a: unknown[]) => void }).destroy = (...a) => calls.push(a);

  r.destroy();

  assert.equal(calls.length, 1);
  const [rendererOpts, stageOpts] = calls[0]!;
  assert.notEqual(rendererOpts, true, "`true` also releases PixiJS's global resources");
  assert.equal(typeof rendererOpts, "object");
  assert.equal((rendererOpts as { releaseGlobalResources?: boolean }).releaseGlobalResources, false);
  assert.equal((rendererOpts as { removeView?: boolean }).removeView, true);
  assert.notEqual(stageOpts, true, "`true` destroys every child's texture, the shared ones included");
  const s = stageOpts as { texture?: boolean; textureSource?: boolean };
  assert.ok(!s.texture && !s.textureSource, "stage children must not destroy their textures");
});
