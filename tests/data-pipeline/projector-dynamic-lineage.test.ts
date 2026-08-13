import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  keccak256,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

import {
  verifyEnvioCandidateBatchWithDualRpc,
  type CandidateRpcClient,
} from "../../lib/data-pipeline/dual-rpc";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import type { VerifiedDynamicSourceLineage } from "../../lib/data-pipeline/projector-identities";
import { rpcProviderCommitment } from "../../lib/data-pipeline/rpc-provider-commitments";
import { runtimeBytecodeEvidence } from "../../lib/data-pipeline/runtime-bytecode";

const SOURCE = "0x4cfe000000000000000000000000000000000001" as const;
const FACTORY = "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a" as const;
const BLOCK = 25_639_597n;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const SAFE_BLOCK = BLOCK + 3n;
const SAFE_BLOCK_HASH = `0x${"22".repeat(32)}` as const;
const TRANSACTION_HASH = `0x${"33".repeat(32)}` as const;
const TOPIC = `0x${"44".repeat(32)}` as const;
const DATA = "0x1234" as const;
const RUNTIME = "0x6001aabb6000" as const;
const IMMUTABLE_REFERENCES = [{ start: 2, length: 2 }] as const;
const RUNTIME_EVIDENCE = runtimeBytecodeEvidence({
  runtimeBytecode: RUNTIME,
  expectedByteLength: 6,
  immutableReferences: IMMUTABLE_REFERENCES,
});

function candidate(): EnvioCandidate {
  return {
    candidateId: `1:${BLOCK_HASH}:${TRANSACTION_HASH}:4`,
    chainId: 1,
    blockNumber: BLOCK.toString(),
    blockHash: BLOCK_HASH,
    blockTimestamp: "1785481000",
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 1,
    blockGlobalLogIndex: 4,
    sourceAddress: SOURCE,
    contractName: "ClassicV3RewardVault",
    eventName: "CreatorFeesCheckpointed",
    releaseHint: { model: "unresolved", releaseVersion: "unresolved" },
    orderedTopics: [TOPIC],
    rawData: DATA,
    decodedPayload: {},
    payloadHash: keccak256(
      encodeAbiParameters(
        [{ type: "bytes32[]" }, { type: "bytes" }],
        [[TOPIC], DATA],
      ),
    ),
  };
}

function lineage(
  overrides: Partial<VerifiedDynamicSourceLineage> = {},
): VerifiedDynamicSourceLineage {
  return {
    attestationId: "10000000-0000-4000-8000-000000000001",
    sourceAddress: SOURCE,
    contractName: "ClassicV3RewardVault",
    model: "classic",
    releaseVersion: "classic-v3",
    factoryAddress: FACTORY,
    factoryContractName: "ClassicV3RewardVaultFactory",
    factoryCandidateId:
      `1:0x${"55".repeat(32)}:0x${"66".repeat(32)}:3`,
    factoryBlockNumber: (BLOCK - 1n).toString(),
    factoryBlockGlobalLogIndex: "3",
    activationCandidateId:
      `1:${BLOCK_HASH}:0x${"77".repeat(32)}:3`,
    activationBlockNumber: BLOCK.toString(),
    activationBlockHash: BLOCK_HASH,
    activationBlockGlobalLogIndex: "3",
    expectedExactRuntimeCodeHash: RUNTIME_EVIDENCE.exactRuntimeCodeHash,
    expectedNormalizedRuntimeCodeHash:
      RUNTIME_EVIDENCE.normalizedRuntimeCodeHash,
    expectedImmutableReferencesCommitment:
      RUNTIME_EVIDENCE.immutableReferencesCommitment,
    expectedRuntimeByteLength: "6",
    immutableReferences: IMMUTABLE_REFERENCES,
    ...overrides,
  };
}

function client(runtime: Hex = RUNTIME): CandidateRpcClient {
  return {
    getChainId: async () => 1,
    getBlockNumber: async () => SAFE_BLOCK + 12n,
    getBlock: async ({ blockNumber }) =>
      blockNumber === SAFE_BLOCK
        ? {
            number: SAFE_BLOCK,
            hash: SAFE_BLOCK_HASH,
            timestamp: 1785481100n,
          }
        : {
            number: BLOCK,
            hash: BLOCK_HASH,
            timestamp: 1785481000n,
          },
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: BLOCK,
      blockHash: BLOCK_HASH,
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 1,
      logs: [
        {
          address: SOURCE,
          blockNumber: BLOCK,
          blockHash: BLOCK_HASH,
          transactionHash: TRANSACTION_HASH,
          transactionIndex: 1,
          logIndex: 4,
          removed: false,
          topics: [TOPIC],
          data: DATA,
        },
      ],
    }),
    getBytecode: async () => runtime,
  };
}

function provider(identity: string, rpcClient = client()) {
  const endpoint = `https://${identity}.example`;
  return {
    identity,
    vendorGroup: identity.split("-")[0]!,
    endpointCommitment: rpcProviderCommitment("endpoint", endpoint),
    endpointOriginCommitment: rpcProviderCommitment("origin", endpoint),
    client: rpcClient,
  };
}

function verify(dynamicSources?: readonly VerifiedDynamicSourceLineage[]) {
  return verifyEnvioCandidateBatchWithDualRpc({
    candidates: [candidate()],
    providers: [provider("drpc-mainnet"), provider("quicknode-mainnet")],
    dynamicSources,
    requireDynamicLineage: true,
    rpcPolicy: { maxAttempts: 1 },
  });
}

describe("two-phase dynamic source lineage", () => {
  it("rejects an unresolved dynamic source without a prior attestation", async () => {
    await expect(verify()).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
    });
  });

  it("verifies exact runtime, normalized template, and immutable layout", async () => {
    await expect(verify([lineage()])).resolves.toMatchObject({
      candidates: [
        expect.objectContaining({
          sourceKind: "dynamic-attested",
          model: "classic",
          releaseVersion: "classic-v3",
          sourceCodeHash: RUNTIME_EVIDENCE.exactRuntimeCodeHash,
          dynamicSourceAttestationId:
            "10000000-0000-4000-8000-000000000001",
        }),
      ],
    });
  });

  it("rejects null or zero runtime commitments", async () => {
    await expect(
      verify([
        lineage({
          expectedExactRuntimeCodeHash: `0x${"00".repeat(32)}`,
        }),
      ]),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a runtime whose immutable-normalized template differs", async () => {
    const changed = "0x6001aabb6001" as const;
    await expect(
      verifyEnvioCandidateBatchWithDualRpc({
        candidates: [candidate()],
        providers: [
          provider("drpc-mainnet", client(changed)),
          provider("quicknode-mainnet", client(changed)),
        ],
        dynamicSources: [lineage()],
        requireDynamicLineage: true,
        rpcPolicy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a same-or-later factory parent placement", async () => {
    await expect(
      verify([
        lineage({
          factoryBlockNumber: BLOCK.toString(),
          factoryBlockGlobalLogIndex: "4",
        }),
      ]),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a same-height activation from a replacement fork", async () => {
    const replacementHash = `0x${"99".repeat(32)}` as const;
    await expect(
      verify([
        lineage({
          activationCandidateId:
            `1:${replacementHash}:0x${"77".repeat(32)}:3`,
          activationBlockHash: replacementHash,
        }),
      ]),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a child at or before its launch activation boundary", async () => {
    await expect(
      verify([
        lineage({
          activationCandidateId:
            `1:${BLOCK_HASH}:0x${"77".repeat(32)}:4`,
          activationBlockGlobalLogIndex: "4",
        }),
      ]),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
