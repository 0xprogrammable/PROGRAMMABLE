import { describe, expect, it } from "vitest";

import {
  buildCustomRevenueWorkerPlan,
  CUSTOM_REVENUE_CLAIM_EVENT_TOPIC,
  CUSTOM_REVENUE_CLAIM_SELECTOR,
  CUSTOM_REVENUE_LAUNCH_CLASS_ID,
  CUSTOM_REVENUE_NATIVE_ASSET,
  CUSTOM_REVENUE_REWARD_WALLET,
  CUSTOM_REVENUE_SOURCE_INTERFACE_ID,
  type CanonicalCustomClaimEventV1,
  type CanonicalCustomClaimReceiptV1,
  type CustomRevenueLifetimeCursorV1,
  type CustomRevenueWorkerInputV1,
  type FinalizedCustomRevenueSourceV1,
} from "../lib/protocol-revenue/custom-release-worker";

const hash = (suffix: string) => `0x${suffix.padStart(64, "0")}` as `0x${string}`;
const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as `0x${string}`;

function source(overrides: Partial<FinalizedCustomRevenueSourceV1> = {}): FinalizedCustomRevenueSourceV1 {
  return {
    chainId: "1",
    customRegistryGeneration: "2",
    finalizedRegistrarIndex: 0,
    launchId: hash("11"),
    sourceId: hash("12"),
    launchClassId: CUSTOM_REVENUE_LAUNCH_CLASS_ID,
    source: address("13"),
    sourceRuntimeCodeHash: hash("14"),
    asset: CUSTOM_REVENUE_NATIVE_ASSET,
    claimSelector: CUSTOM_REVENUE_CLAIM_SELECTOR,
    standardInterfaceId: CUSTOM_REVENUE_SOURCE_INTERFACE_ID,
    recipient: CUSTOM_REVENUE_REWARD_WALLET,
    programmableFeeBps: 10,
    approvedFactory: address("15"),
    approvedFactoryRuntimeCodeHash: hash("16"),
    create2Deployer: address("17"),
    create2DeployerRuntimeCodeHash: hash("18"),
    templateCommitment: hash("19"),
    sourceActivatedAtBlock: "100",
    sourceActivatedAtBlockHash: hash("20"),
    sourceActivationTransactionHash: hash("21"),
    sourceActivationTransactionIndex: 1,
    sourceActivationLogIndex: 3,
    sourceActivatedTotalClaimedBaselineWei: "0",
    launchStampBlockNumber: "101",
    finalizedAtBlock: "165",
    finalityEvidenceHash: hash("22"),
    currentlyExecutable: true,
    quarantined: false,
    runtimeCodeHashMatchedAtFinalizedHead: true,
    customRegistryStillFinalizedAtHead: true,
    launchStampStillMatchedAtHead: true,
    totalClaimedAtFinalizedHeadWei: "0",
    accruedAtFinalizedHeadWei: "5",
    ...overrides,
  };
}

function eventFor(item: FinalizedCustomRevenueSourceV1, amountWei: string): CanonicalCustomClaimEventV1 {
  return {
    topic0: CUSTOM_REVENUE_CLAIM_EVENT_TOPIC,
    sourceId: item.sourceId,
    source: item.source,
    asset: CUSTOM_REVENUE_NATIVE_ASSET,
    recipient: CUSTOM_REVENUE_REWARD_WALLET,
    caller: address("31"),
    amountWei,
    blockNumber: "170",
    blockHash: hash("32"),
    transactionHash: hash("33"),
    transactionIndex: 2,
    logIndex: 4,
  };
}

function receipt(amountWei: string): CanonicalCustomClaimReceiptV1 {
  return {
    transactionHash: hash("33"),
    blockNumber: "170",
    blockHash: hash("32"),
    status: "success",
    canonicalClaimEventAmountWei: amountWei,
    rewardWalletBalanceDeltaWei: amountWei,
  };
}

function input(
  sources: readonly FinalizedCustomRevenueSourceV1[],
  claimEvents: readonly CanonicalCustomClaimEventV1[] = [],
  claimReceipts: readonly CanonicalCustomClaimReceiptV1[] = [],
  cursors: readonly CustomRevenueLifetimeCursorV1[] = [],
): CustomRevenueWorkerInputV1 {
  return {
    schemaVersion: "programmable.custom-revenue.worker-input.v1",
    chainId: "1",
    finalizedHead: { blockNumber: "200", blockHash: hash("40") },
    canonicalBlockHashes: {
      "100": hash("20"),
      "170": hash("32"),
      "200": hash("40"),
    },
    sources,
    cursors,
    claimEvents,
    claimReceipts,
  };
}

describe("future Custom release worker", () => {
  it("enumerates only finalized V2 sources and keeps eligibility independent of executor counters", () => {
    const plan = buildCustomRevenueWorkerPlan(input([source()]));
    expect(plan.claimBatches).toEqual([[hash("12")]]);
    expect(plan.observationSourceIds).toEqual([hash("12")]);
    expect(plan.registryV1InferenceUsed).toBe(false);
    expect(plan.executorLocalCountersUsedForEligibility).toBe(false);
    expect(plan.nextCursors[0]?.activationTotalClaimedBaselineWei).toBe("0");
  });

  it("reconciles direct permissionless claims with canonical events, receipts and the lifetime counter", () => {
    const item = source({ totalClaimedAtFinalizedHeadWei: "7" });
    const plan = buildCustomRevenueWorkerPlan(input([item], [eventFor(item, "7")], [receipt("7")]));
    expect(plan.nextCursors[0]?.observedLifetimeClaimedWei).toBe("7");
    expect(plan.nextCursors[0]?.nextBlockNumber).toBe("201");
  });

  it("continues lifetime observation after quarantine while suppressing claim execution", () => {
    const item = source({
      currentlyExecutable: false,
      quarantined: true,
      accruedAtFinalizedHeadWei: "9",
      totalClaimedAtFinalizedHeadWei: "7",
    });
    const plan = buildCustomRevenueWorkerPlan(input([item], [eventFor(item, "7")], [receipt("7")]));
    expect(plan.observationSourceIds).toEqual([item.sourceId]);
    expect(plan.claimBatches).toEqual([]);
    expect(plan.lifetimeObservationIncludesQuarantined).toBe(true);
  });

  it("fails closed when a lifetime counter grows without canonical claim evidence", () => {
    expect(() => buildCustomRevenueWorkerPlan(input([source({ totalClaimedAtFinalizedHeadWei: "1" })])))
      .toThrow(/not fully reconciled/u);
  });

  it("fails closed on Registry V1 inference and nonzero activation baselines", () => {
    expect(() => buildCustomRevenueWorkerPlan(input([source({ customRegistryGeneration: "1" })])))
      .toThrow(/Registry V1/u);
    expect(() => buildCustomRevenueWorkerPlan(input([
      { ...source(), sourceActivatedTotalClaimedBaselineWei: "1" as "0" },
    ]))).toThrow(/baseline/u);
    expect(() => buildCustomRevenueWorkerPlan(input([source({ finalizedRegistrarIndex: 1 })])))
      .toThrow(/complete ordered registrar enumeration/u);
  });

  it("fails closed when receipt value delivery does not match its canonical claim events", () => {
    const item = source({ totalClaimedAtFinalizedHeadWei: "7" });
    expect(() => buildCustomRevenueWorkerPlan(input(
      [item],
      [eventFor(item, "7")],
      [{ ...receipt("7"), rewardWalletBalanceDeltaWei: "6" }],
    ))).toThrow(/does not reconcile/u);
  });

  it("fails closed when activation or receipt evidence is not on the canonical block", () => {
    expect(() => buildCustomRevenueWorkerPlan({
      ...input([source()]),
      canonicalBlockHashes: { "100": hash("99"), "200": hash("40") },
    })).toThrow(/activation block is not canonical/u);

    const item = source({ totalClaimedAtFinalizedHeadWei: "7" });
    expect(() => buildCustomRevenueWorkerPlan(input(
      [item],
      [eventFor(item, "7")],
      [{ ...receipt("7"), blockNumber: "171", blockHash: hash("34") }],
    ))).toThrow(/receipt block/u);
  });
});
