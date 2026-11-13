import { type AvatarLook, defaultPalette, type ProfilePatch, type ProfileView } from "@muchat/space-core";
import type { Collection, MongoClient } from "mongodb";

/**
 * Per-person space profile: the chosen character look and the first-access
 * progress. Server-side so it follows the person across devices (plan §F.11).
 * Deleted with the account (purge_account.py hook, Phase 5).
 */
export interface ProfileStore {
  get(userId: string): Promise<ProfileView>;
  patch(userId: string, patch: ProfilePatch): Promise<ProfileView>;
}

const fresh = (userId: string): ProfileView => ({ look: { palette: defaultPalette(userId) }, onboarding_version: 0 });

function merge(cur: ProfileView, patch: ProfilePatch): ProfileView {
  return {
    look: patch.look ? { palette: patch.look.palette } : cur.look,
    onboarding_version: Math.max(cur.onboarding_version, patch.onboarding_done ?? 0),
  };
}

export class MemoryProfileStore implements ProfileStore {
  readonly docs = new Map<string, ProfileView>();

  async get(userId: string): Promise<ProfileView> {
    return structuredClone(this.docs.get(userId) ?? fresh(userId));
  }

  async patch(userId: string, patch: ProfilePatch): Promise<ProfileView> {
    const next = merge(await this.get(userId), patch);
    this.docs.set(userId, next);
    return structuredClone(next);
  }
}

interface ProfileDoc {
  _id: string;
  look: AvatarLook;
  onboarding_version: number;
  updated_at: Date;
}

/** Mongo `muchat_space.profiles`, one small document per person. */
export class MongoProfileStore implements ProfileStore {
  private readonly col: Collection<ProfileDoc>;

  constructor(client: MongoClient, db = "muchat_space") {
    this.col = client.db(db).collection<ProfileDoc>("profiles");
  }

  async get(userId: string): Promise<ProfileView> {
    const doc = await this.col.findOne({ _id: userId }, { maxTimeMS: 2_000 });
    return doc ? { look: doc.look, onboarding_version: doc.onboarding_version } : fresh(userId);
  }

  async patch(userId: string, patch: ProfilePatch): Promise<ProfileView> {
    // Every field is set by exactly one operator (Mongo rejects conflicts and
    // empty operator documents).
    const set: Record<string, unknown> = { updated_at: new Date() };
    const onInsert: Record<string, unknown> = {};
    if (patch.look) set.look = { palette: patch.look.palette };
    else onInsert.look = { palette: defaultPalette(userId) };
    const update: Record<string, unknown> = { $set: set };
    if (patch.onboarding_done) update.$max = { onboarding_version: patch.onboarding_done };
    else onInsert.onboarding_version = 0;
    if (Object.keys(onInsert).length) update.$setOnInsert = onInsert;
    await this.col.updateOne({ _id: userId }, update, { upsert: true, maxTimeMS: 2_000 });
    return this.get(userId);
  }
}
