import type {
  GainRunRow,
  HeroV5,
  RunOutcome,
  RunSpoils,
} from "@muchat/space-core/game/ot/balance";
import type { MongoClient } from "mongodb";

/**
 * Uma corrida gravada (engine nova, Fase 8). Tudo o que decide o resultado é calculado no início e fica
 * aqui: a semente, a cópia dos heróis, o resultado e o que cada um leva (os itens já com id). Se o
 * processo cair, a corrida volta do banco e fecha na hora certa; os quadros da tela saem de novo da
 * semente (se a `engine` mudou no meio, a recompensa gravada vale e só a tela ao vivo some).
 */
export interface RpgRunMember {
  userId: string;
  name: string;
  /** O herói como entrou (o replay dos quadros sai dele e da semente). */
  hero: HeroV5;
  dead: boolean;
  /** O que leva no fim (XP já com a taxa — e com a stamina até 27/11/2026; poções e munição gastas). */
  spoils: RunSpoils;
  /**
   * O multiplicador do XP de `spoils` na largada: a taxa do servidor (até 27/11/2026 também a stamina,
   * que saiu do jogo). Corridas de antes disso não têm; a estatística deduz pela vitória.
   */
  xp_mult?: number;
}

export interface RpgRunDoc {
  _id: string;
  v: 2;
  engine: number;
  server: string;
  room: string;
  tv: string;
  dungeon: string;
  seed: number;
  started_at: number;
  ends_at: number;
  members: RpgRunMember[];
  outcome: RunOutcome;
  /** Segundos de tela (os quadros): salas e descansos. */
  seconds: number;
  status: "running" | "settled";
  settled_at: number | null;
  auto?: boolean;
  /** Quem saiu antes do fim (não levou nada desta corrida); gravado no fechamento desde 27/11/2026. */
  left?: string[];
}

export const RUNS_COLLECTION = "rpg_runs5";

/** Quantas corridas em andamento voltam do banco ao subir (teto da consulta). */
export const RUNS_RESUME_LIMIT = 500;
/** Corrida fechada fica no banco por 30 dias (TTL) para consulta e suporte. */
export const RUNS_KEEP_MS = 30 * 24 * 3600_000;

export interface RunStore {
  create(doc: RpgRunDoc): Promise<void>;
  running(limit: number): Promise<RpgRunDoc[]>;
  /**
   * As fechadas em vitória pelo loop (`auto`) que terminaram desde `since`, da mais nova para a mais
   * antiga: na subida, o grupo que estava no intervalo entre uma corrida e a próxima (27/11/2026).
   */
  loopWinsSince(since: number, limit: number): Promise<RpgRunDoc[]>;
  /** Marca como fechada (com quem saiu antes); false se já estava (outro processo fechou). */
  settle(id: string, at: number, left?: string[]): Promise<boolean>;
  /**
   * As DGs das corridas fechadas em vitória de que a pessoa participou (ids como gravados, sem
   * repetir). É de onde sai a lista de concluídas do herói gravado antes de 26/11/2026.
   */
  victories(userId: string): Promise<string[]>;
  /**
   * As corridas fechadas da pessoa desde `since` (ms), da mais nova para a mais antiga, até `limit`,
   * já do ponto de vista dela (a estatística de ganho por hora). Quem saiu antes do fim fica de fora.
   */
  gainRows(
    userId: string,
    since: number,
    limit: number,
  ): Promise<{ rows: GainRunRow[]; capped: boolean }>;
  /**
   * As vitórias fechadas que ainda estão no banco, só com o que o ranking lê (a carga inicial dos
   * recordes, 28/11/2026), até `limit`.
   */
  wins(limit: number): Promise<WinDoc[]>;
}

/** O que o ranking lê de uma vitória. */
export type WinDoc = Pick<
  RpgRunDoc,
  "_id" | "server" | "dungeon" | "outcome" | "started_at"
> & {
  members: { userId: string; name: string; hero: { cls: HeroV5["cls"]; level: number } }[];
};

/** O que a estatística lê de uma corrida fechada. */
type GainDoc = Pick<
  RpgRunDoc,
  "dungeon" | "outcome" | "started_at" | "seconds" | "left"
> & {
  members: {
    userId: string;
    dead: boolean;
    hero: { level: number };
    spoils: { xp: number; jobXp: number; gold: number };
    xp_mult?: number;
  }[];
};

/** A corrida do ponto de vista de `userId` (null: não estava nela, ou saiu antes do fim). */
export function gainRowOf(doc: GainDoc, userId: string): GainRunRow | null {
  const me = doc.members.findIndex((m) => m.userId === userId);
  if (me < 0 || doc.left?.includes(userId)) return null;
  const m = doc.members[me]!;
  return {
    dungeon: doc.dungeon,
    outcome: doc.outcome,
    startedAt: doc.started_at,
    seconds: doc.seconds,
    levels: doc.members.map((x) => x.hero.level),
    dead: doc.members.map((x) => x.dead),
    me,
    xp: m.spoils.xp,
    jobXp: m.spoils.jobXp,
    gold: m.spoils.gold,
    ...(typeof m.xp_mult === "number" ? { xpMult: m.xp_mult } : {}),
  };
}

export class MemoryRunStore implements RunStore {
  readonly docs = new Map<string, RpgRunDoc>();

  async create(doc: RpgRunDoc): Promise<void> {
    if (this.docs.has(doc._id)) throw new Error(`run ${doc._id} exists`);
    this.docs.set(doc._id, structuredClone(doc));
  }

  async running(limit: number): Promise<RpgRunDoc[]> {
    return [...this.docs.values()]
      .filter((d) => d.status === "running")
      .sort((a, b) => a.ends_at - b.ends_at)
      .slice(0, limit)
      .map((d) => structuredClone(d));
  }

  async loopWinsSince(since: number, limit: number): Promise<RpgRunDoc[]> {
    return [...this.docs.values()]
      .filter(
        (d) =>
          d.status === "settled" &&
          d.auto === true &&
          d.outcome === "vitoria" &&
          d.ends_at >= since,
      )
      .sort((a, b) => b.ends_at - a.ends_at)
      .slice(0, limit);
  }

  async settle(id: string, at: number, left?: string[]): Promise<boolean> {
    const d = this.docs.get(id);
    if (!d || d.status !== "running") return false;
    d.status = "settled";
    d.settled_at = at;
    if (left?.length) d.left = [...left];
    return true;
  }

  async victories(userId: string): Promise<string[]> {
    const out = new Set<string>();
    for (const d of this.docs.values())
      if (
        d.status === "settled" &&
        d.outcome === "vitoria" &&
        d.members.some((m) => m.userId === userId)
      )
        out.add(d.dungeon);
    return [...out];
  }

  async gainRows(userId: string, since: number, limit: number) {
    const docs = [...this.docs.values()]
      .filter(
        (d) =>
          d.status === "settled" &&
          d.started_at >= since &&
          d.members.some((m) => m.userId === userId),
      )
      .sort((a, b) => b.started_at - a.started_at);
    const rows = docs
      .slice(0, limit)
      .map((d) => gainRowOf(d, userId))
      .filter((r): r is GainRunRow => r !== null);
    return { rows, capped: docs.length > limit };
  }

  async wins(limit: number): Promise<WinDoc[]> {
    return [...this.docs.values()]
      .filter((d) => d.status === "settled" && d.outcome === "vitoria")
      .slice(0, limit)
      .map((d) => ({
        _id: d._id,
        server: d.server,
        dungeon: d.dungeon,
        outcome: d.outcome,
        started_at: d.started_at,
        members: d.members.map((m) => ({
          userId: m.userId,
          name: m.name,
          hero: { cls: m.hero.cls, level: m.hero.level },
        })),
      }));
  }
}

type RunMongo = RpgRunDoc & { expire_at: Date | null };
const OP = { maxTimeMS: 2_000 } as const;
/** A leitura da estatística passa por milhares de corridas grandes (o herói inteiro de cada um). */
const GAIN_QUERY_MS = 5_000;
/** A carga inicial do ranking lê todas as vitórias que ainda estão no banco (uma vez). */
const WINS_QUERY_MS = 30_000;

/** Mongo `muchat_space.rpg_runs5` (a `rpg_runs` do v4 fica como estava). */
export class MongoRunStore implements RunStore {
  private readonly col;

  constructor(client: Pick<MongoClient, "db">, db = "muchat_space") {
    this.col = client.db(db).collection<RunMongo>(RUNS_COLLECTION);
  }

  /** Índices: as em andamento pelo fim; as fechadas somem pelo TTL. Falha aqui não derruba nada. */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex(
      { status: 1, ends_at: 1 },
      { maxTimeMS: 10_000 },
    );
    await this.col.createIndex(
      { expire_at: 1 },
      { expireAfterSeconds: 0, maxTimeMS: 10_000 },
    );
    // As vitórias de uma pessoa (a lista de DGs concluídas de quem jogou antes de 26/11/2026).
    await this.col.createIndex(
      { "members.userId": 1, outcome: 1 },
      { maxTimeMS: 10_000 },
    );
    // O ganho por hora de uma pessoa (as corridas dela numa janela de tempo; 27/11/2026).
    await this.col.createIndex(
      { "members.userId": 1, started_at: -1 },
      { maxTimeMS: 10_000 },
    );
  }

  async create(doc: RpgRunDoc): Promise<void> {
    await this.col.insertOne({ ...doc, expire_at: null }, OP);
  }

  async running(limit: number): Promise<RpgRunDoc[]> {
    const rows = await this.col
      .find({ status: "running" }, { ...OP, limit, sort: { ends_at: 1 } })
      .toArray();
    return rows
      .filter((r) => r.v === 2)
      .map(({ expire_at: _e, ...doc }) => doc as RpgRunDoc);
  }

  async loopWinsSince(since: number, limit: number): Promise<RpgRunDoc[]> {
    // Pelo índice (status, ends_at): a corrida fecha no fim dela.
    const rows = await this.col
      .find(
        { status: "settled", ends_at: { $gte: since }, auto: true, outcome: "vitoria" },
        { ...OP, limit, sort: { ends_at: -1 } },
      )
      .toArray();
    return rows
      .filter((r) => r.v === 2)
      .map(({ expire_at: _e, ...doc }) => doc as RpgRunDoc);
  }

  async settle(id: string, at: number, left?: string[]): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: id, status: "running" },
      {
        $set: {
          status: "settled",
          settled_at: at,
          expire_at: new Date(at + RUNS_KEEP_MS),
          ...(left?.length ? { left: [...left] } : {}),
        },
      },
      OP,
    );
    return res.matchedCount === 1;
  }

  async victories(userId: string): Promise<string[]> {
    const ids = await this.col.distinct(
      "dungeon",
      { "members.userId": userId, outcome: "vitoria", status: "settled" },
      OP,
    );
    return ids.filter((x): x is string => typeof x === "string");
  }

  async gainRows(userId: string, since: number, limit: number) {
    // Uma a mais que o teto: diz se a janela tinha mais corridas do que as lidas.
    const docs = (await this.col
      .find(
        {
          "members.userId": userId,
          status: "settled",
          started_at: { $gte: since },
        },
        {
          maxTimeMS: GAIN_QUERY_MS,
          limit: limit + 1,
          sort: { started_at: -1 },
          projection: {
            _id: 0,
            dungeon: 1,
            outcome: 1,
            started_at: 1,
            seconds: 1,
            left: 1,
            "members.userId": 1,
            "members.dead": 1,
            "members.hero.level": 1,
            "members.spoils.xp": 1,
            "members.spoils.jobXp": 1,
            "members.spoils.gold": 1,
            "members.xp_mult": 1,
          },
        },
      )
      .toArray()) as unknown as GainDoc[];
    const rows = docs
      .slice(0, limit)
      .map((d) => gainRowOf(d, userId))
      .filter((r): r is GainRunRow => r !== null);
    return { rows, capped: docs.length > limit };
  }

  async wins(limit: number): Promise<WinDoc[]> {
    // Uma vez por versão da carga, na subida: sem índice próprio, com prazo maior e só os campos lidos.
    return (await this.col
      .find(
        { status: "settled", outcome: "vitoria", v: 2 },
        {
          maxTimeMS: WINS_QUERY_MS,
          limit,
          projection: {
            _id: 1,
            server: 1,
            dungeon: 1,
            outcome: 1,
            started_at: 1,
            "members.userId": 1,
            "members.name": 1,
            "members.hero.cls": 1,
            "members.hero.level": 1,
          },
        },
      )
      .toArray()) as unknown as WinDoc[];
  }
}
