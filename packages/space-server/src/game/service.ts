import { randomBytes } from "node:crypto";

import { type GameCommand, type GameFightEvent, type GameStateEvent, Rng, shortId, tacticsFromWire } from "@muchat/space-core/game";

import type { Log } from "../log.ts";
import type { SessionPort, Viewer } from "../space/runtime.ts";
import { TokenBucket } from "../ws/ratelimit.ts";
import {
  applyBuy,
  applyEquip,
  applyLobbyMove,
  applyLobbyPlace,
  applyLobbyRemove,
  applyLook,
  applyRunAbandon,
  applyRunRetreat,
  applyRunStart,
  applyRunStep,
  applySell,
  applyTactics,
  applyTrain,
  applyUnequip,
  docBytes,
  DOC_MAX_BYTES,
  type HeroDoc,
  heroView,
  newHeroDoc,
  offersOf,
  type Outcome,
  settleHero,
  touchServer,
} from "./hero.ts";
import type { GameStore } from "./store.ts";

/** O que o jogo precisa do Espaço em que a pessoa está; o SpaceRuntime implementa. */
export interface GameHost {
  readonly serverId: string;
  gameAccess(viewer: Viewer): "ok" | "disabled" | "not_allowed";
}

/** Comandos da expedição que esperam a luta terminar de passar. */
const RUN_STEPS = new Set<GameCommand["t"]>(["game.run.start", "game.run.go", "game.run.choose", "game.run.retreat"]);

/** Comandos de jogo por pessoa (além do balde de 20/s da conexão). */
export const GAME_RATE = { rate: 4, burst: 8 };
/** Quantos `id` de comando por pessoa ficam para reconhecer um reenvio. */
export const DEDUPE_IDS = 32;

/**
 * O Refúgio no servidor (ADR 0009, etapa E2). Um herói por conta, comandos de
 * uma pessoa em fila (duas abas não agem em dobro), servidor como autoridade,
 * sem timer: o tempo passado é assentado a cada comando. Nada aqui roda sozinho.
 */
export class GameService {
  private readonly store: GameStore;
  private readonly log: Log;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly newKey: () => string;
  private readonly cacheMax: number;
  /** Heróis recentes, do menos para o mais recente (LRU pela ordem do Map). */
  private readonly cache = new Map<string, HeroDoc>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly recent = new Map<string, string[]>();

  constructor(deps: {
    store: GameStore;
    log: Log;
    now?: () => number;
    random?: () => number;
    /** Chave da expedição (hex, 128 bits); só testes trocam. */
    newKey?: () => string;
    cacheMax?: number;
  }) {
    this.store = deps.store;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? (() => randomBytes(4).readUInt32LE(0));
    this.newKey = deps.newKey ?? (() => randomBytes(16).toString("hex"));
    this.cacheMax = deps.cacheMax ?? 500;
  }

  /** Entrada do gateway: comando já validado pelo zod. Responde na mesma sessão. */
  handle(session: SessionPort, host: GameHost, cmd: GameCommand): void {
    const userId = session.viewer.user._id;
    const fail = (code: string, reason?: string) =>
      session.send({ v: 1, t: "error", re: cmd.id, d: { code, ...(reason ? { reason } : {}) } });
    const bucket = this.bucketOf(userId);
    if (bucket.take(this.now()) !== "ok") return fail("rate_limited");
    const access = host.gameAccess(session.viewer);
    if (access === "disabled") return fail("game_disabled");
    if (access === "not_allowed") return fail("not_allowed");
    const prev = this.queues.get(userId) ?? Promise.resolve();
    const next = prev
      .then(() => this.run(session, host, cmd))
      .catch((err) => {
        this.log.error("game command failed", { t: cmd.t, err: String(err) });
        fail("internal");
      })
      .finally(() => {
        if (this.queues.get(userId) === next) this.queues.delete(userId);
      });
    this.queues.set(userId, next);
  }

  /** Espera a fila de uma pessoa esvaziar (testes). */
  async idle(userId: string): Promise<void> {
    await this.queues.get(userId);
  }

  private async run(session: SessionPort, host: GameHost, cmd: GameCommand): Promise<void> {
    const userId = session.viewer.user._id;
    const now = this.now();
    const sendState = (doc: HeroDoc | null) => session.send(this.state(doc, now, cmd.id) as unknown as Record<string, unknown>);
    const fail = (code: string, reason?: string, retryAfterMs?: number) =>
      session.send({
        v: 1,
        t: "error",
        re: cmd.id,
        d: { code, ...(reason ? { reason } : {}), ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {}) },
      });

    // Reenvio de um comando já aplicado (reconexão): devolve o estado, não age de novo.
    if (cmd.t !== "game.open" && this.recent.get(userId)?.includes(cmd.id)) return sendState(await this.load(userId));

    if (cmd.t === "game.create") {
      if (await this.load(userId)) return fail("game_invalid", "exists");
      const doc = newHeroDoc(userId, cmd.d.cls, cmd.d.look, now, host.serverId, this.random);
      if (!(await this.store.create(doc))) {
        this.cache.delete(userId);
        return fail("game_invalid", "exists");
      }
      this.remember(doc, cmd.id);
      return sendState(doc);
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await this.load(userId, attempt > 0);
      if (!cur) return cmd.t === "game.open" ? sendState(null) : fail("game_invalid", "no_hero");
      // A luta ainda passa: o passo seguinte da expedição espera (até 4×, ADR 0009 decisão 3).
      if (RUN_STEPS.has(cmd.t) && now < cur.busy_until) return fail("game_busy", undefined, cur.busy_until - now);
      const next = structuredClone(cur);
      const tries = settleHero(next, now);
      const seen = next.servers_seen.length;
      touchServer(next, host.serverId);
      const out = this.apply(next, cmd, now);
      if (!out.ok) return fail("game_invalid", out.reason);
      // Abrir sem nada a assentar não grava (abrir o painel não é escrita).
      if (cmd.t === "game.open" && tries === 0 && seen === next.servers_seen.length) {
        this.remember(cur, null);
        return sendState(cur);
      }
      next.rev = cur.rev + 1;
      next.updated_at = now;
      if (docBytes(next) > DOC_MAX_BYTES) {
        this.log.error("game hero too large", { bytes: docBytes(next) });
        return fail("game_invalid", "too_large");
      }
      if (await this.store.save(next, cur.rev)) {
        this.remember(next, cmd.id);
        // A luta vai antes do estado: o app anima e depois mostra o resultado.
        if (out.fight) {
          const fight: GameFightEvent = { v: 1, t: "game.fight", re: cmd.id, d: { input: out.fight.input, result: out.fight.result, busy_until: next.busy_until } };
          session.send(fight as unknown as Record<string, unknown>);
        }
        return sendState(next);
      }
      // Outro processo gravou antes (redeploy sobreposto): relê e tenta mais uma vez.
      this.cache.delete(userId);
    }
    return fail("conflict");
  }

  private apply(d: HeroDoc, cmd: GameCommand, now: number): Outcome {
    switch (cmd.t) {
      case "game.open":
        return { ok: true };
      case "game.create":
        return { ok: false, reason: "exists" };
      case "game.look":
        return applyLook(d, cmd.d.look);
      case "game.train":
        return applyTrain(d, cmd.d.skill);
      case "game.equip":
        return applyEquip(d, cmd.d.item, now);
      case "game.unequip":
        return applyUnequip(d, cmd.d.slot, now);
      case "game.sell":
        return applySell(d, cmd.d.items);
      case "game.buy":
        return applyBuy(d, cmd.d.offer, cmd.d.qty, cmd.d.item);
      case "game.lobby.place":
        return applyLobbyPlace(d, cmd.d, () => shortId(new Rng(this.random())));
      case "game.lobby.move":
        return applyLobbyMove(d, cmd.d.id, cmd.d);
      case "game.lobby.remove":
        return applyLobbyRemove(d, cmd.d.id);
      case "game.tactics":
        return applyTactics(d, tacticsFromWire(cmd.d));
      case "game.run.start":
        return applyRunStart(d, cmd.d.degree, cmd.d.abyss ?? 1, now, this.newKey());
      case "game.run.go":
        return applyRunStep(d, { t: "go", lane: cmd.d.lane }, now);
      case "game.run.choose":
        return applyRunStep(d, { t: "choose", option: cmd.d.option }, now);
      case "game.run.retreat":
        return applyRunRetreat(d, now);
      case "game.run.abandon":
        return applyRunAbandon(d, now);
    }
  }

  private state(doc: HeroDoc | null, now: number, re: string): GameStateEvent {
    return {
      v: 1,
      t: "game.state",
      re,
      d: {
        server_now: now,
        rev: doc?.rev ?? 0,
        hero: doc ? heroView(doc, now) : null,
        offers: doc ? offersOf(doc) : { potion: null, dummy: null },
      },
    };
  }

  private async load(userId: string, fresh = false): Promise<HeroDoc | null> {
    const hit = fresh ? undefined : this.cache.get(userId);
    if (hit) {
      this.cache.delete(userId);
      this.cache.set(userId, hit);
      return hit;
    }
    const doc = await this.store.get(userId);
    if (doc) this.put(doc);
    return doc;
  }

  private remember(doc: HeroDoc, cmdId: string | null) {
    this.put(doc);
    if (!cmdId) return;
    const ids = this.recent.get(doc._id) ?? [];
    ids.push(cmdId);
    if (ids.length > DEDUPE_IDS) ids.splice(0, ids.length - DEDUPE_IDS);
    this.recent.set(doc._id, ids);
  }

  private put(doc: HeroDoc) {
    this.cache.delete(doc._id);
    this.cache.set(doc._id, doc);
    while (this.cache.size > this.cacheMax) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
      this.recent.delete(oldest);
      this.buckets.delete(oldest);
    }
  }

  private bucketOf(userId: string): TokenBucket {
    let b = this.buckets.get(userId);
    if (!b) {
      b = new TokenBucket(GAME_RATE.rate, GAME_RATE.burst, 10_000, this.now());
      this.buckets.set(userId, b);
      // Sem herói em cache o balde não sai pela LRU: limite próprio.
      if (this.buckets.size > this.cacheMax * 2) this.buckets.delete(this.buckets.keys().next().value as string);
    }
    return b;
  }
}
