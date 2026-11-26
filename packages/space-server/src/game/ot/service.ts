import { randomInt, randomUUID } from "node:crypto";

import {
  type FighterInput,
  type HeroResult,
  type HeroV5,
  type OwnedItem,
  type RandomSource,
  type RpgBoardEvent,
  type RpgBoardRun,
  type RpgCommand,
  type RpgLobbyMember,
  type RpgRunEnd,
  type RpgRunEndView,
  type RpgRunEvent,
  type RpgRunFeedItem,
  type RpgRunMemberEnd,
  type RpgRunTickEvent,
  type RpgRunView,
  type RpgStateEvent,
  type RunFrame,
  type RunResult,
  type RunSpoils,
  ENGINE_VERSION,
  FAMILIES,
  Rng,
  autoEquipBag,
  bankGold,
  buyAmmo,
  buyCommonItem,
  buyPotions,
  discardItem,
  changeClass,
  dismantleItem,
  dismantleItems,
  dungeonById,
  equipItem,
  evolveTier,
  heroRunFighter,
  meterOf,
  skillManaCostFor,
  skillCooldownMs,
  planTransfer,
  raiseAttributes,
  randomSource,
  refineItem,
  reforgeItem,
  respecAttributes,
  respecSkills,
  runLoot,
  runRewards,
  sellItem,
  sellItems,
  setBelt,
  setSkillAi,
  setSkillSlots,
  simulateRun,
  spendSkillPoint,
  unequipItem,
  vaultExpand,
  vaultPut,
  vaultTake,
  balance as gameBalance,
} from "@muchat/space-core/game/ot/balance";
import { runStaminaCost } from "@muchat/space-core/game/ot";

import type { AvatarGear, NpcKind } from "@muchat/space-core";

import type { Log } from "../../log.ts";
import type { SessionPort, Viewer } from "../../space/runtime.ts";
import { TokenBucket } from "../../ws/ratelimit.ts";
import {
  type RpgHeroDoc,
  type RpgOutcome,
  type RpgTransfer,
  RPG_DOC_MAX_BYTES,
  checkHeroDoc,
  closeDojo,
  heroLook,
  inRun,
  markRun,
  newRpgHero,
  openDojo,
  rpgDocBytes,
  rpgHeroState,
  settleRunHero,
  staminaXpMult,
  transferIn,
  transferOut,
  transferSettled,
} from "./hero.ts";
import { type Lobby, type LobbyResult, lobbyView } from "./lobby.ts";
import {
  type RpgRunDoc,
  type RpgRunMember,
  type RunStore,
  MemoryRunStore,
  RUNS_RESUME_LIMIT,
} from "./runs.ts";
import type { RpgStore } from "./store.ts";

/** Taxas do operador (engine nova): só a de XP (`SPACE_GAME_RATES="exp=2"`). */
export interface RpgRates {
  exp: number;
}
export const DEFAULT_RPG_RATES: Readonly<RpgRates> = { exp: 1 };

/** O que o jogo idle precisa do Espaço em que a pessoa está; o SpaceRuntime implementa. */
export interface RpgHost {
  readonly serverId: string;
  gameAccess(viewer: Viewer): "ok" | "disabled" | "not_allowed";
  /** O boneco `instanceId` existe, é de treino, a pessoa pode usá-lo e está ao lado dele. */
  trainSpot(
    viewer: Viewer,
    instanceId: string,
  ): { ok: true; zone: string } | { ok: false; code: string; reason?: string };
  /** O NPC `instanceId` existe, é do tipo `kind`, a pessoa pode usá-lo e está ao lado. */
  npcSpot(
    viewer: Viewer,
    instanceId: string,
    kind: NpcKind,
  ): { ok: true } | { ok: false; code: string; reason?: string };
  isTrainingAt(userId: string, instanceId: string): boolean;
  trainingOf(userId: string): string | null;
  /** Quantos outros treinam na mesma sala (o bônus social do Dojô, §2). */
  trainingPeers(userId: string): number;
  setTraining(userId: string, instanceId: string | null): void;
  /** O herói sob o nome no mapa e o que ele veste (null: sem herói). */
  setHero(
    userId: string,
    look: { level: number; vocation: number; gear: AvatarGear } | null,
  ): void;
  sessionOf(userId: string): SessionPort | null;
  displayName(userId: string): string;
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
  lobbyJoin(
    tv: string,
    id: string | undefined,
    member: RpgLobbyMember,
  ): LobbyResult;
  lobbyLeave(userId: string): void;
  lobbyStart(userId: string, auto?: boolean): LobbyResult;
  lobbyDisband(userId: string): LobbyResult;
  lobbyDungeon(userId: string, dungeon: string): LobbyResult;
  lobbyLoop(userId: string, on: boolean): LobbyResult;
  /** O líder pede a largada (espera quem se prepara e conta 3 s; 26/11/2026). */
  lobbyRequestStart(userId: string): LobbyResult;
  lobbyCancelStart(userId: string): LobbyResult;
  /** A ficha ou um NPC aberto (null: fechou); devolve o grupo da pessoa, se houver. */
  lobbyPrep(
    userId: string,
    what: import("@muchat/space-core/game/ot/balance").RpgPrepKind | null,
  ): Lobby | null;
  lobbyRunning(id: string, runId: string): void;
  lobbyAbort(id: string): void;
  lobbyRunEnded(
    runId: string,
    outcome: RpgRunEnd,
    levels: Record<string, number>,
  ): void;
  lobbyLoopFailed(
    id: string,
    why: import("@muchat/space-core/game/ot/balance").RpgLoopStop,
    detail?: string,
  ): void;
  isPresent(userId: string): boolean;
  /** O herói trocou de classe no Mestre: o grupo em que ele está mostra a classe nova. */
  lobbyHero(userId: string, cls: RpgLobbyMember["cls"], level: number): void;
  lobbyOf(userId: string): Lobby | undefined;
  allLobbies(): Lobby[];
  sendRun(
    room: string,
    userIds: readonly string[],
    ev: Record<string, unknown>,
  ): void;
}

/** O registro que vai para quem chega no meio da corrida. */
const FEED_MAX = 40;
/** Fechamento que falhou (banco) tenta de novo depois disto. */
const SETTLE_RETRY_MS = 30_000;
const BOARD_MAX = 30;
const WATCHERS_MAX = 64;

interface ActiveRun {
  doc: RpgRunDoc;
  /** Os quadros (null: a corrida veio de outra versão das regras; a tela fica sem a luta). */
  frames: RunFrame[] | null;
  sent: number;
  settling: boolean;
  nextTry: number;
  watchers: Set<string>;
  /** Quem saiu antes do fim (já fechou a parte dele). */
  left: Set<string>;
  /** O fechamento de quem saiu, para o resumo do fim. */
  leftEnds: Map<string, RpgRunMemberEnd>;
}

/** Comandos por pessoa: 4/s, rajada de 8. */
export const RPG_RATE = { rate: 4, burst: 8 };
const DEDUPE_IDS = 32;

/** Sorteios tirados antes da gravação: a tentativa repetida (conflito de CAS) dá o mesmo resultado. */
function drawn(n = 64): () => RandomSource {
  const xs = Array.from({ length: n }, () => randomInt(0, 2 ** 32) / 2 ** 32);
  return () => {
    let i = 0;
    return { next: () => xs[i++ % xs.length]! };
  };
}

/** A ação do herói do núcleo aplicada no documento (o herói novo no lugar). */
function apply<E extends string>(d: RpgHeroDoc, r: HeroResult<E>): RpgOutcome {
  if (!r.ok) return { ok: false, reason: r.error };
  d.hero = r.hero;
  return { ok: true };
}

/** Poções e munição que o herói gastou até o segundo `sec` (para quem sai no meio). */
/** O herói usa arma de distância (gasta munição a cada ataque básico). */
function ranged(h: HeroV5): boolean {
  return (
    !!h.equipment.arma && FAMILIES[h.equipment.arma.family].kind === "ranged"
  );
}

function spentUntil(
  frames: RunFrame[] | null,
  member: number,
  sec: number,
  hero: HeroV5,
): { potionsUsed: { hp: number; mp: number }; ammoUsed: number } {
  let hp = 0;
  let mp = 0;
  let autos = 0;
  for (const f of frames ?? []) {
    if (f.s > sec) break;
    for (const e of f.e) {
      if (e.k === "pocao" && e.a === member) e.mana ? mp++ : hp++;
      if (e.k === "golpe" && e.a === member) autos++;
    }
  }
  return { potionsUsed: { hp, mp }, ammoUsed: ranged(hero) ? autos : 0 };
}

export class RpgService {
  private readonly store: RpgStore;
  private readonly log: Log;
  private readonly now: () => number;
  private readonly rates: RpgRates;
  private readonly cacheMax: number;
  private readonly cache = new Map<string, RpgHeroDoc>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly recent = new Map<string, string[]>();
  private readonly delivering = new Set<string>();
  private readonly runStore: RunStore;
  private readonly autoTick: boolean;
  private readonly active = new Map<string, ActiveRun>();
  /**
   * Quem está numa largada agora (entre ler os heróis e marcar a corrida): os comandos que mudam o
   * herói esperam ela sair. Sem isso, um save que chegava nesse meio respondia "ok" e a corrida
   * que acabava de sair lutava com o herói de antes (26/11/2026).
   */
  private readonly starting = new Set<string>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private hostOf: (serverId: string) => RpgHost | null = () => null;

  constructor(deps: {
    store: RpgStore;
    log: Log;
    now?: () => number;
    rates?: RpgRates;
    cacheMax?: number;
    runStore?: RunStore;
    /** false nos testes: o teste chama `tickRuns()`. */
    autoTick?: boolean;
  }) {
    this.store = deps.store;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.rates = deps.rates ?? DEFAULT_RPG_RATES;
    this.cacheMax = deps.cacheMax ?? 500;
    this.runStore = deps.runStore ?? new MemoryRunStore();
    this.autoTick = deps.autoTick ?? true;
  }

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

  /** Corridas em andamento no banco (reinício, redeploy): voltam e fecham na hora certa. */
  async resumeRuns(): Promise<number> {
    const docs = await this.runStore.running(RUNS_RESUME_LIMIT);
    let n = 0;
    for (const doc of docs) {
      if (this.active.has(doc._id)) continue;
      const frames = this.replay(doc);
      const sec = Math.floor((this.now() - doc.started_at) / 1000);
      this.activate(doc, frames, Math.max(0, Math.min(sec, doc.seconds)));
      n++;
    }
    return n;
  }

  stopRuns(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Um segundo das corridas: manda os quadros que chegaram e fecha a que acabou. */
  tickRuns(): Promise<void> {
    const now = this.now();
    const settling: Promise<void>[] = [];
    for (const run of [...this.active.values()]) {
      if (now >= run.doc.ends_at) {
        if (!run.settling && now >= run.nextTry)
          settling.push(this.settleRunDoc(run));
        continue;
      }
      if (!run.frames) continue;
      const sec = Math.min(
        Math.floor((now - run.doc.started_at) / 1000),
        run.frames.length,
      );
      if (sec <= run.sent) continue;
      const frames = run.frames.slice(run.sent, sec);
      run.sent = sec;
      const ev: RpgRunTickEvent = {
        v: 1,
        t: "rpg.run.tick",
        d: { id: run.doc._id, frames },
      };
      this.hostOf(run.doc.server)?.sendRun(
        run.doc.room,
        [...run.doc.members.map((h) => h.userId), ...run.watchers],
        ev as unknown as Record<string, unknown>,
      );
    }
    if (this.active.size === 0) this.stopRuns();
    return Promise.all(settling).then(() => undefined);
  }

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

  /** O runtime avisa que a pessoa saiu de perto do boneco: o treino fecha agora (credita). */
  trainingLeft(host: RpgHost, userId: string): void {
    this.enqueue(
      userId,
      async () => {
        const peers = host.trainingPeers(userId);
        const out = await this.mutate(userId, null, (d) =>
          closeDojo(d, this.now(), peers)
            ? { ok: true }
            : { ok: false, reason: "no_training" },
        );
        if (out && "doc" in out)
          this.push(host.sessionOf(userId), out.doc, undefined, host);
      },
      () => undefined,
    );
  }

  /** Alguém entrou no mapa: o nível do herói aparece sob o nome. */
  avatarJoined(host: RpgHost, userId: string): void {
    this.enqueue(
      userId,
      async () => {
        const doc = await this.load(userId);
        const at = host.trainingOf(userId);
        const t = doc?.dojo;
        if (
          at !== null &&
          (!t || t.server !== host.serverId || t.instance !== at)
        )
          host.setTraining(userId, null);
        host.setHero(userId, doc ? heroLook(doc) : null);
      },
      () => undefined,
    );
  }

  async idle(userId: string): Promise<void> {
    await this.queues.get(userId);
  }

  /** Esquece o herói do cache (o próximo comando lê do banco): testes e suporte que editaram o banco. */
  forget(userId: string): void {
    this.cache.delete(userId);
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
    /**
     * Uma ação do herói, gravada e respondida com o estado: fora da corrida, ou também durante
     * ela (`duringRun`: o Mercador, 26/11/2026). Nunca no meio de uma largada.
     */
    const act = async (
      fn: (d: RpgHeroDoc) => RpgOutcome,
      log?: string,
      duringRun = false,
    ) => {
      if (this.starting.has(userId))
        return fail("rpg_invalid", "run_starting");
      const out = await this.mutate(userId, null, (d) =>
        !duringRun && inRun(d, this.now())
          ? { ok: false, reason: "in_run" }
          : fn(d),
      );
      if (!out) return fail("rpg_invalid", "no_hero");
      if ("reason" in out) return fail("rpg_invalid", out.reason);
      this.remember(userId, cmd.id);
      if (log)
        this.log.info(log, { server: host.serverId, user: userId, cmd: cmd.t });
      return this.push(session, out.doc, cmd.id, host);
    };
    const near = (instance: string, kind: NpcKind) => {
      const spot = host.npcSpot(session.viewer, instance, kind);
      if (!spot.ok) {
        fail(spot.code, spot.reason);
        return false;
      }
      return true;
    };

    // Reenvio de um comando já aplicado (reconexão): devolve o estado, não age de novo.
    if (
      cmd.t !== "rpg.open" &&
      !cmd.t.startsWith("rpg.lobby.") &&
      this.recent.get(userId)?.includes(cmd.id)
    )
      return this.push(session, await this.load(userId), cmd.id, host);

    switch (cmd.t) {
      case "rpg.open": {
        const cur = await this.load(userId);
        // Treino no Dojô que o runtime não vê mais (reconexão, reinício, outro servidor): fecha agora.
        const stale =
          cur?.dojo &&
          (cur.dojo.server !== host.serverId ||
            !host.isTrainingAt(userId, cur.dojo.instance));
        if (!cur || !stale) {
          this.push(session, cur, cmd.id, host);
          return this.sendOwnRun(session, cur);
        }
        const out = await this.mutate(userId, null, (d) =>
          closeDojo(d, now, 0)
            ? { ok: true }
            : { ok: false, reason: "no_training" },
        );
        host.setTraining(userId, null);
        return this.push(
          session,
          out && "doc" in out ? out.doc : await this.load(userId),
          cmd.id,
          host,
        );
      }
      case "rpg.class": {
        // Jogador novo (D34): escolhe a classe uma vez; quem já tem herói não troca por aqui.
        if (await this.load(userId)) return fail("rpg_invalid", "has_hero");
        const out = await this.mutate(
          userId,
          (t) => newRpgHero(userId, cmd.d.cls, t, randomUUID),
          () => ({ ok: true }),
        );
        if (!out) return fail("conflict");
        if ("reason" in out) return fail("rpg_invalid", out.reason);
        this.remember(userId, cmd.id);
        this.log.info("rpg hero created", {
          server: host.serverId,
          user: userId,
          cls: cmd.d.cls,
        });
        return this.push(session, out.doc, cmd.id, host);
      }
      case "rpg.dojo.start": {
        const spot = host.trainSpot(session.viewer, cmd.d.instance);
        if (!spot.ok) return fail(spot.code, spot.reason);
        const where = {
          instance: cmd.d.instance,
          server: host.serverId,
          zone: spot.zone,
        };
        const out = await this.mutate(userId, null, (d) =>
          openDojo(d, where, now),
        );
        if (!out) return fail("rpg_invalid", "no_hero");
        if ("reason" in out) return fail("rpg_invalid", out.reason);
        host.setTraining(userId, cmd.d.instance);
        this.remember(userId, cmd.id);
        return this.push(session, out.doc, cmd.id, host);
      }
      case "rpg.dojo.stop": {
        const peers = host.trainingPeers(userId);
        const out = await this.mutate(userId, null, (d) =>
          closeDojo(d, now, peers)
            ? { ok: true }
            : { ok: false, reason: "no_training" },
        );
        host.setTraining(userId, null);
        if (!out || "reason" in out)
          return this.push(session, await this.load(userId), cmd.id, host);
        this.remember(userId, cmd.id);
        return this.push(session, out.doc, cmd.id, host);
      }
      case "rpg.attrs":
        return act((d) => apply(d, raiseAttributes(d.hero, cmd.d.add)));
      case "rpg.skill.spend":
        return act((d) =>
          apply(d, spendSkillPoint(d.hero, cmd.d.skill, cmd.d.target)),
        );
      case "rpg.skill.slots":
        return act((d) => apply(d, setSkillSlots(d.hero, cmd.d.slots)));
      case "rpg.skill.ai":
        return act((d) =>
          apply(d, setSkillAi(d.hero, cmd.d.skill, cmd.d.conditions)),
        );
      case "rpg.master": {
        if (!near(cmd.d.npc, "mestre")) return;
        return act(
          (d) =>
            apply(
              d,
              cmd.d.action === "evoluir"
                ? evolveTier(d.hero)
                : cmd.d.action === "redistribuir-atributos"
                  ? respecAttributes(d.hero)
                  : respecSkills(d.hero),
            ),
          "rpg master",
        );
      }
      case "rpg.master.class": {
        if (!near(cmd.d.npc, "mestre")) return;
        const from = (await this.load(userId))?.hero.cls;
        await act(
          (d) => apply(d, changeClass(d.hero, cmd.d.cls)),
          "rpg class changed",
        );
        const doc = await this.load(userId);
        if (doc && doc.hero.cls === cmd.d.cls && from !== cmd.d.cls) {
          this.log.info("rpg class change", {
            server: host.serverId,
            user: userId,
            from,
            to: cmd.d.cls,
            level: doc.hero.level,
          });
          host.lobbyHero(userId, doc.hero.cls, doc.hero.level);
        }
        return;
      }
      case "rpg.equip":
        return act((d) => apply(d, equipItem(d.hero, cmd.d.uid)));
      case "rpg.unequip":
        return act((d) => apply(d, unequipItem(d.hero, cmd.d.slot)));
      case "rpg.autoequip":
        return act((d) => {
          if (cmd.d.on !== undefined)
            d.hero = { ...d.hero, autoEquip: cmd.d.on };
          return cmd.d.apply ? apply(d, autoEquipBag(d.hero)) : { ok: true };
        });
      case "rpg.discard":
        return act((d) => apply(d, discardItem(d.hero, cmd.d.uid)));
      case "rpg.supplies":
        return act((d) => {
          d.hero = { ...d.hero, supplies: { hp: cmd.d.hp, mp: cmd.d.mp } };
          return { ok: true };
        });
      case "rpg.belt":
        return act((d) => apply(d, setBelt(d.hero, cmd.d.kind, cmd.d.size)));
      case "rpg.shop.buy": {
        if (!near(cmd.d.npc, "mercador")) return;
        const b = cmd.d.buy;
        const roll = drawn();
        // Na corrida o Mercador vende só consumível (poção e munição: valem a partir da próxima,
        // porque a corrida já saiu calculada); item novo, só depois (26/11/2026).
        if (b.kind === "item")
          return act(
            (d) =>
              inRun(d, this.now())
                ? { ok: false, reason: "in_run_item" }
                : apply(d, buyCommonItem(d.hero, b.base, randomUUID, roll())),
            undefined,
            true,
          );
        return act(
          (d) =>
            apply(
              d,
              b.kind === "pocao"
                ? buyPotions(d.hero, b.type, b.size, b.count)
                : buyAmmo(d.hero, b.grade, b.packs),
            ),
          undefined,
          true,
        );
      }
      case "rpg.shop.sell": {
        if (!near(cmd.d.npc, "mercador")) return;
        // Vender da mochila vale na corrida: abre espaço para o loot que vem no fim. O que está
        // equipado não sai (a corrida usa a cópia do herói da largada).
        return act(
          (d) => apply(d, sellItem(d.hero, cmd.d.uid, cmd.d.confirm ?? false)),
          undefined,
          true,
        );
      }
      case "rpg.shop.sell.many": {
        if (!near(cmd.d.npc, "mercador")) return;
        return act(
          (d) => apply(d, sellItems(d.hero, cmd.d.uids, cmd.d.confirm ?? false)),
          undefined,
          true,
        );
      }
      case "rpg.smith.dismantle.many": {
        if (!near(cmd.d.npc, "ferreiro")) return;
        return act(
          (d) => apply(d, dismantleItems(d.hero, cmd.d.uids)),
          "rpg smith",
          true,
        );
      }
      case "rpg.smith": {
        if (!near(cmd.d.npc, "ferreiro")) return;
        const roll = drawn();
        // Desmontar vale na corrida, como vender no Mercador: o que está vestido não desmonta e a
        // corrida usa a cópia do herói da largada. Refinar e reforjar, só depois (26/11/2026).
        return act(
          (d) =>
            apply(
              d,
              cmd.d.action === "refinar"
                ? refineItem(d.hero, cmd.d.uid, roll(), cmd.d.protect ?? false)
                : cmd.d.action === "reforjar"
                  ? reforgeItem(d.hero, cmd.d.uid, roll())
                  : dismantleItem(d.hero, cmd.d.uid),
            ),
          "rpg smith",
          cmd.d.action === "desmontar",
        );
      }
      case "rpg.bank": {
        if (!near(cmd.d.npc, "banqueiro")) return;
        return act((d) => apply(d, bankGold(d.hero, cmd.d.gold)));
      }
      case "rpg.vault": {
        if (!near(cmd.d.npc, "banqueiro")) return;
        return act((d) =>
          apply(
            d,
            cmd.d.action === "guardar"
              ? vaultPut(d.hero, cmd.d.uid)
              : vaultTake(d.hero, cmd.d.uid),
          ),
        );
      }
      case "rpg.vault.expand": {
        if (!near(cmd.d.npc, "banqueiro")) return;
        return act((d) => apply(d, vaultExpand(d.hero)));
      }
      case "rpg.bank.transfer": {
        if (!near(cmd.d.npc, "banqueiro")) return;
        // Para quem está neste Espaço agora e já tem herói.
        if (!host.sessionOf(cmd.d.to)) return fail("rpg_invalid", "not_here");
        const target = await this.load(cmd.d.to);
        if (!target) return fail("rpg_invalid", "no_hero");
        const me = await this.load(userId);
        if (!me) return fail("rpg_invalid", "no_hero");
        const items = cmd.d.uids
          .map((u) => me.hero.bag.find((x) => x.uid === u))
          .filter((x): x is OwnedItem => !!x);
        if (items.length !== cmd.d.uids.length)
          return fail("rpg_invalid", "item-nao-encontrado");
        const plan = planTransfer({
          from: userId,
          to: cmd.d.to,
          gold: cmd.d.gold,
          items,
          balance: me.hero.gold,
          confirmations: cmd.d.confirmations,
        });
        if (!plan.ok) return fail("rpg_invalid", plan.error);
        const t: RpgTransfer = {
          id: randomUUID(),
          to: cmd.d.to,
          gold: cmd.d.gold,
          items,
          at: now,
        };
        const out = await this.mutate(userId, null, (d) =>
          transferOut(d, t, now),
        );
        if (!out) return fail("rpg_invalid", "no_hero");
        if ("reason" in out) return fail("rpg_invalid", out.reason);
        this.remember(userId, cmd.id);
        this.push(session, out.doc, cmd.id, host);
        this.log.info("rpg transfer out", {
          id: t.id,
          gold: t.gold,
          items: t.items.length,
          fee: plan.plan.fee,
        });
        this.deliver(out.doc, host);
        return;
      }
      case "rpg.lobby.create":
      case "rpg.lobby.join": {
        const spot = host.tvSpot(session.viewer, cmd.d.tv);
        if (!spot.ok) return fail(spot.code, spot.reason);
        const doc = await this.load(userId);
        if (!doc) return fail("rpg_invalid", "no_hero");
        if (inRun(doc, now)) return fail("rpg_invalid", "in_run");
        const member: RpgLobbyMember = {
          user_id: userId,
          name: host.displayName(userId),
          cls: doc.hero.cls,
          level: doc.hero.level,
        };
        const res =
          cmd.t === "rpg.lobby.create"
            ? host.lobbyCreate(cmd.d.tv, spot.room, cmd.d.dungeon, member)
            : host.lobbyJoin(cmd.d.tv, cmd.d.id, member);
        if (!res.ok) return fail("rpg_invalid", res.reason);
        return session.send({
          v: 1,
          t: "rpg.lobby",
          re: cmd.id,
          d: {
            tv: res.lobby.tv,
            id: res.lobby.id,
            lobby: lobbyView(res.lobby),
          },
        });
      }
      case "rpg.lobby.dungeon":
      case "rpg.lobby.loop": {
        const res =
          cmd.t === "rpg.lobby.dungeon"
            ? host.lobbyDungeon(userId, cmd.d.dungeon)
            : host.lobbyLoop(userId, cmd.d.on);
        if (!res.ok) return fail("rpg_invalid", res.reason);
        return session.send({
          v: 1,
          t: "rpg.lobby",
          re: cmd.id,
          d: {
            tv: res.lobby.tv,
            id: res.lobby.id,
            lobby: lobbyView(res.lobby),
          },
        });
      }
      case "rpg.lobby.leave": {
        if (cmd.d?.disband) {
          const res = host.lobbyDisband(userId);
          if (!res.ok) return fail("rpg_invalid", res.reason);
        } else host.lobbyLeave(userId);
        return session.send({
          v: 1,
          t: "rpg.lobby",
          re: cmd.id,
          d: { tv: "", lobby: null },
        });
      }
      case "rpg.lobby.start": {
        // A largada fica pedida (26/11/2026): espera quem está na ficha ou num NPC, conta 3 s e
        // sai pelo tique do runtime (`launchDue`). O que dá para conferir já, confere aqui.
        if (cmd.d?.cancel) {
          const res = host.lobbyCancelStart(userId);
          if (!res.ok) return fail("rpg_invalid", res.reason);
          return session.send({
            v: 1,
            t: "rpg.lobby",
            re: cmd.id,
            d: { tv: res.lobby.tv, id: res.lobby.id, lobby: lobbyView(res.lobby) },
          });
        }
        const peek = host.lobbyOf(userId);
        if (peek && peek.leader === userId) {
          const dg = dungeonById(peek.dungeon);
          if (!dg) return fail("rpg_invalid", "unknown_dungeon");
          if (
            peek.members.length < dg.party.min ||
            peek.members.length > dg.party.max
          )
            return fail("rpg_invalid", "party_size");
          if (peek.members.some((m) => m.level < dg.minLevel))
            return fail("rpg_invalid", "level");
        }
        const res = host.lobbyRequestStart(userId);
        if (!res.ok) return fail("rpg_invalid", res.reason);
        return session.send({
          v: 1,
          t: "rpg.lobby",
          re: cmd.id,
          d: { tv: res.lobby.tv, id: res.lobby.id, lobby: lobbyView(res.lobby) },
        });
      }
      case "rpg.lobby.prep": {
        const lobby = host.lobbyPrep(userId, cmd.d.what);
        return session.send({
          v: 1,
          t: "rpg.lobby",
          re: cmd.id,
          d: lobby
            ? { tv: lobby.tv, id: lobby.id, lobby: lobbyView(lobby) }
            : { tv: "", lobby: null, none: true },
        });
      }
      case "rpg.run.leave":
        return this.leaveRun(session, host, cmd.id);
      case "rpg.run.watch": {
        const run = this.active.get(cmd.d.id);
        if (!run || run.doc.server !== host.serverId || run.settling)
          return fail("rpg_invalid", "no_run");
        if (run.watchers.size < WATCHERS_MAX) run.watchers.add(userId);
        return session.send({
          ...(this.runSnapshot(run) as unknown as Record<string, unknown>),
          re: cmd.id,
        });
      }
      case "rpg.board": {
        const runs: RpgBoardRun[] = [];
        for (const r of this.active.values()) {
          if (r.doc.server !== host.serverId || runs.length >= BOARD_MAX)
            continue;
          runs.push({
            id: r.doc._id,
            dungeon: r.doc.dungeon,
            room: r.doc.room,
            tv: r.doc.tv,
            started_at: r.doc.started_at,
            ends_at: r.doc.ends_at,
            members: r.doc.members.map((m) => ({
              user_id: m.userId,
              name: m.name,
              cls: m.hero.cls,
              level: m.hero.level,
            })),
          });
        }
        const lobbies = host
          .allLobbies()
          .filter((l) => l.state !== "running")
          .slice(0, BOARD_MAX)
          .map(lobbyView);
        const ev: RpgBoardEvent = {
          v: 1,
          t: "rpg.board",
          re: cmd.id,
          d: { lobbies, runs },
        };
        return session.send(ev as unknown as Record<string, unknown>);
      }
    }
  }

  /**
   * Lê, aplica e grava com CAS (uma nova tentativa se outro processo gravou antes). `create`: sem
   * herói, nasce um (só o `rpg.class`). Devolve o documento gravado, o motivo da recusa, ou null se
   * não há herói (e não cria) ou o conflito persistiu.
   */
  private async mutate(
    userId: string,
    create: ((now: number) => RpgHeroDoc) | null,
    fn: (d: RpgHeroDoc) => RpgOutcome,
  ): Promise<{ doc: RpgHeroDoc } | { reason: string } | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await this.load(userId, attempt > 0);
      const now = this.now();
      if (!cur && !create) return null;
      const next = cur ? structuredClone(cur) : create!(now);
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
   * A contagem da largada acabou (pedida pelo líder ou pelo loop): na fila do líder, lê e confere
   * todos e solta a corrida. Se não der, a largada desiste e todos veem o motivo.
   */
  launchDue(
    host: RpgHost,
    leader: string,
    lobbyId: string,
    auto = true,
  ): void {
    this.enqueue(
      leader,
      async () => {
        const lobby = host.lobbyOf(leader);
        if (!lobby || lobby.id !== lobbyId || lobby.leader !== leader) {
          if (lobby?.id === lobbyId) host.lobbyLoopFailed(lobbyId, "leader_left");
          return;
        }
        if (!lobby.members.some((m) => host.isPresent(m.user_id))) {
          host.lobbyLoopFailed(lobbyId, "offline");
          return;
        }
        const started = await this.startRun(host, leader, auto);
        if (!started.ok) {
          host.lobbyLoopFailed(
            lobbyId,
            "start_failed",
            started.reason ?? started.code,
          );
          this.log.info("rpg lobby loop stopped", {
            server: host.serverId,
            tv: lobby.tv,
            reason: started.reason ?? started.code,
          });
        }
      },
      () => host.lobbyLoopFailed(lobbyId, "start_failed", "internal"),
    );
  }

  /**
   * O líder começa. Lê e valida todos, simula a corrida inteira com a semente do servidor (os quadros
   * da tela e o que cada um leva: XP com stamina e taxa, ouro, itens já com id, minério, pedras,
   * poções e munição), fecha o grupo (só se ele não mudou enquanto os heróis eram lidos), grava a
   * corrida e marca cada herói.
   */
  private async startRun(
    host: RpgHost,
    userId: string,
    auto = false,
  ): Promise<
    | { ok: true; res: Extract<LobbyResult, { ok: true }> }
    | { ok: false; code: string; reason?: string }
  > {
    const peek = host.lobbyOf(userId);
    if (!peek) return { ok: false, code: "rpg_invalid", reason: "no_lobby" };
    if (peek.leader !== userId)
      return { ok: false, code: "rpg_invalid", reason: "not_leader" };
    const dungeon = dungeonById(peek.dungeon);
    if (!dungeon)
      return { ok: false, code: "rpg_invalid", reason: "unknown_dungeon" };
    const members = peek.members.map((m) => ({ ...m }));
    if (
      members.length < dungeon.party.min ||
      members.length > dungeon.party.max
    )
      return { ok: false, code: "rpg_invalid", reason: "party_size" };
    // Ninguém do grupo muda o herói daqui até a marca da corrida; o comando que já estava na fila
    // de alguém termina antes da leitura (lida na fila de cada um).
    const mine = members
      .map((m) => m.user_id)
      .filter((id) => !this.starting.has(id));
    for (const id of mine) this.starting.add(id);
    try {
      return await this.startRunLocked(host, userId, auto, peek, members);
    } finally {
      for (const id of mine) this.starting.delete(id);
    }
  }

  private async startRunLocked(
    host: RpgHost,
    userId: string,
    auto: boolean,
    peek: Lobby,
    members: Lobby["members"],
  ): Promise<
    | { ok: true; res: Extract<LobbyResult, { ok: true }> }
    | { ok: false; code: string; reason?: string }
  > {
    const dungeon = dungeonById(peek.dungeon)!;
    const docs = await Promise.all(
      members.map((m) =>
        m.user_id === userId
          ? this.load(m.user_id, true)
          : this.inQueue(m.user_id, () => this.load(m.user_id, true)),
      ),
    );
    const now = this.now();
    for (const d of docs) {
      if (!d) return { ok: false, code: "rpg_invalid", reason: "no_hero" };
      if (d.hero.level < dungeon.minLevel)
        return { ok: false, code: "rpg_invalid", reason: "level" };
      if (inRun(d, now))
        return { ok: false, code: "rpg_invalid", reason: "in_run" };
    }
    const heroes = docs.map((d) => d!.hero);
    const fighters = heroes.map((h) => heroRunFighter(h));
    const seed = randomInt(0, 0xffff_ffff);
    const result = simulateRun(dungeon, fighters, {
      mode: "aleatorio",
      random: randomSource(new Rng(seed)),
      record: true,
    });
    const frames = result.frames ?? [];
    const spoils = this.spoilsOf(
      dungeon,
      heroes,
      docs.map((d) => staminaXpMult(d!, now) * this.rates.exp),
      fighters,
      result,
      seed,
    );
    // Sem espera entre conferir e fechar: o grupo é o mesmo que foi lido.
    const again = host.lobbyOf(userId);
    const ids = (l: { members: { user_id: string }[] }) =>
      l.members.map((m) => m.user_id).join(",");
    if (!again || again.leader !== userId || ids(again) !== ids(peek))
      return { ok: false, code: "rpg_invalid", reason: "changed" };
    const res = host.lobbyStart(userId, auto);
    if (!res.ok) return { ok: false, code: "rpg_invalid", reason: res.reason };
    const doc: RpgRunDoc = {
      _id: randomUUID(),
      v: 2,
      engine: ENGINE_VERSION,
      server: host.serverId,
      room: res.lobby.room,
      tv: res.lobby.tv,
      dungeon: dungeon.id,
      seed,
      started_at: now,
      ends_at: now + frames.length * 1000,
      members: members.map(
        (m, i): RpgRunMember => ({
          userId: m.user_id,
          name: m.name,
          hero: heroes[i]!,
          dead: !result.heroes[i]!.alive,
          spoils: spoils[i]!,
        }),
      ),
      outcome: result.outcome,
      seconds: frames.length,
      status: "running",
      settled_at: null,
      ...(auto ? { auto: true } : {}),
    };
    try {
      await this.runStore.create(doc);
    } catch (err) {
      this.log.error("rpg run create failed", { err: String(err) });
      host.lobbyAbort(res.lobby.id);
      return { ok: false, code: "internal" };
    }
    host.lobbyRunning(res.lobby.id, doc._id);
    const mark = { id: doc._id, dungeon: dungeon.id, ends_at: doc.ends_at };
    await Promise.all(
      members.map(async (m) => {
        const job = async () => {
          const out = await this.mutate(m.user_id, null, (d) =>
            markRun(d, mark, this.now()),
          );
          if (out && "doc" in out) {
            host.setTraining(m.user_id, null);
            this.push(host.sessionOf(m.user_id), out.doc, undefined, host);
          } else
            this.log.warn("rpg run member not marked", {
              run: doc._id,
              user: m.user_id,
              reason: out && "reason" in out ? out.reason : "conflict",
            });
        };
        if (m.user_id === userId) await job();
        else await this.inQueue(m.user_id, job);
      }),
    );
    const run = this.activate(doc, frames, 0);
    host.sendRun(
      doc.room,
      members.map((m) => m.user_id),
      this.runSnapshot(run) as unknown as Record<string, unknown>,
    );
    this.log.info("rpg run started", {
      server: doc.server,
      run: doc._id,
      dungeon: doc.dungeon,
      members: members.length,
      outcome: doc.outcome,
      seconds: doc.seconds,
    });
    return { ok: true, res };
  }

  /** O que cada herói leva (o sorteio do loot sai de outra semente, derivada da da corrida). */
  private spoilsOf(
    dungeon: NonNullable<ReturnType<typeof dungeonById>>,
    heroes: HeroV5[],
    xpMult: number[],
    fighters: FighterInput[],
    result: RunResult,
    seed: number,
  ): RunSpoils[] {
    const levels = heroes.map((h) => h.level);
    const rewards = runRewards(dungeon, levels, result);
    const loot = runLoot(
      dungeon.level,
      heroes.map((h) => h.cls),
      result,
      randomSource(new Rng((seed ^ 0x9e37_79b9) >>> 0)),
    );
    return heroes.map((_, i) => {
      const xp = Math.floor(rewards.heroes[i]!.xp * xpMult[i]!);
      return {
        xp,
        jobXp: Math.floor(xp * gameBalance.cfg.xp.jobShare),
        gold: rewards.heroes[i]!.gold,
        items: loot.items
          .filter((x) => x.hero === i)
          .map((x) => ({ ...x.item, uid: randomUUID() })),
        ores: loot.ores[i] ?? {},
        stones: loot.protectionStones[i] ?? 0,
        potionsUsed: {
          hp: result.rooms.reduce((a, r) => a + r.heroes[i]!.hpPotions, 0),
          mp: result.rooms.reduce((a, r) => a + r.heroes[i]!.mpPotions, 0),
        },
        ammoUsed: ranged(heroes[i]!)
          ? result.rooms.reduce((a, r) => a + r.heroes[i]!.autos, 0)
          : 0,
      };
    });
  }

  private activate(doc: RpgRunDoc, frames: RunFrame[] | null, sent: number) {
    const run: ActiveRun = {
      doc,
      frames,
      sent,
      settling: false,
      nextTry: 0,
      watchers: new Set(),
      left: new Set(),
      leftEnds: new Map(),
    };
    this.active.set(doc._id, run);
    if (!this.ticker && this.autoTick) {
      this.ticker = setInterval(() => void this.tickRuns(), 1000);
      this.ticker.unref?.();
    }
    return run;
  }

  /** Refaz os quadros da semente; só serve se as regras e o resultado batem com o gravado. */
  private replay(doc: RpgRunDoc): RunFrame[] | null {
    if (doc.engine !== ENGINE_VERSION) return null;
    const dungeon = dungeonById(doc.dungeon);
    if (!dungeon) return null;
    try {
      const r = simulateRun(
        dungeon,
        doc.members.map((m) => heroRunFighter(m.hero)),
        {
          mode: "aleatorio",
          random: randomSource(new Rng(doc.seed)),
          record: true,
        },
      );
      const same =
        r.outcome === doc.outcome && (r.frames?.length ?? -1) === doc.seconds;
      return same ? r.frames! : null;
    } catch (err) {
      this.log.warn("rpg run replay failed", {
        run: doc._id,
        err: String(err),
      });
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
      auto: doc.auto ?? false,
      members: doc.members.map((m) => {
        const f = heroRunFighter(m.hero);
        return {
          user_id: m.userId,
          name: m.name,
          cls: m.hero.cls,
          level: m.hero.level,
          job: m.hero.job,
          proficiency: m.hero.proficiency,
          hp_max: Math.round(f.stats.hp),
          mp_max: Math.round(f.stats.mp),
          equipment: m.hero.equipment,
          skills: f.skills.map((s) => ({
            id: s.id,
            mana: Math.round(skillManaCostFor(s, f.stats)),
            cd_ms: Math.round(skillCooldownMs(s, f.stats.cooldownCut)),
          })),
          supplies: m.hero.supplies,
          belt: m.hero.belt,
          potions: {
            hp: m.hero.potions.hp[m.hero.belt.hp],
            mp: m.hero.potions.mp[m.hero.belt.mp],
          },
        };
      }),
    };
  }

  /** A corrida até o segundo de agora: o último quadro e o registro recente. */
  private runSnapshot(run: ActiveRun, end?: RpgRunEndView): RpgRunEvent {
    const frames = run.frames ?? [];
    const sec = end
      ? frames.length
      : Math.min(
          Math.floor((this.now() - run.doc.started_at) / 1000),
          frames.length,
        );
    const feed: RpgRunFeedItem[] = [];
    for (let i = sec - 1; i >= 0 && feed.length < FEED_MAX; i--) {
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
        frame: sec > 0 ? (frames[sec - 1] ?? null) : null,
        feed,
        ...(end ? { end } : {}),
        ...(run.frames
          ? { meter: meterOf(frames, run.doc.members.length, sec) }
          : {}),
      },
    };
  }

  private sendOwnRun(session: SessionPort, doc: RpgHeroDoc | null) {
    const id = doc?.run?.id;
    const run = id ? this.active.get(id) : undefined;
    if (run)
      session.send(this.runSnapshot(run) as unknown as Record<string, unknown>);
  }

  /** Sair da corrida: fecha a parte dele agora, sem a recompensa (o gasto até ali fica). */
  private async leaveRun(session: SessionPort, host: RpgHost, re: string) {
    const userId = session.viewer.user._id;
    const now = this.now();
    const fail = (reason: string) =>
      session.send({
        v: 1,
        t: "error",
        re,
        d: { code: "rpg_invalid", reason },
      });
    const hero = await this.load(userId);
    const runId = hero?.run?.id;
    const run = runId ? this.active.get(runId) : undefined;
    if (!hero || !runId || !run || run.settling || !inRun(hero, now))
      return fail("no_run");
    const i = run.doc.members.findIndex((m) => m.userId === userId);
    if (i < 0) return fail("no_run");
    const elapsed = Math.max(0, Math.floor((now - run.doc.started_at) / 1000));
    const spent = spentUntil(run.frames, i, elapsed, run.doc.members[i]!.hero);
    let end: RpgRunMemberEnd | null = null;
    const out = await this.mutate(userId, null, (d) => {
      const r = settleRunHero(
        d,
        runId,
        null,
        spent,
        runStaminaCost(elapsed),
        now,
      );
      if (!r.ok) return r;
      end = {
        user_id: userId,
        dead: false,
        retreated: true,
        reward: null,
        left: [],
        potions_used: spent.potionsUsed,
        ammo_used: spent.ammoUsed,
        levels_gained: 0,
        jobs_gained: 0,
      };
      return { ok: true };
    });
    if (!out) return fail("no_run");
    if ("reason" in out) return fail(out.reason);
    run.left.add(userId);
    if (end) run.leftEnds.set(userId, end);
    this.remember(userId, re);
    this.push(session, out.doc, re, host);
    this.log.info("rpg run left", {
      server: host.serverId,
      run: runId,
      seconds: elapsed,
    });
    const lobby = host.lobbyOf(userId);
    if (lobby && lobby.runId === runId && lobby.loop)
      host.lobbyLoopFailed(lobby.id, "retreat");
    if (run.doc.members.every((m) => run.left.has(m.userId)))
      void this.settleRunDoc(run);
  }

  /**
   * Fecha a corrida: cada herói na fila dele (a marca garante uma vez só), depois a corrida no banco,
   * depois o resumo para a sala. Erro de banco: tenta de novo em 30 s.
   */
  private async settleRunDoc(run: ActiveRun): Promise<void> {
    run.settling = true;
    const { doc } = run;
    const now = this.now();
    const host = this.hostOf(doc.server);
    try {
      const cost = runStaminaCost(doc.seconds);
      const abandoned = doc.members.every((m) => run.left.has(m.userId));
      const levels: Record<string, number> = {};
      const ends: RpgRunMemberEnd[] = [];
      for (const m of doc.members) {
        if (run.left.has(m.userId)) {
          ends.push(run.leftEnds.get(m.userId)!);
          continue;
        }
        let end: RpgRunMemberEnd = {
          user_id: m.userId,
          dead: m.dead,
          retreated: false,
          reward: null,
          left: [],
          potions_used: m.spoils.potionsUsed,
          ammo_used: m.spoils.ammoUsed,
          levels_gained: 0,
          jobs_gained: 0,
        };
        await this.inQueue(m.userId, async () => {
          const out = await this.mutate(m.userId, null, (d) => {
            const r = settleRunHero(d, doc._id, m.spoils, m.spoils, cost, now);
            if (!r.ok) return r;
            end = {
              ...end,
              reward: {
                xp: m.spoils.xp,
                job_xp: m.spoils.jobXp,
                gold: m.spoils.gold,
                items: m.spoils.items,
                ores: m.spoils.ores,
                stones: m.spoils.stones,
              },
              left: r.settled.left,
              levels_gained: r.settled.levelsGained,
              jobs_gained: r.settled.jobsGained,
            };
            return { ok: true };
          });
          if (out && "doc" in out) {
            levels[m.userId] = out.doc.hero.level;
            this.push(
              host?.sessionOf(m.userId) ?? null,
              out.doc,
              undefined,
              host,
            );
          }
        });
        ends.push(end);
      }
      await this.runStore.settle(doc._id, now);
      this.active.delete(doc._id);
      const outcome: RpgRunEnd = abandoned ? "retirada" : doc.outcome;
      host?.lobbyRunEnded(doc._id, outcome, levels);
      host?.sendRun(
        doc.room,
        [...doc.members.map((m) => m.userId), ...run.watchers],
        this.runSnapshot(run, { outcome, members: ends }) as unknown as Record<
          string,
          unknown
        >,
      );
      this.log.info("rpg run settled", {
        server: doc.server,
        run: doc._id,
        outcome,
      });
    } catch (err) {
      run.settling = false;
      run.nextTry = this.now() + SETTLE_RETRY_MS;
      this.log.error("rpg run settle failed", {
        run: doc._id,
        err: String(err),
      });
    }
  }

  /**
   * Entrega as transferências da fila de saída de `sender`. O crédito roda na fila de quem recebe e
   * a baixa na de quem enviou, cada um sem esperar o outro. O crédito é por `id` (uma vez só); se o
   * processo cair no meio, a próxima leitura de quem enviou entrega de novo. Destino sem herói: volta.
   */
  private deliver(sender: RpgHeroDoc, host: RpgHost | null = null): void {
    for (const t of sender.outbox) {
      if (this.delivering.has(t.id)) continue;
      this.delivering.add(t.id);
      const done = () => this.delivering.delete(t.id);
      this.enqueue(
        t.to,
        async () => {
          const got = await this.mutate(t.to, null, (d) => transferIn(d, t));
          if (got === null && (await this.load(t.to, true))) {
            done();
            return;
          }
          if (got && "reason" in got)
            throw new Error(`transfer in: ${got.reason}`);
          const refund = got === null;
          if (got && host)
            this.push(host.sessionOf(t.to), got.doc, undefined, host);
          this.enqueue(
            sender._id,
            async () => {
              const out = await this.mutate(sender._id, null, (d) =>
                transferSettled(d, t.id, refund),
              );
              done();
              if (out && "doc" in out && host)
                this.push(host.sessionOf(sender._id), out.doc, undefined, host);
              this.log.info("rpg transfer", {
                id: t.id,
                gold: t.gold,
                items: t.items.length,
                refund,
              });
            },
            done,
          );
        },
        done,
      );
    }
  }

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
    if (doc) host?.setHero(doc._id, heroLook(doc));
    // O mapa segue o banco: sem treino no herói, sem "treinando" no avatar.
    if (doc && !doc.dojo) host?.setTraining(doc._id, null);
    if (!session) return;
    const ev: RpgStateEvent = {
      v: 1,
      t: "rpg.state",
      ...(re ? { re } : {}),
      d: {
        server_now: this.now(),
        rev: doc?.rev ?? 0,
        hero: doc ? rpgHeroState(doc, this.rates, this.now()) : null,
      },
    };
    session.send(ev as unknown as Record<string, unknown>);
  }

  /**
   * Lê o herói (cache LRU). O documento torto não é consertado: o motivo vai para o log e o comando
   * falha (o dado fica como está no banco para o suporte olhar).
   */
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
    if (!raw) {
      this.cache.delete(userId);
      return null;
    }
    const checked = checkHeroDoc(raw);
    if (!checked.ok) {
      this.log.error("rpg hero invalid", {
        user: userId,
        reason: checked.reason,
      });
      throw new Error(`rpg hero ${userId} invalid: ${checked.reason}`);
    }
    const doc = checked.doc;
    this.keep(doc);
    if (doc.outbox.length > 0) this.deliver(doc);
    return structuredClone(doc);
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
      if (this.buckets.size > this.cacheMax * 2)
        this.buckets.delete(this.buckets.keys().next().value as string);
    }
    return b;
  }
}

/**
 * Taxa do operador: `SPACE_GAME_RATES="exp=2"` (as chaves antigas de skill, magia e loot são
 * ignoradas na engine nova). Chave ausente ou inválida fica no padrão.
 */
export function ratesFromEnv(raw: string | undefined): RpgRates {
  const out: RpgRates = { ...DEFAULT_RPG_RATES };
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [k, v] = part.split("=").map((x) => x.trim());
    const n = Number(v);
    if (!k || !Number.isFinite(n) || n <= 0 || n > 1_000) continue;
    if (k === "exp") out.exp = n;
  }
  return out;
}
