import assert from "node:assert/strict";
import { test } from "node:test";

import { hasUnreadNews, NEWS_MAX_ITEMS, NewsWire } from "./news.ts";

const note = (id: string) => ({ id, title: `nota ${id}`, publishedAt: "2026-11-25T18:00:00.000Z", markdown: "" });

test("não lida: só quando a nota mais nova não é a última aberta", () => {
  assert.equal(hasUnreadNews([], null), false, "quadro vazio não tem nada a ler");
  assert.equal(hasUnreadNews([note("b"), note("a")], null), true, "nunca abriu: tudo é novo");
  assert.equal(hasUnreadNews([note("b"), note("a")], "b"), false);
  assert.equal(hasUnreadNews([note("c"), note("b")], "b"), true, "chegou nota depois da última aberta");
});

test("contrato do quadro: url pode ser null (desligado) e a lista tem teto", () => {
  assert.ok(NewsWire.safeParse({ items: [], url: null }).success);
  assert.ok(NewsWire.safeParse({ items: [note("a")], url: "https://outline.test/s/x" }).success);
  const tooMany = Array.from({ length: NEWS_MAX_ITEMS + 1 }, (_, i) => note(String(i)));
  assert.equal(NewsWire.safeParse({ items: tooMany, url: null }).success, false);
  assert.equal(NewsWire.safeParse({ items: [{ ...note("a"), title: "" }], url: null }).success, false);
});
