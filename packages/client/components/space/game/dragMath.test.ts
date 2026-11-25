import assert from "node:assert/strict";
import test from "node:test";

import {
  BIG_STEP,
  EDGE,
  STEP,
  clampOffset,
  keyStep,
  loadOffset,
  saveOffset,
} from "./dragMath.ts";

// A área do mapa (sem a barra lateral) e uma janela centralizada nela.
const area = { left: 220, top: 0, right: 1280, bottom: 820 };
const win = { left: 500, top: 100, right: 1000, bottom: 700 };

test("o deslocamento dentro da área passa como veio", () => {
  assert.deepEqual(clampOffset({ x: 30, y: -40 }, win, area), {
    x: 30,
    y: -40,
  });
});

test("a janela não sai da área por nenhum lado (com a folga da borda)", () => {
  assert.deepEqual(clampOffset({ x: -900, y: -900 }, win, area), {
    x: area.left + EDGE - win.left,
    y: area.top + EDGE - win.top,
  });
  assert.deepEqual(clampOffset({ x: 900, y: 900 }, win, area), {
    x: area.right - EDGE - win.right,
    y: area.bottom - EDGE - win.bottom,
  });
});

test("janela maior que a área fica presa pelo canto de cima à esquerda (a alça não some)", () => {
  const big = { left: 200, top: -20, right: 1400, bottom: 900 };
  const o = clampOffset({ x: 500, y: 500 }, big, area);
  assert.equal(big.left + o.x, area.left + EDGE);
  assert.equal(big.top + o.y, area.top + EDGE);
});

test("as setas viram passos; Shift dá o passo maior; outra tecla não move", () => {
  assert.deepEqual(keyStep("ArrowLeft", false), { x: -STEP, y: 0 });
  assert.deepEqual(keyStep("ArrowRight", true), { x: BIG_STEP, y: 0 });
  assert.deepEqual(keyStep("ArrowUp", false), { x: 0, y: -STEP });
  assert.deepEqual(keyStep("ArrowDown", true), { x: 0, y: BIG_STEP });
  assert.equal(keyStep("Enter", false), null);
});

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

test("o lugar fica guardado por janela, arredondado; voltar ao lugar apaga a chave", () => {
  const store = memoryStore();
  saveOffset("rpg-run", { x: 12.6, y: -40.2 }, store);
  saveOffset("rpg-npc-mestre", { x: -5, y: 7 }, store);
  assert.deepEqual(loadOffset("rpg-run", store), { x: 13, y: -40 });
  assert.deepEqual(loadOffset("rpg-npc-mestre", store), { x: -5, y: 7 });
  saveOffset("rpg-run", { x: 0, y: 0 }, store);
  assert.equal(store.data.has("muchat:janela:rpg-run"), false);
  assert.equal(loadOffset("rpg-run", store), null);
});

test("armazenamento estragado ou indisponível não quebra a janela", () => {
  const store = memoryStore();
  store.data.set("muchat:janela:a", "{nao-json");
  store.data.set("muchat:janela:b", JSON.stringify({ x: "1", y: null }));
  assert.equal(loadOffset("a", store), null);
  assert.equal(loadOffset("b", store), null);
  assert.equal(loadOffset("c", null), null);
  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(loadOffset("x", broken), null);
  assert.doesNotThrow(() => saveOffset("x", { x: 1, y: 1 }, broken));
});
