import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CandidateRpcProvider } from "../../lib/data-pipeline/dual-rpc";
import {
  CLASSIC_V2_RECONCILER_ROUTE_KEYS,
  RECONCILER_ROUTE_KEYS,
  STOCK_PAIRED_RECONCILER_ROUTE_KEYS,
  reconcilerRouteKeysForScope,
  runReconcilerPreParityCycle,
  type ReconcilerCheckpointRequest,
  type ReconcilerCommitInput,
  type ReconcilerPreParityContract,
  type ReconcilerPreParityStore,
  type ReconcilerRouteDto,
  type ReconcilerRouteDtoReader,
} from "../../lib/data-pipeline/reconciler-preparity";

const BLOCK_NUMBER = 25_700_000n;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const ENDPOINT_A = `0x${"21".repeat(32)}` as const;
const ENDPOINT_B = `0x${"22".repeat(32)}` as const;
const ORIGIN_A = `0x${"31".repeat(32)}` as const;
const ORIGIN_B = `0x${"32".repeat(32)}` as const;

const request: ReconcilerCheckpointRequest = Object.freeze({
  chainId: "1",
  releaseId: "classic-v3",
  modelId: "classic",
  sourceGroup: "ethereum-mainnet",
  epochId: "10000000-0000-4000-8000-000000000001",
  pointerGeneration: "7",
  checkpointId: "10000000-0000-4000-8000-000000000002",
  checkpointBlockNumber: BLOCK_NUMBER.toString(),
  checkpointBlockHash: BLOCK_HASH,
  maximumEntityCount: 10_000,
});

const contract: ReconcilerPreParityContract = Object.freeze({
  chainId: "1",
  releaseId: request.releaseId,
  modelId: request.modelId,
  sourceGroup: request.sourceGroup,
  projectorVersion: "projector-v1",
  epochId: request.epochId,
  pointerGeneration: request.pointerGeneration,
  checkpointId: request.checkpointId,
  checkpointGeneration: "11",
  reorgGeneration: "0",
  checkpointBlockNumber: request.checkpointBlockNumber,
  checkpointBlockHash: request.checkpointBlockHash,
  routeKeys: RECONCILER_ROUTE_KEYS,
  routeContract: { routes: [...RECONCILER_ROUTE_KEYS] },
  projectionContract: { resultCommitment: `0x${"44".repeat(32)}` },
  currentEntities: [{ entityKind: "token", entityKey: "0x01" }],
});

function routeDtos(
  suffix = "same",
  routeKeys = RECONCILER_ROUTE_KEYS as readonly typeof RECONCILER_ROUTE_KEYS[number][],
): ReconcilerRouteDto[] {
  return routeKeys.map((routeKey, index) => ({
    routeKey,
    comparedCount: index + 1,
    dto: {
      routeKey,
      suffix,
      records: [{ id: String(index + 1), amount: "1000000000000000000" }],
    },
  }));
}

function provider(input: {
  identity: string;
  vendorGroup: string;
  endpointCommitment: typeof ENDPOINT_A;
  endpointOriginCommitment: typeof ORIGIN_A;
  blockHash?: typeof BLOCK_HASH;
}) {
  const getBlockNumber = vi.fn(async () => BLOCK_NUMBER + 100n);
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    hash: input.blockHash ?? BLOCK_HASH,
    timestamp: 1_785_500_000n,
  }));
  const value: CandidateRpcProvider = {
    identity: input.identity,
    vendorGroup: input.vendorGroup,
    endpointCommitment: input.endpointCommitment,
    endpointOriginCommitment: input.endpointOriginCommitment,
    client: {
      getChainId: vi.fn(async () => 1),
      getBlockNumber,
      getBlock,
      getTransactionReceipt: vi.fn(),
      getBytecode: vi.fn(),
    },
  };
  return { value, getBlockNumber, getBlock };
}

function runtime(overrides: {
  firstLive?: ReconcilerRouteDto[];
  secondLive?: ReconcilerRouteDto[];
  indexed?: ReconcilerRouteDto[];
  contract?: ReconcilerPreParityContract;
  request?: ReconcilerCheckpointRequest;
  reader?: ReconcilerRouteDtoReader;
  providers?: readonly CandidateRpcProvider[];
} = {}) {
  const first = provider({
    identity: "alchemy-mainnet-a",
    vendorGroup: "alchemy",
    endpointCommitment: ENDPOINT_A,
    endpointOriginCommitment: ORIGIN_A,
  });
  const second = provider({
    identity: "quicknode-mainnet-b",
    vendorGroup: "quicknode",
    endpointCommitment: ENDPOINT_B,
    endpointOriginCommitment: ORIGIN_B,
  });
  const firstLive = overrides.firstLive ?? routeDtos();
  const secondLive = overrides.secondLive ?? routeDtos();
  const indexed = overrides.indexed ?? routeDtos();
  const readLiveRoutes = vi.fn(async ({ source }) =>
    source.vendorGroup === "alchemy" ? firstLive : secondLive,
  );
  const reader =
    overrides.reader ??
    ({
      readLiveRoutes,
      readIndexedRoutes: vi.fn(async () => indexed),
    } satisfies ReconcilerRouteDtoReader);
  const readExactContract = vi.fn(async () => overrides.contract ?? contract);
  const commitResult = vi.fn(async (input: ReconcilerCommitInput) => {
    const mismatchCount = input.legacyDtoHashes.filter(
      (hash, index) => hash !== input.indexedDtoHashes[index],
    ).length;
    return {
      runId: input.runId,
      reconciliationId: input.reconciliationId,
      checkpointId: input.contract.checkpointId,
      checkpointBlockNumber: input.contract.checkpointBlockNumber,
      checkpointBlockHash: input.contract.checkpointBlockHash,
      routeCount: input.routeKeys.length,
      mismatchCount,
      status: mismatchCount === 0 ? ("succeeded" as const) : ("failed" as const),
    };
  });
  const store: ReconcilerPreParityStore = {
    readExactContract,
    commitResult,
  };
  let uuidCounter = 0;
  const uuidFactory = () => {
    uuidCounter += 1;
    return `20000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
  };
  let nowCounter = 0;
  const now = () => new Date(1_785_500_000_000 + nowCounter++);
  return {
    first,
    second,
    reader,
    readLiveRoutes,
    readExactContract,
    commitResult,
    input: {
      request: overrides.request ?? request,
      store,
      providers: overrides.providers ?? [first.value, second.value],
      routeDtoReader: reader,
      uuidFactory,
      now,
      deadlineMs: 2_000,
    },
  };
}

describe("exact-checkpoint reconciler", () => {
  it("uses the exact applicable-route matrix for every supported release", () => {
    expect(reconcilerRouteKeysForScope("classic-v2", "classic")).toEqual(
      CLASSIC_V2_RECONCILER_ROUTE_KEYS,
    );
    expect(reconcilerRouteKeysForScope("classic-v3", "classic")).toEqual(
      RECONCILER_ROUTE_KEYS,
    );
    for (const releaseId of [
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ]) {
      expect(reconcilerRouteKeysForScope(releaseId, "stock-paired")).toEqual(
        STOCK_PAIRED_RECONCILER_ROUTE_KEYS,
      );
    }
    expect(() => reconcilerRouteKeysForScope("classic-v2", "stock-paired"))
      .toThrow();
  });

  it("commits only four records for a Classic V2 checkpoint", async () => {
    const classicV2Request = {
      ...request,
      releaseId: "classic-v2",
    };
    const classicV2Contract = {
      ...contract,
      releaseId: "classic-v2",
      routeKeys: CLASSIC_V2_RECONCILER_ROUTE_KEYS,
      routeContract: { routes: [...CLASSIC_V2_RECONCILER_ROUTE_KEYS] },
    };
    const routes = routeDtos("same", CLASSIC_V2_RECONCILER_ROUTE_KEYS);
    const fixture = runtime({
      request: classicV2Request,
      contract: classicV2Contract,
      firstLive: routes,
      secondLive: routes,
      indexed: routes,
    });

    await expect(runReconcilerPreParityCycle(fixture.input)).resolves
      .toMatchObject({ status: "succeeded", routeCount: 4 });
    const commit = fixture.commitResult.mock.calls[0]![0];
    expect(commit.routeKeys).toEqual(CLASSIC_V2_RECONCILER_ROUTE_KEYS);
    expect(commit.parityRecordIds).toHaveLength(4);
    expect(commit.parityBindingIds).toHaveLength(4);
  });

  it("reads both independent providers at the same explicit checkpoint and atomically commits six routes", async () => {
    const fixture = runtime();

    await expect(runReconcilerPreParityCycle(fixture.input)).resolves.toMatchObject({
      status: "succeeded",
      routeCount: 6,
      mismatchCount: 0,
      checkpointBlockNumber: BLOCK_NUMBER.toString(),
      checkpointBlockHash: BLOCK_HASH,
    });

    expect(fixture.first.getBlock).toHaveBeenCalledWith({
      blockNumber: BLOCK_NUMBER,
    });
    expect(fixture.second.getBlock).toHaveBeenCalledWith({
      blockNumber: BLOCK_NUMBER,
    });
    expect(fixture.first.getBlockNumber).not.toHaveBeenCalled();
    expect(fixture.second.getBlockNumber).not.toHaveBeenCalled();
    expect(fixture.readLiveRoutes).toHaveBeenCalledTimes(2);
    expect(fixture.commitResult).toHaveBeenCalledTimes(1);

    const commit = fixture.commitResult.mock.calls[0]![0];
    expect(commit.routeKeys).toEqual(RECONCILER_ROUTE_KEYS);
    expect(commit.legacyDtoHashes).toHaveLength(6);
    expect(commit.indexedDtoHashes).toHaveLength(6);
    expect(commit.routeEvidenceCommitments).toHaveLength(6);
    expect(commit.parityBindingCommitments).toHaveLength(6);
    expect(new Set([...commit.parityRecordIds, ...commit.parityBindingIds]).size)
      .toBe(12);
  });

  it("canonicalizes a shuffled complete DTO set into the fixed six-route order", async () => {
    const fixture = runtime({
      firstLive: routeDtos().reverse(),
      secondLive: routeDtos().slice(2).concat(routeDtos().slice(0, 2)),
      indexed: routeDtos().slice(1).concat(routeDtos().slice(0, 1)),
    });

    await expect(runReconcilerPreParityCycle(fixture.input)).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(fixture.commitResult.mock.calls[0]![0].routeKeys).toEqual(
      RECONCILER_ROUTE_KEYS,
    );
  });

  it("fails before commit when either provider omits or duplicates a route", async () => {
    const omitted = runtime({ firstLive: routeDtos().slice(0, 5) });
    await expect(runReconcilerPreParityCycle(omitted.input)).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
    expect(omitted.commitResult).not.toHaveBeenCalled();

    const duplicate = routeDtos();
    duplicate[5] = { ...duplicate[4]! };
    const duplicated = runtime({ secondLive: duplicate });
    await expect(runReconcilerPreParityCycle(duplicated.input)).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
    expect(duplicated.commitResult).not.toHaveBeenCalled();
  });

  it("fails before commit when live providers disagree", async () => {
    const changed = routeDtos();
    changed[2] = {
      ...changed[2]!,
      dto: { routeKey: "explore-chart", suffix: "provider-disagreement" },
    };
    const fixture = runtime({ secondLive: changed });

    await expect(runReconcilerPreParityCycle(fixture.input)).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
    expect(fixture.commitResult).not.toHaveBeenCalled();
  });

  it("records an indexed mismatch as failed instead of activating false parity", async () => {
    const changed = routeDtos();
    changed[4] = {
      ...changed[4]!,
      dto: { routeKey: "classic-v3-profile", suffix: "stale-index" },
    };
    const fixture = runtime({ indexed: changed });

    await expect(runReconcilerPreParityCycle(fixture.input)).resolves.toMatchObject({
      status: "failed",
      mismatchCount: 1,
    });
    expect(fixture.commitResult).toHaveBeenCalledTimes(1);
    const commit = fixture.commitResult.mock.calls[0]![0];
    expect(commit.legacyDtoHashes[4]).not.toBe(commit.indexedDtoHashes[4]);
  });

  it("rejects zero-work route claims", async () => {
    const emptyClaim = routeDtos();
    emptyClaim[0] = { ...emptyClaim[0]!, comparedCount: 0 };
    const fixture = runtime({ indexed: emptyClaim });

    await expect(runReconcilerPreParityCycle(fixture.input)).rejects.toMatchObject({
      dependency: "postgres",
      code: "validation_failed",
    });
    expect(fixture.commitResult).not.toHaveBeenCalled();
  });

  it("rejects a stale or substituted database contract before RPC work", async () => {
    const fixture = runtime({
      contract: { ...contract, checkpointBlockHash: `0x${"99".repeat(32)}` },
    });

    await expect(runReconcilerPreParityCycle(fixture.input)).rejects.toMatchObject({
      dependency: "postgres",
      code: "validation_failed",
    });
    expect(fixture.first.getBlock).not.toHaveBeenCalled();
    expect(fixture.commitResult).not.toHaveBeenCalled();
  });

  it("rejects an RPC block that does not match the database checkpoint", async () => {
    const first = provider({
      identity: "alchemy-mainnet-a",
      vendorGroup: "alchemy",
      endpointCommitment: ENDPOINT_A,
      endpointOriginCommitment: ORIGIN_A,
      blockHash: `0x${"98".repeat(32)}`,
    });
    const second = provider({
      identity: "quicknode-mainnet-b",
      vendorGroup: "quicknode",
      endpointCommitment: ENDPOINT_B,
      endpointOriginCommitment: ORIGIN_B,
    });
    const fixture = runtime({ providers: [first.value, second.value] });

    await expect(runReconcilerPreParityCycle(fixture.input)).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
    expect(fixture.readLiveRoutes).not.toHaveBeenCalled();
    expect(fixture.commitResult).not.toHaveBeenCalled();
  });

  it("does not commit after the overall deadline even if a reader resolves later", async () => {
    const delayedRoutes = routeDtos();
    const reader: ReconcilerRouteDtoReader = {
      readLiveRoutes: vi.fn(
        () =>
          new Promise<readonly ReconcilerRouteDto[]>((resolve) => {
            setTimeout(() => resolve(delayedRoutes), 150);
          }),
      ),
      readIndexedRoutes: vi.fn(
        () =>
          new Promise<readonly ReconcilerRouteDto[]>((resolve) => {
            setTimeout(() => resolve(delayedRoutes), 150);
          }),
      ),
    };
    const fixture = runtime({ reader });

    await expect(
      runReconcilerPreParityCycle({ ...fixture.input, deadlineMs: 100 }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.commitResult).not.toHaveBeenCalled();
  });

  it("rejects provider pairs that are not independently identified", async () => {
    const same = provider({
      identity: "same-mainnet",
      vendorGroup: "same",
      endpointCommitment: ENDPOINT_A,
      endpointOriginCommitment: ORIGIN_A,
    });
    const fixture = runtime({ providers: [same.value, same.value] });

    await expect(runReconcilerPreParityCycle(fixture.input)).rejects.toMatchObject({
      dependency: "rpc",
      code: "invalid_input",
    });
    expect(fixture.readExactContract).not.toHaveBeenCalled();
  });
});
