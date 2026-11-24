import {
  type RpgLobbyMember,
  type RpgLobbyView,
  type RpgLoopStop,
  type RunOutcome,
  dungeonOf,
  LOBBY,
} from "@muchat/space-core/game/ot";

/**
 * Os grupos nas TVs de um servidor (docs/espaco/jogo/ot, etapa O4). Um por TV, em memória:
 * não precisam sobreviver a um reinício (quem estava nele vê o grupo sumir e monta de novo).
 * O runtime chama os métodos e manda os eventos; aqui só as regras, sem I/O.
 *
 * Desde 24/11/2026 o grupo fica montado entre as corridas ("manter a pt quando a dg acaba"):
 * "forming" até a primeira, "running" com uma rolando, "ready" entre uma e outra. O líder começa
 * a próxima quando quiser, troca a dungeon, ou liga o loop (a próxima começa sozinha depois de
 * cada vitória). Pertencer ao grupo não depende de ficar na sala da TV: só se sai pedindo ou
 * quando o app some de vez (o runtime chama `leave` no fim da reconexão).
 */
export interface Lobby {
  tv: string;
  room: string;
  dungeon: string;
  leader: string;
  members: RpgLobbyMember[];
  createdAt: number;
  expiresAt: number;
  state: "forming" | "running" | "ready";
  runId: string | null;
  runs: number;
  loop: boolean;
  nextAt: number | null;
  last: RunOutcome | null;
  stopped: RpgLoopStop | null;
  stoppedDetail: string | null;
}

export type LobbyResult =
  | { ok: true; lobby: Lobby }
  | { ok: false; reason: string };

export type LobbyEnd = {
  lobby: Lobby;
  ended: "started" | "cancelled" | "expired";
};

/** Durante a corrida o grupo não expira (o fim da corrida dá o prazo de novo). */
const NEVER = Number.MAX_SAFE_INTEGER;

export class LobbyHub {
  private readonly byTv = new Map<string, Lobby>();
  /** Em que TV cada pessoa está (um grupo por vez). */
  private readonly memberOf = new Map<string, string>();

  get(tv: string): Lobby | undefined {
    return this.byTv.get(tv);
  }

  /** O grupo em que a pessoa está, se houver. */
  of(userId: string): Lobby | undefined {
    const tv = this.memberOf.get(userId);
    return tv ? this.byTv.get(tv) : undefined;
  }

  /** As TVs que têm grupo agora. */
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
      state: "forming",
      runId: null,
      runs: 0,
      loop: false,
      nextAt: null,
      last: null,
      stopped: null,
      stoppedDetail: null,
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
   * A pessoa sai (pediu, ou o app sumiu de vez). O líder saindo passa a liderança a quem
   * entrou primeiro depois dele (o loop desliga: o novo líder decide); sem ninguém, o grupo
   * acaba. Devolve o grupo que mudou e se ele acabou.
   */
  leave(userId: string): { lobby: Lobby; ended?: "cancelled" } | null {
    const tv = this.memberOf.get(userId);
    if (!tv) return null;
    const lobby = this.byTv.get(tv);
    this.memberOf.delete(userId);
    if (!lobby) return null;
    lobby.members = lobby.members.filter((m) => m.user_id !== userId);
    if (lobby.members.length === 0) {
      this.close(lobby);
      return { lobby, ended: "cancelled" };
    }
    if (lobby.leader === userId) {
      lobby.leader = lobby.members[0]!.user_id;
      if (lobby.loop) this.stopLoop(lobby, "leader_left");
    }
    return { lobby };
  }

  /** O líder desfaz o grupo inteiro. */
  disband(userId: string): LobbyResult {
    const lobby = this.of(userId);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    if (lobby.leader !== userId) return { ok: false, reason: "not_leader" };
    this.close(lobby);
    return { ok: true, lobby };
  }

  /**
   * O líder começa (ou o loop, por ele): o grupo fica "running" até a corrida fechar. Quem
   * chamou grava a corrida e avisa com `running`; se a gravação falhar, `abort` volta atrás.
   */
  start(userId: string, now: number): LobbyResult {
    const lobby = this.of(userId);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    if (lobby.leader !== userId) return { ok: false, reason: "not_leader" };
    if (lobby.state === "running") return { ok: false, reason: "in_run" };
    if (now >= lobby.expiresAt) return { ok: false, reason: "expired" };
    lobby.state = "running";
    lobby.runId = null;
    lobby.nextAt = null;
    lobby.expiresAt = NEVER;
    // Começou de novo: o motivo da última parada do loop já foi visto.
    lobby.stopped = null;
    lobby.stoppedDetail = null;
    return { ok: true, lobby };
  }

  /** A corrida do grupo foi gravada. */
  running(tv: string, runId: string): void {
    const lobby = this.byTv.get(tv);
    if (lobby && lobby.state === "running") lobby.runId = runId;
  }

  /** A corrida não chegou a começar (gravação falhou): o grupo volta a esperar. */
  abort(tv: string, now: number): Lobby | null {
    const lobby = this.byTv.get(tv);
    if (!lobby || lobby.state !== "running" || lobby.runId) return null;
    lobby.state = lobby.runs > 0 ? "ready" : "forming";
    lobby.expiresAt = now + (lobby.runs > 0 ? LOBBY.idleMs : LOBBY.ttlMs);
    return lobby;
  }

  /**
   * A corrida do grupo fechou: ele fica pronto para a próxima. Com o loop ligado, a próxima
   * fica marcada para daqui a pouco; derrota ou retirada desligam o loop (o grupo ajusta antes
   * de tentar de novo, em vez de perder as poções em sequência).
   */
  runEnded(tv: string, runId: string, outcome: RunOutcome, now: number): Lobby | null {
    const lobby = this.byTv.get(tv);
    if (!lobby || lobby.runId !== runId) return null;
    lobby.state = "ready";
    lobby.runId = null;
    lobby.runs++;
    lobby.last = outcome;
    lobby.expiresAt = now + LOBBY.idleMs;
    if (lobby.loop) {
      if (outcome === "vitoria") lobby.nextAt = now + LOBBY.loopDelayMs;
      else this.stopLoop(lobby, outcome);
    }
    return lobby;
  }

  /** O líder troca a dungeon (entre corridas): todos precisam do level dela. */
  setDungeon(userId: string, dungeon: string): LobbyResult {
    const lobby = this.of(userId);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    if (lobby.leader !== userId) return { ok: false, reason: "not_leader" };
    if (lobby.state === "running") return { ok: false, reason: "in_run" };
    const d = dungeonOf(dungeon);
    if (!d) return { ok: false, reason: "unknown_dungeon" };
    if (lobby.members.some((m) => m.level < d.minLevel))
      return { ok: false, reason: "level" };
    lobby.dungeon = d.id;
    return { ok: true, lobby };
  }

  /**
   * O líder liga ou desliga o loop. Ligando com o grupo pronto depois de uma corrida, a
   * próxima já fica marcada; antes da primeira, ele espera o "Começar".
   */
  setLoop(userId: string, on: boolean, now: number): LobbyResult {
    const lobby = this.of(userId);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    if (lobby.leader !== userId) return { ok: false, reason: "not_leader" };
    lobby.loop = on;
    lobby.stopped = null;
    lobby.stoppedDetail = null;
    lobby.nextAt =
      on && lobby.state === "ready" ? now + LOBBY.loopDelayMs : null;
    return { ok: true, lobby };
  }

  /** O loop não conseguiu começar a próxima (ou ninguém do grupo está aqui): desliga. */
  loopFailed(tv: string, why: RpgLoopStop, detail?: string): Lobby | null {
    const lobby = this.byTv.get(tv);
    if (!lobby) return null;
    this.stopLoop(lobby, why, detail);
    return lobby;
  }

  /** Grupos cuja próxima corrida do loop venceu (o runtime manda começar, pelo líder). */
  due(now: number): Lobby[] {
    return [...this.byTv.values()].filter(
      (l) => l.state === "ready" && l.loop && l.nextAt !== null && now >= l.nextAt,
    );
  }

  /** A TV sumiu (decoração mudou): o grupo dela acaba. */
  dropTv(tv: string): Lobby | null {
    const lobby = this.byTv.get(tv);
    if (!lobby) return null;
    this.close(lobby);
    return lobby;
  }

  /** Grupos parados que passaram do prazo (no tick do runtime: barato, poucos grupos). */
  expire(now: number): Lobby[] {
    const out: Lobby[] = [];
    for (const lobby of [...this.byTv.values()]) {
      if (lobby.state === "running" || lobby.nextAt !== null) continue;
      if (now >= lobby.expiresAt) {
        this.close(lobby);
        out.push(lobby);
      }
    }
    return out;
  }

  private stopLoop(lobby: Lobby, why: RpgLoopStop, detail?: string) {
    lobby.loop = false;
    lobby.nextAt = null;
    lobby.stopped = why;
    lobby.stoppedDetail = detail ?? null;
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
    state: l.state,
    run_id: l.runId,
    runs: l.runs,
    loop: l.loop,
    next_at: l.nextAt,
    last: l.last,
    stopped: l.stopped,
    stopped_detail: l.stoppedDetail,
  };
}
