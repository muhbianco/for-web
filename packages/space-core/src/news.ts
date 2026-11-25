import { z } from "zod";

/**
 * Quadro de avisos do Espaço (25/11/2026): as novidades do produto, que moram numa coleção
 * pública do Outline. O space-server lê a coleção (só ele: a API do Outline não tem CORS) e
 * serve `GET /v1/news`; o cliente mostra num painel do jogo. Estes são o contrato e os tetos.
 */

/** Quantas notas o quadro mostra (as mais novas). */
export const NEWS_MAX_ITEMS = 20;
/** Teto do título de uma nota (o Outline corta em 100; folga para o futuro). */
export const NEWS_MAX_TITLE = 200;
/** Teto do texto de uma nota, em caracteres (a do START tem ~14 mil). */
export const NEWS_MAX_MARKDOWN = 200_000;

export const NewsItem = z.object({
  /** Id do documento no Outline (uuid): é o que o "não lida" compara. */
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(NEWS_MAX_TITLE),
  /** ISO 8601 com fuso (o Outline manda em UTC, com `Z`). */
  publishedAt: z.string().min(1).max(40),
  markdown: z.string().max(NEWS_MAX_MARKDOWN),
});
export type NewsItem = z.infer<typeof NewsItem>;

export const NewsWire = z.object({
  /** Da mais nova para a mais velha. Vazio = quadro sem notas (ou desligado). */
  items: z.array(NewsItem).max(NEWS_MAX_ITEMS),
  /** Página pública da coleção ("Abrir no Outline"); null com o quadro desligado. */
  url: z.string().url().max(2048).nullable(),
});
export type NewsWire = z.infer<typeof NewsWire>;

/**
 * Há nota que esta pessoa ainda não viu? `lastSeenId` é o id da nota mais nova que ela abriu
 * (guardado no aparelho). Sem notas, nada a ver; nunca abriu, tudo é novo.
 */
export function hasUnreadNews(items: readonly NewsItem[], lastSeenId: string | null): boolean {
  const newest = items[0];
  if (!newest) return false;
  return newest.id !== lastSeenId;
}
