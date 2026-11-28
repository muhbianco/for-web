import {
  type ClassId,
  type RpgRankRow,
  dungeonById,
} from "@muchat/space-core/game/ot/balance";
import type { MongoClient } from "mongodb";

import type { RpgRunDoc } from "./runs.ts";

/**
 * O ranking do Idle Hunt (28/11/2026, o dono: "rank solo, quem vai mais longe nas DGs; rank grupo, as
 * comps que foram mais longe até agora; top 10 de cada"). Um recorde por herói sozinho e um por grupo
 * (o mesmo conjunto de jogadores), em todo o Muchat (o dono: "rank é global, entre todos os
 * servidores; informe de qual servidor é o herói"): a DG mais difícil que venceram, quando e em que
 * servidor. As corridas
 * somem do banco em 30 dias (TTL), então o recorde mora numa coleção própria, que só sobe: uma
 * vitória mais fácil nunca troca a mais difícil, e a mesma DG fica com a data da primeira vez.
 *
 * Quem saiu da corrida antes do fim conta no grupo: a corrida é calculada inteira na largada, ele
 * lutou. Os nomes e as classes ficam como estavam na vitória.
 */
export type RecordKind = "solo" | "grupo";

export interface RpgRecordDoc {
  _id: string;
  /** O servidor da corrida que deu o recorde (o nome sai do Stoat na hora de mostrar). */
  server: string;
  kind: RecordKind;
  /** Maior = DG mais difícil (o nível; no mesmo nível, Região > Masmorra > Caçada). */
  score: number;
  dungeon: string;
  /** Quando a corrida que deu o recorde começou (ms). */
  at: number;
  run: string;
  members: { user_id: string; name: string; cls: ClassId; level: number }[];
}

const KIND_RANK = { cacada: 0, masmorra: 1, regional: 2 } as const;

/** A dificuldade de uma DG para o ranking (null: id que o catálogo não conhece mais). */
export function dungeonScore(dungeonId: string): number | null {
  const d = dungeonById(dungeonId);
  return d ? d.level * 4 + KIND_RANK[d.kind] : null;
}

/** O recorde que uma corrida fechada vale (null: não venceu ou DG desconhecida). */
export function recordOf(
  doc: Pick<
    RpgRunDoc,
    "_id" | "server" | "dungeon" | "outcome" | "started_at"
  > & {
    members: {
      userId: string;
      name: string;
      hero: { cls: ClassId; level: number };
    }[];
  },
): RpgRecordDoc | null {
  if (doc.outcome !== "vitoria" || doc.members.length === 0) return null;
  const score = dungeonScore(doc.dungeon);
  if (score === null) return null;
  const d = dungeonById(doc.dungeon)!;
  const kind: RecordKind = doc.members.length === 1 ? "solo" : "grupo";
  const ids = doc.members.map((m) => m.userId).sort();
  return {
    _id: `${kind}:${ids.join(",")}`,
    server: doc.server,
    kind,
    score,
    // O id de hoje (uma DG com id antigo, P11, conta como a de agora).
    dungeon: d.id,
    at: doc.started_at,
    run: doc._id,
    members: doc.members.map((m) => ({
      user_id: m.userId,
      name: m.name,
      cls: m.hero.cls,
      level: m.hero.level,
    })),
  };
}

/** O que o recorde novo faz com o guardado: sobe a DG, ou na mesma DG fica a data mais antiga. */
export function better(
  next: RpgRecordDoc,
  cur: RpgRecordDoc | undefined,
): boolean {
  if (!cur) return true;
  return (
    next.score > cur.score || (next.score === cur.score && next.at < cur.at)
  );
}

export function rankRow(
  r: RpgRecordDoc,
  serverName: (id: string) => string | null,
): RpgRankRow {
  return {
    dungeon: r.dungeon,
    at: r.at,
    members: r.members,
    server: { id: r.server, name: serverName(r.server) },
  };
}

/** Quantos o ranking mostra de cada lista. */
export const RANK_TOP = 10;

export interface RecordStore {
  /** Guarda se for melhor que o que existe (atômico); true se gravou. */
  offer(rec: RpgRecordDoc): Promise<boolean>;
  /** Os melhores de todos os servidores: a DG mais difícil primeiro; empate, quem chegou antes. */
  top(kind: RecordKind, limit: number): Promise<RpgRecordDoc[]>;
  /** A carga das corridas de antes do ranking já foi feita? (marca por versão). */
  backfilled(version: number): Promise<boolean>;
  markBackfilled(version: number, at: number): Promise<void>;
}

export const RECORDS_COLLECTION = "rpg_records5";

export class MemoryRecordStore implements RecordStore {
  readonly docs = new Map<string, RpgRecordDoc>();
  private readonly marks = new Set<number>();

  async offer(rec: RpgRecordDoc): Promise<boolean> {
    if (!better(rec, this.docs.get(rec._id))) return false;
    this.docs.set(rec._id, structuredClone(rec));
    return true;
  }

  async top(kind: RecordKind, limit: number) {
    return [...this.docs.values()]
      .filter((d) => d.kind === kind)
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .slice(0, limit)
      .map((d) => structuredClone(d));
  }

  async backfilled(version: number) {
    return this.marks.has(version);
  }

  async markBackfilled(version: number) {
    this.marks.add(version);
  }
}

const OP = { maxTimeMS: 2_000 } as const;
type MarkDoc = { _id: string; kind: "mark"; at: number };

/** Mongo `muchat_space.rpg_records5`: um documento por recorde e a marca da carga inicial. */
export class MongoRecordStore implements RecordStore {
  private readonly col;

  constructor(client: Pick<MongoClient, "db">, db = "muchat_space") {
    this.col = client
      .db(db)
      .collection<RpgRecordDoc | MarkDoc>(RECORDS_COLLECTION);
  }

  /** O top de cada lista sai pelo índice; falha aqui não derruba nada. */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex(
      { kind: 1, score: -1, at: 1 },
      { maxTimeMS: 10_000 },
    );
  }

  async offer(rec: RpgRecordDoc): Promise<boolean> {
    // Sobe só se for melhor: o filtro não casa com um recorde igual ou maior, e o upsert então tenta
    // inserir o mesmo _id e bate na chave (E11000) — é o "não gravou". Atômico entre processos.
    try {
      const res = await this.col.updateOne(
        {
          _id: rec._id,
          $or: [
            { score: { $lt: rec.score } },
            { score: rec.score, at: { $gt: rec.at } },
          ],
        } as never,
        { $set: rec },
        { ...OP, upsert: true },
      );
      return res.modifiedCount + res.upsertedCount > 0;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  }

  async top(kind: RecordKind, limit: number) {
    return (await this.col
      .find({ kind } as never, {
        ...OP,
        limit,
        sort: { score: -1, at: 1 },
      })
      .toArray()) as RpgRecordDoc[];
  }

  async backfilled(version: number) {
    return (
      (await this.col.countDocuments(
        { _id: `mark:backfill:${version}` } as never,
        OP,
      )) > 0
    );
  }

  async markBackfilled(version: number, at: number) {
    await this.col.updateOne(
      { _id: `mark:backfill:${version}` } as never,
      { $set: { kind: "mark", at } },
      { ...OP, upsert: true },
    );
  }
}
