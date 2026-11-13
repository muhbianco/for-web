import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { managedRoomName, mediaIdentity } from "@muchat/space-core";

import { MediaController, MediaUnavailable } from "./controller.ts";
import { FakeClock, FakeLeases, FakeLiveKit, FakeMinter } from "./fakes.ts";
import { Sweeper } from "./sweeper.ts";

const USER = "01M0AVGXQBDXXBEBXTF3YSFCQS";
const OTHER = "01M0AVGXQBDXXBEBXTF3YSFCQT";
const ROOM_A = "01JCX6Y2Z9K8M7N6P5Q4R3S2T1";
const ROOM_B = "01JCX6Y2Z9K8M7N6P5Q4R3S2T2";
const SERVER = "01JSRV00000000000000000000";

function setup() {
  const lk = new FakeLiveKit();
  const leases = new FakeLeases();
  const minter = new FakeMinter();
  const clock = new FakeClock();
  const exhausted: string[] = [];
  const mc = new MediaController({
    lk,
    leases,
    minter,
    publicUrl: "wss://lab/livekit",
    clock,
    events: { onRemoveRetryExhausted: (r, i) => exhausted.push(`${r}:${i}`) },
  });
  return { lk, leases, minter, clock, mc, exhausted };
}

const input = (roomId: string, userId = USER) => ({
  userId,
  displayName: "Fulano",
  serverId: SERVER,
  roomId,
  epoch: 1,
  capacity: 10,
  sources: ["microphone" as const],
  canSubscribe: true,
});

let open: MediaController[] = [];
afterEach(() => {
  for (const mc of open) mc.stop();
  open = [];
});

test("grant writes the lease before creating the room and minting", async () => {
  const { lk, leases, minter, mc } = setup();
  open.push(mc);
  const g = await mc.grant(input(ROOM_A));
  assert.equal(g.roomName, managedRoomName(ROOM_A, 1));
  assert.equal(g.identity, mediaIdentity(USER, g.grantSeq));
  assert.deepEqual(leases.calls, [`revoke:${USER}`, `write:${g.identity}`]);
  assert.deepEqual(lk.calls, [`ensure:${g.roomName}`]);
  assert.equal(minter.minted[0]?.ttlSeconds, 30);
  assert.equal(minter.minted[0]?.room, g.roomName);
});

test("every grant gets a new identity; the old lease is gone", async () => {
  const { leases, mc } = setup();
  open.push(mc);
  const a = await mc.grant(input(ROOM_A));
  const b = await mc.grant(input(ROOM_A));
  assert.notEqual(a.identity, b.identity);
  assert.ok(b.grantSeq > a.grantSeq);
  assert.equal(leases.leases.has(a.identity), false);
  assert.equal(leases.pointers.get(USER), b.identity);
});

test("moving A→B removes the A participant before the B lease exists", async () => {
  const { lk, leases, mc } = setup();
  open.push(mc);
  const a = await mc.grant(input(ROOM_A));
  lk.join(a.roomName, a.identity);
  lk.calls = [];
  leases.calls = [];
  const b = await mc.grant(input(ROOM_B));
  assert.deepEqual(lk.calls.slice(0, 2), [`remove:${a.roomName}:${a.identity}`, `ensure:${b.roomName}`]);
  assert.deepEqual(leases.calls, [`revoke:${USER}`, `write:${b.identity}`]);
  assert.equal(lk.rooms.get(a.roomName)?.has(a.identity), false);
});

test("unconfirmed removal from the previous room refuses the new grant", async () => {
  const { lk, leases, mc } = setup();
  open.push(mc);
  const a = await mc.grant(input(ROOM_A));
  lk.join(a.roomName, a.identity);
  lk.failRemove = new Error("livekit timeout");
  await assert.rejects(mc.grant(input(ROOM_B)), MediaUnavailable);
  assert.equal(leases.pointers.has(USER), false, "no lease for B");
});

test("revoke removes orphan identities of the same user, not other users", async () => {
  const { lk, mc } = setup();
  open.push(mc);
  const a = await mc.grant(input(ROOM_A));
  lk.join(a.roomName, a.identity);
  const orphan = mediaIdentity(USER, 1);
  const stranger = mediaIdentity(OTHER, 5);
  lk.join(a.roomName, orphan);
  lk.join(a.roomName, `${orphan}#x`);
  lk.join(a.roomName, stranger);
  await mc.revoke(USER);
  const left = [...(lk.rooms.get(a.roomName) ?? [])];
  assert.deepEqual(left, [stranger]);
});

test("NotFound schedules retries that catch a late join, then stop", async () => {
  const { lk, mc, clock, exhausted } = setup();
  open.push(mc);
  const a = await mc.grant(input(ROOM_A));
  // Not joined yet: the join is in flight when the lease is revoked.
  await mc.revoke(USER);
  assert.equal(mc.pendingRetryCount, 1);
  await clock.advance(1_000);
  lk.join(a.roomName, a.identity); // the stale join completes
  await clock.advance(3_000);
  assert.equal(lk.rooms.get(a.roomName)?.has(a.identity), false, "late joiner removed");
  await clock.advance(30_000);
  assert.equal(mc.pendingRetryCount, 0);
  assert.deepEqual(exhausted, [`${a.roomName}:${a.identity}`]);
});

test("revoke still removes media when the lease store is down", async () => {
  const { lk, leases, mc } = setup();
  open.push(mc);
  const a = await mc.grant(input(ROOM_A));
  lk.join(a.roomName, a.identity);
  leases.down = true;
  await mc.revoke(USER);
  assert.equal(lk.rooms.get(a.roomName)?.has(a.identity), false);
});

test("grant with the store down fails closed and leaves no lease", async () => {
  const { leases, mc } = setup();
  open.push(mc);
  leases.down = true;
  await assert.rejects(mc.grant(input(ROOM_A)), MediaUnavailable);
  leases.down = false;
  assert.equal(leases.pointers.size, 0);
});

test("room creation failure rolls the lease back", async () => {
  const { lk, leases, mc } = setup();
  open.push(mc);
  lk.failEnsure = new Error("livekit down");
  await assert.rejects(mc.grant(input(ROOM_A)), MediaUnavailable);
  assert.equal(leases.pointers.size, 0);
  assert.equal(leases.leases.size, 0);
});

test("sweeper removes participants without a matching lease and stale rooms", async () => {
  const { lk, leases, mc } = setup();
  open.push(mc);
  const a = await mc.grant(input(ROOM_A));
  lk.join(a.roomName, a.identity);
  lk.join(a.roomName, mediaIdentity(OTHER, 3)); // no lease
  lk.join(a.roomName, `${a.identity}#pub`); // publish-suffixed
  const stale = managedRoomName(ROOM_B, 0);
  lk.join(stale, mediaIdentity(OTHER, 4));
  lk.join("01JCHANNEL0000000000000000", "01M0AVGXQBDXXBEBXTF3YSFCQT"); // Stoat room: untouched
  const removed: string[] = [];
  const sw = new Sweeper({
    lk,
    leases,
    isCurrentRoom: (n) => n === a.roomName,
    onRemoved: (_r, id, reason) => removed.push(`${id}:${reason}`),
  });
  const res = await sw.tick();
  assert.ok(res);
  assert.equal(res.rooms, 2);
  assert.deepEqual([...(lk.rooms.get(a.roomName) ?? [])], [a.identity]);
  assert.equal(lk.rooms.has(stale), false);
  assert.ok(lk.rooms.get("01JCHANNEL0000000000000000")?.size === 1);
  assert.deepEqual(removed.sort(), [
    `${a.identity}#pub:publish_suffix`,
    `${mediaIdentity(OTHER, 3)}:no_lease`,
    `${mediaIdentity(OTHER, 4)}:stale_room`,
  ].sort());
});

test("sweeper does not mass-kick when the lease store is unreachable", async () => {
  const { lk, leases, mc } = setup();
  open.push(mc);
  const a = await mc.grant(input(ROOM_A));
  lk.join(a.roomName, a.identity);
  leases.down = true;
  const sw = new Sweeper({ lk, leases, isCurrentRoom: () => true });
  const res = await sw.tick();
  assert.equal(res?.removed.length, 0);
  assert.ok((res?.errors ?? 0) > 0);
  assert.ok(lk.rooms.get(a.roomName)?.has(a.identity));
});
