import { type NewsItem, type NewsWire, NEWS_MAX_ITEMS, NEWS_MAX_MARKDOWN, NEWS_MAX_TITLE } from "@muchat/space-core";

import type { Log } from "../log.ts";

/**
 * Fonte do quadro de avisos (25/11/2026): uma coleção do Outline publicada na web. O endereço
 * é fixo, do operador (`SPACE_NEWS_URL`), nunca de quem joga, então não há como apontar o
 * servidor para outro lugar. Lê pela API pública dos compartilhamentos, sem chave:
 * `shares.info` dá a árvore (os documentos da coleção) e `documents.info` com `shareId` dá o
 * markdown e a data de publicação de cada um. Rascunho não aparece num compartilhamento.
 *
 * Guarda o resultado por `ttlMs` (todo mundo lê a mesma coisa) e, se o Outline cair, continua
 * servindo o último bom por até `staleMs`. Toda chamada tem prazo e teto de tamanho.
 */
export interface NewsSource {
  get(): Promise<NewsWire>;
}

export interface OutlineNewsOptions {
  /** Página pública da coleção: https://<host>/s/<shareId>. */
  shareUrl: string;
  log: Log;
  fetch?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  staleMs?: number;
  timeoutMs?: number;
  /** Teto de bytes de cada resposta do Outline. */
  maxBytes?: number;
  /** Quantos documentos buscar ao mesmo tempo. */
  concurrency?: number;
  /** Depois de uma falha, quanto esperar antes de tentar o Outline de novo. */
  retryMs?: number;
}

const SHARE_PATH = /^\/s\/([A-Za-z0-9_-]{1,100})\/?$/;

/** Separa e confere a página pública: só https, só o formato /s/<id>. */
export function parseShareUrl(raw: string): {
  origin: string;
  shareId: string;
  url: string;
} {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("SPACE_NEWS_URL não é um endereço");
  }
  if (u.protocol !== "https:") throw new Error("SPACE_NEWS_URL precisa ser https");
  if (u.username || u.password || u.search || u.hash) throw new Error("SPACE_NEWS_URL só leva host e /s/<id>");
  const m = SHARE_PATH.exec(u.pathname);
  if (!m) throw new Error("SPACE_NEWS_URL precisa ser a página pública /s/<id>");
  return { origin: u.origin, shareId: m[1]!, url: `${u.origin}/s/${m[1]}` };
}

interface TreeNode {
  id: string;
  title: string;
}

interface Cached {
  wire: NewsWire;
  at: number;
}

export class OutlineNews implements NewsSource {
  private readonly origin: string;
  private readonly shareId: string;
  private readonly publicUrl: string;
  private readonly log: Log;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly staleMs: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly concurrency: number;
  private readonly retryMs: number;
  private cache: Cached | null = null;
  private inflight: Promise<NewsWire> | null = null;
  /** Última falha: sem cache, ninguém bate no Outline de novo antes de `retryMs`. */
  private failure: { at: number; err: unknown } | null = null;

  constructor(opts: OutlineNewsOptions) {
    const share = parseShareUrl(opts.shareUrl);
    this.origin = share.origin;
    this.shareId = share.shareId;
    this.publicUrl = share.url;
    this.log = opts.log;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.staleMs = opts.staleMs ?? 24 * 60 * 60_000;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.maxBytes = opts.maxBytes ?? 1_000_000;
    this.concurrency = opts.concurrency ?? 4;
    this.retryMs = opts.retryMs ?? 30_000;
  }

  /** O quadro: do cache enquanto fresco; senão busca (uma busca por vez para todo mundo). */
  async get(): Promise<NewsWire> {
    const now = this.now();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.wire;
    // Acabou de falhar: o último bom (se houver) ou o mesmo erro, sem nova busca.
    if (this.failure && now - this.failure.at < this.retryMs) {
      if (this.cache && now - this.cache.at < this.staleMs) return this.cache.wire;
      throw this.failure.err;
    }
    if (!this.inflight) {
      this.inflight = this.refresh()
        .then(
          (wire) => {
            this.failure = null;
            return wire;
          },
          (err: unknown) => {
            this.failure = { at: this.now(), err };
            throw err;
          },
        )
        .finally(() => {
          this.inflight = null;
        });
    }
    try {
      return await this.inflight;
    } catch (err) {
      if (this.cache && now - this.cache.at < this.staleMs) {
        this.log.warn("news: outline unavailable, serving stale", {
          age_s: Math.round((now - this.cache.at) / 1000),
          err: String(err),
        });
        return this.cache.wire;
      }
      throw err;
    }
  }

  private async refresh(): Promise<NewsWire> {
    const started = this.now();
    const share = await this.call("shares.info", { id: this.shareId });
    const nodes = treeChildren(share).slice(0, NEWS_MAX_ITEMS);
    const docs = await mapLimit(nodes, this.concurrency, (n) => this.document(n));
    const items = docs
      .filter((d): d is NewsItem => d !== null)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const wire: NewsWire = { items, url: this.publicUrl };
    this.cache = { wire, at: this.now() };
    this.log.info("news: refreshed", {
      items: items.length,
      ms: this.now() - started,
    });
    return wire;
  }

  private async document(node: TreeNode): Promise<NewsItem | null> {
    const data = await this.call("documents.info", {
      shareId: this.shareId,
      id: node.id,
    });
    if (!isRecord(data)) throw new Error("documents.info: resposta sem data");
    const id = str(data.id) ?? node.id;
    const title = (str(data.title) ?? node.title).trim().slice(0, NEWS_MAX_TITLE);
    const publishedAt = str(data.publishedAt);
    const text = str(data.text) ?? "";
    // Sem data de publicação é rascunho (não deveria vir num compartilhamento): fica de fora.
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt)) || !title) return null;
    return {
      id,
      title,
      publishedAt,
      markdown: absolutize(text, this.origin).slice(0, NEWS_MAX_MARKDOWN),
    };
  }

  /** POST na API do Outline, com prazo e teto de tamanho; devolve `data`. */
  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await this.fetchImpl(`${this.origin}/api/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > this.maxBytes) throw new Error(`${method}: resposta grande demais`);
    const raw = await res.text();
    if (raw.length > this.maxBytes) throw new Error(`${method}: resposta grande demais`);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`${method}: JSON inválido`);
    }
    if (!isRecord(json) || !("data" in json)) throw new Error(`${method}: resposta sem data`);
    return json.data;
  }
}

/**
 * Os documentos de primeiro nível do compartilhamento, na ordem da coleção. Num compartilhamento
 * de documento (não de coleção) a raiz é o próprio documento: ele vira a única nota se não tiver
 * filhos.
 */
export function treeChildren(data: unknown): TreeNode[] {
  if (!isRecord(data)) throw new Error("shares.info: resposta sem data");
  const tree = data.sharedTree;
  if (!isRecord(tree)) return [];
  const kids = Array.isArray(tree.children) ? tree.children : [];
  const nodes: TreeNode[] = [];
  for (const k of kids) {
    if (!isRecord(k)) continue;
    const id = str(k.id);
    const title = str(k.title);
    if (id && title) nodes.push({ id, title });
  }
  if (nodes.length === 0 && isRecord(data.document)) {
    const id = str(tree.id);
    const title = str(tree.title);
    if (id && title) nodes.push({ id, title });
  }
  return nodes;
}

/**
 * O markdown do Outline usa caminhos do próprio site (`/doc/...`, `/api/attachments.redirect`):
 * no Muchat eles apontariam para o chat. Vira endereço completo do Outline.
 */
export function absolutize(markdown: string, origin: string): string {
  return markdown.replace(/\]\((\/(?!\/)[^)\s]*)/g, (_m, path: string) => `](${origin}${path}`);
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** O quadro fixo do servidor de desenvolvimento (sem Outline): duas notas curtas. */
export class StaticNews implements NewsSource {
  private readonly wire: NewsWire;
  constructor(wire: NewsWire) {
    this.wire = wire;
  }
  async get(): Promise<NewsWire> {
    return this.wire;
  }
}
