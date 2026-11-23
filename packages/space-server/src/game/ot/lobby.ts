import {
  type RpgLobbyMember,
  type RpgLobbyView,
  dungeonOf,
  LOBBY,
} from "@muchat/space-core/game/ot";

/**
 * As salas de preparação nas TVs de um servidor (docs/espaco/jogo/ot, etapa O4). Uma por TV,
 * em memória: duram minutos e não precisam sobreviver a um reinício (quem estava nela vê a
 * sala sumir e monta de novo). O runtime chama os métodos e manda os eventos; aqui só as
 * regras, sem I/O.
 */
export interface Lobby {
  tv: string;
  room: string;
  dungeon: string;
  leader: string;
  members: RpgLobbyMember[];
  createdAt: number;
  expiresAt: number;
}

export type LobbyResult =
  | { ok: true; lobby: Lobby }
  | { ok: false; reason: string };

export type LobbyEnd = {
  lobby: Lobby;
  ended: "started" | "cancelled" | "expired";
};

export class LobbyHub {
  private readonly byTv = new Map<string, Lobby>();
  /** Em que TV cada pessoa está (uma sala por vez). */
  private readonly memberOf = new Map<string, string>();

  get(tv: string): Lobby | undefined {
    return this.byTv.get(tv);
  }

  /** A sala em que a pessoa está, se houver. */
  of(userId: string): Lobby | undefined {
    const tv = this.memberOf.get(userId);
    return tv ? this.byTv.get(tv) : undefined;
  }

  /** As TVs que têm sala agora. */
  tvs(): string[] {
    return [...this.byTv.keys()];
  }

  inRoom(room: string): Lobby[] {
    return [...this.byTv.values()].filter((l) => l.room === room);
  }

  create(
    tv: string,
    room: string,
    dungeon: string,
    leader: RpgLobbyMember,
    now: number,
  ): LobbyResult {
    const d = dungeonOf(dungeon);
    if (!d) return { ok: false, reason: "unknown_dungeon" };
    if (leader.level < d.minLevel) return { ok: false, reason: "level" };
    if (this.byTv.has(tv)) return { ok: false, reason: "tv_busy" };
    if (this.memberOf.has(leader.user_id))
      return { ok: false, reason: "in_lobby" };
    const lobby: Lobby = {
      tv,
      room,
      dungeon,
      leader: leader.user_id,
      members: [leader],
      createdAt: now,
      expiresAt: now + LOBBY.ttlMs,
    };
    this.byTv.set(tv, lobby);
    this.memberOf.set(leader.user_id, tv);
    return { ok: true, lobby };
  }

  join(tv: string, member: RpgLobbyMember): LobbyResult {
    const lobby = this.byTv.get(tv);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    const current = this.memberOf.get(member.user_id);
    if (current === tv) return { ok: true, lobby };
    if (current) return { ok: false, reason: "in_lobby" };
    if (lobby.members.length >= LOBBY.maxMembers)
      return { ok: false, reason: "full" };
    const d = dungeonOf(lobby.dungeon);
    if (d && member.level < d.minLevel) return { ok: false, reason: "level" };
    lobby.members.push(member);
    this.memberOf.set(member.user_id, tv);
    return { ok: true, lobby };
  }

  /**
   * A pessoa sai (pediu, saiu da sala, desconectou, foi tirada). O líder saindo cancela a sala
   * inteira. Devolve a sala que mudou e se ela acabou.
   */
  leave(userId: string): { lobby: Lobby; ended?: "cancelled" } | null {
    const tv = this.memberOf.get(userId);
    if (!tv) return null;
    const lobby = this.byTv.get(tv);
    this.memberOf.delete(userId);
    if (!lobby) return null;
    if (lobby.leader === userId) {
      this.close(lobby);
      return { lobby, ended: "cancelled" };
    }
    lobby.members = lobby.members.filter((m) => m.user_id !== userId);
    return { lobby };
  }

  /** O líder começa: a sala fecha e o grupo vai para a dungeon (etapa O5). */
  start(userId: string, now: number): LobbyResult {
    const lobby = this.of(userId);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    if (lobby.leader !== userId) return { ok: false, reason: "not_leader" };
    if (now >= lobby.expiresAt) return { ok: false, reason: "expired" };
    this.close(lobby);
    return { ok: true, lobby };
  }

  /** A TV sumiu (decoração mudou): a sala dela acaba. */
  dropTv(tv: string): Lobby | null {
    const lobby = this.byTv.get(tv);
    if (!lobby) return null;
    this.close(lobby);
    return lobby;
  }

  /** Salas que passaram do prazo (chamado no tick do runtime: barato, poucas salas). */
  expire(now: number): Lobby[] {
    const out: Lobby[] = [];
    for (const lobby of [...this.byTv.values()]) {
      if (now >= lobby.expiresAt) {
        this.close(lobby);
        out.push(lobby);
      }
    }
    return out;
  }

  private close(lobby: Lobby) {
    this.byTv.delete(lobby.tv);
    for (const m of lobby.members)
      if (this.memberOf.get(m.user_id) === lobby.tv)
        this.memberOf.delete(m.user_id);
  }
}

export function lobbyView(l: Lobby): RpgLobbyView {
  return {
    tv: l.tv,
    room: l.room,
    dungeon: l.dungeon,
    leader: l.leader,
    members: l.members.map((m) => ({ ...m })),
    max: LOBBY.maxMembers,
    expires_at: l.expiresAt,
  };
}
