import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  keccak256,
  stringToHex,
  type Address,
} from "viem";

import { encodeClassicV4Launch } from "../lib/classic-v4";
import {
  validatePreparedClassicV4LaunchTransaction,
  validatePreparedClassicV4LaunchTransactionAgainstPublicRelease,
} from "../lib/classic-v3-launch-validation";
import { CLASSIC_V4_PUBLIC_RELEASE_BINDING } from "../lib/classic-v4-public-release";
import {
  isClassicV4PublicActionRelease,
  parseClassicV4PendingRelease,
  parseClassicV4PublicRelease,
  promoteClassicV4ReleaseToPublicAvailability,
} from "../lib/classic-v4-release";
import {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
} from "../scripts/classic-v4-digest.mjs";
import { createClassicV3Draft, type LaunchDraft } from "../lib/launch";
import { buildPlanHash } from "../lib/launch-transaction";
import { POST } from "../app/api/launch/preflight/route";

const account = "0x1111111111111111111111111111111111111111" as Address;
const launcher = "0x4444444444444444444444444444444444444444" as Address;
const salt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function digest(
  value: Record<string, unknown>,
  omittedKey?: string,
  domain = CLASSIC_V4_DIGEST_DOMAINS.releaseManifest,
) {
  const unsigned = { ...value };
  if (omittedKey) delete unsigned[omittedKey];
  return digestJson(unsigned, domain);
}

function hash(label: string) {
  return keccak256(stringToHex(`classic-v4-preflight:${label}`));
}

function address(index: number) {
  return `0x${index.toString(16).padStart(40, "0")}` as Address;
}

function activeReleaseManifest() {
  const newContracts = [
    "hookFactory",
    "feeHook",
    "positionPlanner",
    "graduationVaultFactory",
    "launcher",
  ] as const;
  const sharedContracts = [
    "ctoAuthority",
    "rewardVaultFactory",
    "initialBuyVestingWalletFactory",
    "launchPolicy",
    "positionForwarderFactory",
  ] as const;
  const deploymentBlocks = {
    hookFactory: 25_700_100,
    feeHook: 25_700_101,
    positionPlanner: 25_700_102,
    graduationVaultFactory: 25_700_103,
    launcher: 25_700_104,
  };
  const runtimeCodeHashes = Object.fromEntries(
    [...sharedContracts, ...newContracts].map((name) => [
      name,
      hash(`${name}:runtime`),
    ]),
  );
  const addresses = {
    deployer: address(20),
    launcherFeeRecipient:
      "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    ctoAuthority: address(1),
    rewardVaultFactory: address(2),
    initialBuyVestingWalletFactory: address(3),
    launchPolicy: address(4),
    positionForwarderFactory: address(5),
    hookFactory: address(6),
    feeHook: address(7),
    positionPlanner: address(8),
    graduationVaultFactory: address(9),
    launcher,
  };
  const deploymentTransactions = Object.fromEntries(
    newContracts.map((name) => [name, hash(`${name}:deployment`)]),
  );
  const verificationBlock = 25_700_150;
  const deploymentVerification = {
    evidenceDigest: hash("deployment-evidence"),
    checkedAt: "2026-08-27T10:04:00.000Z",
    verificationBlock,
    verificationBlockHash: hash("verification-block"),
    contractBlockHashes: Object.fromEntries(
      newContracts.map((name) => [name, hash(`${name}:block`)]),
    ),
    confirmations: Object.fromEntries(
      newContracts.map((name) => [
        name,
        verificationBlock - deploymentBlocks[name] + 1,
      ]),
    ),
  };
  const planDigest = hash("plan");
  const sourceCommitment = hash("source");
  const sourceUnsigned = {
    schemaVersion: 1,
    chainId: 1,
    planDigest,
    sourceCommitment,
    status: "verified",
    checkedAt: "2026-08-27T10:05:00.000Z",
    contracts: Object.fromEntries(
      newContracts.map((name) => [
        name,
        {
          address: addresses[name],
          contractName: name,
          fqcn: `src/${name}.sol:${name}`,
          encodedConstructorArguments: "0x",
          deploymentTransaction: deploymentTransactions[name],
          deploymentBlock: deploymentBlocks[name],
          status: "exact-match",
          providers: [
            {
              name: "Sourcify",
              status: "exact-match",
              url: `https://repo.sourcify.dev/contracts/full_match/1/${addresses[name]}/`,
            },
          ],
        },
      ]),
    ),
  };
  const sourceVerification = {
    ...sourceUnsigned,
    evidenceDigest: digest(
      sourceUnsigned,
      undefined,
      CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
    ),
  };
  const actionNames = [
    "launch",
    "buyExactInput",
    "buyExactOutput",
    "sellExactInput",
    "sellExactOutput",
    "creatorClaim",
    "launcherClaim",
  ] as const;
  const lifecycleVerificationBlock = 25_700_220;
  const actionEvents = {
    launch: [
      "MemeTokenLaunchedV2",
      "MemeLiquidityConfiguredV2",
      "MemeCreatorInitialBuyV2",
      "MemeCreatorInitialBuyCustodyV2",
      "MemeBondingConfiguredV1",
      "PoolRegistered",
      "PoolFeeDisclosure",
      "ClassicBondingConfigured",
      "ClassicBondingPositionActivated",
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    buyExactInput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    buyExactOutput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    sellExactInput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    sellExactOutput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    creatorClaim: [
      "CreatorFeesClaimed",
      "CreatorFeesCheckpointed",
      "BeneficiaryFeesClaimed",
    ],
    launcherClaim: ["LauncherFeesClaimed"],
  } as const;
  const swapIdentities = {
    buyExactInput: ["buy", "exact-input"],
    buyExactOutput: ["buy", "exact-output"],
    sellExactInput: ["sell", "exact-input"],
    sellExactOutput: ["sell", "exact-output"],
  } as const;
  const timestamps = Object.fromEntries(
    actionNames.map((name, index) => [
      name,
      (1_788_000_000n + BigInt(index) * 12n).toString(),
    ]),
  ) as Record<(typeof actionNames)[number], string>;
  const actions = Object.fromEntries(
    actionNames.map((name, index) => {
      const blockNumber = 25_700_200 + index;
      const swapIdentity =
        swapIdentities[name as keyof typeof swapIdentities];
      const values = {
        launch: "600000000000000",
        buyExactInput: "100000000000000",
        buyExactOutput: "1010000000",
        sellExactInput: "0",
        sellExactOutput: "0",
        creatorClaim: "0",
        launcherClaim: "0",
      } as const;
      const target =
        name === "launch"
          ? launcher
          : swapIdentity
            ? "0xd92A36B0000531EF3063dEd4De20A0783308446C"
            : name === "creatorClaim"
              ? address(31)
              : addresses.feeHook;
      return [
        name,
        {
          transactionHash: hash(`action:${name}`),
          inputHash: hash(`input:${name}`),
          blockNumber,
          blockHash: hash(`block:${name}`),
          blockTimestamp: timestamps[name],
          transactionIndex: index,
          nonce: name === "launcherClaim" ? 77 : 100 + index,
          from:
            name === "launcherClaim"
              ? addresses.launcherFeeRecipient
              : account,
          to: target,
          value: values[name],
          confirmations: lifecycleVerificationBlock - blockNumber + 1,
          success: true,
          events: Object.fromEntries(
            actionEvents[name].map((event, eventIndex) => [event, eventIndex]),
          ),
          ...(swapIdentity
            ? { side: swapIdentity[0], exactness: swapIdentity[1] }
            : {}),
        },
      ];
    }),
  ) as unknown as Record<
    (typeof actionNames)[number],
    Record<string, unknown>
  >;
  const grossSplit = (gross: bigint, bps: number) => {
    const total = (gross * BigInt(bps)) / 10_000n;
    const launcherFee = (gross * 10n) / 10_000n;
    return { creator: total - launcherFee, launcher: launcherFee, total };
  };
  const netSplit = (net: bigint, bps: number) => {
    const denominator = 10_000n - BigInt(bps);
    const gross = (net * 10_000n + denominator - 1n) / denominator;
    const total = gross - net;
    const launcherFee = (gross * 10n) / 10_000n;
    return {
      creator: total - launcherFee,
      launcher: launcherFee,
      total,
      gross,
    };
  };
  const buyExactInputFee = grossSplit(100_000_000_000_000n, 100);
  const buyExactOutputFee = netSplit(990_000_000n, 100);
  const sellExactInputFee = grossSplit(1_000_000_000n, 200);
  const sellExactOutputFee = netSplit(1_000_000_000n, 200);
  const swapRows = {
    buyExactInput: {
      side: "buy",
      exactness: "exact-input",
      poolAmount0: "-99000000000000",
      poolAmount1: "70000000000000000000000",
      grossNativeAmount: "100000000000000",
      inputBound: "100000000000000",
      outputBound: "69300000000000000000000",
      quotedAmount: "70000000000000000000000",
      fee: buyExactInputFee,
    },
    buyExactOutput: {
      side: "buy",
      exactness: "exact-output",
      poolAmount0: "-990000000",
      poolAmount1: "1000000000000000000",
      grossNativeAmount: buyExactOutputFee.gross.toString(),
      inputBound: "1010000000",
      outputBound: "1000000000000000000",
      quotedAmount: "1000000000",
      fee: buyExactOutputFee,
    },
    sellExactInput: {
      side: "sell",
      exactness: "exact-input",
      poolAmount0: "1000000000",
      poolAmount1: "-1000000000000000000",
      grossNativeAmount: "1000000000",
      inputBound: "1000000000000000000",
      outputBound: "970200000",
      quotedAmount: "980000000",
      fee: sellExactInputFee,
    },
    sellExactOutput: {
      side: "sell",
      exactness: "exact-output",
      poolAmount0: sellExactOutputFee.gross.toString(),
      poolAmount1: "-750000000000000000000",
      grossNativeAmount: sellExactOutputFee.gross.toString(),
      inputBound: "757500000000000000000",
      outputBound: "1000000000",
      quotedAmount: "750000000000000000000",
      fee: sellExactOutputFee,
    },
  } as const;
  const swaps = Object.fromEntries(
    Object.entries(swapRows).map(([name, row]) => {
      const exactInput = row.exactness === "exact-input";
      return [
        name,
        {
          side: row.side,
          exactness: row.exactness,
          poolAmount0: row.poolAmount0,
          poolAmount1: row.poolAmount1,
          grossNativeAmount: row.grossNativeAmount,
          creatorFee: row.fee.creator.toString(),
          launcherFee: row.fee.launcher.toString(),
          totalFee: row.fee.total.toString(),
          appliedTotalSwapFeeBps: row.side === "buy" ? 100 : 200,
          inputBound: row.inputBound,
          outputBound: row.outputBound,
          routerDeadline: (BigInt(timestamps[name as keyof typeof timestamps]) + 300n).toString(),
          executionPath: "single-hop-all",
          quote: {
            policy: "canonical-v4-quoter-at-parent-block",
            function: `V4Quoter.${
              exactInput ? "quoteExactInputSingle" : "quoteExactOutputSingle"
            }`,
            blockNumber:
              Number(actions[name as keyof typeof actions].blockNumber) - 1,
            blockHash: hash(`quote-block:${name}`),
            exactAmount: exactInput
              ? row.inputBound
              : row.outputBound,
            quotedAmount: row.quotedAmount,
            gasEstimate: "100000",
            slippageBps: 100,
            bound: exactInput ? row.outputBound : row.inputBound,
          },
        },
      ];
    }),
  ) as unknown as Record<
    keyof typeof swapRows,
    Record<string, unknown>
  >;
  const initialFee = grossSplit(600_000_000_000_000n, 100);
  const creatorTotal =
    initialFee.creator +
    Object.values(swapRows).reduce((sum, row) => sum + row.fee.creator, 0n);
  const launcherTotal =
    initialFee.launcher +
    Object.values(swapRows).reduce((sum, row) => sum + row.fee.launcher, 0n);
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const hookSnapshot = (
    registered: boolean,
    creator: bigint,
    launcherFees: bigint,
  ) => ({
    rewardVault: registered ? address(31) : zeroAddress,
    registrar: registered ? launcher : zeroAddress,
    buySwapFeeBps: registered ? 100 : 0,
    sellSwapFeeBps: registered ? 200 : 0,
    registered,
    creatorFeesAccrued: creator.toString(),
    launcherFeesAccrued: launcherFees.toString(),
    totalNativeFeesAccrued: (creator + launcherFees).toString(),
    poolManagerNativeClaims: (creator + launcherFees).toString(),
    poolManagerTokenClaims: "0",
    rawNativeBalance: "0",
  });
  const vaultSnapshot = (amount: bigint) => ({
    totalCreatorFeesReceived: amount.toString(),
    totalCreatorFeesClaimed: amount.toString(),
    beneficiaryClaimed: amount.toString(),
    beneficiaryClaimable: "0",
    rawNativeBalance: "0",
  });
  const lifecycleUnsigned = {
    schemaVersion: 1,
    chainId: 1,
    planDigest,
    sourceCommitment,
    status: "verified-current-release",
    checkedAt: "2026-08-27T10:10:00.000Z",
    independentRpcCount: 2,
    releaseEligible: true,
    canaryPlanDigest: hash("canary-plan"),
    releaseBindingDigest: hash("release-binding"),
    deploymentEvidenceDigest: deploymentVerification.evidenceDigest,
    sourceEvidenceDigest: sourceVerification.evidenceDigest,
    verificationBlock: lifecycleVerificationBlock,
    verificationBlockHash: hash("lifecycle-verification-block"),
    latestLifecycleBlock: actions.launcherClaim.blockNumber,
    confirmations: actions.launcherClaim.confirmations,
    operatorWallet: account,
    launcher,
    feeHook: addresses.feeHook,
    canaryToken: address(30),
    rewardVault: address(31),
    poolId: hash("pool"),
    positionRecipient: address(32),
    finalPositionRecipient: address(33),
    positionTokenId: "42",
    actions,
    swaps,
    claims: {
      creator: {
        amount: creatorTotal.toString(),
        vaultCheckpointAmount: creatorTotal.toString(),
        beneficiaryAmount: creatorTotal.toString(),
      },
      launcher: { amount: launcherTotal.toString() },
    },
    postState: {
      launchMappings: {
        launchHash: hash("launch-hash"),
        rewardVault: address(31),
        initialBuyCustody: zeroAddress,
        graduationVault: address(32),
        finalPositionRecipient: address(33),
      },
      poolFeeConfig: {
        rewardVault: address(31),
        registrar: launcher,
        buySwapFeeBps: 100,
        sellSwapFeeBps: 200,
        registered: true,
        creatorFeesAccrued: "0",
      },
      rewardVault: {
        configurationHash: hash("vault-config"),
        activeConfigurationHash: hash("vault-active-config"),
        configurationEpoch: 1,
        beneficiary: account,
        shareBps: 10_000,
      },
      bondingLifecycle: {
        graduationVault: address(32),
        finalPositionRecipient: address(33),
        factory: addresses.graduationVaultFactory,
        factoryConfigurationHash: hash("graduation-vault-factory-config"),
        poolId: hash("pool"),
        state: "bonding",
        progressBps: 12,
        tokenRemaining: "799000000000000000000000000",
        nativeRemainingNet: "4700000000000000000",
        graduated: false,
        finalPositionTokenId: "0",
      },
      positionLock: {
        owner: address(32),
        approved: zeroAddress,
        tokenId: "42",
        positionLiquidity: "1000000",
        activePoolLiquidity: "1000000",
        tickLower: 174_800,
        tickUpper: 204_200,
        finalPositionRecipient: address(33),
        manager: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
        operator: zeroAddress,
        timelockBlockNumber: ((1n << 256n) - 1n).toString(),
        feeRecipient: account,
        factoryConfigurationHash: hash("forwarder-config"),
      },
      tokenCustody: {
        totalSupply: (1_000_000_000n * 10n ** 18n).toString(),
        lockedTokenDust: "1",
        launcherBalance: "0",
        positionManagerBalance: "0",
      },
      derivedCodeHashes: {
        token: hash("token-code"),
        rewardVault: hash("vault-code"),
        graduationVault: hash("graduation-vault-code"),
        positionForwarder: hash("forwarder-code"),
        rewardVaultPredeployed: false,
        graduationVaultPredeployed: false,
        positionForwarderPredeployed: false,
      },
    },
    feeConservation: {
      creatorAccrualTotal: creatorTotal.toString(),
      launcherAccrualTotal: launcherTotal.toString(),
      totalAccrual: (creatorTotal + launcherTotal).toString(),
      checkpoints: {
        preLaunch: {
          blockNumber: Number(actions.launch.blockNumber) - 1,
          hook: hookSnapshot(false, 0n, 0n),
        },
        beforeCreatorClaim: {
          blockNumber: Number(actions.creatorClaim.blockNumber) - 1,
          hook: hookSnapshot(true, creatorTotal, launcherTotal),
          vault: vaultSnapshot(0n),
        },
        afterCreatorClaim: {
          blockNumber: Number(actions.creatorClaim.blockNumber),
          hook: hookSnapshot(true, 0n, launcherTotal),
          vault: vaultSnapshot(creatorTotal),
        },
        beforeLauncherClaim: {
          blockNumber: Number(actions.launcherClaim.blockNumber) - 1,
          hook: hookSnapshot(true, 0n, launcherTotal),
        },
        final: {
          blockNumber: lifecycleVerificationBlock,
          hook: hookSnapshot(true, 0n, 0n),
          vault: vaultSnapshot(creatorTotal),
        },
      },
    },
    observations: {
      exclusiveHookActivity: {
        fromBlock: actions.launch.blockNumber,
        toBlock: lifecycleVerificationBlock,
        nativeAccrualEvents: 5,
        creatorClaimEvents: 1,
        launcherClaimEvents: 1,
      },
      sellApprovals: Object.fromEntries(
        (["sellExactInput", "sellExactOutput"] as const).map((name) => [
          name,
          {
            blockNumber: Number(actions[name].blockNumber) - 1,
            erc20AllowanceToPermit2: swaps[name].inputBound,
            permit2AllowanceToRouter: swaps[name].inputBound,
            permit2Expiration: (
              BigInt(timestamps[name]) + 1_000n
            ).toString(),
            permit2Nonce: "1",
            requiredAmount: swaps[name].inputBound,
          },
        ]),
      ),
    },
    invariants: {
      launchVerified: true,
      bondingLifecycleVerified: true,
      positionLockVerified: true,
      buyExactInputVerified: true,
      buyExactOutputVerified: true,
      sellExactInputVerified: true,
      sellExactOutputVerified: true,
      creatorClaimVerified: true,
      launcherClaimVerified: true,
      feeConservationVerified: true,
    },
  };
  const lifecycleEvidence = {
    ...lifecycleUnsigned,
    evidenceDigest: digest(
      lifecycleUnsigned,
      undefined,
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
    ),
  };
  const releaseCommit = "1".repeat(40);
  const manifest = {
    schemaVersion: 1,
    model: "classic",
    internalContractRelease: "classic-v4",
    releaseStatus: "indexer-activated",
    chainId: 1,
    releaseCommit,
    releaseTree: "2".repeat(40),
    sourceCommitment,
    planDigest,
    capturedAt: "2026-08-27T10:10:00.000Z",
    startBlock: deploymentBlocks.hookFactory,
    addresses,
    deploymentTransactions,
    deploymentBlocks,
    deploymentVerification,
    runtimeCodeHashes,
    runtimeTemplateHashes: Object.fromEntries(
      newContracts.map((name) => [name, hash(`${name}:template`)]),
    ),
    officialDependencies: {
      poolManager: {
        address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
        runtimeCodeHash:
          "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
      },
      positionManager: {
        address: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
        runtimeCodeHash:
          "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
      },
      stateView: {
        address: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
        runtimeCodeHash:
          "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
      },
      v4Quoter: {
        address: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
        runtimeCodeHash:
          "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
      },
      uerc20Factory: {
        address: "0x000000e200088D55C39a11F609E5F667729ad49b",
        runtimeCodeHash:
          "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
      },
      permit2: {
        address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        runtimeCodeHash:
          "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
      },
      universalRouter: {
        address: "0xd92A36B0000531EF3063dEd4De20A0783308446C",
        runtimeCodeHash:
          "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
      },
    },
    sharedDependencies: Object.fromEntries(
      sharedContracts.map((name) => [
        name,
        {
          address: addresses[name],
          runtimeCodeHash: runtimeCodeHashes[name],
        },
      ]),
    ),
    verification: {
      deploymentLive: true,
      deploymentFinalized: true,
      independentRpcCount: 2,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      sourceVerified: true,
      lifecycleVerified: true,
      indexerActivated: true,
      publicAvailable: false,
    },
    sourceVerification,
    lifecycleEvidence,
    indexerHandoff: {
      schemaVersion: 1,
      chainId: 1,
      model: "classic",
      releaseVersion: "classic-v4",
      releaseCommit,
      sourceCommitment,
      startBlock: deploymentBlocks.hookFactory,
      sources: {
        launcher: {
          address: launcher,
          startBlock: deploymentBlocks.launcher,
          events: [
            "MemeTokenLaunchedV2",
            "MemeLiquidityConfiguredV2",
            "MemeCreatorInitialBuyV2",
            "MemeCreatorInitialBuyCustodyV2",
            "MemeBondingConfiguredV1",
          ],
        },
        feeHook: {
          address: addresses.feeHook,
          startBlock: deploymentBlocks.feeHook,
          events: [
            "PoolRegistered",
            "PoolFeeDisclosure",
            "NativeSwapFeesAccrued",
            "CreatorFeesClaimed",
            "LauncherFeesClaimed",
            "ClassicBondingConfigured",
            "ClassicBondingPositionActivated",
            "ClassicBondingReached",
            "ClassicGraduationBegun",
            "ClassicLiquidityGraduated",
          ],
        },
      },
      sourceVerified: true,
      lifecycleVerified: true,
      activationEligible: true,
      indexerBindingDigest: `0x${"8f".repeat(32)}`,
      activated: true,
    },
  };
  return { ...manifest, manifestDigest: digest(manifest) };
}

function publiclyAvailableReleaseManifest() {
  const manifest = structuredClone(activeReleaseManifest());
  Object.assign(manifest, { releaseStatus: "publicly-available" });
  Object.assign(manifest.verification, { publicAvailable: true });
  manifest.manifestDigest = digest(manifest, "manifestDigest");
  return manifest;
}

function v4Draft(): LaunchDraft {
  return {
    ...createClassicV3Draft(),
    classicContractRelease: "classic-v4",
    tokenName: "Directional",
    tokenSymbol: "DIR",
    tokenDescription: "Immutable directional fees",
    initialBuyEth: "0.0006",
    launchSalt: salt,
  };
}

describe("Classic V4 release and launch preflight", () => {
  it("rejects an unknown contract release instead of silently using V3", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/launch/preflight", {
        method: "POST",
        body: JSON.stringify({
          account,
          walletChainId: "0x1",
          draft: {
            ...v4Draft(),
            classicContractRelease: "classic-v5",
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Refresh the Classic launch setup",
    });
  });

  it("accepts only a complete indexer-activated release manifest", () => {
    const manifest = activeReleaseManifest();
    expect(parseClassicV4PublicRelease(manifest)).toMatchObject({
      releaseStatus: "indexer-activated",
      verification: { indexerActivated: true, publicAvailable: false },
    });

    const parsedIndexerRelease = parseClassicV4PublicRelease(manifest);
    expect(isClassicV4PublicActionRelease(parsedIndexerRelease)).toBe(false);

    const publicManifest = publiclyAvailableReleaseManifest();
    const parsedPublicRelease = parseClassicV4PublicRelease(publicManifest);
    expect(parsedPublicRelease).toMatchObject({
      releaseStatus: "publicly-available",
      verification: { indexerActivated: true, publicAvailable: true },
    });
    expect(isClassicV4PublicActionRelease(parsedPublicRelease)).toBe(true);

    const pending = structuredClone(manifest);
    Object.assign(pending, {
      releaseStatus: "deployment-source-and-lifecycle-verified",
    });
    Object.assign(pending.verification, { indexerActivated: false });
    Object.assign(pending.indexerHandoff, {
      indexerBindingDigest: null,
      activated: false,
    });
    pending.manifestDigest = digest(pending, "manifestDigest");
    expect(parseClassicV4PendingRelease(pending)).toMatchObject({
      releaseStatus: "deployment-source-and-lifecycle-verified",
      verification: { indexerActivated: false, publicAvailable: false },
      indexerHandoff: { indexerBindingDigest: null, activated: false },
    });
    expect(parseClassicV4PublicRelease(pending)).toBeNull();

    const forgedLifecycle = structuredClone(manifest);
    Object.assign(
      forgedLifecycle.lifecycleEvidence.actions.sellExactOutput,
      { success: false },
    );
    forgedLifecycle.lifecycleEvidence.evidenceDigest = digest(
      forgedLifecycle.lifecycleEvidence,
      "evidenceDigest",
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
    );
    forgedLifecycle.manifestDigest = digest(
      forgedLifecycle,
      "manifestDigest",
    );
    expect(parseClassicV4PublicRelease(forgedLifecycle)).toBeNull();

    const forgedFinality = structuredClone(manifest);
    forgedFinality.deploymentVerification.confirmations.launcher += 1;
    forgedFinality.manifestDigest = digest(
      forgedFinality,
      "manifestDigest",
    );
    expect(parseClassicV4PublicRelease(forgedFinality)).toBeNull();

    const missingFinality = structuredClone(manifest) as Record<
      string,
      unknown
    >;
    delete missingFinality.deploymentVerification;
    missingFinality.manifestDigest = digest(
      missingFinality,
      "manifestDigest",
    );
    expect(parseClassicV4PublicRelease(missingFinality)).toBeNull();
  });

  it("binds wallet review to V4 calldata, activation buy and release proof", () => {
    const draft = v4Draft();
    const data = encodeClassicV4Launch(draft, salt, account);
    const transaction = {
      kind: "launch" as const,
      chainId: 1 as const,
      to: launcher as Address,
      data,
      value: "600000000000000",
      gasLimit: "5000000",
    };
    const planHash = buildPlanHash(account, {
      kind: "launch",
      chainId: 1,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    });
    const indexerManifest = activeReleaseManifest();
    const indexerInput = {
      transaction,
      draft,
      account,
      planHash,
      releaseLauncher: indexerManifest.addresses.launcher,
      releaseManifestDigest: indexerManifest.manifestDigest,
    };
    expect(() =>
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        indexerInput,
        {
          chainId: 1,
          launcher: indexerManifest.addresses.launcher,
          manifestDigest: indexerManifest.manifestDigest,
          releaseStatus: "indexer-activated",
          publicAvailable: false,
        },
      ),
    ).toThrow("browser release binding");

    const manifest = publiclyAvailableReleaseManifest();
    const input = {
      transaction,
      draft,
      account,
      planHash,
      releaseLauncher: manifest.addresses.launcher,
      releaseManifestDigest: manifest.manifestDigest,
    };

    const browserBinding = {
      chainId: 1 as const,
      launcher: manifest.addresses.launcher,
      manifestDigest: manifest.manifestDigest,
      releaseStatus: "publicly-available" as const,
      publicAvailable: true as const,
    };
    expect(
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        input,
        browserBinding,
      ),
    ).toEqual(transaction);
    expect(CLASSIC_V4_PUBLIC_RELEASE_BINDING).toBeNull();
    expect(() => validatePreparedClassicV4LaunchTransaction(input)).toThrow(
      "browser release binding",
    );
    expect(() =>
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        {
          ...input,
          releaseManifestDigest: undefined,
        },
        browserBinding,
      ),
    ).toThrow("browser release binding");
    expect(() =>
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        {
          ...input,
          releaseLauncher: address(99),
        },
        browserBinding,
      ),
    ).toThrow("browser V4 release binding");
    expect(() =>
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        input,
        { ...browserBinding, manifestDigest: hash("another manifest") },
      ),
    ).toThrow("browser V4 release binding");
  });

  it("promotes the exact indexer manifest and derives its browser binding", () => {
    const indexed = activeReleaseManifest();
    const originalDigest = indexed.manifestDigest;
    const promotion = promoteClassicV4ReleaseToPublicAvailability(indexed);

    expect(promotion).not.toBeNull();
    expect(indexed).toMatchObject({
      releaseStatus: "indexer-activated",
      manifestDigest: originalDigest,
      verification: { publicAvailable: false },
    });
    expect(promotion?.release).toMatchObject({
      releaseStatus: "publicly-available",
      verification: { publicAvailable: true },
    });
    expect(promotion?.release.manifestDigest).not.toBe(originalDigest);
    expect(promotion?.release.manifestDigest).toBe(
      digest(promotion!.release, "manifestDigest"),
    );
    expect(promotion?.browserBinding).toEqual({
      chainId: 1,
      launcher: promotion?.release.addresses.launcher,
      manifestDigest: promotion?.release.manifestDigest,
      releaseStatus: "publicly-available",
      publicAvailable: true,
    });
    expect(parseClassicV4PublicRelease(promotion?.release)).toEqual(
      promotion?.release,
    );
    expect(
      isClassicV4PublicActionRelease(promotion?.release),
    ).toBe(true);
    expect(
      promoteClassicV4ReleaseToPublicAvailability(promotion?.release),
    ).toBeNull();
  });
});
