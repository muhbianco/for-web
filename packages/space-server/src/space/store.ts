import type { Collection, MongoClient } from "mongodb";

import { type Assignment, normalizeWings, type StoredWing } from "./assignment.ts";

/**
 * Persistence of room placement. `save` is compare-and-set on `rev`, so two
 * writers (a redeploy overlapping the old process) can never interleave.
 */
export interface AssignmentStore {
  load(serverId: string): Promise<Assignment | null>;
  /** Writes `next` only if the stored rev is still `expectedRev` (0 = absent). */
  save(next: Assignment, expectedRev: number): Promise<boolean>;
}

export class MemoryAssignmentStore implements AssignmentStore {
  readonly docs = new Map<string, Assignment>();

  async load(serverId: string): Promise<Assignment | null> {
    const a = this.docs.get(serverId);
    return a ? structuredClone(a) : null;
  }

  async save(next: Assignment, expectedRev: number): Promise<boolean> {
    const cur = this.docs.get(next.serverId);
    if ((cur?.rev ?? 0) !== expectedRev) return false;
    this.docs.set(next.serverId, structuredClone(next));
    return true;
  }
}

interface AssignmentDoc {
  _id: string;
  rev: number;
  /** Template 1 documents hold `null` for free slots; normalized on load. */
  wings: StoredWing[];
  updated_at: Date;
}

/** Mongo `muchat_space.assignments`, one bounded document per Stoat server. */
export class MongoAssignmentStore implements AssignmentStore {
  private readonly col: Collection<AssignmentDoc>;

  constructor(client: MongoClient, db = "muchat_space") {
    this.col = client.db(db).collection<AssignmentDoc>("assignments");
  }

  async load(serverId: string): Promise<Assignment | null> {
    const doc = await this.col.findOne({ _id: serverId }, { maxTimeMS: 3_000 });
    return doc ? { serverId: doc._id, rev: doc.rev, wings: normalizeWings(doc.wings) } : null;
  }

  async save(next: Assignment, expectedRev: number): Promise<boolean> {
    const doc = { rev: next.rev, wings: next.wings, updated_at: new Date() };
    if (expectedRev === 0) {
      try {
        await this.col.insertOne({ _id: next.serverId, ...doc });
        return true;
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return false; // someone else created it
        throw err;
      }
    }
    const res = await this.col.updateOne({ _id: next.serverId, rev: expectedRev }, { $set: doc }, { maxTimeMS: 3_000 });
    return res.modifiedCount === 1;
  }
}
