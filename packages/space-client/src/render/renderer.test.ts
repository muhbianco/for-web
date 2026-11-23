import assert from "node:assert/strict";
import { test } from "node:test";

import { Graphics } from "pixi.js";

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

// 23/11/2026: whoever shares a screen broadcasts on the map (liveFx.ts). The map is drawn
// on demand to leave the CPU to the call, so the animation has a ceiling: at most one
// frame every LIVE_FRAME_MS while a sharer is in view, none otherwise.
type LiveInternals = Internals & {
  animateLive(nowMs: number): void;
  avatars: Map<string, unknown>;
  view: { x0: number; y0: number; x1: number; y1: number };
  reducedMotion: boolean;
};

function sharer(x: number, y: number) {
  return {
    sharing: true,
    liveStill: true,
    badged: false,
    seed: 7,
    liveTag: null,
    live: new Graphics(),
    screen: new Graphics(),
    root: { position: { x, y } },
  };
}

function oneSecond(i: LiveInternals, from = 0) {
  for (let t = from; t <= from + 1000; t += 1000 / 60) {
    i.animateLive(t);
    i.present();
  }
}

test("a sharer in view moves at most 20 times a second; out of view or gone, no frame", () => {
  const { r, renders } = counting();
  const i = r as unknown as LiveInternals;
  Object.assign(i.view, { x0: -500, y0: -500, x1: 500, y1: 500 });
  i.present();
  const a = sharer(0, 0);
  i.avatars.set("u1", a);
  let before = renders();
  oneSecond(i);
  const frames = renders() - before;
  assert.ok(frames >= 18 && frames <= 21, `${frames} frames in a second`);

  a.root.position = { x: 5000, y: 0 };
  before = renders();
  oneSecond(i, 2000);
  assert.equal(renders(), before, "out of view: nothing to draw");

  a.root.position = { x: 0, y: 0 };
  a.sharing = false;
  before = renders();
  oneSecond(i, 4000);
  assert.equal(renders(), before, "nobody sharing: the map stays still");
});

test("reduced motion: the sharer is one still picture, drawn once", () => {
  const { r, renders } = counting();
  const i = r as unknown as LiveInternals;
  Object.assign(i.view, { x0: -500, y0: -500, x1: 500, y1: 500 });
  i.reducedMotion = true;
  i.present();
  const a = sharer(0, 0);
  a.liveStill = false;
  i.avatars.set("u1", a);
  const before = renders();
  oneSecond(i);
  assert.equal(renders() - before, 1);
  assert.equal(a.liveStill, true);
});
