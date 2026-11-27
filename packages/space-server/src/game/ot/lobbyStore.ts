import type { Collection, MongoClient } from "mongodb";

import type { SavedLobby } from "./lobby.ts";

/**
 * Os grupos de DG de cada servidor no desligamento (27/11/2026, o dono: "é importante que nenhum
 * grupo se perca pra seguir na DG pós-deploy"). Todo deploy do for-web reinicia este processo e os
 * grupos só existem em memória (LobbyHub): no SIGTERM cada espaço vivo grava os seus aqui, e o
 * próximo processo os traz de volta antes de retomar as corridas. Mesmo molde do `resume_spots`.
 */
export interface LobbyStore {
  save(serverId: string, lobbies: SavedLobby[], savedAt: number): Promise<void>;
  /** Todos os gravados desde `since`, apagados (um reinício depois não os traz de novo). */
  takeAll(since: number): Promise<{ serverId: string; lobbies: unknown[] }[]>;
}

/** Um grupo gravado há mais que isso não volta (o processo ficou fora tempo demais). */
export const LOBBY_RESUME_TTL_MS = 30 * 60_000;
/** Teto de grupos por servidor num documento. */
export const LOBBY_RESUME_MAX = 200;

export class MemoryLobbyStore implements LobbyStore {
  readonly docs = new Map<string, { lobbies: SavedLobby[]; savedAt: number }>();

  async save(serverId: string, lobbies: SavedLobby[], savedAt: number): Promise<void> {
    this.docs.set(serverId, {
      lobbies: structuredClone(lobbies.slice(0, LOBBY_RESUME_MAX)),
      savedAt,
    });
  }

  async takeAll(since: number): Promise<{ serverId: string; lobbies: unknown[] }[]> {
    const out: { serverId: string; lobbies: unknown[] }[] = [];
    for (const [serverId, d] of this.docs)
      if (d.savedAt >= since) out.push({ serverId, lobbies: structuredClone(d.lobbies) });
    this.docs.clear();
    return out;
  }
}

interface LobbyDoc {
  _id: string;
  lobbies: unknown[];
  saved_at: Date;
}

const OP = { maxTimeMS: 2_000 } as const;

/** Mongo `muchat_space.rpg_lobbies_resume`. */
export class MongoLobbyStore implements LobbyStore {
  private readonly col: Collection<LobbyDoc>;

  constructor(client: Pick<MongoClient, "db">, db = "muchat_space") {
    this.col = client.db(db).collection<LobbyDoc>("rpg_lobbies_resume");
  }

  async save(serverId: string, lobbies: SavedLobby[], savedAt: number): Promise<void> {
    await this.col.replaceOne(
      { _id: serverId },
      { lobbies: lobbies.slice(0, LOBBY_RESUME_MAX), saved_at: new Date(savedAt) },
      { upsert: true, ...OP },
    );
  }

  async takeAll(since: number): Promise<{ serverId: string; lobbies: unknown[] }[]> {
    const docs = await this.col.find({}, OP).limit(1000).toArray();
    if (docs.length > 0)
      await this.col.deleteMany({ _id: { $in: docs.map((d) => d._id) } }, OP);
    return docs
      .filter((d) => d.saved_at instanceof Date && d.saved_at.getTime() >= since)
      .map((d) => ({
        serverId: d._id,
        lobbies: (Array.isArray(d.lobbies) ? d.lobbies : []).slice(0, LOBBY_RESUME_MAX),
      }));
  }
}
