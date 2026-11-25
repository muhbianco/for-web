import assert from "node:assert/strict";
import test from "node:test";

import { TIP_GAP, TIP_MARGIN, placeTip } from "./tipMath.ts";

const desktop = { w: 1280, h: 820 };
const phone = { w: 393, h: 852 };
const tip = { w: 300, h: 360 };
const box = (left: number, top: number, size = 56) => ({
  left,
  top,
  right: left + size,
  bottom: top + size,
});

/** O detalhe nunca cobre o item: os dois retângulos não se cruzam. */
const overlaps = (
  a: ReturnType<typeof box>,
  p: { left: number; top: number },
  s: { w: number; h: number },
) =>
  !(
    p.left >= a.right ||
    p.left + s.w <= a.left ||
    p.top >= a.bottom ||
    p.top + s.h <= a.top
  );

const inside = (
  p: { left: number; top: number },
  s: { w: number; h: number },
  v: typeof desktop,
) =>
  p.left >= TIP_MARGIN &&
  p.top >= TIP_MARGIN &&
  p.left + s.w <= v.w - TIP_MARGIN &&
  p.top + s.h <= v.h - TIP_MARGIN;

test("com espaço, abre à direita do item, alinhado pelo topo", () => {
  const a = box(400, 200);
  const p = placeTip(a, tip, desktop);
  assert.equal(p.side, "right");
  assert.equal(p.left, a.right + TIP_GAP);
  assert.equal(p.top, a.top);
  assert.ok(!overlaps(a, p, tip));
});

test("perto da borda direita, abre à esquerda", () => {
  const a = box(1100, 200);
  const p = placeTip(a, tip, desktop);
  assert.equal(p.side, "left");
  assert.equal(p.left + tip.w, a.left - TIP_GAP);
  assert.ok(inside(p, tip, desktop));
  assert.ok(!overlaps(a, p, tip));
});

test("item lá embaixo: o detalhe sobe só o necessário para caber", () => {
  const a = box(400, 760);
  const p = placeTip(a, tip, desktop);
  assert.equal(p.side, "right");
  assert.equal(p.top, desktop.h - TIP_MARGIN - tip.h);
  assert.ok(inside(p, tip, desktop));
});

test("no celular não cabe dos lados: vai embaixo, centrado e preso à tela", () => {
  const a = box(60, 120);
  const p = placeTip(a, tip, phone);
  assert.equal(p.side, "below");
  assert.equal(p.top, a.bottom + TIP_GAP);
  assert.equal(p.left, TIP_MARGIN);
  assert.ok(inside(p, tip, phone));
  assert.ok(!overlaps(a, p, tip));
});

test("no celular, item embaixo da tela: o detalhe abre em cima", () => {
  const a = box(200, 700);
  const p = placeTip(a, tip, phone);
  assert.equal(p.side, "above");
  assert.equal(p.top + tip.h, a.top - TIP_GAP);
  assert.ok(inside(p, tip, phone));
  assert.ok(!overlaps(a, p, tip));
});

test("sem espaço inteiro em lugar nenhum: o lado com mais espaço, com a altura cortada", () => {
  const tall = { w: 300, h: 700 };
  const a = box(200, 400);
  const p = placeTip(a, tall, phone);
  const room =
    p.side === "below"
      ? phone.h - TIP_MARGIN - (a.bottom + TIP_GAP)
      : a.top - TIP_GAP - TIP_MARGIN;
  assert.equal(p.maxHeight, room);
  const shown = { w: tall.w, h: Math.min(tall.h, p.maxHeight) };
  assert.ok(inside(p, shown, phone));
  assert.ok(!overlaps(a, p, shown));
});

test("detalhe mais alto que a tela, de lado: cola no topo e a altura é a da tela", () => {
  const tall = { w: 300, h: 2000 };
  const p = placeTip(box(400, 300), tall, desktop);
  assert.equal(p.side, "right");
  assert.equal(p.top, TIP_MARGIN);
  assert.equal(p.maxHeight, desktop.h - 2 * TIP_MARGIN);
});
