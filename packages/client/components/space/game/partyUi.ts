import { createSignal, onCleanup } from "solid-js";

import { t } from "@lingui/core/macro";
import type { GameWireEvent, SpaceView } from "@muchat/space-client";
import {
  type RpgLobbyMember,
  type RpgLobbyView,
  DUNGEONS,
} from "@muchat/space-core/game/ot";

import { rpgLabels } from "./rpgUi";

/**
 * O grupo que fica montado entre as corridas e o loop (24/11/2026): o que o chip, a TV e o fim
 * da corrida mostram, nas mesmas palavras, e o envio dos comandos com a resposta do servidor.
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

/** Segundos até a próxima corrida do loop (null: nada marcado). */
export function loopSeconds(l: RpgLobbyView, now: number): number | null {
  if (!l.loop || l.state !== "ready" || !l.next_at) return null;
  return Math.max(0, Math.ceil((l.next_at - now) / 1000));
}

/** O estado em poucas palavras (o chip, a TV). */
export function partyState(l: RpgLobbyView, now: number): string {
  if (l.state === "running") return t`em corrida`;
  const s = loopSeconds(l, now);
  if (s !== null) return s > 0 ? t`próxima em ${s} s` : t`começando…`;
  if (l.state === "forming" || !l.state) return t`montando`;
  return t`pronto`;
}

/** Por que o loop parou sozinho, numa frase. */
export function loopStopText(l: RpgLobbyView): string | null {
  if (l.loop || !l.stopped) return null;
  const L = rpgLabels();
  switch (l.stopped) {
    case "derrota":
      return t`O loop parou: o grupo caiu. Confira poções e equipamento e ligue de novo.`;
    case "retirada":
      return t`O loop parou: o grupo se retirou sem conseguir ferir os monstros.`;
    case "offline":
      return t`O loop parou: ninguém do grupo estava conectado.`;
    case "leader_left":
      return t`O loop parou: a liderança mudou de mãos.`;
    case "retreat":
      return t`O loop parou: alguém saiu da corrida.`;
    case "start_failed":
      return t`O loop parou: ${L.error("rpg_invalid", l.stopped_detail ?? undefined)}`;
  }
  return null;
}

/** Quem do grupo não tem o level da dungeon (vazio: todos entram). */
export function belowLevel(
  members: readonly RpgLobbyMember[],
  minLevel: number,
): RpgLobbyMember[] {
  return members.filter((m) => m.level < minLevel);
}

/** As dungeons que o grupo inteiro pode fazer, e as outras com quem falta. */
export function dungeonChoices(members: readonly RpgLobbyMember[]) {
  return DUNGEONS.map((d) => ({ d, below: belowLevel(members, d.minLevel) }));
}

/**
 * Um comando do jogo com a resposta: ocupado enquanto espera, a mensagem de erro em
 * português se o servidor recusar (some sozinha depois de alguns segundos).
 */
export function useGameAction(view: () => SpaceView) {
  const L = rpgLabels();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let pending: string | null = null;
  let onOk: (() => void) | undefined;
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  let hide: ReturnType<typeof setTimeout> | undefined;
  const off = view().onGame((e: GameWireEvent) => {
    if (!pending || e.re !== pending) return;
    pending = null;
    clearTimeout(giveUp);
    setBusy(false);
    if (e.t === "error") {
      const d = e.d as { code?: string; reason?: string };
      setError(L.error(d.code ?? "internal", d.reason));
      clearTimeout(hide);
      hide = setTimeout(() => setError(null), 8_000);
      return;
    }
    const ok = onOk;
    onOk = undefined;
    ok?.();
  });
  onCleanup(() => {
    off();
    clearTimeout(giveUp);
    clearTimeout(hide);
  });
  const send = (
    type: string,
    d: Record<string, unknown> = {},
    done?: () => void,
  ) => {
    if (busy()) return;
    setBusy(true);
    setError(null);
    onOk = done;
    pending = view().gameSend(type, d);
    // Sem resposta (conexão caiu): o botão volta.
    giveUp = setTimeout(() => {
      pending = null;
      setBusy(false);
    }, 10_000);
  };
  return { send, busy, error };
}
