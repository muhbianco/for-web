import {
  type Rates,
  type RpgCommand,
  type RpgStateEvent,
  DEFAULT_RATES,
} from "@muchat/space-core/game/ot";

import type { Log } from "../../log.ts";
import type { SessionPort, Viewer } from "../../space/runtime.ts";
import { TokenBucket } from "../../ws/ratelimit.ts";
import {
  type RpgHeroDoc,
  type RpgOutcome,
  applyVocation,
  newRpgHero,
  RPG_DOC_MAX_BYTES,
  rpgDocBytes,
  rpgHeroView,
  startTraining,
  stopTraining,
  trainingExpired,
} from "./hero.ts";
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

  constructor(deps: {
    store: RpgStore;
    log: Log;
    now?: () => number;
    rates?: Rates;
    cacheMax?: number;
  }) {
    this.store = deps.store;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.rates = deps.rates ?? DEFAULT_RATES;
    this.cacheMax = deps.cacheMax ?? 500;
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
    if (cmd.t !== "rpg.open" && this.recent.get(userId)?.includes(cmd.id)) {
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
        if (!cur || !stale) return this.push(session, cur, cmd.id, host);
        const out = await this.mutate(userId, false, (d) =>
          stopTraining(d, now, this.rates)
            ? { ok: true }
            : { ok: false, reason: "no_training" },
        );
        if (cur.training) host.setTraining(userId, null);
        if (out && "doc" in out) return this.push(session, out.doc, cmd.id, host);
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
        if (!out) return this.push(session, await this.load(userId), cmd.id, host);
        if ("reason" in out)
          return this.push(session, await this.load(userId), cmd.id, host);
        this.remember(userId, cmd.id);
        return this.push(session, out.doc, cmd.id, host);
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

  private push(
    session: SessionPort | null,
    doc: RpgHeroDoc | null,
    re: string | undefined,
    host: RpgHost,
  ) {
    // O level sob o nome acompanha o herói (quem tem herói aparece com ele).
    if (doc) host.setHeroLevel(doc._id, doc.level);
    if (!session) return;
    const ev: RpgStateEvent = {
      v: 1,
      t: "rpg.state",
      ...(re ? { re } : {}),
      d: {
        server_now: this.now(),
        rev: doc?.rev ?? 0,
        hero: doc ? rpgHeroView(doc, this.rates) : null,
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
    const doc = await this.store.get(userId);
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
