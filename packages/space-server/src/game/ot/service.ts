import { randomInt, randomUUID } from "node:crypto";

import {
  type Rates,
  type RpgCommand,
  type RpgLobbyMember,
  type RpgRunEndView,
  type RpgRunEvent,
  type RpgRunFeedItem,
  type RpgRunTickEvent,
  type RpgRunView,
  type RpgStateEvent,
  type RunResult,
  DEFAULT_RATES,
  dungeonOf,
  RUN,
  runReward,
  runStaminaCost,
  simulateRun,
} from "@muchat/space-core/game/ot";

import type { Log } from "../../log.ts";
import type { SessionPort, Viewer } from "../../space/runtime.ts";
import { TokenBucket } from "../../ws/ratelimit.ts";
import {
  type RpgHeroDoc,
  type RpgOutcome,
  applyVocation,
  heroRunSnapshot,
  inRun,
  markRun,
  newRpgHero,
  normalizeHero,
  settleRun,
  RPG_DOC_MAX_BYTES,
  rpgDocBytes,
  rpgHeroView,
  startTraining,
  stopTraining,
  trainingExpired,
} from "./hero.ts";
import { type Lobby, type LobbyResult, lobbyView } from "./lobby.ts";
import {
  type RpgRunDoc,
  type RunStore,
  MemoryRunStore,
  RUNS_RESUME_LIMIT,
} from "./runs.ts";
import type { RpgStore } from "./store.ts";

/** O que o jogo idle precisa do Espaço em que a pessoa está; o SpaceRuntime implementa. */
export interface RpgHost {
  readonly serverId: string;
  gameAccess(viewer: Viewer): "ok" | "disabled" | "not_allowed";
  /** O dummy `instanceId` existe, é de treino, a pessoa pode usá-lo e está ao lado dele. */
  trainSpot(
    viewer: Viewer,
    instanceId: string,
  ): { ok: true; zone: string } | { ok: false; code: string; reason?: string };
  /** O runtime ainda vê a pessoa treinando neste dummy. */
  isTrainingAt(userId: string, instanceId: string): boolean;
  setTraining(userId: string, instanceId: string | null): void;
  /** The hero's level under the person's name on the map (null: no hero). */
  setHeroLevel(userId: string, level: number | null): void;
  sessionOf(userId: string): SessionPort | null;
  displayName(userId: string): string;
  /** A TV numa sala, ao lado da pessoa, dentro da sala (etapa O4). */
  tvSpot(
    viewer: Viewer,
    tv: string,
  ): { ok: true; room: string } | { ok: false; code: string; reason?: string };
  lobbyCreate(
    tv: string,
    room: string,
    dungeon: string,
    member: RpgLobbyMember,
  ): LobbyResult;
  lobbyJoin(tv: string, member: RpgLobbyMember): LobbyResult;
  lobbyLeave(userId: string): void;
  lobbyStart(userId: string): LobbyResult;
  /** O grupo em que a pessoa está, sem mexer nele (para validar antes de começar). */
  lobbyOf(userId: string): Lobby | undefined;
  /** Para todos na sala do mapa e para estas pessoas onde estiverem (uma vez cada). */
  sendRun(room: string, userIds: readonly string[], ev: Record<string, unknown>): void;
}

/** O registro que vai para quem chega no meio da corrida. */
const FEED_MAX = 40;
/** Uma corrida que não conseguiu fechar tenta de novo depois disto. */
const SETTLE_RETRY_MS = 30_000;

interface ActiveRun {
  doc: RpgRunDoc;
  /** Os quadros, refeitos da semente; null se as regras mudaram desde o início. */
  result: RunResult | null;
  /** O último segundo já enviado. */
  sent: number;
  settling: boolean;
  nextTry: number;
}

/** Comandos por pessoa (além do balde de 20/s da conexão), como no Refúgio. */
export const RPG_RATE = { rate: 4, burst: 8 };
const DEDUPE_IDS = 32;

/**
 * O jogo idle no servidor (docs/espaco/jogo/ot, etapa O2). Um herói por conta, comandos de
 * uma pessoa em fila (duas abas não agem em dobro), o servidor como autoridade e nenhum
 * timer: o tempo treinado é calculado quando o treino fecha.
 */
export class RpgService {
  private readonly store: RpgStore;
  private readonly log: Log;
  private readonly now: () => number;
  private readonly rates: Rates;
  private readonly cacheMax: number;
  private readonly cache = new Map<string, RpgHeroDoc>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly recent = new Map<string, string[]>();
  private readonly runStore: RunStore;
  private readonly autoTick: boolean;
  private readonly active = new Map<string, ActiveRun>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private hostOf: (serverId: string) => RpgHost | null = () => null;

  constructor(deps: {
    store: RpgStore;
    log: Log;
    now?: () => number;
    rates?: Rates;
    cacheMax?: number;
    runStore?: RunStore;
    /** false nos testes: o teste chama `tickRuns()`. */
    autoTick?: boolean;
  }) {
    this.store = deps.store;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.rates = deps.rates ?? DEFAULT_RATES;
    this.cacheMax = deps.cacheMax ?? 500;
    this.runStore = deps.runStore ?? new MemoryRunStore();
    this.autoTick = deps.autoTick ?? true;
  }

  /** Como achar o Espaço de um servidor (o registry; só os que estão no ar). */
  setHosts(hostOf: (serverId: string) => RpgHost | null): void {
    this.hostOf = hostOf;
  }

  /** Alguém entrou numa sala do mapa: se há corrida dessa sala, ele vê. */
  roomEntered(host: RpgHost, userId: string, room: string): void {
    const session = host.sessionOf(userId);
    if (!session) return;
    for (const run of this.active.values()) {
      if (run.doc.server !== host.serverId || run.doc.room !== room) continue;
      session.send(this.runSnapshot(run) as unknown as Record<string, unknown>);
    }
  }

  /** Corridas em andamento no banco (reinício, redeploy): voltam e fecham na hora. */
  async resumeRuns(): Promise<number> {
    const docs = await this.runStore.running(RUNS_RESUME_LIMIT);
    let n = 0;
    for (const doc of docs) {
      if (this.active.has(doc._id)) continue;
      const result = this.replay(doc);
      const sec = Math.floor((this.now() - doc.started_at) / 1000);
      this.activate(doc, result, Math.max(-1, Math.min(sec, doc.seconds - 1)));
      n++;
    }
    return n;
  }

  /** Para o relógio das corridas (desligamento; o banco guarda o que falta). */
  stopRuns(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /**
   * Um segundo das corridas: manda os quadros que chegaram e fecha a que acabou. Chamado pelo
   * relógio de 1 s, que só existe enquanto há corrida. A promessa é a dos fechamentos.
   */
  tickRuns(): Promise<void> {
    const now = this.now();
    const settling: Promise<void>[] = [];
    for (const run of [...this.active.values()]) {
      if (now >= run.doc.ends_at) {
        if (!run.settling && now >= run.nextTry)
          settling.push(this.settleRunDoc(run));
        continue;
      }
      if (!run.result) continue;
      const sec = Math.min(
        Math.floor((now - run.doc.started_at) / 1000),
        run.result.frames.length - 1,
      );
      if (sec <= run.sent) continue;
      const frames = run.result.frames.slice(run.sent + 1, sec + 1);
      run.sent = sec;
      const ev: RpgRunTickEvent = {
        v: 1,
        t: "rpg.run.tick",
        d: { id: run.doc._id, frames },
      };
      this.hostOf(run.doc.server)?.sendRun(
        run.doc.room,
        run.doc.heroes.map((h) => h.userId),
        ev as unknown as Record<string, unknown>,
      );
    }
    if (this.active.size === 0) this.stopRuns();
    return Promise.all(settling).then(() => undefined);
  }

  /** Corridas em andamento (testes e diagnóstico). */
  activeRuns(): RpgRunDoc[] {
    return [...this.active.values()].map((r) => r.doc);
  }

  /** Entrada do gateway: comando já validado pelo zod. Responde na mesma sessão. */
  handle(session: SessionPort, host: RpgHost, cmd: RpgCommand): void {
    const userId = session.viewer.user._id;
    const fail = (code: string, reason?: string) =>
      session.send({
        v: 1,
        t: "error",
        re: cmd.id,
        d: { code, ...(reason ? { reason } : {}) },
      });
    if (this.bucketOf(userId).take(this.now()) !== "ok")
      return fail("rate_limited");
    const access = host.gameAccess(session.viewer);
    if (access === "disabled") return fail("game_disabled");
    if (access === "not_allowed") return fail("not_allowed");
    this.enqueue(
      userId,
      () => this.run(session, host, cmd),
      () => fail("internal"),
    );
  }

  /**
   * O runtime avisa que a pessoa saiu de perto do dummy (andou, trocou de sala, foi tirada
   * do Espaço, o dummy sumiu): o treino fecha agora e quem estiver conectado recebe o estado.
   */
  trainingLeft(host: RpgHost, userId: string): void {
    this.enqueue(
      userId,
      async () => {
        const doc = await this.mutate(userId, false, (d) =>
          stopTraining(d, this.now(), this.rates)
            ? { ok: true }
            : { ok: false, reason: "no_training" },
        );
        if (doc && "doc" in doc)
          this.push(host.sessionOf(userId), doc.doc, undefined, host);
      },
      () => undefined,
    );
  }

  /**
   * Alguém entrou no mapa onde o jogo está ligado: o level do herói (se houver) aparece sob
   * o nome. Uma leitura por entrada, servida pelo cache depois.
   */
  avatarJoined(host: RpgHost, userId: string): void {
    this.enqueue(
      userId,
      async () => {
        const doc = await this.load(userId);
        host.setHeroLevel(userId, doc ? doc.level : null);
      },
      () => undefined,
    );
  }

  /** Espera a fila de uma pessoa esvaziar (testes). */
  async idle(userId: string): Promise<void> {
    await this.queues.get(userId);
  }

  private enqueue(
    userId: string,
    job: () => Promise<void>,
    onError: () => void,
  ) {
    const prev = this.queues.get(userId) ?? Promise.resolve();
    const next = prev
      .then(job)
      .catch((err) => {
        this.log.error("rpg command failed", { err: String(err) });
        onError();
      })
      .finally(() => {
        if (this.queues.get(userId) === next) this.queues.delete(userId);
      });
    this.queues.set(userId, next);
  }

  private async run(
    session: SessionPort,
    host: RpgHost,
    cmd: RpgCommand,
  ): Promise<void> {
    const userId = session.viewer.user._id;
    const now = this.now();
    const fail = (code: string, reason?: string) =>
      session.send({
        v: 1,
        t: "error",
        re: cmd.id,
        d: { code, ...(reason ? { reason } : {}) },
      });

    // Reenvio de um comando já aplicado (reconexão): devolve o estado, não age de novo.
    if (
      cmd.t !== "rpg.open" &&
      !cmd.t.startsWith("rpg.lobby.") &&
      this.recent.get(userId)?.includes(cmd.id)
    ) {
      return this.push(session, await this.load(userId), cmd.id, host);
    }

    switch (cmd.t) {
      case "rpg.open": {
        const cur = await this.load(userId);
        // Um treino que o runtime não vê mais (reconexão, reinício, outro servidor) ou que
        // esgotou o orçamento fecha agora, como o treino offline do OT ao voltar.
        const stale =
          cur?.training &&
          (cur.training.server !== host.serverId ||
            !host.isTrainingAt(userId, cur.training.instance) ||
            trainingExpired(cur, now));
        if (!cur || !stale) {
          this.push(session, cur, cmd.id, host);
          return this.sendOwnRun(session, cur);
        }
        const out = await this.mutate(userId, false, (d) =>
          stopTraining(d, now, this.rates)
            ? { ok: true }
            : { ok: false, reason: "no_training" },
        );
        if (cur.training) host.setTraining(userId, null);
        if (out && "doc" in out)
          return this.push(session, out.doc, cmd.id, host);
        return this.push(session, await this.load(userId), cmd.id, host);
      }
      case "rpg.vocation": {
        const out = await this.mutate(userId, true, (d) =>
          applyVocation(d, cmd.d.vocation),
        );
        if (!out) return fail("conflict");
        if ("reason" in out) return fail("rpg_invalid", out.reason);
        this.remember(userId, cmd.id);
        return this.push(session, out.doc, cmd.id, host);
      }
      case "rpg.train.start": {
        const spot = host.trainSpot(session.viewer, cmd.d.instance);
        if (!spot.ok) return fail(spot.code, spot.reason);
        const where = {
          instance: cmd.d.instance,
          server: host.serverId,
          zone: spot.zone,
        };
        const out = await this.mutate(userId, true, (d) =>
          startTraining(d, where, cmd.d.skill, now, this.rates),
        );
        if (!out) return fail("conflict");
        if ("reason" in out) return fail("rpg_invalid", out.reason);
        host.setTraining(userId, cmd.d.instance);
        this.remember(userId, cmd.id);
        return this.push(session, out.doc, cmd.id, host);
      }
      case "rpg.train.stop": {
        const out = await this.mutate(userId, false, (d) =>
          stopTraining(d, now, this.rates)
            ? { ok: true }
            : { ok: false, reason: "no_training" },
        );
        host.setTraining(userId, null);
        if (!out)
          return this.push(session, await this.load(userId), cmd.id, host);
        if ("reason" in out)
          return this.push(session, await this.load(userId), cmd.id, host);
        this.remember(userId, cmd.id);
        return this.push(session, out.doc, cmd.id, host);
      }
      case "rpg.lobby.create":
      case "rpg.lobby.join": {
        const spot = host.tvSpot(session.viewer, cmd.d.tv);
        if (!spot.ok) return fail(spot.code, spot.reason);
        const hero = await this.load(userId);
        if (!hero || hero.vocation === 0)
          return fail("rpg_invalid", "no_vocation");
        if (inRun(hero, now)) return fail("rpg_invalid", "in_run");
        const member: RpgLobbyMember = {
          user_id: userId,
          name: host.displayName(userId),
          vocation: hero.vocation,
          level: hero.level,
        };
        const res =
          cmd.t === "rpg.lobby.create"
            ? host.lobbyCreate(cmd.d.tv, spot.room, cmd.d.dungeon, member)
            : host.lobbyJoin(cmd.d.tv, member);
        if (!res.ok) return fail("rpg_invalid", res.reason);
        return session.send({
          v: 1,
          t: "rpg.lobby",
          re: cmd.id,
          d: { tv: res.lobby.tv, lobby: lobbyView(res.lobby) },
        });
      }
      case "rpg.lobby.leave": {
        host.lobbyLeave(userId);
        return session.send({
          v: 1,
          t: "rpg.lobby",
          re: cmd.id,
          d: { tv: "", lobby: null },
        });
      }
      case "rpg.lobby.start": {
        const started = await this.startRun(host, userId);
        if (!started.ok) return fail(started.code, started.reason);
        const res = started.res;
        return session.send({
          v: 1,
          t: "rpg.lobby",
          re: cmd.id,
          d: {
            tv: res.lobby.tv,
            lobby: null,
            ended: "started",
            started: { dungeon: res.lobby.dungeon, members: res.lobby.members },
          },
        });
      }
    }
  }

  /**
   * Lê, aplica e grava com CAS (uma nova tentativa se outro processo gravou antes).
   * `create`: sem herói, nasce um no primeiro uso. Devolve o documento gravado, o motivo
   * da recusa, ou null se não há herói (e `create` é falso) ou o conflito persistiu.
   */
  private async mutate(
    userId: string,
    create: boolean,
    fn: (d: RpgHeroDoc) => RpgOutcome,
  ): Promise<{ doc: RpgHeroDoc } | { reason: string } | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await this.load(userId, attempt > 0);
      const now = this.now();
      if (!cur && !create) return null;
      const next = cur ? structuredClone(cur) : newRpgHero(userId, now);
      const out = fn(next);
      if (!out.ok) return { reason: out.reason };
      next.updated_at = now;
      if (rpgDocBytes(next) > RPG_DOC_MAX_BYTES) {
        this.log.error("rpg hero too large", { bytes: rpgDocBytes(next) });
        return { reason: "too_large" };
      }
      if (!cur) {
        if (await this.store.create(next)) {
          this.keep(next);
          return { doc: next };
        }
      } else {
        next.rev = cur.rev + 1;
        if (await this.store.save(next, cur.rev)) {
          this.keep(next);
          return { doc: next };
        }
      }
      this.cache.delete(userId);
    }
    return null;
  }

  /**
   * O líder começa (etapa O5). Lê e valida todos, calcula a corrida inteira, fecha o grupo
   * (só se ele não mudou enquanto os heróis eram lidos), grava a corrida e marca cada herói.
   * Quem não pôde ser marcado (corrida que começou em outro lugar no meio) corre sem levar.
   */
  private async startRun(
    host: RpgHost,
    userId: string,
  ): Promise<
    | { ok: true; res: Extract<LobbyResult, { ok: true }> }
    | { ok: false; code: string; reason?: string }
  > {
    const peek = host.lobbyOf(userId);
    if (!peek) return { ok: false, code: "rpg_invalid", reason: "no_lobby" };
    if (peek.leader !== userId)
      return { ok: false, code: "rpg_invalid", reason: "not_leader" };
    const dungeon = dungeonOf(peek.dungeon);
    if (!dungeon)
      return { ok: false, code: "rpg_invalid", reason: "unknown_dungeon" };
    const members = peek.members.map((m) => ({ ...m }));
    const docs = await Promise.all(members.map((m) => this.load(m.user_id, true)));
    const now = this.now();
    for (const d of docs) {
      if (!d || d.vocation === 0)
        return { ok: false, code: "rpg_invalid", reason: "no_vocation" };
      if (d.level < dungeon.minLevel)
        return { ok: false, code: "rpg_invalid", reason: "level" };
      if (inRun(d, now)) return { ok: false, code: "rpg_invalid", reason: "in_run" };
    }
    const heroes = docs.map((d, i) => heroRunSnapshot(d!, members[i]!.name, now));
    const seed = randomInt(0, 0xffff_ffff);
    const result = simulateRun({
      seed,
      dungeon: dungeon.id,
      heroes,
      rateLoot: this.rates.loot,
    });
    // Sem espera entre conferir e fechar: o grupo é o mesmo que foi lido.
    const again = host.lobbyOf(userId);
    const ids = (l: { members: { user_id: string }[] }) =>
      l.members.map((m) => m.user_id).join(",");
    if (!again || again.leader !== userId || ids(again) !== ids(peek))
      return { ok: false, code: "rpg_invalid", reason: "changed" };
    const res = host.lobbyStart(userId);
    if (!res.ok) return { ok: false, code: "rpg_invalid", reason: res.reason };
    const doc: RpgRunDoc = {
      _id: randomUUID(),
      v: 1,
      engine: RUN.engine,
      server: host.serverId,
      room: res.lobby.room,
      tv: res.lobby.tv,
      dungeon: dungeon.id,
      seed,
      rate_loot: this.rates.loot,
      started_at: now,
      ends_at: now + result.seconds * 1000,
      heroes,
      outcome: result.outcome,
      seconds: result.seconds,
      results: result.members,
      rewards: heroes.map((h, i) =>
        runReward(h, result.members[i]!, result.outcome, this.rates),
      ),
      status: "running",
      settled_at: null,
    };
    try {
      await this.runStore.create(doc);
    } catch (err) {
      this.log.error("rpg run create failed", { err: String(err) });
      return { ok: false, code: "internal" };
    }
    const mark = { id: doc._id, dungeon: dungeon.id, ends_at: doc.ends_at };
    await Promise.all(
      members.map(async (m) => {
        const job = async () => {
          const out = await this.mutate(m.user_id, false, (d) =>
            markRun(d, mark, this.now(), this.rates),
          );
          if (out && "doc" in out)
            this.push(host.sessionOf(m.user_id), out.doc, undefined, host);
          else
            this.log.warn("rpg run member not marked", {
              run: doc._id,
              user: m.user_id,
              reason: out && "reason" in out ? out.reason : "conflict",
            });
        };
        // A fila do líder é esta; a dos outros espera a vez deles.
        if (m.user_id === userId) await job();
        else await this.inQueue(m.user_id, job);
      }),
    );
    const run = this.activate(doc, result, 0);
    host.sendRun(
      doc.room,
      members.map((m) => m.user_id),
      this.runSnapshot(run) as unknown as Record<string, unknown>,
    );
    this.log.info("rpg run started", {
      server: doc.server,
      run: doc._id,
      dungeon: doc.dungeon,
      members: heroes.length,
      outcome: doc.outcome,
      seconds: doc.seconds,
    });
    return { ok: true, res };
  }

  private activate(doc: RpgRunDoc, result: RunResult | null, sent: number) {
    const run: ActiveRun = { doc, result, sent, settling: false, nextTry: 0 };
    this.active.set(doc._id, run);
    if (!this.ticker && this.autoTick) {
      this.ticker = setInterval(() => void this.tickRuns(), 1000);
      this.ticker.unref?.();
    }
    return run;
  }

  /** Refaz os quadros da semente; só serve se as regras e o resultado batem com o gravado. */
  private replay(doc: RpgRunDoc): RunResult | null {
    if (doc.engine !== RUN.engine) return null;
    try {
      const r = simulateRun({
        seed: doc.seed,
        dungeon: doc.dungeon,
        heroes: doc.heroes,
        rateLoot: doc.rate_loot,
      });
      const same =
        r.outcome === doc.outcome &&
        r.seconds === doc.seconds &&
        r.members.every((m, i) => m.exp === doc.results[i]?.exp);
      return same ? r : null;
    } catch (err) {
      this.log.warn("rpg run replay failed", { run: doc._id, err: String(err) });
      return null;
    }
  }

  private runView(doc: RpgRunDoc): RpgRunView {
    return {
      id: doc._id,
      tv: doc.tv,
      room: doc.room,
      dungeon: doc.dungeon,
      started_at: doc.started_at,
      ends_at: doc.ends_at,
      members: doc.heroes.map((h) => ({
        user_id: h.userId,
        name: h.name,
        vocation: h.vocation,
        level: h.level,
        health_max: h.healthMax,
        mana_max: h.manaMax,
        gear: h.gear,
      })),
    };
  }

  /** A corrida até o segundo de agora: o último quadro e o registro recente. */
  private runSnapshot(run: ActiveRun, end?: RpgRunEndView): RpgRunEvent {
    const frames = run.result?.frames ?? [];
    const sec = end
      ? frames.length - 1
      : Math.min(
          Math.floor((this.now() - run.doc.started_at) / 1000),
          frames.length - 1,
        );
    const feed: RpgRunFeedItem[] = [];
    for (let i = sec; i >= 0 && feed.length < FEED_MAX; i--) {
      const f = frames[i]!;
      for (let k = f.e.length - 1; k >= 0 && feed.length < FEED_MAX; k--)
        feed.push({ ...f.e[k]!, at: f.s, st: f.st });
    }
    feed.reverse();
    return {
      v: 1,
      t: "rpg.run",
      d: {
        run: this.runView(run.doc),
        frame: sec >= 0 ? (frames[sec] ?? null) : null,
        feed,
        ...(end ? { end } : {}),
      },
    };
  }

  /** O membro que abre o app no meio da corrida vê a corrida dele. */
  private sendOwnRun(session: SessionPort, doc: RpgHeroDoc | null) {
    const id = doc?.run?.id;
    const run = id ? this.active.get(id) : undefined;
    if (run)
      session.send(this.runSnapshot(run) as unknown as Record<string, unknown>);
  }

  /**
   * Fecha a corrida: cada herói na fila dele (a marca garante uma vez só), depois a corrida no
   * banco, depois o resumo para a sala. Erro de banco: tenta de novo em 30 s.
   */
  private async settleRunDoc(run: ActiveRun): Promise<void> {
    run.settling = true;
    const { doc } = run;
    const now = this.now();
    const host = this.hostOf(doc.server);
    try {
      const cost = runStaminaCost(doc.seconds);
      for (let i = 0; i < doc.heroes.length; i++) {
        const userId = doc.heroes[i]!.userId;
        await this.inQueue(userId, async () => {
          const out = await this.mutate(userId, false, (d) => {
            const r = settleRun(d, doc._id, doc.rewards[i] ?? null, cost, now);
            return r.ok ? { ok: true } : r;
          });
          if (out && "doc" in out)
            this.push(host?.sessionOf(userId) ?? null, out.doc, undefined, host);
        });
      }
      await this.runStore.settle(doc._id, now);
      this.active.delete(doc._id);
      const end: RpgRunEndView = {
        outcome: doc.outcome,
        members: doc.heroes.map((h, i) => {
          const r = doc.rewards[i];
          return {
            user_id: h.userId,
            dead: doc.results[i]?.dead ?? false,
            reward: r
              ? {
                  exp: r.exp,
                  gold: r.gold,
                  loot: r.loot,
                  tries: r.tries,
                  mana_spent: r.manaSpent,
                }
              : null,
          };
        }),
      };
      host?.sendRun(
        doc.room,
        doc.heroes.map((h) => h.userId),
        this.runSnapshot(run, end) as unknown as Record<string, unknown>,
      );
      this.log.info("rpg run settled", {
        server: doc.server,
        run: doc._id,
        outcome: doc.outcome,
      });
    } catch (err) {
      run.settling = false;
      run.nextTry = this.now() + SETTLE_RETRY_MS;
      this.log.error("rpg run settle failed", { run: doc._id, err: String(err) });
    }
  }

  /** Roda `fn` na fila de outra pessoa e devolve o resultado (erros sobem para quem chamou). */
  private inQueue<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.enqueue(
        userId,
        async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          }
        },
        () => undefined,
      );
    });
  }

  private push(
    session: SessionPort | null,
    doc: RpgHeroDoc | null,
    re: string | undefined,
    host: RpgHost | null,
  ) {
    // O level sob o nome acompanha o herói (quem tem herói aparece com ele).
    if (doc) host?.setHeroLevel(doc._id, doc.level);
    if (!session) return;
    const ev: RpgStateEvent = {
      v: 1,
      t: "rpg.state",
      ...(re ? { re } : {}),
      d: {
        server_now: this.now(),
        rev: doc?.rev ?? 0,
        hero: doc ? rpgHeroView(doc, this.rates, this.now()) : null,
      },
    };
    session.send(ev as unknown as Record<string, unknown>);
  }

  private async load(
    userId: string,
    fresh = false,
  ): Promise<RpgHeroDoc | null> {
    if (!fresh) {
      const hit = this.cache.get(userId);
      if (hit) {
        this.cache.delete(userId);
        this.cache.set(userId, hit);
        return structuredClone(hit);
      }
    }
    const raw = await this.store.get(userId);
    const doc = raw ? normalizeHero(raw) : null;
    if (doc) this.keep(doc);
    else this.cache.delete(userId);
    return doc ? structuredClone(doc) : null;
  }

  private keep(doc: RpgHeroDoc) {
    this.cache.delete(doc._id);
    this.cache.set(doc._id, structuredClone(doc));
    while (this.cache.size > this.cacheMax) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private remember(userId: string, id: string) {
    const ids = this.recent.get(userId) ?? [];
    ids.push(id);
    while (ids.length > DEDUPE_IDS) ids.shift();
    this.recent.set(userId, ids);
  }

  private bucketOf(userId: string): TokenBucket {
    let b = this.buckets.get(userId);
    if (!b) {
      b = new TokenBucket(RPG_RATE.rate, RPG_RATE.burst, 10_000, this.now());
      this.buckets.set(userId, b);
      // Sem herói em cache o balde não sai pela LRU: limite próprio.
      if (this.buckets.size > this.cacheMax * 2)
        this.buckets.delete(this.buckets.keys().next().value as string);
    }
    return b;
  }
}

/**
 * Taxas do operador: `SPACE_GAME_RATES="exp=5,skill=2,magic=2,loot=2"`. Lidas direto do
 * ambiente (o `env()` do main.ts derruba o processo quando a variável falta, e com ele a voz
 * das salas). Chave ausente ou inválida fica no padrão.
 */
export function ratesFromEnv(raw: string | undefined): Rates {
  const out: Rates = { ...DEFAULT_RATES };
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [k, v] = part.split("=").map((x) => x.trim());
    const n = Number(v);
    if (!k || !Number.isFinite(n) || n <= 0 || n > 1_000) continue;
    if (k === "exp" || k === "skill" || k === "magic" || k === "loot")
      out[k] = n;
  }
  return out;
}
