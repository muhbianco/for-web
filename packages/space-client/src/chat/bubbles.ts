/**
 * Balões de conversa sobre os avatares (27/11/2026, referência: o bate-papo do Humortadela antigo).
 * O que uma mensagem mostra no mapa, quanto tempo fica, quando vira esteira e onde cada balão vai
 * para nenhum cobrir outro. Puro: sem DOM; o app mede o texto e pinta. Roda no node:test.
 */

/** Medidas dos balões, em px CSS. Fixas em todo zoom: o texto tem o tamanho do chat do app. */
export const BUBBLE = {
  /** Balão mais largo (com o respiro). */
  maxWidth: 248,
  padX: 10,
  padY: 6,
  fontPx: 13,
  lineHeight: 18,
  /** Linhas que um balão mostra parado; mensagem maior corre em esteira. */
  maxLines: 3,
  /** Espaço entre a cabeça e a ponta do balão (a ponta mede isso). */
  tail: 7,
  /** Espaço entre balões empilhados e entre colunas vizinhas. */
  gap: 4,
  /** Balões que uma pessoa mantém na tela; o mais antigo sai primeiro. */
  perPerson: 3,
  /** Borda do mapa que fica livre. */
  margin: 8,
} as const;

/** Largura útil do texto num balão. */
export const BUBBLE_TEXT_WIDTH = BUBBLE.maxWidth - 2 * BUBBLE.padX;

/**
 * Ritmo de leitura: 14 caracteres por segundo (~140 palavras por minuto), uma leitura de relance
 * numa cena com jogo, avatares andando e conversa.
 */
export const READ_CPS = 14;
/** A esteira anda no ritmo de leitura de texto em movimento: 15 caracteres por segundo. */
export const TICKER_CPS = 15;
/** Teto de velocidade da esteira: acima disso o texto treme a 60 Hz (mais de 2 px por quadro). */
export const TICKER_MAX_PX_S = 110;
/** A esteira espera no começo (achar o início) e no fim (terminar a última palavra). */
export const TICKER_START_MS = 1200;
export const TICKER_END_MS = 1800;
/** Uma esteira não passa disto: o resto fica no chat do canal. */
export const TICKER_MAX_CHARS = 280;
/** Balão parado: tempo mínimo e máximo na tela. */
export const STATIC_MIN_MS = 4500;
export const STATIC_MAX_MS = 11_000;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Quanto tempo um balão parado fica na tela: o tempo de ler, com um respiro para achar o balão. */
export function staticMs(text: string): number {
  return Math.round(
    clamp(1800 + (text.length * 1000) / READ_CPS, STATIC_MIN_MS, STATIC_MAX_MS),
  );
}

export interface TickerPlan {
  /** Quanto o texto anda (px): do começo à vista até o fim encostar na borda direita. */
  distancePx: number;
  pxPerSec: number;
  /** Espera antes de andar, tempo andando e tempo total na tela (com a espera do fim). */
  delayMs: number;
  runMs: number;
  totalMs: number;
}

/**
 * A esteira de uma mensagem longa: `textPx` é a largura da linha inteira, `chars` quantos
 * caracteres ela tem, `boxPx` a janela do balão.
 */
export function tickerPlan(
  textPx: number,
  chars: number,
  boxPx = BUBBLE_TEXT_WIDTH,
): TickerPlan {
  const distancePx = Math.max(0, Math.ceil(textPx - boxPx));
  const charPx = chars > 0 && textPx > 0 ? textPx / chars : 7;
  const pxPerSec = Math.min(TICKER_MAX_PX_S, TICKER_CPS * charPx);
  const runMs = Math.round((distancePx / pxPerSec) * 1000);
  return {
    distancePx,
    pxPerSec,
    delayMs: TICKER_START_MS,
    runMs,
    totalMs: TICKER_START_MS + runMs + TICKER_END_MS,
  };
}

/** Mede a largura de um texto na fonte do balão (o app usa um canvas). */
export type Measure = (text: string) => number;

/**
 * Quebra um texto em linhas de até `width` px (quebra gulosa por palavra; palavra maior que a linha
 * quebra por caractere, como `overflow-wrap: anywhere`). Usada para decidir parado × esteira.
 */
export function wrapLines(
  text: string,
  width: number,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    if (measure(word) <= width) {
      line = word;
      continue;
    }
    // Uma palavra (um link, um "kkkkkkk") maior que a linha: por caractere.
    let piece = "";
    for (const ch of word) {
      if (measure(piece + ch) > width && piece) {
        lines.push(piece);
        piece = ch;
      } else piece += ch;
    }
    line = piece;
  }
  if (line) lines.push(line);
  return lines;
}

export type BubblePlan =
  | { mode: "static"; lines: number }
  | { mode: "ticker"; text: string; ticker: TickerPlan };

/** Parado (até `BUBBLE.maxLines` linhas) ou esteira (uma linha correndo), com o tempo de cada um. */
export function planBubble(text: string, measure: Measure): BubblePlan {
  const lines = wrapLines(text, BUBBLE_TEXT_WIDTH, measure);
  if (lines.length <= BUBBLE.maxLines)
    return { mode: "static", lines: lines.length };
  const shown =
    text.length > TICKER_MAX_CHARS
      ? `${text.slice(0, TICKER_MAX_CHARS).trimEnd()}…`
      : text;
  return {
    mode: "ticker",
    text: shown,
    ticker: tickerPlan(measure(shown), shown.length),
  };
}

/** Tempo na tela de um balão já planejado. */
export function bubbleMs(text: string, plan: BubblePlan): number {
  return plan.mode === "static" ? staticMs(text) : plan.ticker.totalMs;
}

export interface BubbleTextOptions {
  /** Quantos anexos a mensagem tem. */
  attachments?: number;
  /** Rótulos em português (o app passa os traduzidos). */
  labels?: Partial<BubbleLabels>;
}

export interface BubbleLabels {
  code: string;
  spoiler: string;
  attachment: string;
  attachments: (n: number) => string;
}

const DEFAULT_LABELS: BubbleLabels = {
  code: "[código]",
  spoiler: "[spoiler]",
  attachment: "📎 anexo",
  attachments: (n) => `📎 ${n} anexos`,
};

/**
 * O que um balão diz de uma mensagem: o texto simples (o `contentPlain` do Stoat, com menções já
 * em nome e spoiler já trocado), sem marcação de Markdown, links curtos, numa linha só. Spoiler
 * nunca aparece no balão. Vazio com anexo vira "📎 anexo".
 */
export function bubbleText(
  plain: string,
  opts: BubbleTextOptions = {},
): string {
  const labels = { ...DEFAULT_LABELS, ...opts.labels };
  let s = plain;
  // Blocos de código: o conteúdo não cabe num balão.
  s = s.replace(/```[\s\S]*?(```|$)/g, ` ${labels.code} `);
  // Spoiler (o Stoat já troca ||x|| por <spoiler>; o que sobrou também).
  s = s.replace(/<spoiler>/g, labels.spoiler);
  s = s.replace(/\|\|[\s\S]*?\|\|/g, labels.spoiler);
  // Código em linha: só o texto.
  s = s.replace(/`([^`]*)`/g, "$1");
  // Links do Markdown: o texto do link.
  s = s.replace(/!?\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1");
  // Links soltos: o domínio (e "/…" quando tem caminho).
  s = s.replace(/<?(https?:\/\/[^\s<>]+)>?/g, (_, url: string) =>
    shortUrl(url),
  );
  // Títulos, citações e marcadores de lista no começo da linha.
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "• ");
  // Ênfase: **x**, __x__, ~~x~~, *x*, _x_ (sem mexer em snake_case nem em 2*3).
  s = s.replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, "$2");
  s = s.replace(
    /(^|[\s(])([*_])(?=\S)([^*_\n]*?\S)\2(?=$|[\s).,!?:;])/g,
    "$1$3",
  );
  // Uma linha só.
  s = s.replace(/\s+/g, " ").trim();
  if (!s && opts.attachments)
    return opts.attachments > 1
      ? labels.attachments(opts.attachments)
      : labels.attachment;
  if (s && opts.attachments) s = `📎 ${s}`;
  return s;
}

/** `https://www.youtube.com/watch?v=x` → `youtube.com/…`. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    const more = (u.pathname && u.pathname !== "/") || u.search || u.hash;
    return more ? `${host}/…` : host;
  } catch {
    return url;
  }
}

// ---- onde cada balão fica -----------------------------------------------------------------

/** A pilha de balões de uma pessoa: âncora na cabeça e o tamanho medido da pilha. */
export interface BubbleColumn {
  id: string;
  /** Topo do que está desenhado sobre a cabeça (nome, selos, telinha ao vivo), px do mapa. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Prioridade: 0 = a fala mais recente, que fica no lugar natural. */
  order: number;
}

export interface BubblePlacement {
  id: string;
  left: number;
  top: number;
  /** Onde a ponta encosta, medido da borda esquerda da coluna. */
  tailX: number;
  /** Quanto a coluna subiu além do lugar natural (> 0: há uma linha ligando à cabeça). */
  lift: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const hits = (a: Rect, b: Rect, gap: number) =>
  a.left < b.right + gap &&
  b.left < a.right + gap &&
  a.top < b.bottom + gap &&
  b.top < a.bottom + gap;

/** Deslocamentos laterais tentados antes de empilhar (px): pequenos, a ponta segue na cabeça. */
const NUDGES = [0, -24, 24, -48, 48];

/**
 * Onde cada pilha fica, sem uma cobrir a outra. A fala mais recente fica no lugar natural (sobre a
 * cabeça, presa à borda do mapa); as outras primeiro chegam um pouco para o lado e, se ainda
 * batem, sobem acima de quem bateu. A ponta sempre aponta para a cabeça de quem falou.
 */
export function layoutBubbles(
  cols: readonly BubbleColumn[],
  bounds: { w: number; h: number },
): BubblePlacement[] {
  const m = BUBBLE.margin;
  const placed: Rect[] = [];
  const out: BubblePlacement[] = [];
  const clampLeft = (left: number, w: number) =>
    w >= bounds.w - 2 * m ? m : clamp(left, m, bounds.w - m - w);
  for (const c of [...cols].sort((a, b) => a.order - b.order)) {
    const natLeft = clampLeft(c.x - c.w / 2, c.w);
    const natTop = c.y - BUBBLE.tail - c.h;
    const rectAt = (left: number, top: number): Rect => ({
      left,
      top,
      right: left + c.w,
      bottom: top + c.h,
    });
    let left = natLeft;
    let top = natTop;
    const free = (r: Rect) => !placed.some((p) => hits(r, p, BUBBLE.gap));
    const nudge = NUDGES.map((dx) => clampLeft(natLeft + dx, c.w)).find(
      // A ponta ainda alcança a cabeça (fica dentro da coluna).
      (l) => c.x - l >= 10 && l + c.w - c.x >= 10 && free(rectAt(l, natTop)),
    );
    if (nudge !== undefined) left = nudge;
    else {
      for (let i = 0; i < 16; i++) {
        const r = rectAt(left, top);
        const over = placed.filter((p) => hits(r, p, BUBBLE.gap));
        if (!over.length) break;
        top = Math.min(...over.map((p) => p.top)) - BUBBLE.gap - c.h;
      }
    }
    // Sem lugar acima (a pessoa está colada no topo do mapa): fica na borda, por cima.
    top = Math.max(m, Math.round(top));
    left = Math.round(left);
    placed.push(rectAt(left, top));
    out.push({
      id: c.id,
      left,
      top,
      tailX: Math.round(clamp(c.x - left, 10, c.w - 10)),
      lift: Math.max(0, Math.round(natTop - top)),
    });
  }
  return out;
}
