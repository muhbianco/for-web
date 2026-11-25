import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NEWS_MAX_ITEMS, NewsWire } from "@muchat/space-core";

import { silentLog } from "../log.ts";
import { absolutize, OutlineNews, parseShareUrl, treeChildren } from "./outline.ts";

const SHARE = "https://outline.test/s/novidades";

interface Doc {
  id: string;
  title: string;
  publishedAt: string | null;
  text: string;
}

/** Um Outline de mentira: a árvore da coleção e os documentos, contando as chamadas. */
function fakeOutline(docs: Doc[], opts: { fail?: () => boolean; delayMs?: number; body?: string } = {}) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = url.pathname.replace("/api/", "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ method, body });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.fail?.()) return new Response("down", { status: 502 });
    if (opts.body !== undefined) return new Response(opts.body, { status: 200 });
    if (method === "shares.info") {
      assert.equal(body.id, "novidades");
      return Response.json({
        data: {
          shares: [{ id: "s1" }],
          sharedTree: {
            id: "col",
            title: "Novidades",
            children: docs.map((d) => ({
              id: d.id,
              title: d.title,
              children: [],
            })),
          },
        },
      });
    }
    if (method === "documents.info") {
      assert.equal(body.shareId, "novidades");
      const d = docs.find((x) => x.id === body.id);
      if (!d) return new Response("nope", { status: 404 });
      return Response.json({
        data: {
          id: d.id,
          title: d.title,
          text: d.text,
          publishedAt: d.publishedAt,
        },
      });
    }
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const START: Doc = {
  id: "d-start",
  title: "2026-11-25 — START",
  publishedAt: "2026-11-25T18:00:00.000Z",
  text: "| a | b |\n|---|---|\n| 1 | 2 |\n\nVeja [a outra](/doc/decoracao-abc) e ![](/api/attachments.redirect?id=x)",
};
const OLD: Doc = {
  id: "d-old",
  title: "2026-11-14 — Decoração",
  publishedAt: "2026-11-14T12:00:00.000Z",
  text: "velha",
};

describe("parseShareUrl", () => {
  it("aceita só a página pública https /s/<id>", () => {
    assert.deepEqual(parseShareUrl("https://outline.muhbianco.com.br/s/novidades"), {
      origin: "https://outline.muhbianco.com.br",
      shareId: "novidades",
      url: "https://outline.muhbianco.com.br/s/novidades",
    });
    for (const bad of [
      "http://outline.test/s/x",
      "https://outline.test/doc/x",
      "https://outline.test/s/x/doc/y",
      "https://user:pw@outline.test/s/x",
      "https://outline.test/s/x?y=1",
      "não é url",
    ]) {
      assert.throws(() => parseShareUrl(bad), bad);
    }
  });
});

describe("OutlineNews", () => {
  it("lê a coleção, ordena da mais nova e devolve o contrato do quadro", async () => {
    const o = fakeOutline([OLD, START]);
    const news = new OutlineNews({
      shareUrl: SHARE,
      log: silentLog,
      fetch: o.fetchImpl,
    });
    const wire = await news.get();
    assert.ok(NewsWire.safeParse(wire).success);
    assert.equal(wire.url, SHARE);
    assert.deepEqual(
      wire.items.map((i) => i.id),
      ["d-start", "d-old"],
    );
    // Caminhos do Outline viram endereço do Outline (no Muchat apontariam para o chat).
    assert.match(wire.items[0]!.markdown, /\]\(https:\/\/outline\.test\/doc\/decoracao-abc\)/);
    assert.match(wire.items[0]!.markdown, /\]\(https:\/\/outline\.test\/api\/attachments\.redirect\?id=x\)/);
  });

  it("deixa de fora documento sem data de publicação", async () => {
    const o = fakeOutline([START, { id: "d-draft", title: "rascunho", publishedAt: null, text: "x" }]);
    const wire = await new OutlineNews({
      shareUrl: SHARE,
      log: silentLog,
      fetch: o.fetchImpl,
    }).get();
    assert.deepEqual(
      wire.items.map((i) => i.id),
      ["d-start"],
    );
  });

  it("guarda por ttl e faz uma busca só para pedidos simultâneos", async () => {
    let now = 1_000;
    const o = fakeOutline([START, OLD], { delayMs: 5 });
    const news = new OutlineNews({
      shareUrl: SHARE,
      log: silentLog,
      fetch: o.fetchImpl,
      now: () => now,
      ttlMs: 60_000,
    });
    await Promise.all([news.get(), news.get(), news.get()]);
    assert.equal(o.calls.filter((c) => c.method === "shares.info").length, 1);
    now += 30_000;
    await news.get();
    assert.equal(o.calls.filter((c) => c.method === "shares.info").length, 1);
    now += 31_000;
    await news.get();
    assert.equal(o.calls.filter((c) => c.method === "shares.info").length, 2);
  });

  it("com o Outline fora, serve o último bom até staleMs; depois, erro", async () => {
    let now = 0;
    let down = false;
    const o = fakeOutline([START], { fail: () => down });
    const news = new OutlineNews({
      shareUrl: SHARE,
      log: silentLog,
      fetch: o.fetchImpl,
      now: () => now,
      ttlMs: 1_000,
      staleMs: 10_000,
      retryMs: 0,
    });
    const good = await news.get();
    down = true;
    now = 5_000;
    assert.deepEqual(await news.get(), good);
    now = 20_000;
    await assert.rejects(news.get(), /HTTP 502/);
  });

  it("depois de uma falha sem cache, não bate no Outline de novo antes de retryMs", async () => {
    let now = 0;
    const o = fakeOutline([START], { fail: () => true });
    const news = new OutlineNews({
      shareUrl: SHARE,
      log: silentLog,
      fetch: o.fetchImpl,
      now: () => now,
      retryMs: 30_000,
    });
    await assert.rejects(news.get());
    now = 10_000;
    await assert.rejects(news.get());
    assert.equal(o.calls.length, 1);
    now = 31_000;
    await assert.rejects(news.get());
    assert.equal(o.calls.length, 2);
  });

  it("recusa resposta acima do teto e JSON quebrado", async () => {
    const big = fakeOutline([START], { body: "x".repeat(2_000) });
    await assert.rejects(
      new OutlineNews({
        shareUrl: SHARE,
        log: silentLog,
        fetch: big.fetchImpl,
        maxBytes: 1_000,
      }).get(),
      /grande demais/,
    );
    const broken = fakeOutline([START], { body: "{não é json" });
    await assert.rejects(
      new OutlineNews({
        shareUrl: SHARE,
        log: silentLog,
        fetch: broken.fetchImpl,
      }).get(),
      /JSON inválido/,
    );
  });

  it("estoura o prazo de cada chamada", async () => {
    // O timer do AbortSignal.timeout não segura o processo (unref): este segura, como o
    // servidor de verdade seguraria, e some no abort.
    const slow = (async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const hold = setTimeout(() => reject(new Error("o prazo não estourou")), 2_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(hold);
          reject(init.signal!.reason);
        });
      })) as typeof fetch;
    await assert.rejects(
      new OutlineNews({
        shareUrl: SHARE,
        log: silentLog,
        fetch: slow,
        timeoutMs: 20,
      }).get(),
    );
  });

  it("busca no máximo NEWS_MAX_ITEMS documentos", async () => {
    const docs: Doc[] = Array.from({ length: NEWS_MAX_ITEMS + 5 }, (_, i) => ({
      id: `d${i}`,
      title: `nota ${i}`,
      publishedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      text: "",
    }));
    const o = fakeOutline(docs);
    const wire = await new OutlineNews({
      shareUrl: SHARE,
      log: silentLog,
      fetch: o.fetchImpl,
    }).get();
    assert.equal(wire.items.length, NEWS_MAX_ITEMS);
    assert.equal(o.calls.filter((c) => c.method === "documents.info").length, NEWS_MAX_ITEMS);
  });
});

describe("treeChildren e absolutize", () => {
  it("compartilhamento de documento sem filhos vira uma nota só", () => {
    assert.deepEqual(
      treeChildren({
        sharedTree: { id: "d1", title: "Uma", children: [] },
        document: { id: "d1" },
      }),
      [{ id: "d1", title: "Uma" }],
    );
    assert.deepEqual(treeChildren({ sharedTree: null }), []);
  });

  it("não mexe em endereço completo nem em //host", () => {
    const md = "[a](https://x.test/y) [b](//cdn.test/z) [c](/doc/k)";
    assert.equal(absolutize(md, "https://o.test"), "[a](https://x.test/y) [b](//cdn.test/z) [c](https://o.test/doc/k)");
  });
});
