import type { MongoClient } from "mongodb";

import { type RpgHeroDoc, RPG_VERSION } from "./hero.ts";

/**
 * Onde mora o herói do jogo idle (docs/espaco/jogo/ot). Mesmo desenho do store do Refúgio
 * (ADR 0009, decisão 6): compare-and-set em `rev`, a fila por pessoa do serviço serializa
 * um processo e o CAS cobre dois (redeploy sobreposto).
 */
export interface RpgStore {
  get(userId: string): Promise<RpgHeroDoc | null>;
  /** Grava um herói novo; false se ele já existe. */
  create(doc: RpgHeroDoc): Promise<boolean>;
  /** Substitui se o `rev` guardado ainda é `expectRev`; false se alguém gravou antes. */
  save(doc: RpgHeroDoc, expectRev: number): Promise<boolean>;
}

export class MemoryRpgStore implements RpgStore {
  readonly docs = new Map<string, RpgHeroDoc>();
  writes = 0;

  async get(userId: string): Promise<RpgHeroDoc | null> {
    const d = this.docs.get(userId);
    return d ? structuredClone(d) : null;
  }

  async create(doc: RpgHeroDoc): Promise<boolean> {
    if (this.docs.has(doc._id)) return false;
    this.docs.set(doc._id, structuredClone(doc));
    this.writes++;
    return true;
  }

  async save(doc: RpgHeroDoc, expectRev: number): Promise<boolean> {
    const cur = this.docs.get(doc._id);
    if (!cur || cur.rev !== expectRev) return false;
    this.docs.set(doc._id, structuredClone(doc));
    this.writes++;
    return true;
  }
}

type RpgMongo = RpgHeroDoc & { mtime: Date };

/** As versões que este código sabe ler (a 1 é da etapa O5; a conversão mora em hero.ts). */
export function knownVersion(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= RPG_VERSION;
}
const OP = { maxTimeMS: 2_000 } as const;

/**
 * Mongo `muchat_space.rpg_heroes`. Versão de antes (1 até a atual) volta como está e o serviço
 * converte (normalizeHero); versão mais nova que este código (um rollback) = recusa, nunca
 * sobrescreve.
 */
export class MongoRpgStore implements RpgStore {
  private readonly col;

  constructor(client: Pick<MongoClient, "db">, db = "muchat_space") {
    this.col = client.db(db).collection<RpgMongo>("rpg_heroes");
  }

  async get(userId: string): Promise<RpgHeroDoc | null> {
    const raw = await this.col.findOne({ _id: userId }, OP);
    if (!raw) return null;
    const { mtime: _m, ...doc } = raw;
    if (!knownVersion(doc.v))
      throw new Error(`rpg hero ${userId}: unknown version ${String(doc.v)}`);
    return doc as RpgHeroDoc;
  }

  async create(doc: RpgHeroDoc): Promise<boolean> {
    try {
      await this.col.insertOne({ ...doc, mtime: new Date() }, OP);
      return true;
    } catch (err) {
      if ((err as { code?: unknown }).code === 11000) return false;
      throw err;
    }
  }

  async save(doc: RpgHeroDoc, expectRev: number): Promise<boolean> {
    const res = await this.col.replaceOne(
      { _id: doc._id, rev: expectRev },
      { ...doc, mtime: new Date() },
      OP,
    );
    return res.matchedCount === 1;
  }
}
