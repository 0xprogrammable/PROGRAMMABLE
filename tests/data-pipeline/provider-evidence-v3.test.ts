import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  projectionExecutionTraceCommitmentV1,
  projectionExecutionTracePreimageV1,
  providerEvidenceV3,
  providerEvidenceV3ContractCommitment,
} from "../../lib/data-pipeline/provider-evidence";

const bytes32 = (byte: string) => `0x${byte.repeat(64)}`;

const executionInput = Object.freeze({
  chain_id: "1",
  release_id: "classic-v3",
  model_id: "classic",
  source_group: "core",
  epoch_id: "70000000-0000-4000-8000-000000000020",
  pointer_generation: "1",
  run_id: "80000000-0000-4000-8000-000000000001",
  provider_a_id: "10000000-0000-4000-8000-000000000002",
  provider_b_id: "10000000-0000-4000-8000-000000000003",
  provider_a_identity: "alchemy-mainnet-11111111111111111111111111111111",
  provider_b_identity: "quicknode-mainnet-55555555555555555555555555555555",
  provider_a_vendor_group: "alchemy",
  provider_b_vendor_group: "quicknode",
  provider_a_endpoint_commitment: bytes32("3"),
  provider_b_endpoint_commitment: bytes32("5"),
  provider_a_origin_commitment: bytes32("4"),
  provider_b_origin_commitment: bytes32("6"),
  provider_a_call_count: 6,
  provider_b_call_count: 6,
  candidate_batch_size: 40,
  hard_deadline_ms: 75_000,
  maximum_calls_per_provider: 128,
  elapsed_ms: 2,
  execution_trace_commitment: bytes32("7"),
});

const rewardInput = Object.freeze({
  chain_id: "1",
  release_id: "classic-v3",
  model_id: "classic",
  source_group: "core",
  epoch_id: "70000000-0000-4000-8000-000000000020",
  pointer_generation: "1",
  run_id: "80000000-0000-4000-8000-000000000001",
  projection_execution_evidence_id:
    "81000000-0000-4000-8000-000000000001",
  block_evidence_id: "82000000-0000-4000-8000-000000000001",
  vault: `0x${"8".repeat(40)}`,
  reward_model: "classic-v3",
  block_number: "25639601",
  block_hash: bytes32("9"),
  provider_a_id: "10000000-0000-4000-8000-000000000002",
  provider_b_id: "10000000-0000-4000-8000-000000000003",
  provider_a_snapshot_commitment: bytes32("a"),
  provider_b_snapshot_commitment: bytes32("a"),
  provider_a_call_count: 14,
  provider_b_call_count: 14,
  verification_accounts: [
    `0x${"1".repeat(40)}`,
    `0x${"2".repeat(40)}`,
  ],
  verification_account_chunk_end_offsets: [2],
  provider_a_verification_chunk_commitments: [bytes32("d")],
  provider_b_verification_chunk_commitments: [bytes32("d")],
  provider_a_verification_chunk_call_counts: [14],
  provider_b_verification_chunk_call_counts: [14],
  folded_snapshot_commitment: bytes32("b"),
  execution_trace_commitment: bytes32("c"),
});

describe("provider evidence v3 projection codecs", () => {
  it("uses a new immutable version and subtype frame", () => {
    const execution = providerEvidenceV3(
      "projection_execution",
      executionInput,
    );
    const reward = providerEvidenceV3("reward_snapshot", rewardInput);

    expect(execution.encodingVersion).toBe(3);
    expect(reward.encodingVersion).toBe(3);
    expect(Buffer.from(execution.canonicalPreimage).subarray(0, 35)).toEqual(
      Buffer.concat([
        Buffer.from("programmable:provider-evidence:v3\0", "utf8"),
        Buffer.from([6]),
      ]),
    );
    expect(Buffer.from(reward.canonicalPreimage).subarray(0, 35)).toEqual(
      Buffer.concat([
        Buffer.from("programmable:provider-evidence:v3\0", "utf8"),
        Buffer.from([7]),
      ]),
    );
    expect(execution.contentFingerprint).toBe(
      "0x9ce10c58b04e1d21bb51f78092e358ecc125aeef8ae597f88eae12dcf029cc4d",
    );
    expect(reward.contentFingerprint).toBe(
      "0x0bc3258a5ca6d74ac6710e5e2ba218d6c9f4ec46cda0e4fb4777e3799b5ddb54",
    );
    expect(Buffer.from(reward.canonicalPreimage).toString("hex")).toBe(
      "70726f6772616d6d61626c653a70726f76696465722d65766964656e63653a7633000700000000000000010000000a636c61737369632d763300000007636c617373696300000004636f726570000000000040008000000000000020000000000000000180000000000040008000000000000001810000000000400080000000000000018200000000004000800000000000000188888888888888888888888888888888888888880000000a636c61737369632d76330000000001873ab199999999999999999999999999999999999999999999999999999999999999991000000000004000800000000000000210000000000040008000000000000003aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000e0000000e0000000211111111111111111111111111111111111111112222222222222222222222222222222222222222000000010000000200000001dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd00000001dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd000000010000000e000000010000000ebbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    );
    expect(providerEvidenceV3ContractCommitment()).toBe(
      "0x3234e87ac53489e1cfefafa865b053e9723945930d060265c0e8084669a1e955",
    );
  });

  it("rejects unknown fields and noncanonical account arrays", () => {
    expect(() =>
      providerEvidenceV3("projection_execution", {
        ...executionInput,
        extra: true,
      }),
    ).toThrow();
    expect(() =>
      providerEvidenceV3("reward_snapshot", {
        ...rewardInput,
        verification_accounts: [`0x${"AA".repeat(20)}`],
      }),
    ).toThrow();
  });

  it("freezes a structural execution trace independent of JSON key order", () => {
    const call = {
      providerIdentity: "alchemy-mainnet-11111111111111111111111111111111",
      providerVendorGroup: "alchemy",
      providerEndpointCommitment: bytes32("3"),
      providerOriginCommitment: bytes32("4"),
      operation: "getTransactionReceipt",
      attempt: 1,
      startedOffsetMs: 3,
      durationMs: 2,
      outcome: "success",
    };
    const trace = {
      startedAtMs: 1_775_000_000_000,
      completedAtMs: 1_775_000_000_005,
      candidateBatchSize: 1,
      hardDeadlineMs: 75_000,
      maxCallsPerProvider: 128,
      elapsedMs: 5,
      providerCallCounts: [1, 0],
      calls: [call],
    };
    const reordered = {
      calls: [{
        outcome: "success",
        durationMs: 2,
        startedOffsetMs: 3,
        attempt: 1,
        operation: "getTransactionReceipt",
        providerOriginCommitment: bytes32("4"),
        providerEndpointCommitment: bytes32("3"),
        providerVendorGroup: "alchemy",
        providerIdentity: "alchemy-mainnet-11111111111111111111111111111111",
      }],
      providerCallCounts: [1, 0],
      elapsedMs: 5,
      maxCallsPerProvider: 128,
      hardDeadlineMs: 75_000,
      candidateBatchSize: 1,
      completedAtMs: 1_775_000_000_005,
      startedAtMs: 1_775_000_000_000,
    };

    expect(
      Buffer.from(projectionExecutionTracePreimageV1(trace)).toString("hex"),
    ).toBe(
      Buffer.from(projectionExecutionTracePreimageV1(reordered)).toString(
        "hex",
      ),
    );
    expect(projectionExecutionTraceCommitmentV1(trace)).toBe(
      "0x466d9059a360712fd7d40fc9a4fd326cf58ed7d8f4a7f93a31da4edd9bbdc620",
    );
  });

  it("rejects changed trace structure, call counts and enums", () => {
    const trace = {
      startedAtMs: 1,
      completedAtMs: 2,
      candidateBatchSize: 1,
      hardDeadlineMs: 75_000,
      maxCallsPerProvider: 128,
      elapsedMs: 1,
      providerCallCounts: [0, 0],
      calls: [],
    };
    expect(() => projectionExecutionTracePreimageV1({
      ...trace,
      extra: true,
    })).toThrow();
    expect(() => projectionExecutionTracePreimageV1({
      ...trace,
      providerCallCounts: [129, 0],
    })).toThrow();
    expect(() => projectionExecutionTracePreimageV1({
      ...trace,
      providerCallCounts: [1, 0],
      calls: [{
        providerIdentity: "alchemy",
        providerVendorGroup: "alchemy",
        providerEndpointCommitment: bytes32("3"),
        providerOriginCommitment: bytes32("4"),
        operation: "unknown",
        attempt: 1,
        startedOffsetMs: 0,
        durationMs: 1,
        outcome: "success",
      }],
    })).toThrow();
  });

  it("encodes reward traces whose logical calls summarize raw RPC counts", () => {
    const providers = [
      {
        identity: "alchemy-mainnet-11111111111111111111111111111111",
        vendor: "alchemy",
        endpoint: bytes32("3"),
        origin: bytes32("4"),
      },
      {
        identity: "quicknode-mainnet-55555555555555555555555555555555",
        vendor: "quicknode",
        endpoint: bytes32("5"),
        origin: bytes32("6"),
      },
    ];
    const commitment = projectionExecutionTraceCommitmentV1({
      startedAtMs: 1_775_000_000_000,
      completedAtMs: 1_775_000_000_005,
      candidateBatchSize: 0,
      hardDeadlineMs: 75_000,
      maxCallsPerProvider: 128,
      elapsedMs: 5,
      providerCallCounts: [14, 14],
      calls: providers.map((provider) => ({
        providerIdentity: provider.identity,
        providerVendorGroup: provider.vendor,
        providerEndpointCommitment: provider.endpoint,
        providerOriginCommitment: provider.origin,
        operation: "readRewardSnapshot",
        attempt: 1,
        startedOffsetMs: 0,
        durationMs: 5,
        outcome: "success",
      })),
    });
    expect(commitment).toBe(
      "0x387a035634613b9c1fcf9369aeea587e325815bef91d3d3945e56136d0472043",
    );
  });
});
