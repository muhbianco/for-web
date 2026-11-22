/**
 * Chave do operador para o Refúgio (ADR 0009, decisão 7): `SPACE_GAME_SERVERS`
 * com ids separados por vírgula, ou `*`. **Ausente ou vazia = desligado em
 * todo lugar.** Não usa o `env()` do main.ts de propósito: ele derruba o
 * processo quando a variável falta, e este processo libera a voz das salas.
 */
export function gameSwitch(value: string | undefined): { available: (serverId: string) => boolean; count: number | "*" } {
  const ids = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.includes("*")) return { available: () => true, count: "*" };
  const set = new Set(ids);
  return { available: (id) => set.has(id), count: set.size };
}
