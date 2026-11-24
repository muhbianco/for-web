import type { Collection, MongoClient } from "mongodb";

/**
 * Where each avatar stood when the process stopped (24/11/2026, owner: "when the web or LiveKit
 * resets, the avatars go back where they were, training too"). Every for-web deploy restarts this
 * process; positions and who trains at which dummy live only in memory. On SIGTERM each live
 * space writes its avatars here, and the next process puts them back on their first join.
 */
export interface ResumeSpot {
  user: string;
  /** Pixel position; null = only the training is known (the avatar goes next to the dummy). */
  x: number | null;
  y: number | null;
  room: string | null;
  /** The dummy instance the person trained at, if any. */
  training: string | null;
}

/** A spot older than this is the ordinary "came back later" case: the normal entry applies. */
export const RESUME_SPOT_TTL_MS = 30 * 60_000;
/** One bounded document per server. */
export const RESUME_SPOTS_MAX = 500;

export interface SpotStore {
  save(serverId: string, spots: ResumeSpot[], savedAt: number): Promise<void>;
  /** The spots saved at or after `since`, removed so a later restart never replays them. */
  take(serverId: string, since: number): Promise<ResumeSpot[]>;
}

export class MemorySpotStore implements SpotStore {
  readonly docs = new Map<string, { spots: ResumeSpot[]; savedAt: number }>();

  async save(serverId: string, spots: ResumeSpot[], savedAt: number): Promise<void> {
    this.docs.set(serverId, { spots: structuredClone(spots.slice(0, RESUME_SPOTS_MAX)), savedAt });
  }

  async take(serverId: string, since: number): Promise<ResumeSpot[]> {
    const d = this.docs.get(serverId);
    this.docs.delete(serverId);
    return d && d.savedAt >= since ? structuredClone(d.spots) : [];
  }
}

interface SpotDoc {
  _id: string;
  spots: ResumeSpot[];
  saved_at: Date;
}

const OP = { maxTimeMS: 2_000 } as const;

/** Mongo `muchat_space.resume_spots`. */
export class MongoSpotStore implements SpotStore {
  private readonly col: Collection<SpotDoc>;

  constructor(client: Pick<MongoClient, "db">, db = "muchat_space") {
    this.col = client.db(db).collection<SpotDoc>("resume_spots");
  }

  async save(serverId: string, spots: ResumeSpot[], savedAt: number): Promise<void> {
    await this.col.replaceOne(
      { _id: serverId },
      { spots: spots.slice(0, RESUME_SPOTS_MAX), saved_at: new Date(savedAt) },
      { upsert: true, ...OP },
    );
  }

  async take(serverId: string, since: number): Promise<ResumeSpot[]> {
    const doc = await this.col.findOneAndDelete({ _id: serverId }, OP);
    if (!doc || !(doc.saved_at instanceof Date) || doc.saved_at.getTime() < since) return [];
    return (Array.isArray(doc.spots) ? doc.spots : []).slice(0, RESUME_SPOTS_MAX).filter(validSpot);
  }
}

/** A stored spot is read back as untrusted input (a hand edit, an older format). */
export function validSpot(s: unknown): s is ResumeSpot {
  if (!s || typeof s !== "object") return false;
  const v = s as Record<string, unknown>;
  const num = (n: unknown) => n === null || (typeof n === "number" && Number.isFinite(n));
  const str = (n: unknown) => n === null || (typeof n === "string" && n.length > 0 && n.length <= 64);
  return typeof v.user === "string" && v.user.length > 0 && v.user.length <= 64 && num(v.x) && num(v.y) && str(v.room) && str(v.training);
}
