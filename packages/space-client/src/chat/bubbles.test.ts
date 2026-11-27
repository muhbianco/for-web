import assert from "node:assert/strict";
import test from "node:test";

import {
  type BubbleColumn,
  BUBBLE,
  BUBBLE_TEXT_WIDTH,
  bubbleMs,
  bubbleText,
  layoutBubbles,
  planBubble,
  READ_CPS,
  shortUrl,
  STATIC_MAX_MS,
  STATIC_MIN_MS,
  staticMs,
  TICKER_END_MS,
  TICKER_MAX_CHARS,
  TICKER_MAX_PX_S,
  TICKER_START_MS,
  tickerPlan,
  wrapLines,
} from "./bubbles.ts";

/** Fonte de largura fixa para os testes: 7 px por caractere (a média do system-ui a 13 px). */
const mono = (s: string) => s.length * 7;

test("texto do balão: Markdown some, menções e emoji ficam como o Stoat entregou", () => {
  assert.equal(bubbleText("**olha** isso _agora_"), "olha isso agora");
  assert.equal(bubbleText("~~errado~~ certo"), "errado certo");
  assert.equal(bubbleText("> citação\nresposta"), "citação resposta");
  assert.equal(bubbleText("# Título\ntexto"), "Título texto");
  assert.equal(bubbleText("- um\n- dois"), "• um • dois");
  assert.equal(bubbleText("usa `npm i` aqui"), "usa npm i aqui");
  assert.equal(bubbleText("@ana vem cá :party:"), "@ana vem cá :party:");
  // snake_case e contas não são ênfase.
  assert.equal(
    bubbleText("o campo user_id_x e 2*3*4"),
    "o campo user_id_x e 2*3*4",
  );
});

test("texto do balão: spoiler nunca aparece, código vira rótulo, link fica curto", () => {
  assert.equal(
    bubbleText("o final é <spoiler> kkk"),
    "o final é [spoiler] kkk",
  );
  assert.equal(bubbleText("o final é ||ele morre||"), "o final é [spoiler]");
  assert.equal(
    bubbleText("veja:\n```js\nconst x = 1;\n```\nok"),
    "veja: [código] ok",
  );
  assert.equal(
    bubbleText("assiste https://www.youtube.com/watch?v=abc agora"),
    "assiste youtube.com/… agora",
  );
  assert.equal(bubbleText("[a doc](https://docs.muhbianco.com.br/x)"), "a doc");
  assert.equal(shortUrl("https://muhbianco.com.br"), "muhbianco.com.br");
  assert.equal(shortUrl("não é link"), "não é link");
});

test("texto do balão: anexo sem texto ganha rótulo; com texto, o clipe na frente", () => {
  assert.equal(bubbleText("", { attachments: 1 }), "📎 anexo");
  assert.equal(bubbleText("  ", { attachments: 3 }), "📎 3 anexos");
  assert.equal(
    bubbleText("foto do rolê", { attachments: 1 }),
    "📎 foto do rolê",
  );
  assert.equal(bubbleText(""), "");
});

test("quebra de linha: por palavra, e palavra gigante por caractere", () => {
  assert.deepEqual(wrapLines("a b c", 21, mono), ["a b", "c"]);
  const long = "k".repeat(70);
  const lines = wrapLines(long, BUBBLE_TEXT_WIDTH, mono);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(mono(l) <= BUBBLE_TEXT_WIDTH);
  assert.equal(lines.join(""), long);
});

test("parado até 3 linhas; mais que isso vira esteira", () => {
  const short = "bom dia, pessoal! alguém vai na reunião das 10?";
  assert.equal(planBubble(short, mono).mode, "static");
  const three = "palavra ".repeat(30).trim(); // ~3 linhas de 32 caracteres
  const p3 = planBubble(three, mono);
  assert.equal(
    p3.mode,
    wrapLines(three, BUBBLE_TEXT_WIDTH, mono).length <= 3 ? "static" : "ticker",
  );
  const long =
    "Gente, só pra avisar: amanhã a reunião muda para as 15h porque o cliente pediu, e quem não puder vir avisa no canal que eu mando o resumo depois.";
  const p = planBubble(long, mono);
  assert.equal(p.mode, "ticker");
  if (p.mode !== "ticker") return;
  assert.equal(p.text, long);
  assert.ok(p.ticker.distancePx > 0);
});

test("esteira: ritmo de leitura, teto de velocidade e as esperas do começo e do fim", () => {
  const chars = 200;
  const plan = tickerPlan(chars * 7, chars);
  // 15 caracteres por segundo a 7 px = 105 px/s, abaixo do teto.
  assert.equal(plan.pxPerSec, 105);
  assert.ok(plan.pxPerSec <= TICKER_MAX_PX_S);
  assert.equal(plan.delayMs, TICKER_START_MS);
  assert.equal(plan.totalMs, TICKER_START_MS + plan.runMs + TICKER_END_MS);
  // Anda só o que passa da janela: o fim encosta na borda direita.
  assert.equal(plan.distancePx, chars * 7 - BUBBLE_TEXT_WIDTH);
  // Fonte larga não acelera a esteira além do teto.
  assert.equal(tickerPlan(chars * 12, chars).pxPerSec, TICKER_MAX_PX_S);
});

test("esteira tem teto de tamanho: o resto fica no chat", () => {
  const text = "a".repeat(10) + " " + "bla ".repeat(200);
  const p = planBubble(text, mono);
  assert.equal(p.mode, "ticker");
  if (p.mode !== "ticker") return;
  assert.ok(p.text.length <= TICKER_MAX_CHARS + 1);
  assert.ok(p.text.endsWith("…"));
  // ~280 caracteres a 15 por segundo: menos de meio minuto na tela.
  assert.ok(p.ticker.totalMs < 30_000);
});

test("tempo do balão parado: o de ler, com mínimo e máximo", () => {
  assert.equal(staticMs("oi"), STATIC_MIN_MS);
  assert.equal(staticMs("x".repeat(2000)), STATIC_MAX_MS);
  const t = staticMs("x".repeat(84));
  assert.equal(t, Math.round(1800 + (84 * 1000) / READ_CPS));
  assert.equal(bubbleMs("oi", { mode: "static", lines: 1 }), STATIC_MIN_MS);
});

const col = (
  id: string,
  x: number,
  y: number,
  order: number,
  w = 120,
  h = 30,
): BubbleColumn => ({
  id,
  x,
  y,
  w,
  h,
  order,
});

const rectOf = (c: BubbleColumn, p: { left: number; top: number }) => ({
  left: p.left,
  top: p.top,
  right: p.left + c.w,
  bottom: p.top + c.h,
});

function overlapping(cols: BubbleColumn[], bounds = { w: 1200, h: 800 }) {
  const placed = layoutBubbles(cols, bounds);
  const byId = new Map(cols.map((c) => [c.id, c]));
  let n = 0;
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = rectOf(byId.get(placed[i]!.id)!, placed[i]!);
      const b = rectOf(byId.get(placed[j]!.id)!, placed[j]!);
      if (
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom
      )
        n++;
    }
  return { placed, n };
}

test("balão sozinho: centrado sobre a cabeça, a ponta na cabeça", () => {
  const [p] = layoutBubbles([col("ana", 600, 400, 0)], { w: 1200, h: 800 });
  assert.equal(p!.left, 540);
  assert.equal(p!.top, 400 - BUBBLE.tail - 30);
  assert.equal(p!.tailX, 60);
  assert.equal(p!.lift, 0);
});

test("balão na borda: preso dentro do mapa, a ponta continua na cabeça", () => {
  const [p] = layoutBubbles([col("ana", 20, 400, 0)], { w: 1200, h: 800 });
  assert.equal(p!.left, BUBBLE.margin);
  assert.equal(p!.tailX, 12);
  const [q] = layoutBubbles([col("bia", 1195, 400, 0)], { w: 1200, h: 800 });
  assert.equal(q!.left, 1200 - BUBBLE.margin - 120);
  assert.equal(q!.tailX, 110);
});

test("duas pessoas lado a lado: nenhum balão cobre o outro e o mais recente não sai do lugar", () => {
  const { placed, n } = overlapping([
    col("ana", 600, 400, 1),
    col("bia", 640, 400, 0),
  ]);
  assert.equal(n, 0);
  const bia = placed.find((p) => p.id === "bia")!;
  assert.equal(bia.left, 580);
  assert.equal(bia.lift, 0);
});

test("muita gente no mesmo ponto (o 'Ir para' leva todos à mesma porta): sem sobreposição", () => {
  const cols = Array.from({ length: 6 }, (_, i) =>
    col(`p${i}`, 600 + i * 6, 500, i),
  );
  const { placed, n } = overlapping(cols);
  assert.equal(n, 0);
  // Todas as pontas alcançam a cabeça de quem falou.
  for (const p of placed) {
    const c = cols.find((x) => x.id === p.id)!;
    assert.ok(p.tailX >= 10 && p.tailX <= c.w - 10);
  }
});

test("pilhas altas na mesma coluna sobem acima de quem bateu, sem passar do topo", () => {
  const cols = [
    col("a", 300, 120, 0, 200, 60),
    col("b", 305, 125, 1, 200, 60),
    col("c", 310, 130, 2, 200, 60),
  ];
  const placed = layoutBubbles(cols, { w: 800, h: 600 });
  for (const p of placed) assert.ok(p.top >= BUBBLE.margin);
});

test("mapa mais estreito que o balão: o balão encosta na margem", () => {
  const [p] = layoutBubbles([col("ana", 100, 300, 0, 248, 40)], {
    w: 200,
    h: 600,
  });
  assert.equal(p!.left, BUBBLE.margin);
});

test("TTS: o balão mostra o texto sem o /tts (a carinha entra no lugar)", async () => {
  const { ttsBody } = await import("./bubbles.ts");
  assert.equal(ttsBody("/tts aqui aqui aqui"), "aqui aqui aqui");
  assert.equal(ttsBody("  /TTS  oi gente "), "oi gente");
  assert.equal(ttsBody("/tts"), "");
  assert.equal(ttsBody("/ttsx não é"), null);
  assert.equal(ttsBody("falei /tts no meio"), null);
});
