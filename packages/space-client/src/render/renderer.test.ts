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

// 15/11/2026: the map rendered every display frame (144 Hz on 144 Hz panels)
// for the whole call, and `overlayGfx.clear()` on every frame made PixiJS
// rebuild the whole stage. Now it presents only when something changed.
function counting(): { r: Renderer; renders: () => number } {
  const r = new Renderer();
  let n = 0;
  (r.app as unknown as { render: () => void }).render = () => {
    n += 1;
  };
  return { r, renders: () => n };
}

type Internals = { present(): void; drawOverlay(): void };

test("present draws once per change and nothing while idle", () => {
  const { r, renders } = counting();
  const i = r as unknown as Internals;
  i.present();
  assert.equal(renders(), 1, "the first frame is owed");
  i.present();
  i.present();
  assert.equal(renders(), 1, "idle frames draw nothing");
  r.invalidate();
  i.present();
  assert.equal(renders(), 2);
  r.setZoom(3);
  i.present();
  assert.equal(renders(), 3, "zoom is a visible change");
});

test("the editor overlay is redrawn only when it is replaced", () => {
  const { r, renders } = counting();
  const i = r as unknown as Internals;
  i.present();
  const closed = { enabled: false, hoverTile: null, zoneRect: null, floorTool: false, ghost: null, selected: null };
  r.overlay = closed;
  i.drawOverlay();
  i.present();
  assert.equal(renders(), 2);
  i.drawOverlay();
  i.present();
  assert.equal(renders(), 2, "same overlay object: no clear, no redraw");
  r.overlay = { ...closed };
  i.drawOverlay();
  i.present();
  assert.equal(renders(), 3);
});

test("a hidden page keeps the frame owed and draws it on return", () => {
  const { r, renders } = counting();
  const i = r as unknown as Internals;
  const g = globalThis as { document?: { hidden: boolean } };
  const had = "document" in g;
  const saved = g.document;
  g.document = { hidden: true };
  try {
    i.present();
    assert.equal(renders(), 0);
    g.document.hidden = false;
    i.present();
    assert.equal(renders(), 1);
  } finally {
    if (had) g.document = saved;
    else delete g.document;
  }
});
