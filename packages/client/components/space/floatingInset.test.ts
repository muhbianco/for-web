import assert from "node:assert/strict";
import test from "node:test";

import { floatingInset } from "./floatingInset.ts";

const viewport = { width: 1600, height: 900 };

test("sem painel, o card fica onde sempre ficou", () => {
  const grid = { right: 1600, bottom: 900, height: 852 };
  assert.deepEqual(
    floatingInset({
      narrow: false,
      sideWidthPx: 0,
      panelRowPct: 0,
      grid,
      viewport,
    }),
    { right: 0, bottom: 0 },
  );
  assert.deepEqual(
    floatingInset({
      narrow: true,
      sideWidthPx: 0,
      panelRowPct: 0,
      grid,
      viewport,
    }),
    { right: 0, bottom: 0 },
  );
});

test("tela larga: o card sai da coluna do painel (salas, decoração, Refúgio)", () => {
  const grid = { right: 1600, bottom: 900, height: 852 };
  for (const side of [280, 340, 424]) {
    assert.deepEqual(
      floatingInset({
        narrow: false,
        sideWidthPx: side,
        panelRowPct: 55,
        grid,
        viewport,
      }),
      { right: side, bottom: 0 },
    );
  }
});

test("tela larga: o que fica à direita da página também conta", () => {
  const grid = { right: 1500, bottom: 900, height: 852 };
  assert.deepEqual(
    floatingInset({
      narrow: false,
      sideWidthPx: 424,
      panelRowPct: 0,
      grid,
      viewport,
    }),
    { right: 524, bottom: 0 },
  );
});

test("tela estreita: o card sobe acima da faixa do painel", () => {
  const phone = { width: 375, height: 812 };
  const grid = { right: 375, bottom: 812, height: 700 };
  assert.deepEqual(
    floatingInset({
      narrow: true,
      sideWidthPx: 424,
      panelRowPct: 55,
      grid,
      viewport: phone,
    }),
    { right: 0, bottom: 385 },
  );
  assert.deepEqual(
    floatingInset({
      narrow: true,
      sideWidthPx: 280,
      panelRowPct: 40,
      grid,
      viewport: phone,
    }),
    { right: 0, bottom: 280 },
  );
});

test("nunca negativo (grade maior que a janela durante um resize)", () => {
  const grid = { right: 1700, bottom: 1000, height: 1000 };
  assert.deepEqual(
    floatingInset({
      narrow: false,
      sideWidthPx: 50,
      panelRowPct: 0,
      grid,
      viewport,
    }),
    { right: 0, bottom: 0 },
  );
});
