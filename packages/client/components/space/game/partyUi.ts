import { t } from "@lingui/core/macro";
import type { RunState } from "@muchat/space-client";
import {
  type ClassId,
  type RpgLobbyMember,
  type RpgLobbyView,
  type RpgPrepKind,
  CLASSES,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";

import { errorText } from "./gameText";

/**
 * O grupo que fica montado entre as corridas e o loop: o que o chip, a TV e o fim da corrida
 * mostram, nas mesmas palavras. Sem contagem regressiva (D21): o estado em palavras.
 */

/** O meu grupo, onde quer que ele esteja (o app guarda o meu e os da sala). */
export function myLobby(
  lobbies: Record<string, RpgLobbyView> | null | undefined,
  myId: string | null,
): RpgLobbyView | null {
  if (!lobbies || !myId) return null;
  for (const l of Object.values(lobbies))
    if (l.members.some((m) => m.user_id === myId)) return l;
  return null;
}

/** O que segura a largada, em palavras ("na ficha do herói", "no Ferreiro"). */
export function prepText(what: RpgPrepKind): string {
  switch (what) {
    case "heroi":
      return t`na ficha do herói`;
    case "ferreiro":
      return t`no Ferreiro`;
    case "banqueiro":
      return t`no Banqueiro`;
    case "mestre":
      return t`no Mestre da evolução`;
  }
}

/** O mesmo, curto (o quadro do grupo): "ficha", "Ferreiro"… */
export function prepShort(what: RpgPrepKind): string {
  switch (what) {
    case "heroi":
      return t`ficha`;
    case "ferreiro":
      return t`Ferreiro`;
    case "banqueiro":
      return t`Banqueiro`;
    case "mestre":
      return t`Mestre`;
  }
}

/**
 * A largada pedida que ainda não saiu (26/11/2026): quem ainda se prepara, ou os segundos da
 * contagem (`now` no relógio do servidor). null: sem largada pendente.
 */
export function startView(
  l: RpgLobbyView,
  now: number,
): { waiting: { name: string; what: RpgPrepKind }[]; secs: number | null } | null {
  if (!l.pending) return null;
  const waiting = (l.prep ?? []).map((p) => ({
    name: l.members.find((m) => m.user_id === p.user_id)?.name ?? "?",
    what: p.what,
  }));
  const secs =
    waiting.length === 0 && typeof l.start_at === "number"
      ? Math.max(0, Math.ceil((l.start_at - now) / 1000))
      : null;
  return { waiting, secs };
}

/** O estado em poucas palavras (o chip, a TV). */
export function partyState(l: RpgLobbyView): string {
  if (l.state === "running") return t`em corrida`;
  if (l.pending)
    return (l.prep?.length ?? 0) > 0
      ? t`esperando quem se prepara`
      : t`largando`;
  if (l.loop && l.state === "ready") return t`loop: a próxima começa sozinha`;
  if (l.state === "ready") return t`pronto`;
  return t`montando`;
}

/** Por que o loop parou sozinho, numa frase. */
export function loopStopText(l: RpgLobbyView): string | null {
  if (l.loop || !l.stopped) return null;
  switch (l.stopped) {
    case "derrota":
      return t`O loop parou: o grupo caiu. Confira poções e equipamento e ligue de novo.`;
    case "offline":
      return t`O loop parou: ninguém do grupo estava conectado.`;
    case "leader_left":
      return t`O loop parou: a liderança mudou de mãos.`;
    case "retreat":
      return t`O loop parou: alguém saiu da corrida.`;
    case "prep":
      return t`A largada desistiu depois de 5 minutos esperando: ${l.stopped_detail ?? "?"} ficou com a ficha ou um NPC aberto.`;
    case "start_failed":
      return t`A largada não saiu: ${errorText(l.stopped_detail ?? undefined)}`;
  }
  return null;
}

/** Quem do grupo está abaixo do nível recomendado da DG (só aviso: o nível não trava desde 27/11/2026). */
export function belowLevel(
  members: readonly RpgLobbyMember[],
  minLevel: number,
): RpgLobbyMember[] {
  return members.filter((m) => m.level < minLevel);
}

/** Os papéis cobertos no grupo (a Masmorra cobra tanque, suporte e dano; §1.4). */
export function roles(classes: readonly ClassId[]) {
  const has = (r: "tanque" | "suporte" | "dps") =>
    classes.some((c) => CLASSES[c].role === r);
  return { tanque: has("tanque"), suporte: has("suporte"), dps: has("dps") };
}

export const dungeonName = (id: string) => dungeonById(id)?.name ?? id;

/** "vitória", "derrota"... (o fim de uma corrida, para o chip e o resumo). */
export function outcomeText(o: string): string {
  switch (o) {
    case "vitoria":
      return t`vitória`;
    case "derrota":
      return t`derrota`;
    case "retirada":
      return t`retirada`;
    default:
      return t`interrompida`;
  }
}

/** A corrida que o chip mostra: a nossa em andamento, depois qualquer outra, depois as que acabaram. */
export function runToShow(
  runs: Record<string, RunState>,
  myId: string | null,
): RunState | null {
  const all = Object.values(runs);
  const mine = (r: RunState) => r.run.members.some((m) => m.user_id === myId);
  return (
    all.find((r) => !r.end && mine(r)) ??
    all.find((r) => !r.end) ??
    all.find(mine) ??
    all[0] ??
    null
  );
}
