import { describe, expect, it, vi } from "vitest";

import {
  DEEP_V2_KEEPER_STATE_PATH,
  createDeepV2StateWriter,
} from "../ops/deep-keeper-v2/state.mjs";
import {
  DEEP_V2_KEEPER_LEASE_DURATION_MS,
  acquireDeepV2KeeperLease,
} from "../ops/deep-keeper-v2/lease.mjs";

type Entry = { value: string; etag: string };

function memoryControlStore() {
  const entries = new Map<string, Entry>();
  let version = 0;
  return {
    async read(path: string) {
      const entry = entries.get(path);
      return entry ? { ...entry } : null;
    },
    async putIfAbsent(path: string, value: string) {
      if (entries.has(path)) return null;
      version += 1;
      const entry = { value, etag: `etag-${version}` };
      entries.set(path, entry);
      return { etag: entry.etag };
    },
    async putIfMatch(path: string, value: string, etag: string) {
      const current = entries.get(path);
      if (!current || current.etag !== etag) return null;
      version += 1;
      const entry = { value, etag: `etag-${version}` };
      entries.set(path, entry);
      return { etag: entry.etag };
    },
    entry(path: string) {
      const entry = entries.get(path);
      return entry ? { ...entry } : null;
    },
  };
}

function state(generation = 1) {
  return {
    schemaVersion: 1,
    fencingGeneration: generation,
    marker: "state",
  };
}

describe("Deep V2 fenced state persistence", () => {
  it("uses create-only then ETag-conditional writes", async () => {
    const store = memoryControlStore();
    const lease = await acquireDeepV2KeeperLease({
      store,
      nowMs: 600_000,
      ownerId: "cycle",
      createFencingToken: () => "token",
    });
    const writer = createDeepV2StateWriter({
      store,
      lease: lease!,
      assertLease: vi.fn().mockResolvedValue(true),
      now: () => 610_000,
    });

    await expect(writer.write(state())).resolves.toBe(true);
    await expect(
      writer.write({ ...state(), marker: "updated" }),
    ).resolves.toBe(true);
    expect(
      JSON.parse(store.entry(DEEP_V2_KEEPER_STATE_PATH)!.value),
    ).toMatchObject({
      ownerId: "cycle",
      generation: 1,
      boundaryState: {
        marker: "updated",
        fencingGeneration: 1,
      },
    });
  });

  it("rejects state from another generation before touching storage", async () => {
    const store = memoryControlStore();
    const lease = await acquireDeepV2KeeperLease({
      store,
      nowMs: 600_000,
      ownerId: "cycle",
      createFencingToken: () => "token",
    });
    const writer = createDeepV2StateWriter({
      store,
      lease: lease!,
      assertLease: vi.fn().mockResolvedValue(true),
      now: () => 610_000,
    });

    await expect(writer.write(state(2))).rejects.toMatchObject({
      code: "FENCING_GENERATION_MISMATCH",
    });
    expect(
      JSON.parse(store.entry(DEEP_V2_KEEPER_STATE_PATH)!.value),
    ).toMatchObject({ boundaryState: null });
  });

  it("fails closed when lease ownership or the state ETag is lost", async () => {
    const store = memoryControlStore();
    const lease = await acquireDeepV2KeeperLease({
      store,
      nowMs: 600_000,
      ownerId: "cycle",
      createFencingToken: () => "token",
    });
    const staleLease = { ...lease! };
    const lostFence = createDeepV2StateWriter({
      store,
      lease: lease!,
      assertLease: vi.fn().mockResolvedValue(false),
      now: () => 610_000,
    });
    await expect(lostFence.write(state())).rejects.toMatchObject({
      code: "LEASE_FENCE_LOST",
    });

    const winner = createDeepV2StateWriter({
      store,
      lease: lease!,
      assertLease: vi.fn().mockResolvedValue(true),
      now: () => 610_000,
    });
    await expect(winner.write(state())).resolves.toBe(true);

    const stale = createDeepV2StateWriter({
      store,
      lease: staleLease,
      assertLease: vi.fn().mockResolvedValue(true),
      now: () => 610_000,
    });
    await expect(stale.write(state())).resolves.toBe(false);
  });

  it("cannot write stale state when takeover lands after lease assertion", async () => {
    const store = memoryControlStore();
    const first = await acquireDeepV2KeeperLease({
      store,
      nowMs: 10,
      ownerId: "first",
      createFencingToken: () => "token-first",
    });
    let successor:
      | Awaited<ReturnType<typeof acquireDeepV2KeeperLease>>
      | undefined;
    const writer = createDeepV2StateWriter({
      store,
      lease: first!,
      assertLease: async () => {
        successor = await acquireDeepV2KeeperLease({
          store,
          nowMs: 10 + DEEP_V2_KEEPER_LEASE_DURATION_MS,
          ownerId: "successor",
          createFencingToken: () => "token-successor",
        });
        return true;
      },
      now: () => 10 + DEEP_V2_KEEPER_LEASE_DURATION_MS - 1,
    });

    await expect(writer.write(state(1))).resolves.toBe(false);
    expect(successor).toMatchObject({ ownerId: "successor", generation: 2 });
    expect(
      JSON.parse(store.entry(DEEP_V2_KEEPER_STATE_PATH)!.value),
    ).toMatchObject({
      ownerId: "successor",
      generation: 2,
      boundaryState: null,
    });
  });

  it("carries the last committed state into the next lease generation", async () => {
    const store = memoryControlStore();
    const first = await acquireDeepV2KeeperLease({
      store,
      nowMs: 10,
      ownerId: "first",
      createFencingToken: () => "token-first",
    });
    const writer = createDeepV2StateWriter({
      store,
      lease: first!,
      assertLease: vi.fn().mockResolvedValue(true),
      now: () => 11,
    });
    await expect(writer.write(state(1))).resolves.toBe(true);

    const successor = await acquireDeepV2KeeperLease({
      store,
      nowMs: 10 + DEEP_V2_KEEPER_LEASE_DURATION_MS,
      ownerId: "successor",
      createFencingToken: () => "token-successor",
    });

    expect(successor).toMatchObject({
      generation: 2,
      boundaryState: {
        marker: "state",
        fencingGeneration: 1,
      },
    });
  });
});
