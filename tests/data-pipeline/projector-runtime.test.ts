import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runProjectorCycle } from "../../lib/data-pipeline/projector";
import { validationError } from "../../lib/data-pipeline/errors";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";

const CURSOR_HASH = `0x${"11".repeat(32)}` as const;
const SAFE_HASH = `0x${"22".repeat(32)}` as const;
const TX_HASH = `0x${"33".repeat(32)}` as const;
const CANDIDATE_HASH = `0x${"44".repeat(32)}` as const;

function candidate(): EnvioCandidate {
  return {
    candidateId: `1:${CANDIDATE_HASH}:${TX_HASH}:7`,
    chainId: 1,
    blockNumber: "101",
    blockHash: CANDIDATE_HASH,
    blockTimestamp: "1000",
    transactionHash: TX_HASH,
    transactionIndex: 0,
    blockGlobalLogIndex: 7,
    sourceAddress: "0xd240d06f8586eb799f20056054e5b527405e6bad",
    contractName: "ClassicV2Launcher",
    eventName: "MemeTokenLaunched",
    releaseHint: { model: "classic", releaseVersion: "classic-v2" },
    orderedTopics: [`0x${"55".repeat(32)}`],
    rawData: "0x",
    decodedPayload: {},
    payloadHash: `0x${"66".repeat(32)}`,
  };
}

function fixtures() {
  let databaseTransactionOpen = false;
  const store = {
    readPlan: vi.fn(async () => {
      databaseTransactionOpen = true;
      databaseTransactionOpen = false;
      return {
        cursor: {
          generation: "5",
          blockNumber: "100",
          blockHash: CURSOR_HASH,
          blockGlobalLogIndex: -1,
          candidateId: "",
        },
        dynamicSources: [],
      };
    }),
    commitVerifiedPage: vi.fn(async () => {
      expect(databaseTransactionOpen).toBe(false);
      databaseTransactionOpen = true;
      databaseTransactionOpen = false;
      return { generation: "6" };
    }),
  };
  const envio = {
    readProgress: vi.fn(async () => {
      expect(databaseTransactionOpen).toBe(false);
      return { progressBlock: "200" };
    }),
    readCandidatesWindow: vi.fn(async () => {
      expect(databaseTransactionOpen).toBe(false);
      return [candidate()];
    }),
  };
  const captureSafeHead = vi.fn(async () => {
    expect(databaseTransactionOpen).toBe(false);
    return {
      providerHeads: ["220", "221"] as const,
      safeBlockNumber: "208",
      safeBlockHash: SAFE_HASH,
      cursorBlockHash: CURSOR_HASH,
    };
  });
  const verifyWindow = vi.fn(async () => {
    expect(databaseTransactionOpen).toBe(false);
    return {
      chainId: 1 as const,
      providerIdentities: ["alchemy", "quicknode"] as const,
      providerVendorGroups: ["alchemy", "quicknode"] as const,
      providerEndpointCommitments: [SAFE_HASH, CURSOR_HASH] as const,
      providerOriginCommitments: [SAFE_HASH, CURSOR_HASH] as const,
      providerHeads: ["220", "221"] as const,
      safeBlockNumber: "208",
      safeBlockHash: SAFE_HASH,
      candidates: [],
      coveredCandidateCount: 1,
      coverage: {
        fromBlockNumber: "100",
        throughBlockNumber: "101",
        throughBlockGlobalLogIndex: "7",
        providerLogCommitments: [SAFE_HASH, SAFE_HASH] as const,
      },
    };
  });
  return { store, envio, captureSafeHead, verifyWindow };
}

describe("projector runtime boundary", () => {
  it("finishes all provider work before opening the atomic commit", async () => {
    const input = fixtures();
    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).resolves.toEqual({
      status: "committed",
      candidateCount: 1,
      generation: "6",
      snapshotBlock: "200",
    });
    expect(input.store.commitVerifiedPage).toHaveBeenCalledTimes(1);
    expect(input.verifyWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [expect.objectContaining({ candidateId: candidate().candidateId })],
        through: expect.objectContaining({ candidateId: candidate().candidateId }),
        dynamicSources: [],
        rpcPolicy: expect.objectContaining({
          maxProviderCalls: 48,
          deadlineMs: expect.any(Number),
        }),
      }),
    );
  });

  it("never commits or advances after coverage failure", async () => {
    const input = fixtures();
    input.verifyWindow.mockRejectedValue(
      validationError("rpc", "coverage-omission"),
    );
    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });

  it("caps each persisted page to the safe call-budget prefix", async () => {
    const input = fixtures();
    await runProjectorCycle({
      ...input,
      providers: [] as never,
      deadlineMs: 1_000,
    });
    expect(input.envio.readCandidatesWindow).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 12 }),
    );
  });

  it("fails closed on the overall deadline before database commit", async () => {
    const input = fixtures();
    input.captureSafeHead.mockImplementation(
      () => new Promise(() => undefined),
    );
    await expect(
      runProjectorCycle({
        ...input,
        providers: [] as never,
        deadlineMs: 20,
      }),
    ).rejects.toMatchObject({ dependency: "rpc", code: "timeout" });
    expect(input.store.commitVerifiedPage).not.toHaveBeenCalled();
  });
});
