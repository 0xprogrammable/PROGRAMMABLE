import { describe, expect, it, vi } from "vitest";
import { keccak256, type EIP1193RequestFn } from "viem";

vi.mock("server-only", () => ({}));

import {
  bindPrivateBlobReadMetadata,
  createMemoryPersistentRpcCacheStore,
  createPersistentRpcRequest,
  createVercelBlobPersistentRpcCacheStore,
  persistentRpcCachePathByteLimit,
  PERSISTENT_RPC_CACHE_LIMITS,
  PersistentRpcCacheError,
  PersistentRpcCacheReorgError,
  readBoundedBlobJson,
  withPersistentRpcIntegrityScope,
  type PersistentRpcCacheStore,
} from "../lib/onchain/persistent-rpc-cache.server";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const TOPIC = `0x${"22".repeat(32)}`;

function quantity(value: bigint | number) {
  return `0x${BigInt(value).toString(16)}`;
}

function bytes32(value: bigint | number) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function log(blockNumber: bigint | number, logIndex = 0) {
  const block = BigInt(blockNumber);
  return {
    address: ADDRESS,
    blockHash: bytes32(10_000n + block),
    blockNumber: quantity(block),
    data: "0x",
    logIndex: quantity(logIndex),
    removed: false,
    topics: [TOPIC],
    transactionHash: bytes32(20_000n + block),
    transactionIndex: "0x0",
  };
}

function logRequest(
  request: EIP1193RequestFn,
  fromBlock: bigint | number,
  toBlock: bigint | number,
  topic = TOPIC,
) {
  return request({
    method: "eth_getLogs",
    params: [
      {
        address: ADDRESS,
        topics: [topic],
        fromBlock: quantity(fromBlock),
        toBlock: quantity(toBlock),
      },
    ],
  });
}

type MockRpc = Readonly<{
  request: EIP1193RequestFn;
  counts: {
    blocks: number;
    logs: number;
  };
  failRange(fromBlock: bigint, toBlock: bigint): void;
  reorg(blockNumber: bigint): void;
}>;

function mockRpc(
  input: Readonly<{
    duplicate?: boolean;
    delayMs?: number;
    sparseAtBlock?: bigint;
  }> = {},
): MockRpc {
  const counts = { blocks: 0, logs: 0 };
  const failures = new Set<string>();
  const reorged = new Set<bigint>();
  const request = (async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_getBlockByNumber") {
      counts.blocks += 1;
      const blockNumber = BigInt(String(params?.[0]));
      return {
        number: quantity(blockNumber),
        hash: reorged.has(blockNumber)
          ? bytes32(90_000n + blockNumber)
          : bytes32(10_000n + blockNumber),
      };
    }
    if (method !== "eth_getLogs") throw new Error(`unexpected ${method}`);
    counts.logs += 1;
    const filter = params?.[0] as { fromBlock: string; toBlock: string };
    const fromBlock = BigInt(filter.fromBlock);
    const toBlock = BigInt(filter.toBlock);
    if (input.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    if (failures.delete(`${fromBlock}:${toBlock}`)) {
      throw new Error("injected partial failure");
    }
    const result = input.sparseAtBlock === undefined
      ? [log(fromBlock)]
      : input.sparseAtBlock >= fromBlock && input.sparseAtBlock <= toBlock
        ? [log(input.sparseAtBlock)]
        : [];
    return input.duplicate ? [...result, ...result] : result;
  }) as EIP1193RequestFn;
  return {
    request,
    counts,
    failRange(fromBlock, toBlock) {
      failures.add(`${fromBlock}:${toBlock}`);
    },
    reorg(blockNumber) {
      reorged.add(blockNumber);
    },
  };
}

function cachedRequest(
  rpc: MockRpc,
  store = createMemoryPersistentRpcCacheStore(),
  providerId = "provider-a",
  maxLogBlockRange?: bigint,
) {
  return {
    store,
    request: createPersistentRpcRequest({
      chainId: 1,
      providerId,
      request: rpc.request,
      store,
      maxLogBlockRange,
    }),
  };
}

function countingStore(base = createMemoryPersistentRpcCacheStore()) {
  const counts = { reads: 0 };
  const store: PersistentRpcCacheStore = {
    async read(path) {
      counts.reads += 1;
      return base.read(path);
    },
    create: base.create,
    replace: base.replace,
  };
  return { store, counts };
}

function reorgOnCreateStore(
  onCreate: () => void,
  base = createMemoryPersistentRpcCacheStore(),
): PersistentRpcCacheStore {
  let triggered = false;
  return {
    read: base.read,
    async create(path, value) {
      const result = await base.create(path, value);
      if (!triggered) {
        triggered = true;
        onCreate();
      }
      return result;
    },
    replace: base.replace,
  };
}

function weakEtagBlobClient() {
  const values = new Map<string, { body: string; etag: string }>();
  let generation = 0;
  const nextEtag = () => {
    generation += 1;
    return `"${generation.toString(16).padStart(32, "0")}"`;
  };
  const client = {
    async get(path: string) {
      const current = values.get(path);
      if (!current) return null;
      const bytes = new TextEncoder().encode(current.body);
      return {
        statusCode: 200 as const,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        headers: new Headers({
          "content-encoding": "gzip",
          "content-length": "0",
        }),
        blob: {
          etag: `W/${current.etag}`,
          size: 0,
        },
      };
    },
    async head(path: string) {
      const current = values.get(path);
      if (!current) throw new Error("Vercel Blob: object is missing");
      return {
        etag: current.etag,
        size: new TextEncoder().encode(current.body).byteLength,
      };
    },
    async put(
      path: string,
      body: string,
      options: Readonly<{ allowOverwrite: boolean; ifMatch?: string }>,
    ) {
      const current = values.get(path);
      if (!options.allowOverwrite && current) {
        throw new Error("Vercel Blob: object already exists");
      }
      if (
        options.ifMatch !== undefined &&
        current?.etag !== options.ifMatch
      ) {
        throw new Error("Vercel Blob: Precondition failed: ETag mismatch.");
      }
      const etag = nextEtag();
      values.set(path, { body, etag });
      return { etag };
    },
  };
  return {
    client,
    paths: () => [...values.keys()],
    value(path: string) {
      const current = values.get(path);
      return current ? JSON.parse(current.body) as unknown : null;
    },
  };
}

describe("persistent RPC log cursor", () => {
  it("commits both provider cursors through weak Blob ETags and rejects a stale writer", async () => {
    const blob = weakEtagBlobClient();
    const store = createVercelBlobPersistentRpcCacheStore(
      "test-read-write-token",
      async () => blob.client,
    );

    for (const providerId of ["provider-primary", "provider-secondary"]) {
      const rpc = mockRpc();
      const cached = cachedRequest(rpc, store, providerId, 5n);
      await withPersistentRpcIntegrityScope(() =>
        Promise.all([
          logRequest(cached.request, 0, 9, bytes32(101)),
          logRequest(cached.request, 0, 9, bytes32(102)),
        ]),
      );

      const providerPaths = blob.paths().filter((path) =>
        path.includes(`/${providerId}/`),
      );
      const cursorPaths = providerPaths.filter((path) =>
        path.endsWith("/cursor.json"),
      );
      const integrityPaths = providerPaths.filter((path) =>
        path.includes("/integrity/"),
      );
      expect(cursorPaths).toHaveLength(2);
      expect(integrityPaths).toHaveLength(1);
      for (const path of cursorPaths) {
        expect(
          (blob.value(path) as { payload: { segments: unknown[] } }).payload
            .segments,
        ).toHaveLength(2);
      }
      expect(
        (blob.value(integrityPaths[0] as string) as {
          payload: { status: string };
        }).payload.status,
      ).toBe("committed");
    }

    const cursorPath = blob.paths().find(
      (path) =>
        path.includes("/provider-primary/") && path.endsWith("/cursor.json"),
    ) as string;
    const stale = await store.read(cursorPath);
    expect(stale).not.toBeNull();
    expect(
      await store.replace(cursorPath, stale?.value, stale?.etag as string),
    ).toBe("replaced");
    expect(
      await store.replace(cursorPath, stale?.value, stale?.etag as string),
    ).toBe("conflict");
  });

  it("survives a process restart and serves a canonical cursor without rescanning", async () => {
    const rpc = mockRpc();
    const first = cachedRequest(rpc);
    expect(await logRequest(first.request, 10, 19)).toHaveLength(1);
    expect(rpc.counts.logs).toBe(1);

    const restarted = cachedRequest(rpc, first.store);
    expect(await logRequest(restarted.request, 10, 19)).toEqual([log(10)]);
    expect(rpc.counts.logs).toBe(1);
    expect(rpc.counts.blocks).toBeGreaterThanOrEqual(3);
  });

  it("rejects stale logs when the provider changes the anchor during the read", async () => {
    const store = createMemoryPersistentRpcCacheStore();
    let canonicalGeneration = 0;
    let staleLogReads = 0;
    const unstable = (async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_getBlockByNumber") {
        const blockNumber = BigInt(String(params?.[0]));
        return {
          number: quantity(blockNumber),
          hash: bytes32(
            (canonicalGeneration === 0 ? 10_000n : 90_000n) + blockNumber,
          ),
        };
      }
      if (method === "eth_getLogs") {
        staleLogReads += 1;
        canonicalGeneration = 1;
        return [log(0)];
      }
      throw new Error(`unexpected ${method}`);
    }) as EIP1193RequestFn;
    const first = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-reorging-logs",
      request: unstable,
      store,
    });
    await expect(logRequest(first, 0, 9)).rejects.toBeInstanceOf(
      PersistentRpcCacheReorgError,
    );

    const healthy = mockRpc();
    const restarted = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-reorging-logs",
      request: healthy.request,
      store,
    });
    expect(await logRequest(restarted, 0, 9)).toEqual([log(0)]);
    expect(staleLogReads).toBe(1);
    expect(healthy.counts.logs).toBe(1);
  });

  it("rejects old-fork log hashes even when pre and post anchors already agree", async () => {
    const store = createMemoryPersistentRpcCacheStore();
    const inconsistent = (async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_getBlockByNumber") {
        const blockNumber = BigInt(String(params?.[0]));
        return {
          number: quantity(blockNumber),
          hash: bytes32(90_000n + blockNumber),
        };
      }
      if (method === "eth_getLogs") return [log(0)];
      throw new Error(`unexpected ${method}`);
    }) as EIP1193RequestFn;
    const cached = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-inconsistent-logs",
      request: inconsistent,
      store,
    });
    await expect(logRequest(cached, 0, 9)).rejects.toBeInstanceOf(
      PersistentRpcCacheReorgError,
    );

    const healthy = mockRpc();
    const restarted = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-inconsistent-logs",
      request: healthy.request,
      store,
    });
    expect(await logRequest(restarted, 0, 9)).toEqual([log(0)]);
  });

  it("detects a reorg injected by Blob persistence before returning logs", async () => {
    const rpc = mockRpc();
    const store = reorgOnCreateStore(() => {
      rpc.reorg(0n);
      rpc.reorg(9n);
    });
    const first = cachedRequest(rpc, store);
    await expect(logRequest(first.request, 0, 9)).rejects.toBeInstanceOf(
      PersistentRpcCacheReorgError,
    );

    const restarted = cachedRequest(rpc, store);
    await expect(logRequest(restarted.request, 0, 9)).rejects.toBeInstanceOf(
      PersistentRpcCacheReorgError,
    );
  });

  it("does not mix an old cached prefix with a suffix after a reorg", async () => {
    const rpc = mockRpc();
    const cached = cachedRequest(rpc);
    await logRequest(cached.request, 0, 9);
    rpc.reorg(0n);
    rpc.reorg(9n);
    rpc.reorg(19n);
    await expect(logRequest(cached.request, 0, 19)).rejects.toBeInstanceOf(
      PersistentRpcCacheReorgError,
    );

    const restarted = cachedRequest(rpc, cached.store);
    await expect(logRequest(restarted.request, 0, 19)).rejects.toBeInstanceOf(
      PersistentRpcCacheReorgError,
    );
  });

  it("resumes after a partial failure without repeating committed ranges", async () => {
    const rpc = mockRpc();
    const first = cachedRequest(rpc);
    await logRequest(first.request, 0, 4);
    rpc.failRange(5n, 9n);
    await expect(logRequest(first.request, 5, 9)).rejects.toThrow(
      "injected partial failure",
    );
    expect(rpc.counts.logs).toBe(2);

    const restarted = cachedRequest(rpc, first.store);
    await logRequest(restarted.request, 0, 4);
    await logRequest(restarted.request, 5, 9);
    expect(rpc.counts.logs).toBe(3);
  });

  it("resumes a split logical stream after an internal chunk fails", async () => {
    const rpc = mockRpc();
    const first = cachedRequest(
      rpc,
      createMemoryPersistentRpcCacheStore(),
      "provider-a",
      5n,
    );
    rpc.failRange(5n, 9n);
    await expect(logRequest(first.request, 0, 9)).rejects.toThrow(
      "injected partial failure",
    );
    expect(rpc.counts.logs).toBe(2);

    const restarted = cachedRequest(rpc, first.store, "provider-a", 5n);
    expect(await logRequest(restarted.request, 0, 9)).toEqual([
      log(0),
      log(5),
    ]);
    expect(rpc.counts.logs).toBe(3);
  });

  it("keeps the configured provider chunk bound without a persistent store", async () => {
    const rpc = mockRpc();
    const request = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-passthrough",
      request: rpc.request,
      store: null,
      maxLogBlockRange: 5n,
    });

    expect(await logRequest(request, 0, 9)).toEqual([log(0), log(5)]);
    expect(rpc.counts).toEqual({ blocks: 0, logs: 2 });
  });

  it("does not immediately replay a no-store prefix after a later chunk fails", async () => {
    const rpc = mockRpc();
    rpc.failRange(5n, 9n);
    const request = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-passthrough-partial",
      request: rpc.request,
      store: null,
      maxLogBlockRange: 5n,
    });

    await expect(logRequest(request, 0, 9)).rejects.toBeInstanceOf(
      PersistentRpcCacheError,
    );
    expect(rpc.counts).toEqual({ blocks: 0, logs: 2 });
  });

  it("revalidates a shared operation after its individual reads complete", async () => {
    const rpc = mockRpc();
    const first = cachedRequest(rpc);
    await withPersistentRpcIntegrityScope(() =>
      logRequest(first.request, 0, 9),
    );
    const restarted = cachedRequest(rpc, first.store);

    await expect(
      withPersistentRpcIntegrityScope(async () => {
        const logs = await logRequest(restarted.request, 0, 9);
        rpc.reorg(9n);
        return logs;
      }),
    ).rejects.toBeInstanceOf(PersistentRpcCacheReorgError);
  });

  it("never admits a stream cursor when a later stream aborts its integrity scope", async () => {
    const rpc = mockRpc();
    const first = cachedRequest(rpc);
    await expect(
      withPersistentRpcIntegrityScope(async () => {
        await logRequest(first.request, 0, 9, bytes32(1));
        rpc.reorg(0n);
        rpc.failRange(0n, 9n);
        await logRequest(first.request, 0, 9, bytes32(2));
      }),
    ).rejects.toThrow("injected partial failure");
    expect(rpc.counts.logs).toBe(2);

    const restarted = cachedRequest(rpc, first.store);
    await expect(
      withPersistentRpcIntegrityScope(() =>
        logRequest(restarted.request, 0, 9, bytes32(1)),
      ),
    ).rejects.toBeInstanceOf(PersistentRpcCacheReorgError);
    expect(rpc.counts.logs).toBe(3);
  });

  it("rejects a reorg injected while publishing the integrity marker", async () => {
    const rpc = mockRpc();
    const base = createMemoryPersistentRpcCacheStore();
    let markerWrites = 0;
    const store: PersistentRpcCacheStore = {
      read: base.read,
      async create(path, value) {
        const created = await base.create(path, value);
        if (path.includes("/integrity/")) {
          markerWrites += 1;
          rpc.reorg(0n);
          rpc.reorg(9n);
        }
        return created;
      },
      replace: base.replace,
    };
    const first = cachedRequest(rpc, store, "provider-marker-reorg");
    await expect(
      withPersistentRpcIntegrityScope(() =>
        logRequest(first.request, 0, 9),
      ),
    ).rejects.toBeInstanceOf(PersistentRpcCacheReorgError);
    expect(markerWrites).toBe(1);

    const restarted = cachedRequest(rpc, store, "provider-marker-reorg");
    await expect(
      withPersistentRpcIntegrityScope(() =>
        logRequest(restarted.request, 0, 9),
      ),
    ).rejects.toBeInstanceOf(PersistentRpcCacheReorgError);
  });

  it("rejects multiple request/store domains before admitting either cursor", async () => {
    const rpc = mockRpc();
    const storeA = createMemoryPersistentRpcCacheStore();
    const storeB = createMemoryPersistentRpcCacheStore();
    const firstA = cachedRequest(rpc, storeA, "provider-shared");
    const firstB = cachedRequest(rpc, storeB, "provider-shared");
    await expect(
      withPersistentRpcIntegrityScope(async () => {
        await logRequest(firstA.request, 0, 9);
        await logRequest(firstB.request, 0, 9);
      }),
    ).rejects.toThrow("cannot span request/store domains");
    expect(rpc.counts.logs).toBe(2);

    const restartedA = cachedRequest(rpc, storeA, "provider-shared");
    const restartedB = cachedRequest(rpc, storeB, "provider-shared");
    expect(await logRequest(restartedA.request, 0, 9)).toEqual([log(0)]);
    expect(await logRequest(restartedB.request, 0, 9)).toEqual([log(0)]);
    expect(rpc.counts.logs).toBe(4);
  });

  it("does not share proofs across request backends with the same provider id", async () => {
    const rpcA = mockRpc();
    const rpcB = mockRpc();
    const storeA = createMemoryPersistentRpcCacheStore();
    const baseB = createMemoryPersistentRpcCacheStore();
    const storeB: PersistentRpcCacheStore = {
      read: baseB.read,
      async create(path, value) {
        const created = await baseB.create(path, value);
        if (path.includes("/integrity/")) {
          rpcB.reorg(0n);
          rpcB.reorg(9n);
        }
        return created;
      },
      replace: baseB.replace,
    };
    const firstA = cachedRequest(rpcA, storeA, "provider-aliased");
    const firstB = cachedRequest(rpcB, storeB, "provider-aliased");
    await expect(
      withPersistentRpcIntegrityScope(async () => {
        await logRequest(firstA.request, 0, 9);
        await logRequest(firstB.request, 0, 9);
      }),
    ).rejects.toBeInstanceOf(PersistentRpcCacheError);
  });

  it("does not singleflight across stores and request backends", async () => {
    const rpcA = mockRpc({ delayMs: 5 });
    const rpcB = mockRpc({ delayMs: 5 });
    const firstA = cachedRequest(
      rpcA,
      createMemoryPersistentRpcCacheStore(),
      "provider-aliased-flight",
    );
    const firstB = cachedRequest(
      rpcB,
      createMemoryPersistentRpcCacheStore(),
      "provider-aliased-flight",
    );
    await Promise.all([
      logRequest(firstA.request, 0, 9),
      logRequest(firstB.request, 0, 9),
    ]);
    expect(rpcA.counts.logs).toBe(1);
    expect(rpcB.counts.logs).toBe(1);
  });

  it("seals the scope against detached child requests", async () => {
    const rpc = mockRpc();
    const first = cachedRequest(rpc);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detached!: Promise<unknown>;
    await withPersistentRpcIntegrityScope(async () => {
      await logRequest(first.request, 0, 9, bytes32(1));
      detached = gate.then(() =>
        logRequest(first.request, 0, 9, bytes32(2)),
      );
    });
    release();
    await expect(detached).rejects.toThrow("already sealed");

    const restarted = cachedRequest(rpc, first.store);
    expect(await logRequest(restarted.request, 0, 9, bytes32(1))).toEqual([
      log(0),
    ]);
    expect(await logRequest(restarted.request, 0, 9, bytes32(2))).toEqual([
      log(0),
    ]);
    expect(rpc.counts.logs).toBe(2);
  });

  it("rejects a detached covered read released after the scope closes", async () => {
    const rpc = mockRpc();
    const base = createMemoryPersistentRpcCacheStore();
    const seeded = cachedRequest(rpc, base, "provider-covered-lease");
    await logRequest(seeded.request, 0, 9, bytes32(1));
    await logRequest(seeded.request, 0, 9, bytes32(2));

    let pauseSegmentRead = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const segmentReadEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let paused = false;
    const gatedStore: PersistentRpcCacheStore = {
      async read(path) {
        const record = await base.read(path);
        if (pauseSegmentRead && !paused && path.includes("/segments/")) {
          paused = true;
          entered();
          await gate;
        }
        return record;
      },
      create: base.create,
      replace: base.replace,
    };
    const restarted = cachedRequest(
      rpc,
      gatedStore,
      "provider-covered-lease",
    );
    let detached!: Promise<unknown>;
    await withPersistentRpcIntegrityScope(async () => {
      await logRequest(restarted.request, 0, 9, bytes32(1));
      pauseSegmentRead = true;
      detached = logRequest(restarted.request, 0, 9, bytes32(2));
      await segmentReadEntered;
    });
    release();
    await expect(detached).rejects.toThrow("already sealed");
    expect(rpc.counts.logs).toBe(2);
  });

  it("rejects and leaves uncovered a detached cursor write after scope close", async () => {
    const rpc = mockRpc();
    const base = createMemoryPersistentRpcCacheStore();
    let pauseCursorCreate = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const cursorCreateEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let paused = false;
    const gatedStore: PersistentRpcCacheStore = {
      read: base.read,
      async create(path, value) {
        const created = await base.create(path, value);
        if (
          pauseCursorCreate &&
          !paused &&
          path.endsWith("/cursor.json")
        ) {
          paused = true;
          entered();
          await gate;
        }
        return created;
      },
      replace: base.replace,
    };
    const first = cachedRequest(
      rpc,
      gatedStore,
      "provider-detached-write",
    );
    let detached!: Promise<unknown>;
    await withPersistentRpcIntegrityScope(async () => {
      await logRequest(first.request, 0, 9, bytes32(1));
      pauseCursorCreate = true;
      detached = logRequest(first.request, 0, 9, bytes32(2));
      await cursorCreateEntered;
    });
    release();
    await expect(detached).rejects.toThrow("already sealed");
    pauseCursorCreate = false;

    const restarted = cachedRequest(
      rpc,
      gatedStore,
      "provider-detached-write",
    );
    expect(await logRequest(restarted.request, 0, 9, bytes32(1))).toEqual([
      log(0),
    ]);
    expect(await logRequest(restarted.request, 0, 9, bytes32(2))).toEqual([
      log(0),
    ]);
    expect(rpc.counts.logs).toBe(3);
  });

  it("extends an existing prefix by fetching only the new tail", async () => {
    const rpc = mockRpc();
    const first = cachedRequest(rpc);
    expect(await logRequest(first.request, 0, 4)).toEqual([log(0)]);

    const restarted = cachedRequest(rpc, first.store);
    expect(await logRequest(restarted.request, 0, 9)).toEqual([
      log(0),
      log(5),
    ]);
    expect(rpc.counts.logs).toBe(2);
  });

  it("persists an earlier full scan after a tail-first process seeds the stream", async () => {
    const rpc = mockRpc();
    const tailFirst = cachedRequest(rpc);
    expect(await logRequest(tailFirst.request, 10, 19)).toEqual([log(10)]);

    const fullScan = cachedRequest(rpc, tailFirst.store);
    expect(await logRequest(fullScan.request, 0, 19)).toEqual([
      log(0),
      log(10),
    ]);
    expect(rpc.counts.logs).toBe(2);

    const restarted = cachedRequest(rpc, tailFirst.store);
    expect(await logRequest(restarted.request, 0, 19)).toEqual([
      log(0),
      log(10),
    ]);
    expect(rpc.counts.logs).toBe(2);
  });

  it("fails closed on overlapping CAS races without corrupting later coverage", async () => {
    const rpc = mockRpc({ delayMs: 5 });
    const cached = cachedRequest(rpc);
    const raced = await Promise.allSettled([
      logRequest(cached.request, 0, 9),
      logRequest(cached.request, 5, 14),
    ]);
    expect(
      raced.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = raced.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.any(PersistentRpcCacheError),
    });

    const restarted = cachedRequest(rpc, cached.store);
    expect(await logRequest(restarted.request, 0, 14)).toHaveLength(2);
    const finalRestart = cachedRequest(rpc, cached.store);
    expect(await logRequest(finalRestart.request, 0, 14)).toHaveLength(2);
    expect(rpc.counts.logs).toBe(3);
  });

  it("fails closed when the persisted cursor block was reorganized", async () => {
    const rpc = mockRpc();
    const first = cachedRequest(rpc);
    await logRequest(first.request, 20, 29);
    rpc.reorg(29n);

    const restarted = cachedRequest(rpc, first.store);
    await expect(logRequest(restarted.request, 20, 29)).rejects.toBeInstanceOf(
      PersistentRpcCacheReorgError,
    );
    expect(rpc.counts.logs).toBe(1);
  });

  it("rejects duplicate event provenance before advancing the cursor", async () => {
    const rpc = mockRpc({ duplicate: true });
    const cached = cachedRequest(rpc);
    await expect(logRequest(cached.request, 30, 39)).rejects.toBeInstanceOf(
      PersistentRpcCacheError,
    );

    const healthy = mockRpc();
    const restarted = cachedRequest(healthy, cached.store);
    await logRequest(restarted.request, 30, 39);
    expect(healthy.counts.logs).toBe(1);
  });

  it("single-flights concurrent identical ranges", async () => {
    const rpc = mockRpc({ delayMs: 5 });
    const cached = cachedRequest(rpc);
    const [first, second] = await Promise.all([
      logRequest(cached.request, 40, 49),
      logRequest(cached.request, 40, 49),
    ]);
    expect(first).toEqual(second);
    expect(rpc.counts.logs).toBe(1);
  });

  it("keeps provider caches independent for dual-provider quorum reads", async () => {
    const primary = mockRpc();
    const secondary = mockRpc();
    const store = createMemoryPersistentRpcCacheStore();
    const primaryCached = cachedRequest(primary, store, "provider-primary");
    const secondaryCached = cachedRequest(secondary, store, "provider-secondary");
    await Promise.all([
      logRequest(primaryCached.request, 50, 59),
      logRequest(secondaryCached.request, 50, 59),
    ]);
    expect(primary.counts.logs).toBe(1);
    expect(secondary.counts.logs).toBe(1);
  });

  it("reuses an immutable runtime proof until its release binding or block hash changes", async () => {
    const code = "0x6001600055" as const;
    const expectedRuntimeCodeHash = keccak256(code);
    const store = createMemoryPersistentRpcCacheStore();
    let codeReads = 0;
    let reorged = false;
    const rpc = (async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_getCode") {
        codeReads += 1;
        return code;
      }
      if (method === "eth_getBlockByNumber") {
        const blockNumber = BigInt(String(params?.[0]));
        return {
          number: quantity(blockNumber),
          hash: reorged ? bytes32(99_999) : bytes32(10_000n + blockNumber),
        };
      }
      throw new Error(`unexpected ${method}`);
    }) as EIP1193RequestFn;
    const binding = {
      address: ADDRESS as `0x${string}`,
      expectedRuntimeCodeHash,
      notBeforeBlock: 100n,
    };
    const first = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-runtime",
      request: rpc,
      store,
      immutableCodeBindings: [binding],
    });
    expect(
      await first({
        method: "eth_getCode",
        params: [ADDRESS, quantity(100)],
      }),
    ).toBe(code);

    const restarted = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-runtime",
      request: rpc,
      store,
      immutableCodeBindings: [binding],
    });
    expect(
      await restarted({
        method: "eth_getCode",
        params: [ADDRESS, quantity(110)],
      }),
    ).toBe(code);
    expect(codeReads).toBe(2);

    const nextRelease = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-runtime",
      request: rpc,
      store,
      immutableCodeBindings: [{ ...binding, notBeforeBlock: 101n }],
    });
    expect(
      await nextRelease({
        method: "eth_getCode",
        params: [ADDRESS, quantity(111)],
      }),
    ).toBe(code);
    expect(codeReads).toBe(4);

    reorged = true;
    const afterReorg = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-runtime",
      request: rpc,
      store,
      immutableCodeBindings: [binding],
    });
    await expect(
      afterReorg({
        method: "eth_getCode",
        params: [ADDRESS, quantity(111)],
      }),
    ).rejects.toBeInstanceOf(PersistentRpcCacheReorgError);
  });

  it("isolates the current cache generation from legacy cache entries", async () => {
    const code = "0x6001600055" as const;
    const expectedRuntimeCodeHash = keccak256(code);
    const backing = createMemoryPersistentRpcCacheStore();
    const paths: string[] = [];
    const store = {
      async read(path: string) {
        paths.push(path);
        return backing.read(path);
      },
      async create(path: string, value: unknown) {
        paths.push(path);
        return backing.create(path, value);
      },
      async replace(path: string, value: unknown, expectedEtag: string) {
        paths.push(path);
        return backing.replace(path, value, expectedEtag);
      },
    };
    const rpc = (async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_getCode") return code;
      if (method === "eth_getBlockByNumber") {
        const blockNumber = BigInt(String(params?.[0]));
        return {
          number: quantity(blockNumber),
          hash: bytes32(10_000n + blockNumber),
        };
      }
      throw new Error(`unexpected ${method}`);
    }) as EIP1193RequestFn;
    const request = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-runtime-v2",
      request: rpc,
      store,
      immutableCodeBindings: [{
        address: ADDRESS as `0x${string}`,
        expectedRuntimeCodeHash,
        notBeforeBlock: 100n,
      }],
    });

    await expect(
      request({ method: "eth_getCode", params: [ADDRESS, quantity(100)] }),
    ).resolves.toBe(code);
    expect(paths.every((path) => path.includes("/rpc-log-cursors/v3/"))).toBe(true);
    expect(paths.some((path) => path.includes("/rpc-log-cursors/v2/"))).toBe(false);
    expect(paths.some((path) => path.includes("/runtime-v2/"))).toBe(true);
    expect(paths.some((path) => path.includes("/runtime/"))).toBe(false);
  });

  it("bounds runtime-v2 Blob reads in the current cache generation", () => {
    expect(
      persistentRpcCachePathByteLimit(
        "indexes/rpc-log-cursors/v3/1/provider/runtime-v2/address/release.json",
      ),
    ).toBe(PERSISTENT_RPC_CACHE_LIMITS.maxRuntimeBytes);
    expect(() =>
      persistentRpcCachePathByteLimit(
        "indexes/rpc-log-cursors/v2/1/provider/runtime/address/release.json",
      )
    ).toThrow(PersistentRpcCacheError);
  });

  it("does not persist runtime code across a changing canonical anchor", async () => {
    const code = "0x6001600055" as const;
    const binding = {
      address: ADDRESS as `0x${string}`,
      expectedRuntimeCodeHash: keccak256(code),
      notBeforeBlock: 100n,
    };
    const store = createMemoryPersistentRpcCacheStore();
    let canonicalGeneration = 0;
    let unstableCodeReads = 0;
    const unstable = (async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_getCode") {
        unstableCodeReads += 1;
        canonicalGeneration = 1;
        return code;
      }
      if (method === "eth_getBlockByNumber") {
        const blockNumber = BigInt(String(params?.[0]));
        return {
          number: quantity(blockNumber),
          hash: bytes32(
            (canonicalGeneration === 0 ? 10_000n : 90_000n) + blockNumber,
          ),
        };
      }
      throw new Error(`unexpected ${method}`);
    }) as EIP1193RequestFn;
    const first = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-reorging-runtime",
      request: unstable,
      store,
      immutableCodeBindings: [binding],
    });
    await expect(
      first({ method: "eth_getCode", params: [ADDRESS, quantity(100)] }),
    ).rejects.toBeInstanceOf(PersistentRpcCacheReorgError);

    let healthyCodeReads = 0;
    const healthy = (async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_getCode") {
        healthyCodeReads += 1;
        return code;
      }
      if (method === "eth_getBlockByNumber") {
        const blockNumber = BigInt(String(params?.[0]));
        return {
          number: quantity(blockNumber),
          hash: bytes32(90_000n + blockNumber),
        };
      }
      throw new Error(`unexpected ${method}`);
    }) as EIP1193RequestFn;
    const restarted = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-reorging-runtime",
      request: healthy,
      store,
      immutableCodeBindings: [binding],
    });
    expect(
      await restarted({
        method: "eth_getCode",
        params: [ADDRESS, quantity(100)],
      }),
    ).toBe(code);
    expect(unstableCodeReads).toBe(1);
    expect(healthyCodeReads).toBe(2);
  });

  it("detects a reorg injected by runtime-proof persistence and rejects it after restart", async () => {
    const code = "0x6001600055" as const;
    const binding = {
      address: ADDRESS as `0x${string}`,
      expectedRuntimeCodeHash: keccak256(code),
      notBeforeBlock: 100n,
    };
    let reorged = false;
    const rpc = (async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_getCode") return code;
      if (method === "eth_getBlockByNumber") {
        const blockNumber = BigInt(String(params?.[0]));
        return {
          number: quantity(blockNumber),
          hash: reorged
            ? bytes32(90_000n + blockNumber)
            : bytes32(10_000n + blockNumber),
        };
      }
      throw new Error(`unexpected ${method}`);
    }) as EIP1193RequestFn;
    const store = reorgOnCreateStore(() => {
      reorged = true;
    });
    const first = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-runtime-store-reorg",
      request: rpc,
      store,
      immutableCodeBindings: [binding],
    });
    await expect(
      first({ method: "eth_getCode", params: [ADDRESS, quantity(100)] }),
    ).rejects.toBeInstanceOf(PersistentRpcCacheReorgError);

    const restarted = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-runtime-store-reorg",
      request: rpc,
      store,
      immutableCodeBindings: [binding],
    });
    await expect(
      restarted({
        method: "eth_getCode",
        params: [ADDRESS, quantity(100)],
      }),
    ).rejects.toBeInstanceOf(PersistentRpcCacheReorgError);
  });

  it("compacts 200 suffixes into a bounded number of verified Blob reads", async () => {
    const rpc = mockRpc();
    const counted = countingStore();
    const initial = cachedRequest(rpc, counted.store);
    const chunkCount = 200;
    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      await logRequest(initial.request, chunk * 10, chunk * 10 + 9);
    }
    expect(rpc.counts.logs).toBe(chunkCount);

    counted.counts.reads = 0;
    const restarted = cachedRequest(rpc, counted.store);
    expect(await logRequest(restarted.request, 0, 1_999)).toHaveLength(
      chunkCount,
    );
    expect(rpc.counts.logs).toBe(chunkCount);
    expect(counted.counts.reads).toBeLessThanOrEqual(
      1 + PERSISTENT_RPC_CACHE_LIMITS.maxSegmentReadsPerOperation,
    );

    rpc.reorg(1_999n);
    counted.counts.reads = 0;
    const afterReorg = cachedRequest(rpc, counted.store);
    await expect(logRequest(afterReorg.request, 0, 1_999)).rejects.toBeInstanceOf(
      PersistentRpcCacheReorgError,
    );
    expect(counted.counts.reads).toBe(1);
  });

  it("keeps concurrent CAS appends bounded when compaction is required", async () => {
    const rpc = mockRpc({ delayMs: 5 });
    const counted = countingStore();
    const initial = cachedRequest(rpc, counted.store);
    for (let chunk = 0; chunk < 8; chunk += 1) {
      await logRequest(initial.request, chunk * 10, chunk * 10 + 9);
    }
    await Promise.all([
      logRequest(initial.request, 80, 89),
      logRequest(initial.request, 90, 99),
    ]);

    counted.counts.reads = 0;
    const restarted = cachedRequest(rpc, counted.store);
    expect(await logRequest(restarted.request, 0, 99)).toHaveLength(10);
    expect(counted.counts.reads).toBeLessThanOrEqual(
      1 + PERSISTENT_RPC_CACHE_LIMITS.maxSegmentReadsPerOperation,
    );
  });

  it("fails closed before persisting a segment beyond the byte bound", async () => {
    const store = createMemoryPersistentRpcCacheStore();
    const oversizedData = `0x${"00".repeat(
      Math.ceil(PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes / 2),
    )}`;
    let logReads = 0;
    const rpc = (async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_getBlockByNumber") {
        const blockNumber = BigInt(String(params?.[0]));
        return {
          number: quantity(blockNumber),
          hash: bytes32(10_000n + blockNumber),
        };
      }
      if (method === "eth_getLogs") {
        logReads += 1;
        return [{ ...log(0), data: oversizedData }];
      }
      throw new Error(`unexpected ${method}`);
    }) as EIP1193RequestFn;
    const cached = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-oversized",
      request: rpc,
      store,
    });
    await expect(logRequest(cached, 0, 9)).rejects.toThrow(
      /exceeds .* bytes/u,
    );
    const restarted = createPersistentRpcRequest({
      chainId: 1,
      providerId: "provider-oversized",
      request: rpc,
      store,
    });
    await expect(logRequest(restarted, 0, 9)).rejects.toThrow(
      /exceeds .* bytes/u,
    );
    expect(logReads).toBe(2);
  });

  it("cancels a lying Blob stream before materializing bytes beyond its bound", async () => {
    let canceled = false;
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(
          reads === 1
            ? new TextEncoder().encode("{\"safe\":true}")
            : new Uint8Array(128),
        );
      },
      cancel() {
        canceled = true;
      },
    });
    await expect(
      readBoundedBlobJson({
        stream,
        maximumBytes: 32,
        declaredSize: 13,
        declaredContentLength: 13,
      }),
    ).rejects.toThrow(/stream exceeds/u);
    expect(canceled).toBe(true);
  });

  it("rejects oversized or conflicting Blob declarations before reading", async () => {
    let pulled = false;
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
      cancel() {
        canceled = true;
      },
    });
    await expect(
      readBoundedBlobJson({
        stream,
        maximumBytes: 8,
        declaredSize: 9,
        declaredContentLength: 2,
      }),
    ).rejects.toThrow(/declaration exceeds or conflicts/u);
    expect(pulled).toBe(false);
    expect(canceled).toBe(true);
  });

  it("rejects corrupt or truncated bounded Blob bodies before JSON parsing succeeds", async () => {
    const corrupt = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(0xff));
        controller.close();
      },
    });
    await expect(
      readBoundedBlobJson({
        stream: corrupt,
        maximumBytes: 8,
        declaredSize: 1,
        declaredContentLength: 1,
      }),
    ).rejects.toThrow(/could not be read safely/u);

    const truncated = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    await expect(
      readBoundedBlobJson({
        stream: truncated,
        maximumBytes: 8,
        declaredSize: 3,
        declaredContentLength: 3,
      }),
    ).rejects.toThrow(/does not match/u);
  });

  it("binds a compressed private Blob response to its authenticated HEAD metadata", () => {
    expect(
      bindPrivateBlobReadMetadata({
        responseEtag: 'W/"a51ca021c9c058ed68999c1ef7728007"',
        headEtag: '"a51ca021c9c058ed68999c1ef7728007"',
        headSize: 23_849,
      }),
    ).toEqual({
      etag: '"a51ca021c9c058ed68999c1ef7728007"',
      declaredSize: 23_849,
    });
  });

  it("rejects a private Blob that changes between GET and HEAD", () => {
    expect(() =>
      bindPrivateBlobReadMetadata({
        responseEtag: 'W/"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
        headEtag: '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
        headSize: 23_849,
      }),
    ).toThrow(/changed while it was being read/u);
  });

  it("reduces total steady-state RPC requests and conservative Alchemy CU by at least 80 percent", async () => {
    const streamCount = 5;
    const chunkCount = 20;
    const maximumRange = 100n;
    const historicalToBlock = chunkCount * Number(maximumRange) - 1;
    const advancingToBlock = historicalToBlock + 25;
    const baseline = {
      blocks: 0,
      logs: streamCount * chunkCount,
    };
    const baselineRequests = baseline.blocks + baseline.logs;
    // https://www.alchemy.com/docs/reference/compute-unit-costs (2026-08-13).
    const alchemyCu = (counts: Readonly<{ blocks: number; logs: number }>) =>
      counts.logs * 60 + counts.blocks * 20;
    const baselineCu = alchemyCu(baseline);

    for (const fixture of [
      {
        label: "sparse",
        rpc: mockRpc({ sparseAtBlock: 0n }),
        coldBlocks: 222,
        steadyBlocks: 13,
        requestReduction: 0.82,
        cuReduction: 0.906_666_666_7,
      },
      {
        label: "one-log-per-historical-chunk",
        rpc: mockRpc(),
        coldBlocks: 260,
        steadyBlocks: 15,
        requestReduction: 0.8,
        cuReduction: 0.9,
      },
    ]) {
      const initial = cachedRequest(
        fixture.rpc,
        createMemoryPersistentRpcCacheStore(),
        `provider-${fixture.label}`,
        maximumRange,
      );
      await withPersistentRpcIntegrityScope(async () => {
        for (let stream = 0; stream < streamCount; stream += 1) {
          await logRequest(
            initial.request,
            0,
            historicalToBlock,
            bytes32(100 + stream),
          );
        }
      });
      expect(fixture.rpc.counts.logs).toBe(baseline.logs);
      expect(fixture.rpc.counts.blocks, fixture.label).toBe(
        fixture.coldBlocks,
      );
      const beforeLogRequests = fixture.rpc.counts.logs;
      const beforeBlockRequests = fixture.rpc.counts.blocks;

      const restarted = cachedRequest(
        fixture.rpc,
        initial.store,
        `provider-${fixture.label}`,
        maximumRange,
      );
      await withPersistentRpcIntegrityScope(async () => {
        for (let stream = 0; stream < streamCount; stream += 1) {
          await logRequest(
            restarted.request,
            0,
            advancingToBlock,
            bytes32(100 + stream),
          );
        }
      });
      const steady = {
        blocks: fixture.rpc.counts.blocks - beforeBlockRequests,
        logs: fixture.rpc.counts.logs - beforeLogRequests,
      };
      const steadyRequests = steady.blocks + steady.logs;
      const steadyCu = alchemyCu(steady);
      const requestReduction = 1 - steadyRequests / baselineRequests;
      const cuReduction = 1 - steadyCu / baselineCu;

      expect(steady, fixture.label).toEqual({
        blocks: fixture.steadyBlocks,
        logs: 5,
      });
      expect(requestReduction, fixture.label).toBeCloseTo(
        fixture.requestReduction,
      );
      expect(cuReduction, fixture.label).toBeCloseTo(fixture.cuReduction);
      expect(requestReduction, fixture.label).toBeGreaterThanOrEqual(0.8);
      expect(cuReduction, fixture.label).toBeGreaterThanOrEqual(0.8);
    }
  });
});
