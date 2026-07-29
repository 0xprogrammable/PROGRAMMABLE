import { describe, expect, it } from "vitest";

import {
  DEEP_V2_KEEPER_LEASE_DURATION_MS,
  DEEP_V2_KEEPER_LEASE_PATH,
  acquireDeepV2KeeperLease,
  assertDeepV2KeeperLease,
  releaseDeepV2KeeperLease,
} from "../ops/deep-keeper-v2/lease.mjs";

type Entry = { value: string; etag: string };

function memoryLeaseStore() {
  let entry: Entry | null = null;
  let version = 0;

  return {
    async read(path: string) {
      expect(path).toBe(DEEP_V2_KEEPER_LEASE_PATH);
      return entry ? { ...entry } : null;
    },
    async putIfAbsent(path: string, value: string) {
      expect(path).toBe(DEEP_V2_KEEPER_LEASE_PATH);
      if (entry) return null;
      version += 1;
      entry = { value, etag: `etag-${version}` };
      return { etag: entry.etag };
    },
    async putIfMatch(path: string, value: string, etag: string) {
      expect(path).toBe(DEEP_V2_KEEPER_LEASE_PATH);
      if (!entry || entry.etag !== etag) return null;
      version += 1;
      entry = { value, etag: `etag-${version}` };
      return { etag: entry.etag };
    },
  };
}

describe("Deep V2 fenced distributed lease", () => {
  it("gives exactly one overlapping invocation ownership", async () => {
    const store = memoryLeaseStore();
    const [first, second] = await Promise.all([
      acquireDeepV2KeeperLease({
        store,
        nowMs: 10_000,
        ownerId: "first",
        createFencingToken: () => "token-first",
      }),
      acquireDeepV2KeeperLease({
        store,
        nowMs: 10_000,
        ownerId: "second",
        createFencingToken: () => "token-second",
      }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((first ?? second)?.generation).toBe(1);
  });

  it("increments the generation on takeover and rejects the stale fence", async () => {
    const store = memoryLeaseStore();
    const first = await acquireDeepV2KeeperLease({
      store,
      nowMs: 10_000,
      ownerId: "first",
      createFencingToken: () => "token-first",
    });
    const second = await acquireDeepV2KeeperLease({
      store,
      nowMs: 10_000 + DEEP_V2_KEEPER_LEASE_DURATION_MS,
      ownerId: "second",
      createFencingToken: () => "token-second",
    });

    expect(first).toMatchObject({ generation: 1 });
    expect(second).toMatchObject({
      generation: 2,
      fencingToken: "token-second",
    });
    await expect(
      assertDeepV2KeeperLease({
        store,
        lease: first!,
        nowMs: 10_000 + DEEP_V2_KEEPER_LEASE_DURATION_MS,
      }),
    ).resolves.toBe(false);
    await expect(
      assertDeepV2KeeperLease({
        store,
        lease: second!,
        nowMs: 10_000 + DEEP_V2_KEEPER_LEASE_DURATION_MS,
      }),
    ).resolves.toBe(true);
  });

  it("cannot release a successor with a stale ETag and fencing token", async () => {
    const store = memoryLeaseStore();
    const first = await acquireDeepV2KeeperLease({
      store,
      nowMs: 10_000,
      ownerId: "first",
      createFencingToken: () => "token-first",
    });
    const second = await acquireDeepV2KeeperLease({
      store,
      nowMs: 10_000 + DEEP_V2_KEEPER_LEASE_DURATION_MS,
      ownerId: "second",
      createFencingToken: () => "token-second",
    });

    await expect(
      releaseDeepV2KeeperLease({
        store,
        lease: first!,
        nowMs: 100_001,
      }),
    ).resolves.toBe(false);
    await expect(
      assertDeepV2KeeperLease({
        store,
        lease: second!,
        nowMs: 100_001,
      }),
    ).resolves.toBe(true);
  });
});
