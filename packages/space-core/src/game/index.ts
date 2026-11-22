// Refúgio, o RPG idle do Espaço (docs/espaco ADR 0009 no overlay muchat).
// Regras puras, iguais no servidor, no app e na simulação de balanceamento.
// Subcaminho próprio (`@muchat/space-core/game`): o bundle do app só leva o jogo quando o painel importar.
export * from "./data.ts";
export * from "./fight.ts";
export * from "./items.ts";
export * from "./lobby.ts";
export * from "./map.ts";
export * from "./protocol.ts";
export * from "./rng.ts";
export * from "./run.ts";
export * from "./stats.ts";
export * from "./tables.ts";
export * from "./time.ts";
