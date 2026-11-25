import type {
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
  /** O que leva no fim (XP já com stamina e taxa; poções e munição gastas). */
  spoils: RunSpoils;
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
}

export const RUNS_COLLECTION = "rpg_runs5";

/** Quantas corridas em andamento voltam do banco ao subir (teto da consulta). */
export const RUNS_RESUME_LIMIT = 500;
/** Corrida fechada fica no banco por 30 dias (TTL) para consulta e suporte. */
export const RUNS_KEEP_MS = 30 * 24 * 3600_000;

export interface RunStore {
  create(doc: RpgRunDoc): Promise<void>;
  running(limit: number): Promise<RpgRunDoc[]>;
  /** Marca como fechada; false se já estava (outro processo fechou). */
  settle(id: string, at: number): Promise<boolean>;
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

  async settle(id: string, at: number): Promise<boolean> {
    const d = this.docs.get(id);
    if (!d || d.status !== "running") return false;
    d.status = "settled";
    d.settled_at = at;
    return true;
  }
}

type RunMongo = RpgRunDoc & { expire_at: Date | null };
const OP = { maxTimeMS: 2_000 } as const;

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

  async settle(id: string, at: number): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: id, status: "running" },
      {
        $set: {
          status: "settled",
          settled_at: at,
          expire_at: new Date(at + RUNS_KEEP_MS),
        },
      },
      OP,
    );
    return res.matchedCount === 1;
  }
}
