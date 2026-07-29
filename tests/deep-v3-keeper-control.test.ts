import { describe, expect, it } from "vitest";

import {
  acquireDeepV3KeeperControl,
  assertDeepV3KeeperControl,
  createDeepV3KeeperState,
  writeDeepV3KeeperState,
} from "../ops/deep-keeper-v3/control.mjs";

function memoryStore() {
  let value: string | null = null;
  let etag: string | null = null;
  let version = 0;
  return {
    async read() {
      return value === null ? null : { value, etag: etag! };
    },
    async putIfAbsent(_path: string, next: string) {
      if (value !== null) return null;
      value = next;
      etag = `etag-${++version}`;
      return { etag };
    },
    async putIfMatch(
      _path: string,
      next: string,
      expected: string,
    ) {
      if (etag !== expected) return null;
      value = next;
      etag = `etag-${++version}`;
      return { etag };
    },
    snapshot() {
      return value === null ? null : JSON.parse(value);
    },
  };
}

const config = {
  releaseManifest:
    "contracts/deployments/mainnet-deep-full-range-v3.json",
  chainId: 1 as const,
  automationAddress:
    "0x0000000000000000000000000000000000000001" as const,
  executorAddress:
    "0x0000000000000000000000000000000000000002" as const,
  sourceCommitment: `0x${"1".repeat(64)}` as `0x${string}`,
};

describe("Deep V3 one-blob CAS control", () => {
  it("grants one owner and persists lease plus state under the same ETag", async () => {
    const store = memoryStore();
    const [first, second] = await Promise.all([
      acquireDeepV3KeeperControl({
        store,
        nowMs: 10,
        ownerId: "first",
        createFencingToken: () => "first-token",
      }),
      acquireDeepV3KeeperControl({
        store,
        nowMs: 10,
        ownerId: "second",
        createFencingToken: () => "second-token",
      }),
    ]);
    const control = (first ?? second)!;
    expect([first, second].filter(Boolean)).toHaveLength(1);

    const state = {
      ...createDeepV3KeeperState(config),
      fencingGeneration: control.generation,
    };
    await expect(
      writeDeepV3KeeperState({
        store,
        control,
        state,
        config,
        nowMs: 11,
      }),
    ).resolves.toBe(true);
    expect(store.snapshot()).toMatchObject({
      ownerId: control.ownerId,
      generation: 1,
      state: {
        sourceCommitment: config.sourceCommitment,
        fencingGeneration: 1,
      },
    });
  });

  it("rejects stale ownership after an expired lease is taken over", async () => {
    const store = memoryStore();
    const first = await acquireDeepV3KeeperControl({
      store,
      nowMs: 10,
      ownerId: "first",
      durationMs: 10,
      createFencingToken: () => "first-token",
    });
    const second = await acquireDeepV3KeeperControl({
      store,
      nowMs: 20,
      ownerId: "second",
      durationMs: 10,
      createFencingToken: () => "second-token",
    });
    expect(second).toMatchObject({ generation: 2 });
    await expect(
      assertDeepV3KeeperControl({
        store,
        control: first!,
        nowMs: 20,
      }),
    ).resolves.toBe(false);
    await expect(
      assertDeepV3KeeperControl({
        store,
        control: second!,
        nowMs: 20,
      }),
    ).resolves.toBe(true);
  });

  it("durably fences an uncertain hash in explicit operator recovery", async () => {
    const store = memoryStore();
    const control = await acquireDeepV3KeeperControl({
      store,
      nowMs: 10,
      ownerId: "recovery",
      createFencingToken: () => "recovery-token",
    });
    const transactionHash = `0x${"2".repeat(64)}`;
    const vault = "0x0000000000000000000000000000000000000009";
    const state = {
      ...createDeepV3KeeperState(config),
      pending: {
        vault,
        action: 1 as const,
        slot: 2,
        cursor: 0,
        idempotencyKey: `deep-${"3".repeat(32)}`,
        transactionHash,
        createdAtMs: 10,
        lastReplayAtMs: 10,
        replayCount: 1,
        gas: "3000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "1000000000",
      },
      operatorActionRequired: {
        reason:
          "transaction-absent-after-privy-idempotency-window" as const,
        transactionHash,
        vault,
        action: 1 as const,
        enteredAtMs: 10,
      },
      fencingGeneration: control!.generation,
    };

    await expect(
      writeDeepV3KeeperState({
        store,
        control: control!,
        state,
        config,
        nowMs: 11,
      }),
    ).resolves.toBe(true);
    expect(store.snapshot()?.state.operatorActionRequired).toEqual(
      state.operatorActionRequired,
    );
  });

  it("rejects durable timestamps from the future", async () => {
    const store = memoryStore();
    const control = await acquireDeepV3KeeperControl({
      store,
      nowMs: 10,
      ownerId: "clock",
      createFencingToken: () => "clock-token",
    });
    const state = {
      ...createDeepV3KeeperState(config),
      lastCompletedSlot: 0,
      lastCompletedAtMs: 12,
      lastCompletedBlockNumber: 1,
      lastCompletedBlockHash: `0x${"4".repeat(64)}`,
      fencingGeneration: control!.generation,
    };

    await expect(
      writeDeepV3KeeperState({
        store,
        control: control!,
        state,
        config,
        nowMs: 11,
      }),
    ).rejects.toThrow("future timestamp");
  });
});
