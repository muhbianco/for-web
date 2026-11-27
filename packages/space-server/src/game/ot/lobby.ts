import { randomUUID } from "node:crypto";

import {
  type DungeonDef,
  type RpgLobbyMember,
  type RpgLobbyView,
  type RpgLoopStop,
  type RpgPrepKind,
  type RpgRunEnd,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";

/** Prazos do grupo (os de antes; o tamanho agora vem da DG: Caçada 1–2, Masmorra e Região 3–4). */
export const LOBBY = {
  /** A sala de preparação some sozinha se ninguém começar. */
  ttlMs: 5 * 60 * 1000,
  /** O grupo que já correu fica montado; desfaz sozinho depois disto sem corrida nenhuma. */
  idleMs: 30 * 60 * 1000,
  /**
   * O loop: a próxima largada é pedida sozinha depois disto (o tempo de ver o resultado); com a
   * contagem, dá os 12 s de antes entre uma corrida e outra.
   */
  loopDelayMs: 9 * 1000,
  /** A contagem antes de cada largada (pedido do dono, 26/11/2026). */
  countdownMs: 3 * 1000,
  /** Quanto a largada espera por quem está na ficha ou num NPC; depois desiste (e avisa quem). */
  prepHoldMaxMs: 5 * 60 * 1000,
} as const;

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
 *
 * Uma TV tem quantos grupos quiserem (24/11/2026: o grupo que ficava montado prendia a TV e
 * ninguém mais montava outro nela); a regra é um grupo por pessoa. Cada grupo tem um id.
 */
export interface Lobby {
  id: string;
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
  last: RpgRunEnd | null;
  stopped: RpgLoopStop | null;
  stoppedDetail: string | null;
  /**
   * A largada pedida que ainda não saiu (26/11/2026): pelo líder ("Começar") ou pelo loop. Espera
   * ninguém estar se preparando (`prep`), conta `countdownMs` e sai pelo runtime (`launchDue`).
   */
  pending: boolean;
  /** A largada pendente veio do loop. */
  pendingAuto: boolean;
  /** Quando a corrida sai; null enquanto alguém se prepara (ou fora de largada). */
  startAt: number | null;
  /** Desde quando a largada espera alguém se preparar. */
  heldSince: number | null;
  /** A largada foi entregue ao serviço (lendo os heróis): não sai de novo no próximo tique. */
  launching: boolean;
  /** Quem está na ficha ou num NPC agora (segura a largada). */
  prep: Map<string, RpgPrepKind>;
}

export type LobbyResult =
  | { ok: true; lobby: Lobby }
  | { ok: false; reason: string };

export type LobbyEnd = {
  lobby: Lobby;
  ended: "started" | "cancelled" | "expired";
};

/**
 * O Chefe de Região só para quem já concluiu as Caçadas e Masmorras da região (pedido do dono,
 * 26/11/2026): cada um do grupo, pelas regiões que o serviço calculou do herói (`regions`).
 */
function bossLocked(d: DungeonDef, m: RpgLobbyMember): boolean {
  return d.kind === "regional" && !(m.regions ?? []).includes(d.region.index);
}

/** Quantos cabem no grupo desta DG (o catálogo; 4 se a DG sumiu). */
function maxOf(dungeon: string): number {
  return dungeonById(dungeon)?.party.max ?? 4;
}

/** Durante a corrida o grupo não expira (o fim da corrida dá o prazo de novo). */
const NEVER = Number.MAX_SAFE_INTEGER;

export class LobbyHub {
  private readonly byId = new Map<string, Lobby>();
  /** Em que grupo cada pessoa está (um por vez). */
  private readonly memberOf = new Map<string, string>();

  get(id: string): Lobby | undefined {
    return this.byId.get(id);
  }

  /** O grupo em que a pessoa está, se houver. */
  of(userId: string): Lobby | undefined {
    const id = this.memberOf.get(userId);
    return id ? this.byId.get(id) : undefined;
  }

  all(): Lobby[] {
    return [...this.byId.values()];
  }

  /** Os grupos de uma TV. */
  atTv(tv: string): Lobby[] {
    return this.all().filter((l) => l.tv === tv);
  }

  /** As TVs que têm grupo agora. */
  tvs(): string[] {
    return [...new Set(this.all().map((l) => l.tv))];
  }

  inRoom(room: string): Lobby[] {
    return this.all().filter((l) => l.room === room);
  }

  create(
    tv: string,
    room: string,
    dungeon: string,
    leader: RpgLobbyMember,
    now: number,
    id: string = randomUUID(),
  ): LobbyResult {
    const d = dungeonById(dungeon);
    if (!d) return { ok: false, reason: "unknown_dungeon" };
    // Sem trava de nível desde 27/11/2026 (o dono: "não vamos mais impedir ninguém de entrar em DG de
    // level mais alto"): o nível mínimo virou só recomendação. O chefe de Região continua trancado.
    if (bossLocked(d, leader)) return { ok: false, reason: "region" };
    if (this.memberOf.has(leader.user_id))
      return { ok: false, reason: "in_lobby" };
    const lobby: Lobby = {
      id,
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
      pending: false,
      pendingAuto: false,
      startAt: null,
      heldSince: null,
      launching: false,
      prep: new Map(),
    };
    this.byId.set(id, lobby);
    this.memberOf.set(leader.user_id, id);
    return { ok: true, lobby };
  }

  /** Entra no grupo `id` (sem id: no primeiro da TV com vaga, fora de corrida). */
  join(
    tv: string,
    id: string | undefined,
    member: RpgLobbyMember,
  ): LobbyResult {
    // Sem id, quem já está num grupo desta TV fica nele (entrar de novo não troca de grupo).
    const mine = this.of(member.user_id);
    if (!id && mine?.tv === tv) return { ok: true, lobby: mine };
    const lobby = id
      ? this.byId.get(id)
      : this.atTv(tv).find(
          (l) => l.state !== "running" && l.members.length < maxOf(l.dungeon),
        );
    if (!lobby || lobby.tv !== tv) return { ok: false, reason: "no_lobby" };
    const current = this.memberOf.get(member.user_id);
    if (current === lobby.id) return { ok: true, lobby };
    if (current) return { ok: false, reason: "in_lobby" };
    if (lobby.members.length >= maxOf(lobby.dungeon))
      return { ok: false, reason: "full" };
    const d = dungeonById(lobby.dungeon);
    if (d && bossLocked(d, member)) return { ok: false, reason: "region" };
    lobby.members.push(member);
    this.memberOf.set(member.user_id, lobby.id);
    return { ok: true, lobby };
  }

  /**
   * A pessoa sai (pediu, ou o app sumiu de vez). O líder saindo passa a liderança a quem
   * entrou primeiro depois dele (o loop desliga: o novo líder decide); sem ninguém, o grupo
   * acaba. Devolve o grupo que mudou e se ele acabou.
   */
  leave(
    userId: string,
    now = Date.now(),
  ): { lobby: Lobby; ended?: "cancelled" } | null {
    const id = this.memberOf.get(userId);
    if (!id) return null;
    const lobby = this.byId.get(id);
    this.memberOf.delete(userId);
    if (!lobby) return null;
    lobby.members = lobby.members.filter((m) => m.user_id !== userId);
    lobby.prep.delete(userId);
    if (lobby.members.length === 0) {
      this.close(lobby);
      return { lobby, ended: "cancelled" };
    }
    if (lobby.leader === userId) {
      lobby.leader = lobby.members[0]!.user_id;
      if (lobby.loop || lobby.pending) this.stopLoop(lobby, "leader_left");
    } else if (lobby.pending) this.schedule(lobby, now);
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
   * O líder pede a largada (26/11/2026): ela espera ninguém estar se preparando, conta 3 s e sai
   * pelo `launchDue` (o runtime entrega ao serviço, que lê os heróis e chama `start`). Pedir de
   * novo com a largada pendente não muda nada.
   */
  requestStart(userId: string, now: number, auto = false): LobbyResult {
    const lobby = this.of(userId);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    if (lobby.leader !== userId) return { ok: false, reason: "not_leader" };
    if (lobby.state === "running") return { ok: false, reason: "in_run" };
    if (lobby.pending) return { ok: true, lobby };
    if (now >= lobby.expiresAt) return { ok: false, reason: "expired" };
    this.pend(lobby, now, auto);
    return { ok: true, lobby };
  }

  /** O líder desiste da largada pendente (o loop desliga junto: ele decide quando volta). */
  cancelStart(userId: string, now: number): LobbyResult {
    const lobby = this.of(userId);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    if (lobby.leader !== userId) return { ok: false, reason: "not_leader" };
    if (!lobby.pending || lobby.launching)
      return { ok: false, reason: "no_start" };
    this.unpend(lobby);
    lobby.loop = false;
    lobby.nextAt = null;
    lobby.expiresAt = now + (lobby.runs > 0 ? LOBBY.idleMs : LOBBY.ttlMs);
    return { ok: true, lobby };
  }

  /**
   * A pessoa abriu (ou fechou, `what` null) a ficha do herói ou um NPC que segura a largada.
   * Devolve o grupo se algo mudou (para avisar todos), null se nada mudou.
   */
  setPrep(userId: string, what: RpgPrepKind | null, now: number): Lobby | null {
    const lobby = this.of(userId);
    if (!lobby) return null;
    if ((lobby.prep.get(userId) ?? null) === what) return null;
    if (what) lobby.prep.set(userId, what);
    else lobby.prep.delete(userId);
    if (lobby.pending && !lobby.launching) this.schedule(lobby, now);
    return lobby;
  }

  /** Largadas cuja contagem acabou: o runtime entrega cada uma ao serviço (uma vez). */
  launchDue(now: number): Lobby[] {
    const out: Lobby[] = [];
    for (const l of this.all())
      if (
        l.pending &&
        !l.launching &&
        l.startAt !== null &&
        now >= l.startAt &&
        l.state !== "running"
      ) {
        l.launching = true;
        out.push(l);
      }
    return out;
  }

  /**
   * Largadas que esperaram demais por alguém na ficha ou num NPC: desistem e avisam quem (o loop
   * desliga). Sem isso, quem esquece a ficha aberta prende o grupo inteiro.
   */
  holdTimeouts(now: number): Lobby[] {
    const out: Lobby[] = [];
    for (const l of this.all())
      if (
        l.pending &&
        !l.launching &&
        l.heldSince !== null &&
        now - l.heldSince >= LOBBY.prepHoldMaxMs
      ) {
        const names = l.members
          .filter((m) => l.prep.has(m.user_id))
          .map((m) => m.name)
          .join(", ");
        this.stopLoop(l, "prep", names);
        l.expiresAt = now + (l.runs > 0 ? LOBBY.idleMs : LOBBY.ttlMs);
        out.push(l);
      }
    return out;
  }

  /**
   * A largada sai de fato (o serviço leu e conferiu os heróis): o grupo fica "running" até a
   * corrida fechar. Quem chamou grava a corrida e avisa com `running`; se a gravação falhar,
   * `abort` volta atrás.
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
    this.unpend(lobby);
    // Começou de novo: o motivo da última parada do loop já foi visto.
    lobby.stopped = null;
    lobby.stoppedDetail = null;
    return { ok: true, lobby };
  }

  /** A corrida do grupo foi gravada. */
  running(id: string, runId: string): void {
    const lobby = this.byId.get(id);
    if (lobby && lobby.state === "running") lobby.runId = runId;
  }

  /** A corrida não chegou a começar (gravação falhou): o grupo volta a esperar. */
  abort(id: string, now: number): Lobby | null {
    const lobby = this.byId.get(id);
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
  runEnded(runId: string, outcome: RpgRunEnd, now: number): Lobby | null {
    const lobby = this.all().find((l) => l.runId === runId);
    if (!lobby) return null;
    lobby.state = "ready";
    lobby.runId = null;
    lobby.runs++;
    lobby.last = outcome;
    lobby.expiresAt = now + LOBBY.idleMs;
    if (lobby.loop) {
      if (outcome === "vitoria") lobby.nextAt = now + LOBBY.loopDelayMs;
      else this.stopLoop(lobby, outcome === "retirada" ? "retreat" : "derrota");
    }
    return lobby;
  }

  /** O líder troca a dungeon (entre corridas): todos precisam do level dela. */
  setDungeon(userId: string, dungeon: string): LobbyResult {
    const lobby = this.of(userId);
    if (!lobby) return { ok: false, reason: "no_lobby" };
    if (lobby.leader !== userId) return { ok: false, reason: "not_leader" };
    if (lobby.state === "running") return { ok: false, reason: "in_run" };
    const d = dungeonById(dungeon);
    if (!d) return { ok: false, reason: "unknown_dungeon" };
    if (lobby.members.some((m) => bossLocked(d, m)))
      return { ok: false, reason: "region" };
    if (lobby.members.length > d.party.max)
      return { ok: false, reason: "party_size" };
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
    // Desligar no meio da contagem do loop desiste dessa largada também.
    if (!on && lobby.pending && lobby.pendingAuto && !lobby.launching)
      this.unpend(lobby);
    lobby.nextAt =
      on && lobby.state === "ready" && !lobby.pending
        ? now + LOBBY.loopDelayMs
        : null;
    return { ok: true, lobby };
  }

  /** O loop não conseguiu começar a próxima (ou ninguém do grupo está aqui): desliga. */
  loopFailed(id: string, why: RpgLoopStop, detail?: string): Lobby | null {
    const lobby = this.byId.get(id);
    if (!lobby) return null;
    this.stopLoop(lobby, why, detail);
    return lobby;
  }

  /**
   * Grupos cuja próxima corrida do loop venceu: a largada fica pedida (espera quem se prepara e
   * conta 3 s, como a do líder). Devolve os que mudaram, para o runtime avisar.
   */
  loopDue(now: number): Lobby[] {
    const out: Lobby[] = [];
    for (const l of this.all())
      if (
        l.state === "ready" &&
        l.loop &&
        !l.pending &&
        l.nextAt !== null &&
        now >= l.nextAt
      ) {
        l.nextAt = null;
        this.pend(l, now, true);
        out.push(l);
      }
    return out;
  }

  /** A TV sumiu (decoração mudou): os grupos dela acabam. */
  dropTv(tv: string): Lobby[] {
    const gone = this.atTv(tv);
    for (const l of gone) this.close(l);
    return gone;
  }

  /** Grupos parados que passaram do prazo (no tick do runtime: barato, poucos grupos). */
  expire(now: number): Lobby[] {
    const out: Lobby[] = [];
    for (const lobby of this.all()) {
      if (lobby.state === "running" || lobby.nextAt !== null || lobby.pending)
        continue;
      if (now >= lobby.expiresAt) {
        this.close(lobby);
        out.push(lobby);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- reinício (27/11/2026)
  // O dono: "é importante que nenhum grupo se perca para seguir na DG pós-deploy". Todo deploy do
  // for-web reinicia o processo e os grupos só existem aqui: no desligamento o runtime grava o
  // `snapshot`; na subida, `restore` os traz de volta e `adopt` refaz, pela corrida gravada, o
  // grupo de uma corrida em andamento que não veio no snapshot (o processo antigo não gravava).

  /** Os grupos como dados simples, para gravar no desligamento (a preparação não vai: é da tela). */
  snapshot(): SavedLobby[] {
    return this.all().map(({ prep: _prep, ...rest }) => structuredClone(rest));
  }

  /**
   * Traz de volta os grupos gravados no desligamento (dado do banco: confere a forma e pula o que
   * não fecha). Grupo "rodando" cuja corrida não está mais em andamento (`activeRuns`) volta pronto
   * para a próxima, com o loop marcado se estava ligado. Quem já está noutro grupo fica de fora.
   */
  restore(saved: readonly unknown[], activeRuns: ReadonlySet<string>, now: number): Lobby[] {
    const out: Lobby[] = [];
    for (const raw of saved) {
      const s = savedLobby(raw);
      if (!s || this.byId.has(s.id)) continue;
      const members = s.members.filter((m) => !this.memberOf.has(m.user_id));
      if (members.length === 0) continue;
      const lobby: Lobby = {
        ...s,
        members,
        leader: members.some((m) => m.user_id === s.leader) ? s.leader : members[0]!.user_id,
        prep: new Map(),
        launching: false,
      };
      if (lobby.state === "running" && (!lobby.runId || !activeRuns.has(lobby.runId))) {
        lobby.state = lobby.runs > 0 || lobby.runId ? "ready" : "forming";
        lobby.runId = null;
        lobby.nextAt = lobby.loop ? now + LOBBY.loopDelayMs : null;
      }
      if (lobby.state === "running") lobby.expiresAt = NEVER;
      // Quem volta precisa de tempo para reconectar antes de o grupo parado vencer.
      else lobby.expiresAt = Math.max(lobby.expiresAt, now + LOBBY.ttlMs);
      if (lobby.pending) {
        lobby.heldSince = null;
        lobby.startAt = Math.max(lobby.startAt ?? now, now + LOBBY.countdownMs);
      }
      this.byId.set(lobby.id, lobby);
      for (const m of members) this.memberOf.set(m.user_id, lobby.id);
      out.push(lobby);
    }
    return out;
  }

  /**
   * O grupo de uma corrida em andamento que não voltou do snapshot: os membros dela, o primeiro
   * como líder, o loop ligado se a corrida saiu do loop (`auto`). Null se a corrida já tem grupo,
   * a DG sumiu ou todos já estão noutro grupo. `ended`: a corrida é uma vitória do loop que acabou
   * de fechar (o grupo estava no intervalo): volta pronto, com a próxima marcada como no `runEnded`.
   */
  adopt(
    run: {
      id: string;
      tv: string;
      room: string;
      dungeon: string;
      members: RpgLobbyMember[];
      auto: boolean;
      ended?: boolean;
    },
    now: number,
  ): Lobby | null {
    if (this.all().some((l) => l.runId === run.id)) return null;
    const ended = run.ended === true;
    const loop = run.auto;
    if (!dungeonById(run.dungeon)) return null;
    const members = run.members.filter((m) => !this.memberOf.has(m.user_id));
    if (members.length === 0) return null;
    const lobby: Lobby = {
      id: randomUUID(),
      tv: run.tv,
      room: run.room,
      dungeon: run.dungeon,
      leader: members[0]!.user_id,
      members,
      createdAt: now,
      expiresAt: ended ? now + LOBBY.idleMs : NEVER,
      state: ended ? "ready" : "running",
      runId: ended ? null : run.id,
      runs: ended ? 1 : 0,
      loop,
      nextAt: ended && loop ? now + LOBBY.loopDelayMs : null,
      last: ended ? "vitoria" : null,
      stopped: null,
      stoppedDetail: null,
      pending: false,
      pendingAuto: false,
      startAt: null,
      heldSince: null,
      launching: false,
      prep: new Map(),
    };
    this.byId.set(lobby.id, lobby);
    for (const m of members) this.memberOf.set(m.user_id, lobby.id);
    return lobby;
  }

  private stopLoop(lobby: Lobby, why: RpgLoopStop, detail?: string) {
    lobby.loop = false;
    lobby.nextAt = null;
    lobby.stopped = why;
    lobby.stoppedDetail = detail ?? null;
    this.unpend(lobby);
  }

  private pend(lobby: Lobby, now: number, auto: boolean) {
    lobby.pending = true;
    lobby.pendingAuto = auto;
    lobby.launching = false;
    lobby.startAt = null;
    lobby.heldSince = null;
    lobby.nextAt = null;
    lobby.expiresAt = NEVER;
    lobby.stopped = null;
    lobby.stoppedDetail = null;
    this.schedule(lobby, now);
  }

  private unpend(lobby: Lobby) {
    lobby.pending = false;
    lobby.pendingAuto = false;
    lobby.launching = false;
    lobby.startAt = null;
    lobby.heldSince = null;
  }

  /** Alguém se preparando: a contagem para; ninguém: ela começa (ou segue, se já corria). */
  private schedule(lobby: Lobby, now: number) {
    const busy = lobby.members.some((m) => lobby.prep.has(m.user_id));
    if (busy) {
      lobby.startAt = null;
      lobby.heldSince ??= now;
    } else {
      lobby.heldSince = null;
      lobby.startAt ??= now + LOBBY.countdownMs;
    }
  }

  private close(lobby: Lobby) {
    this.byId.delete(lobby.id);
    for (const m of lobby.members)
      if (this.memberOf.get(m.user_id) === lobby.id)
        this.memberOf.delete(m.user_id);
  }
}

/** Um grupo gravado no desligamento: o grupo sem a preparação (que é da tela de cada um). */
export type SavedLobby = Omit<Lobby, "prep">;

const STATES = new Set(["forming", "running", "ready"]);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strOrNull = (v: unknown) => v === null || isStr(v);
const numOrNull = (v: unknown) => v === null || isNum(v);

/** O grupo lido do banco é entrada não confiável: só volta se a forma fechar. */
export function savedLobby(raw: unknown): SavedLobby | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (!isStr(v.id) || !isStr(v.tv) || !isStr(v.room) || !isStr(v.dungeon) || !isStr(v.leader)) return null;
  if (!STATES.has(v.state as string) || !strOrNull(v.runId)) return null;
  if (!isNum(v.createdAt) || !isNum(v.expiresAt) || !isNum(v.runs)) return null;
  if (typeof v.loop !== "boolean" || !numOrNull(v.nextAt)) return null;
  if (!strOrNull(v.last) || !strOrNull(v.stopped) || !strOrNull(v.stoppedDetail)) return null;
  if (typeof v.pending !== "boolean" || typeof v.pendingAuto !== "boolean") return null;
  if (!numOrNull(v.startAt) || !numOrNull(v.heldSince)) return null;
  if (!Array.isArray(v.members) || v.members.length === 0 || v.members.length > 10) return null;
  const members: RpgLobbyMember[] = [];
  for (const m of v.members) {
    const x = m as Record<string, unknown>;
    if (!x || !isStr(x.user_id) || !isStr(x.name) || !isStr(x.cls) || !isNum(x.level)) return null;
    const regions = Array.isArray(x.regions) && x.regions.every(isNum) ? (x.regions as number[]) : undefined;
    members.push({
      user_id: x.user_id,
      name: x.name,
      cls: x.cls as RpgLobbyMember["cls"],
      level: x.level,
      ...(regions ? { regions } : {}),
    });
  }
  return {
    id: v.id,
    tv: v.tv,
    room: v.room,
    dungeon: v.dungeon,
    leader: v.leader,
    members,
    createdAt: v.createdAt,
    expiresAt: v.expiresAt,
    state: v.state as Lobby["state"],
    runId: (v.runId as string | null) ?? null,
    runs: v.runs,
    loop: v.loop,
    nextAt: (v.nextAt as number | null) ?? null,
    last: (v.last as RpgRunEnd | null) ?? null,
    stopped: (v.stopped as RpgLoopStop | null) ?? null,
    stoppedDetail: (v.stoppedDetail as string | null) ?? null,
    pending: v.pending,
    pendingAuto: v.pendingAuto,
    startAt: (v.startAt as number | null) ?? null,
    heldSince: (v.heldSince as number | null) ?? null,
    launching: false,
  };
}

export function lobbyView(l: Lobby): RpgLobbyView {
  return {
    id: l.id,
    tv: l.tv,
    room: l.room,
    dungeon: l.dungeon,
    leader: l.leader,
    members: l.members.map((m) => ({ ...m })),
    max: maxOf(l.dungeon),
    expires_at: l.expiresAt,
    state: l.state,
    run_id: l.runId,
    runs: l.runs,
    loop: l.loop,
    next_at: l.nextAt,
    last: l.last,
    stopped: l.stopped,
    stopped_detail: l.stoppedDetail,
    pending: l.pending,
    pending_auto: l.pending && l.pendingAuto,
    start_at: l.pending ? l.startAt : null,
    prep: l.members
      .filter((m) => l.prep.has(m.user_id))
      .map((m) => ({ user_id: m.user_id, what: l.prep.get(m.user_id)! })),
  };
}
