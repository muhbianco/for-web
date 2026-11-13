/**
 * Stoat user id of a LiveKit participant.
 *
 * In classic calls (join_call) the identity IS the user id. In rooms of the
 * Muchat Espaço it is `sp_<userId>_<grantSeq>`, one per entry
 * (space-core/src/media/naming.ts), so a token from an earlier entry never
 * matches again. Everything in the UI that looks a person up by participant
 * (avatar, name, per-person volume and mute) goes through here.
 *
 * Display only: admission is decided by the space server and the livekit-gate.
 */
const SPACE_IDENTITY = /^sp_([0-9A-HJKMNP-TV-Z]{26})_(?:0|[1-9][0-9]{0,15})$/;

export function participantUserId(identity: string): string {
  // LiveKit's v0 `publish` parameter can add a "#suffix"; ignore it.
  const base = identity.split("#", 1)[0] ?? identity;
  return SPACE_IDENTITY.exec(base)?.[1] ?? identity;
}
