import { describe, expect, it } from "vitest";

import {
  DEEP_KEEPER_LEASE_DURATION_MS,
  acquireDeepKeeperLease,
  releaseDeepKeeperLease,
} from "../ops/deep-keeper/lease.mjs";

type Entry = { value: string; etag: string };

function memoryLeaseStore() {
  let entry: Entry | null = null;
  let version = 0;

  return {
    async read() {
      return entry ? { ...entry } : null;
    },
    async putIfAbsent(_path: string, value: string) {
      if (entry) return null;
      version += 1;
      entry = { value, etag: `etag-${version}` };
      return { etag: entry.etag };
    },
    async putIfMatch(_path: string, value: string, etag: string) {
      if (!entry || entry.etag !== etag) return null;
      version += 1;
      entry = { value, etag: `etag-${version}` };
      return { etag: entry.etag };
    },
  };
}

describe("Deep keeper distributed lease", () => {
  it("allows only one overlapping invocation to acquire the lease", async () => {
    const store = memoryLeaseStore();

    const [first, second] = await Promise.all([
      acquireDeepKeeperLease({
        store,
        nowMs: 10_000,
        ownerId: "first-invocation",
      }),
      acquireDeepKeeperLease({
        store,
        nowMs: 10_000,
        ownerId: "second-invocation",
      }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(first?.ownerId ?? second?.ownerId).toMatch(
      /^(first|second)-invocation$/,
    );
  });

  it("atomically recovers an expired lease", async () => {
    const store = memoryLeaseStore();
    const original = await acquireDeepKeeperLease({
      store,
      nowMs: 10_000,
      ownerId: "stalled-invocation",
    });

    expect(original).not.toBeNull();

    const recovered = await acquireDeepKeeperLease({
      store,
      nowMs: 10_000 + DEEP_KEEPER_LEASE_DURATION_MS,
      ownerId: "recovered-invocation",
    });

    expect(recovered).toMatchObject({ ownerId: "recovered-invocation" });
  });

  it("releases the lease after a keeper failure so the next cycle can run", async () => {
    const store = memoryLeaseStore();
    const lease = await acquireDeepKeeperLease({
      store,
      nowMs: 10_000,
      ownerId: "failing-invocation",
    });

    expect(lease).not.toBeNull();

    await expect(
      (async () => {
        try {
          throw new Error("simulated keeper failure");
        } finally {
          expect(
            await releaseDeepKeeperLease({ store, lease: lease!, nowMs: 10_001 }),
          ).toBe(true);
        }
      })(),
    ).rejects.toThrow("simulated keeper failure");

    await expect(
      acquireDeepKeeperLease({
        store,
        nowMs: 10_001,
        ownerId: "next-invocation",
      }),
    ).resolves.toMatchObject({ ownerId: "next-invocation" });
  });
});
