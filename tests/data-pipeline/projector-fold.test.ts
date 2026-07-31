import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DualRpcCandidateEvidence } from "../../lib/data-pipeline/dual-rpc";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import {
  foldProjectorEvents,
  projectorFoldManifestCoverage,
  translateProjectorEvent,
} from "../../lib/data-pipeline/projector-fold";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const CREATOR = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const HOOK = "0x025a386eaa79f6067d29848fd05ccc71beab20cc" as const;
const LAUNCHER = "0xd240d06f8586eb799f20056054e5b527405e6bad" as const;
const POSITION = "0x3333333333333333333333333333333333333333" as const;
const POOL = `0x${"44".repeat(32)}` as const;
const LAUNCH_HASH = `0x${"55".repeat(32)}` as const;
const BLOCK_HASH = `0x${"66".repeat(32)}` as const;
const TX_HASH = `0x${"77".repeat(32)}` as const;
const PAYLOAD_HASH = `0x${"88".repeat(32)}` as const;
const TOPIC = `0x${"99".repeat(32)}` as const;
const V3_HOOK = "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc" as const;
const V3_LAUNCHER = "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770" as const;
const V3_FACTORY = "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a" as const;
const V3_VAULT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const CONFIGURATION = `0x${"bc".repeat(32)}` as const;

function event(
  contractName: string,
  eventName: string,
  decodedPayload: Record<string, unknown>,
  logIndex: number,
  sourceAddress: string = contractName.includes("Hook") ? HOOK : LAUNCHER,
  releaseVersion = "classic-v2",
): { candidate: EnvioCandidate; evidence: DualRpcCandidateEvidence } {
  const candidate: EnvioCandidate = {
    candidateId: `1:${BLOCK_HASH}:${TX_HASH}:${logIndex}`,
    chainId: 1,
    blockNumber: "25624131",
    blockHash: BLOCK_HASH,
    blockTimestamp: "1785460000",
    transactionHash: TX_HASH,
    transactionIndex: 3,
    blockGlobalLogIndex: logIndex,
    sourceAddress: sourceAddress as `0x${string}`,
    contractName,
    eventName,
    releaseHint: {
      model: releaseVersion.startsWith("classic") ? "classic" : "stock-paired",
      releaseVersion,
    },
    orderedTopics: [TOPIC],
    rawData: "0x",
    decodedPayload,
    payloadHash: PAYLOAD_HASH,
  };
  return {
    candidate,
    evidence: {
      chainId: 1,
      candidateId: candidate.candidateId,
      sourceAddress: candidate.sourceAddress,
      contractName,
      eventName,
      sourceKind: "static",
      model: releaseVersion.startsWith("classic") ? "classic" : "stock-paired",
      releaseVersion,
      payloadHash: PAYLOAD_HASH,
      rawLogCommitment: `0x${"aa".repeat(32)}`,
      providerIdentities: ["alchemy", "quicknode"],
      providerVendorGroups: ["alchemy", "quicknode"],
      providerEndpointCommitments: [
        `0x${"ab".repeat(32)}`,
        `0x${"ac".repeat(32)}`,
      ],
      providerOriginCommitments: [
        `0x${"ad".repeat(32)}`,
        `0x${"ae".repeat(32)}`,
      ],
      providerHeads: ["25624150", "25624151"],
      safeBlockNumber: "25624139",
      safeBlockHash: `0x${"af".repeat(32)}`,
      candidateBlockNumber: candidate.blockNumber,
      candidateBlockHash: candidate.blockHash,
      candidateBlockTimestamp: candidate.blockTimestamp,
      transactionHash: candidate.transactionHash,
      transactionIndex: candidate.transactionIndex,
      receiptCommitment: `0x${"ba".repeat(32)}`,
      sourceCodeHash: `0x${"bb".repeat(32)}`,
      receiptLogOrdinal: logIndex,
    },
  };
}

function classicV2LaunchEvents() {
  return [
    event(
      "ClassicV2Hook",
      "PoolRegistered",
      {
        poolId: POOL,
        token: TOKEN,
        creator: CREATOR,
        registrar: LAUNCHER,
        totalSwapFeeBps: "100",
      },
      1,
    ),
    event(
      "ClassicV2Hook",
      "PoolFeeDisclosure",
      {
        poolId: POOL,
        token: TOKEN,
        buySwapFeeBps: "100",
        sellSwapFeeBps: "100",
        launcherFeeBps: "10",
        transferTaxBps: "0",
        lpFeePips: "0",
      },
      2,
    ),
    event(
      "ClassicV2Launcher",
      "MemeTokenLaunched",
      {
        creator: CREATOR,
        token: TOKEN,
        poolId: POOL,
        feeHook: HOOK,
        positionRecipient: POSITION,
        positionTokenId: "42",
        totalSwapFeeBps: "100",
        launchHash: LAUNCH_HASH,
      },
      3,
    ),
    event(
      "ClassicV2Launcher",
      "MemeLiquidityConfigured",
      {
        token: TOKEN,
        totalSupply: "1000000000000000000000000000",
        tokenLiquidityAmount: "999999999999999999999999999",
        lockedTokenDust: "1",
        initialTick: "76000",
        tickLower: "-887200",
        tickUpper: "76000",
        lpFeePips: "0",
        launchHash: LAUNCH_HASH,
      },
      4,
    ),
    event(
      "ClassicV2Launcher",
      "MemeCreatorInitialBuy",
      {
        creator: CREATOR,
        token: TOKEN,
        poolId: POOL,
        nativeAmount: "6000000000000000",
        tokenAmount: "1000000",
        launchHash: LAUNCH_HASH,
      },
      5,
    ),
  ];
}

function atClassicV3Block<T extends ReturnType<typeof event>>(item: T): T {
  item.candidate.blockNumber = "25639596";
  item.evidence = { ...item.evidence, candidateBlockNumber: "25639596" };
  return item;
}

function classicV3UnlockedLaunchEvents() {
  return [
    atClassicV3Block(
      event(
        "ClassicV3RewardVaultFactory",
        "ClassicRewardVaultDeployed",
        {
          vault: V3_VAULT,
          poolId: POOL,
          feeHook: V3_HOOK,
          salt: `0x${"bd".repeat(32)}`,
          configurationHash: CONFIGURATION,
        },
        1,
        V3_FACTORY,
        "classic-v3",
      ),
    ),
    atClassicV3Block(
      event(
        "ClassicV3Hook",
        "PoolRegistered",
        {
          poolId: POOL,
          token: TOKEN,
          rewardVault: V3_VAULT,
          registrar: V3_LAUNCHER,
          buySwapFeeBps: "300",
          sellSwapFeeBps: "500",
          rewardConfigurationHash: CONFIGURATION,
        },
        2,
        V3_HOOK,
        "classic-v3",
      ),
    ),
    atClassicV3Block(
      event(
        "ClassicV3Hook",
        "PoolFeeDisclosure",
        {
          poolId: POOL,
          token: TOKEN,
          rewardVault: V3_VAULT,
          buySwapFeeBps: "300",
          sellSwapFeeBps: "500",
          buyCreatorFeeBps: "290",
          sellCreatorFeeBps: "490",
          launcherFeeBps: "10",
          transferTaxBps: "0",
          lpFeePips: "0",
        },
        3,
        V3_HOOK,
        "classic-v3",
      ),
    ),
    atClassicV3Block(
      event(
        "ClassicV3Launcher",
        "MemeTokenLaunchedV2",
        {
          deployer: CREATOR,
          token: TOKEN,
          poolId: POOL,
          feeHook: V3_HOOK,
          rewardVault: V3_VAULT,
          positionRecipient: POSITION,
          positionTokenId: "42",
          buySwapFeeBps: "300",
          sellSwapFeeBps: "500",
          rewardConfigurationHash: CONFIGURATION,
          launchHash: LAUNCH_HASH,
        },
        4,
        V3_LAUNCHER,
        "classic-v3",
      ),
    ),
    atClassicV3Block(
      event(
        "ClassicV3Launcher",
        "MemeLiquidityConfiguredV2",
        {
          token: TOKEN,
          totalSupply: "1000000000000000000000000000",
          tokenLiquidityAmount: "999999999999999999999999999",
          lockedTokenDust: "1",
          initialTick: "76000",
          tickLower: "-887200",
          tickUpper: "76000",
          lpFeePips: "0",
          launchHash: LAUNCH_HASH,
        },
        5,
        V3_LAUNCHER,
        "classic-v3",
      ),
    ),
    atClassicV3Block(
      event(
        "ClassicV3Launcher",
        "MemeCreatorInitialBuyV2",
        {
          deployer: CREATOR,
          token: TOKEN,
          poolId: POOL,
          nativeAmount: "6000000000000000",
          tokenAmount: "1000000",
          launchHash: LAUNCH_HASH,
        },
        6,
        V3_LAUNCHER,
        "classic-v3",
      ),
    ),
    atClassicV3Block(
      event(
        "ClassicV3Launcher",
        "MemeCreatorInitialBuyCustodyV2",
        {
          deployer: CREATOR,
          token: TOKEN,
          custody: ZERO,
          mode: "0",
          durationDays: "0",
          cliffDays: "0",
          configurationHash: `0x${"be".repeat(32)}`,
          launchHash: LAUNCH_HASH,
        },
        7,
        V3_LAUNCHER,
        "classic-v3",
      ),
    ),
  ];
}

describe("projector fold manifest", () => {
  it("covers every frozen release event and excludes non-P0 models", () => {
    const coverage = projectorFoldManifestCoverage();
    expect(coverage).toHaveLength(51);
    expect(coverage.some((item) => /deep|adaptive/iu.test(item.contractName))).toBe(false);
    expect(new Set(coverage.map((item) => `${item.contractName}:${item.eventName}`)).size).toBe(51);
  });

  it("emits exact occurrence placement and decimal fee facts", () => {
    const input = event(
      "ClassicV2Hook",
      "NativeSwapFeesAccrued",
      {
        poolId: POOL,
        swapSender: CREATOR,
        grossNativeAmount: "900719925474099300000",
        creatorFee: "9007199254740993000",
        launcherFee: "900719925474099300",
      },
      9,
    );
    const translated = translateProjectorEvent(input);
    expect(translated.occurrence).toMatchObject({
      releaseId: "classic-v2",
      modelId: "classic",
      transactionIndex: "3",
      receiptLogOrdinal: "9",
      blockGlobalLogIndex: "9",
      eventSignature: TOPIC,
    });
    expect(translated.fact).toMatchObject({
      kind: "fee-accrual",
      procedure: "stage_fee_accrual_fact",
      values: {
        grossAmount: "900719925474099300000",
        creatorFee: "9007199254740993000",
        launcherFee: "900719925474099300",
      },
    });
  });

  it("rejects missing, extra, non-canonical, or evidence-mismatched input", () => {
    const missing = event(
      "ClassicV2Hook",
      "PoolRegistered",
      { poolId: POOL },
      1,
    );
    expect(() => translateProjectorEvent(missing)).toThrow(/payload/iu);

    const extra = classicV2LaunchEvents()[0]!;
    extra.candidate.decodedPayload = {
      ...extra.candidate.decodedPayload,
      unexpected: "0",
    };
    expect(() => translateProjectorEvent(extra)).toThrow(/payload/iu);

    const mismatch = classicV2LaunchEvents()[0]!;
    mismatch.evidence = { ...mismatch.evidence, eventName: "PoolFeeDisclosure" };
    expect(() => translateProjectorEvent(mismatch)).toThrow(/evidence/iu);
  });
});

describe("projector semantic fold", () => {
  it("builds one complete Classic v2 launch projection from parent-first events", () => {
    const result = foldProjectorEvents({
      events: classicV2LaunchEvents(),
      tokenMetadata: {
        [TOKEN]: { name: "Flower", symbol: "FLOWER" },
      },
    });
    expect(result.occurrences).toHaveLength(5);
    expect(result.facts).toHaveLength(5);
    expect(result.launches).toHaveLength(1);
    expect(result.launches[0]).toMatchObject({
      releaseVersion: "classic-v2",
      token: TOKEN,
      creator: CREATOR,
      poolId: POOL,
      launchHash: LAUNCH_HASH,
      tokenName: "Flower",
      tokenSymbol: "FLOWER",
      totalSupply: "1000000000000000000000000000",
      pool: {
        currency0: ZERO,
        currency1: TOKEN,
        poolKeyFee: "0",
        tickSpacing: "200",
        hook: HOOK,
      },
      feeConfiguration: {
        buySwapFeeBps: "100",
        sellSwapFeeBps: "100",
        buyCreatorFeeBps: "90",
        sellCreatorFeeBps: "90",
        launcherFeeBps: "10",
        transferTaxBps: "0",
        lpFeePips: "0",
      },
      initialBuy: {
        fundingAsset: ZERO,
        fundingAmount: "6000000000000000",
        tokenAmount: "1000000",
      },
      ethFunded: true,
    });
    expect(result.launches[0]!.liquidity.initialSqrtPriceX96).toMatch(/^[1-9]\d*$/u);
  });

  it("rejects child-before-parent and incomplete launch sequences", () => {
    const sequence = classicV2LaunchEvents();
    expect(() =>
      foldProjectorEvents({
        events: [sequence[2]!, sequence[0]!, sequence[1]!, sequence[3]!, sequence[4]!],
        tokenMetadata: { [TOKEN]: { name: "Flower", symbol: "FLOWER" } },
      }),
    ).toThrow(/order|parent/iu);
    expect(() =>
      foldProjectorEvents({
        events: sequence.slice(0, 4),
        tokenMetadata: { [TOKEN]: { name: "Flower", symbol: "FLOWER" } },
      }),
    ).toThrow(/incomplete/iu);
  });

  it("requires verified dynamic lineage before translating vault events", () => {
    const input = event(
      "ClassicV3RewardVault",
      "CreatorFeesCheckpointed",
      {
        poolId: POOL,
        configurationEpoch: "1",
        amount: "10",
        totalCreatorFeesReceived: "10",
      },
      1,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "classic-v3",
    );
    input.candidate.releaseHint = { model: "unresolved", releaseVersion: "unresolved" };
    input.evidence = {
      ...input.evidence,
      sourceKind: "dynamic-unresolved",
    };
    expect(() => translateProjectorEvent(input)).toThrow(/dynamic|attestation/iu);
  });

  it("requires the Classic v3 vault parent and preserves directional fees", () => {
    const result = foldProjectorEvents({
      events: classicV3UnlockedLaunchEvents(),
      tokenMetadata: { [TOKEN]: { name: "Directional", symbol: "DIR" } },
    });
    expect(result.launches).toHaveLength(1);
    expect(result.launches[0]).toMatchObject({
      releaseVersion: "classic-v3",
      rewardVault: V3_VAULT,
      feeConfiguration: {
        buySwapFeeBps: "300",
        sellSwapFeeBps: "500",
        buyCreatorFeeBps: "290",
        sellCreatorFeeBps: "490",
      },
      custody: {
        address: ZERO,
        mode: "0",
        vestingSourceCandidateId: null,
      },
    });
    expect(result.launches[0]!.occurrenceRoles).toContainEqual({
      sourceRole: "vault_factory",
      candidateId: classicV3UnlockedLaunchEvents()[0]!.candidate.candidateId,
    });
  });
});
