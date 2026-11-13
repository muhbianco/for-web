import assert from "node:assert/strict";
import { test } from "node:test";

import { type MediaGrant, MediaLink, type MediaStatus, type Timers, type VoicePort } from "./media.ts";

const ROOM = "01JPVB00000000000000000000";
const OTHER = "01JPRV00000000000000000000";

/** The app's voice, reduced to what MediaLink sees. */
class FakeVoice implements VoicePort {
  current: { identity: string; channel: string } | null = null;
  /** LiveKit dropped the call; the app still holds it. */
  dropped = false;
  pending: Array<{ grant: MediaGrant; resolve: () => void; reject: (e: unknown) => void }> = [];
  disconnects = 0;
  connect(grant: MediaGrant): Promise<void> {
    this.current = null;
    this.dropped = false;
    return new Promise((resolve, reject) => {
      this.pending.push({
        grant,
        resolve: () => {
          this.current = { identity: grant.identity, channel: grant.room_id };
          resolve();
        },
        reject,
      });
    });
  }
  disconnect() {
    this.disconnects++;
    this.current = null;
    this.dropped = false;
  }
  identity() {
    return this.current?.identity ?? null;
  }
  live() {
    return this.current !== null && !this.dropped;
  }
  busyElsewhere(roomId: string) {
    return this.current !== null && this.current.channel !== roomId;
  }
  /** A DM call started by the person. */
  otherCall() {
    this.current = { identity: "01JANA00000000000000000000", channel: "DM" };
  }
}

class ManualTimers implements Timers {
  queue: Array<{ fn: () => void; ms: number; id: number }> = [];
  private id = 0;
  set(fn: () => void, ms: number) {
    const id = ++this.id;
    this.queue.push({ fn, ms, id });
    return id;
  }
  clear(h: unknown) {
    this.queue = this.queue.filter((t) => t.id !== h);
  }
  fire() {
    const t = this.queue.shift();
    assert.ok(t, "a timer is pending");
    t.fn();
    return t.ms;
  }
}

const grant = (identity: string, room = ROOM): MediaGrant => ({
  room_id: room,
  url: "wss://chat.test/livekit",
  token: `token-${identity}`,
  identity,
  sources: ["microphone"],
  can_subscribe: true,
  expires_at: 0,
});

function setup() {
  const voice = new FakeVoice();
  const timers = new ManualTimers();
  const statuses: MediaStatus[] = [];
  let requests = 0;
  const link = new MediaLink({
    voice,
    timers,
    request: () => requests++,
    onStatus: (s) => statuses.push(s),
  });
  return { voice, timers, statuses, link, requests: () => requests };
}

const tick = () => new Promise((r) => setImmediate(r));

test("grant → connect; revoked → leave the call", async () => {
  const { voice, link } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  assert.deepEqual(link.status, { kind: "connecting", roomId: ROOM });
  voice.pending[0]!.resolve();
  await tick();
  assert.deepEqual(link.status, { kind: "connected", roomId: ROOM });
  link.onRevoked({ room_id: ROOM, reason: "left" });
  assert.equal(voice.disconnects, 1);
  assert.deepEqual(link.status, { kind: "idle" });
});

test("a fresh token for the admission we are in changes nothing", async () => {
  const { voice, link } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  voice.pending[0]!.resolve();
  await tick();
  link.onGrant(grant("sp_A_1")); // socket came back
  assert.equal(voice.pending.length, 1, "no second connect");
  assert.deepEqual(link.status, { kind: "connected", roomId: ROOM });
});

test("a failed connect retries with backoff by asking for a new token, then stops", async () => {
  const { voice, timers, link, requests } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  voice.pending[0]!.reject(new Error("403"));
  await tick();
  assert.deepEqual(link.status, { kind: "unavailable", roomId: ROOM, retrying: true });
  const delays: number[] = [];
  for (let i = 0; i < 3; i++) {
    delays.push(timers.fire());
    assert.equal(requests(), i + 1);
    link.onGrant(grant(`sp_A_${i + 2}`));
    voice.pending.at(-1)!.reject(new Error("403"));
    await tick();
  }
  assert.deepEqual(delays, [3_000, 6_000, 12_000]);
  assert.deepEqual(link.status, { kind: "unavailable", roomId: ROOM, retrying: false });
  assert.equal(timers.queue.length, 0, "manual from now on");
  link.retry();
  assert.equal(requests(), 4);
});

test("a LiveKit drop waits for the server first: removal by the server is not an error", async () => {
  const { voice, timers, link, requests } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  voice.pending[0]!.resolve();
  await tick();
  link.voiceChanged("dropped");
  link.onRevoked({ room_id: ROOM, reason: "left" }); // arrives right after
  assert.equal(timers.queue.length, 0);
  assert.deepEqual(link.status, { kind: "idle" });
  assert.equal(requests(), 0);

  // A real drop: no event follows, so it asks for a token.
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_2"));
  voice.pending[1]!.resolve();
  await tick();
  link.voiceChanged("dropped");
  timers.fire(); // grace over
  assert.equal(link.status.kind, "unavailable");
  timers.fire(); // first retry
  assert.equal(requests(), 1);
});

test("never takes the app's voice from another call by itself", async () => {
  const { voice, link } = setup();
  voice.otherCall();
  // A grant that comes from a reconnect, not from walking in.
  link.onGrant(grant("sp_A_1"));
  assert.deepEqual(link.status, { kind: "paused", roomId: ROOM });
  assert.equal(voice.pending.length, 0, "the DM call goes on");
  // Leaving the room does not end the DM call either.
  link.onRevoked({ room_id: ROOM, reason: "left" });
  assert.equal(voice.disconnects, 0);
  // Walking in is consent: the room's call replaces the DM.
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_2"));
  assert.equal(voice.pending.length, 1);
});

test("hanging up in the dock pauses; 'Voltar ao áudio' asks again and switches", async () => {
  const { voice, link, requests } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  voice.pending[0]!.resolve();
  await tick();
  voice.disconnect();
  link.voiceChanged("gone");
  assert.deepEqual(link.status, { kind: "paused", roomId: ROOM });
  link.retry();
  assert.equal(requests(), 1);
  link.onGrant(grant("sp_A_1"));
  assert.equal(voice.pending.length, 2, "reconnects with the reissued token");
});

test("another space took the audio: leave ours, offer 'Usar aqui'", async () => {
  const { voice, link } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  voice.pending[0]!.resolve();
  await tick();
  // The other tab already connected with its own identity.
  voice.current = { identity: "sp_A_2", channel: OTHER };
  link.onRevoked({ room_id: ROOM, reason: "elsewhere" });
  assert.equal(voice.disconnects, 0, "never hangs up the other space's call");
  assert.deepEqual(link.status, { kind: "elsewhere", roomId: ROOM });
});

test("a connect that finishes after the revocation is ignored", async () => {
  const { voice, link } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  link.onRevoked({ room_id: ROOM, reason: "left" });
  assert.equal(voice.disconnects, 1, "the in-flight connect is torn down");
  voice.pending[0]!.resolve();
  await tick();
  assert.deepEqual(link.status, { kind: "idle" });
});

test("closing the space leaves only its own call", async () => {
  const a = setup();
  a.link.roomChanged(ROOM);
  a.link.onGrant(grant("sp_A_1"));
  a.voice.pending[0]!.resolve();
  await tick();
  a.link.destroy();
  assert.equal(a.voice.disconnects, 1);

  const b = setup();
  b.voice.otherCall();
  b.link.onGrant(grant("sp_A_1"));
  b.link.destroy();
  assert.equal(b.voice.disconnects, 0);
});

test("the server removes us first, then revokes: the dropped call is left, not kept", async () => {
  const { voice, timers, link } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  voice.pending[0]!.resolve();
  await tick();
  voice.dropped = true; // LiveKit removed the participant before the WS event
  link.voiceChanged("dropped");
  link.onRevoked({ room_id: ROOM, reason: "left" });
  assert.equal(voice.disconnects, 1, "the held, dead call is cleaned up");
  assert.equal(voice.identity(), null);
  assert.deepEqual(link.status, { kind: "idle" });
  assert.equal(timers.queue.length, 0);
});

test("a reissued token for a dropped call reconnects instead of claiming it is up", async () => {
  const { voice, link } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  voice.pending[0]!.resolve();
  await tick();
  voice.dropped = true;
  link.onGrant(grant("sp_A_1")); // same admission, fresh token
  assert.equal(voice.pending.length, 2, "connects again");
  assert.deepEqual(link.status, { kind: "connecting", roomId: ROOM });
});

test("another tab took the session: this one leaves its call and waits", async () => {
  const { voice, timers, link } = setup();
  link.roomChanged(ROOM);
  link.onGrant(grant("sp_A_1"));
  voice.pending[0]!.resolve();
  await tick();
  voice.dropped = true; // LiveKit kicked the duplicate identity
  link.voiceChanged("dropped");
  link.detach();
  assert.equal(voice.disconnects, 1);
  assert.deepEqual(link.status, { kind: "idle" });
  assert.equal(timers.queue.length, 0, "no retry from a replaced tab");
});
