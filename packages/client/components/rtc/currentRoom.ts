/**
 * Whether a late answer about `room` still belongs to the call.
 *
 * Opening the mic is getUserMedia, then publish, and a room of the Espaço can
 * be gone before that ends: the person walks out right after it connected (or
 * the page walks them to the `?sala=` room), and the space server revokes it.
 * livekit-client then waits 15 s for an engine that never comes back and
 * rejects with "publishing rejected as engine not connected within timeout".
 * That failure belongs to the room that was left, not to the call: it must not
 * show an error nor turn the person's mic setting off. Measured on 23/11/2026,
 * that setting went off while the mic of the room they were in was open and
 * sending (docs/voz/12 in the muchat repo).
 *
 * Pure so it can be tested; Voice asks it before applying such an answer.
 */

/** The slice of a livekit Room this needs (Room.state is a ConnectionState). */
export interface RoomLike {
  readonly state: string;
}

/**
 * True while `room` is the call's room and has not disconnected. A room that is
 * reconnecting is still the call's: a failure there is a real one.
 */
export function isCurrentRoom<R extends RoomLike>(
  current: R | undefined,
  room: R,
): boolean {
  return current === room && room.state !== "disconnected";
}
