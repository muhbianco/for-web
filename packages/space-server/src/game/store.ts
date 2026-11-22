import type { MongoClient } from "mongodb";

import { HERO_VERSION, type HeroDoc } from "./hero.ts";

/**
 * Onde o herói mora (ADR 0009, decisão 6). Escrita com compare-and-set em
 * `rev`: a fila por pessoa do GameService já serializa os comandos de um
 * processo, e o CAS cobre dois processos (redeploy sobreposto).
 */
export interface GameStore {
  get(userId: string): Promise<HeroDoc | null>;
  /** Grava um herói novo; false se ele já existe. */
  create(doc: HeroDoc): Promise<boolean>;
  /** Substitui se o `rev` guardado ainda é `expectRev`; false se alguém gravou antes. */
  save(doc: HeroDoc, expectRev: number): Promise<boolean>;
}

export class MemoryGameStore implements GameStore {
  readonly docs = new Map<string, HeroDoc>();
  writes = 0;

  async get(userId: string): Promise<HeroDoc | null> {
    const d = this.docs.get(userId);
    return d ? structuredClone(d) : null;
  }

  async create(doc: HeroDoc): Promise<boolean> {
    if (this.docs.has(doc._id)) return false;
    this.docs.set(doc._id, structuredClone(doc));
    this.writes++;
    return true;
  }

  async save(doc: HeroDoc, expectRev: number): Promise<boolean> {
    const cur = this.docs.get(doc._id);
    if (!cur || cur.rev !== expectRev) return false;
    this.docs.set(doc._id, structuredClone(doc));
    this.writes++;
    return true;
  }
}

/** Um documento no Mongo: o herói mais a hora da gravação como Date (para quem olha o banco). */
type HeroMongo = HeroDoc & { mtime: Date };

const OP = { maxTimeMS: 2_000 } as const;

/** Mongo `muchat_space.game_heroes`. Versão desconhecida no banco = recusa, nunca sobrescreve. */
export class MongoGameStore implements GameStore {
  private readonly col;

  constructor(client: Pick<MongoClient, "db">, db = "muchat_space") {
    this.col = client.db(db).collection<HeroMongo>("game_heroes");
  }

  async get(userId: string): Promise<HeroDoc | null> {
    const raw = await this.col.findOne({ _id: userId }, OP);
    if (!raw) return null;
    const { mtime: _m, ...doc } = raw;
    if (doc.v !== HERO_VERSION) throw new Error(`hero ${userId}: unknown version ${String(doc.v)}`);
    return doc as HeroDoc;
  }

  async create(doc: HeroDoc): Promise<boolean> {
    try {
      await this.col.insertOne({ ...doc, mtime: new Date() }, OP);
      return true;
    } catch (err) {
      if ((err as { code?: unknown }).code === 11000) return false;
      throw err;
    }
  }

  async save(doc: HeroDoc, expectRev: number): Promise<boolean> {
    const res = await this.col.replaceOne({ _id: doc._id, rev: expectRev }, { ...doc, mtime: new Date() }, OP);
    return res.matchedCount === 1;
  }
}
