/**
 * Quadro de avisos (25/11/2026): a nota mais nova que esta pessoa já abriu, guardada neste
 * aparelho. É só o alfinete de "não lido": se o armazenamento falhar (aba privada, cota), o
 * quadro mostra a nota como nova de novo, e nada mais quebra.
 */
const KEY = "muchat:space-news:last-seen";

export function newsLastSeen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function markNewsSeen(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Sem armazenamento: o alfinete volta na próxima visita, e só.
  }
}
