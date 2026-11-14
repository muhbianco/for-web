import { type DecorSettings, type DecorState, type DecorInstance, DEFAULT_SETTINGS } from "@muchat/space-core";
import type { Collection, MongoClient } from "mongodb";

/**
 * Persistence of a server's decoration (ADR 0007): one bounded document per
 * Stoat server, compare-and-set on `rev` like the room placement, so an
 * overlapping redeploy never interleaves writes.
 */
export interface DecorStore {
  load(serverId: string): Promise<DecorState | null>;
  /** Writes `next` only if the stored rev is still `expectedRev` (0 = absent). */
  save(serverId: string, next: DecorState, expectedRev: number): Promise<boolean>;
}

export class MemoryDecorStore implements DecorStore {
  readonly docs = new Map<string, DecorState>();

  async load(serverId: string): Promise<DecorState | null> {
    const d = this.docs.get(serverId);
    return d ? structuredClone(d) : null;
  }

  async save(serverId: string, next: DecorState, expectedRev: number): Promise<boolean> {
    const cur = this.docs.get(serverId);
    if ((cur?.rev ?? 0) !== expectedRev) return false;
    this.docs.set(serverId, structuredClone(next));
    return true;
  }
}

interface DecorDoc {
  _id: string;
  rev: number;
  floors: Record<string, string>;
  items: DecorInstance[];
  settings: DecorSettings;
  furnished: string[];
  updated_at: Date;
}

/** Mongo `muchat_space.decor`. */
export class MongoDecorStore implements DecorStore {
  private readonly col: Collection<DecorDoc>;

  constructor(client: MongoClient, db = "muchat_space") {
    this.col = client.db(db).collection<DecorDoc>("decor");
  }

  async load(serverId: string): Promise<DecorState | null> {
    const doc = await this.col.findOne({ _id: serverId }, { maxTimeMS: 3_000 });
    if (!doc) return null;
    return {
      rev: doc.rev,
      floors: doc.floors ?? {},
      items: doc.items ?? [],
      settings: doc.settings ?? { ...DEFAULT_SETTINGS, roles: [] },
      furnished: doc.furnished ?? [],
    };
  }

  async save(serverId: string, next: DecorState, expectedRev: number): Promise<boolean> {
    const doc = {
      rev: next.rev,
      floors: next.floors,
      items: next.items,
      settings: next.settings,
      furnished: next.furnished,
      updated_at: new Date(),
    };
    if (expectedRev === 0) {
      try {
        await this.col.insertOne({ _id: serverId, ...doc });
        return true;
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return false;
        throw err;
      }
    }
    const res = await this.col.updateOne({ _id: serverId, rev: expectedRev }, { $set: doc }, { maxTimeMS: 3_000 });
    return res.modifiedCount === 1;
  }
}
