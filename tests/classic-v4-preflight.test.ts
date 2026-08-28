import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";

vi.mock("server-only", () => ({}));

import {
  CLASSIC_V4_LAUNCH_STAMP_ROUTER,
  classicV4LaunchAbi,
  encodeClassicV4Launch,
} from "../lib/classic-v4";
import {
  validatePreparedClassicV4LaunchTransaction,
  validatePreparedClassicV4LaunchTransactionAgainstPublicRelease,
} from "../lib/classic-v3-launch-validation";
import { CLASSIC_V4_PUBLIC_RELEASE_BINDING } from "../lib/classic-v4-public-release";
import {
  getConfiguredClassicV4PublicRelease,
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
const zeroAddress = "0x0000000000000000000000000000000000000000";

const routerAbi = parseAbi([
  "function launchAndStampV1((uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value) permit,(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bytes32 hookRuntimeCodeHash,(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)[] components) stampRequest,bytes routePayload,bytes signature) payable returns (bytes32 stampHash)",
]);
const routerPermitTypes = {
  ProgrammableLaunchPermitV1: [
    { name: "chainId", type: "uint256" },
    { name: "router", type: "address" },
    { name: "launchWallet", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "routePayloadHash", type: "bytes32" },
    { name: "expectedResultHash", type: "bytes32" },
    { name: "stampRequestHash", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "validAfter", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "value", type: "uint256" },
  ],
} as const;
const routeParameters = parseAbiParameters(
  "(address launcher,bytes32 launcherRuntimeCodeHash,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters,(address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) expectedResult) route",
);
const resultAddressesTypehash = keccak256(
  stringToHex(
    "ProgrammableClassicResultAddressesV1(address token,address rewardVault,address positionRecipient,address initialBuyCustody)",
  ),
);
const resultAmountsTypehash = keccak256(
  stringToHex(
    "ProgrammableClassicResultAmountsV1(uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount)",
  ),
);
const resultTypehash = keccak256(
  stringToHex(
    "ProgrammableClassicLaunchResultV1(bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash)",
  ),
);
const componentTypehash = keccak256(
  stringToHex(
    "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
  ),
);
const poolKeyTypehash = keccak256(
  stringToHex(
    "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
  ),
);
const stampRequestTypehash = keccak256(
  stringToHex(
    "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
  ),
);

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

function activeReleaseManifest(
  sourceMatchTier: "match" | "exact-match" = "exact-match",
) {
  const newContracts = [
    "hookFactory",
    "feeHook",
    "positionPlanner",
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
    launcher: 25_700_103,
  };
  const runtimeCodeHashes = Object.fromEntries(
    [...sharedContracts, ...newContracts].map((name) => [
      name,
      hash(`${name}:runtime`),
    ]),
  );
  const addresses = {
    deployer: address(20),
    launcherFeeRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    ctoAuthority: address(1),
    rewardVaultFactory: address(2),
    initialBuyVestingWalletFactory: address(3),
    launchPolicy: address(4),
    positionForwarderFactory: address(5),
    hookFactory: address(6),
    feeHook: address(7),
    positionPlanner: address(8),
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
          status: sourceMatchTier,
          providers: [
            {
              name: "Sourcify",
              status: sourceMatchTier,
              url: `https://sourcify.dev/server/v2/contract/1/${addresses[name]}`,
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
  const releaseBindingDigest = digestJson(
    {
      planDigest,
      deploymentEvidenceDigest: deploymentVerification.evidenceDigest,
      sourceEvidenceDigest: sourceVerification.evidenceDigest,
    },
    CLASSIC_V4_DIGEST_DOMAINS.releaseBinding,
  );
  const launchTimestamp = 1_788_000_000n;
  const launchValidAfter = launchTimestamp - 30n;
  const launchDeadline = launchTimestamp + 300n;
  const canaryCreatorSalt = digestJson(
    {
      purpose: "programmable-classic-v4-mainnet-lifecycle-canary",
      releaseBindingDigest,
      operatorWallet: account,
    },
    CLASSIC_V4_DIGEST_DOMAINS.canaryCreatorSalt,
  );
  const routerLaunch = preparedV4RouterTransaction(
    classicV4CanaryDraft(),
    {
      addresses: {
        launcher: addresses.launcher,
        feeHook: addresses.feeHook,
      },
      runtimeCodeHashes: {
        launcher: runtimeCodeHashes.launcher,
        feeHook: runtimeCodeHashes.feeHook,
      },
    },
    { validAfter: launchValidAfter, deadline: launchDeadline },
    canaryCreatorSalt,
  );
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
      "ProgrammableComponentStampedV1.token",
      "ProgrammableComponentStampedV1.rewardVault",
      "ProgrammableComponentStampedV1.positionRecipient",
      "ProgrammableComponentStampedV1.feeHook",
      "ProgrammableLaunchRouteStampedV1",
      "ProgrammableLaunchStampedV1",
      "MemeTokenLaunchedV2",
      "MemeLiquidityConfiguredV2",
      "MemeCreatorInitialBuyV2",
      "MemeCreatorInitialBuyCustodyV2",
      "PoolRegistered",
      "PoolFeeDisclosure",
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
      (launchTimestamp + BigInt(index) * 12n).toString(),
    ]),
  ) as Record<(typeof actionNames)[number], string>;
  const actions = Object.fromEntries(
    actionNames.map((name, index) => {
      const blockNumber = 25_700_200 + index;
      const swapIdentity = swapIdentities[name as keyof typeof swapIdentities];
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
          ? CLASSIC_V4_LAUNCH_STAMP_ROUTER
          : swapIdentity
            ? "0xd92A36B0000531EF3063dEd4De20A0783308446C"
            : name === "creatorClaim"
              ? address(31)
              : addresses.feeHook;
      return [
        name,
        {
          transactionHash: hash(`action:${name}`),
          inputHash:
            name === "launch"
              ? keccak256(routerLaunch.transaction.data)
              : hash(`input:${name}`),
          blockNumber,
          blockHash: hash(`block:${name}`),
          blockTimestamp: timestamps[name],
          transactionIndex: index,
          nonce: name === "launcherClaim" ? 77 : 100 + index,
          from:
            name === "launcherClaim" ? addresses.launcherFeeRecipient : account,
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
  ) as unknown as Record<(typeof actionNames)[number], Record<string, unknown>>;
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
          routerDeadline: (
            BigInt(timestamps[name as keyof typeof timestamps]) + 300n
          ).toString(),
          executionPath: "single-hop-all",
          quote: {
            policy: "canonical-v4-quoter-at-parent-block",
            function: `V4Quoter.${
              exactInput ? "quoteExactInputSingle" : "quoteExactOutputSingle"
            }`,
            blockNumber:
              Number(actions[name as keyof typeof actions].blockNumber) - 1,
            blockHash: hash(`quote-block:${name}`),
            exactAmount: exactInput ? row.inputBound : row.outputBound,
            quotedAmount: row.quotedAmount,
            gasEstimate: "100000",
            slippageBps: 100,
            bound: exactInput ? row.outputBound : row.inputBound,
          },
        },
      ];
    }),
  ) as unknown as Record<keyof typeof swapRows, Record<string, unknown>>;
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
  const launchAuthorization = {
    schemaVersion: "programmable.classic-launch-authorization.v1",
    chainId: "1",
    releaseManifestDigest: releaseBindingDigest,
    predictedToken: routerLaunch.token,
    predictedHook: addresses.feeHook,
    permitDigest: routerLaunch.permitDigest,
    validAfter: launchValidAfter.toString(),
    deadline: launchDeadline.toString(),
    simulation: {
      blockNumber: (Number(actions.launch.blockNumber) - 1).toString(),
      blockHash: hash("launch-authorization-block"),
      blockTimestamp: (launchTimestamp - 1n).toString(),
      gasEstimate: "2000000",
      stampHash: hash("launch-authorization-stamp"),
    },
    transaction: {
      chainId: "1",
      from: account,
      to: routerLaunch.transaction.to,
      valueWei: routerLaunch.transaction.value,
      calldata: routerLaunch.transaction.data,
      gasLimit: routerLaunch.transaction.gasLimit,
    },
  };
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
    launchAuthorization,
    launchAuthorizationDigest: digest(
      launchAuthorization,
      undefined,
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleAuthorization,
    ),
    releaseBindingDigest,
    deploymentEvidenceDigest: deploymentVerification.evidenceDigest,
    sourceEvidenceDigest: sourceVerification.evidenceDigest,
    verificationBlock: lifecycleVerificationBlock,
    verificationBlockHash: hash("lifecycle-verification-block"),
    latestLifecycleBlock: actions.launcherClaim.blockNumber,
    confirmations: actions.launcherClaim.confirmations,
    operatorWallet: account,
    launcher,
    feeHook: addresses.feeHook,
    canaryToken: routerLaunch.expectedResult.token,
    rewardVault: routerLaunch.expectedResult.rewardVault,
    poolId: routerLaunch.expectedResult.poolId,
    positionRecipient: routerLaunch.expectedResult.positionRecipient,
    positionTokenId: routerLaunch.expectedResult.positionTokenId.toString(),
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
        launchHash: routerLaunch.expectedResult.launchHash,
        rewardVault: address(31),
        initialBuyCustody: zeroAddress,
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
      positionLock: {
        owner: address(32),
        approved: zeroAddress,
        tokenId: routerLaunch.expectedResult.positionTokenId.toString(),
        positionLiquidity: "1000000",
        activePoolLiquidity: "1000000",
        tickLower: 174_800,
        tickUpper: 204_200,
        manager: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
        operator: zeroAddress,
        timelockBlockNumber: ((1n << 256n) - 1n).toString(),
        feeRecipient: account,
        factoryConfigurationHash: hash("forwarder-config"),
      },
      tokenCustody: {
        totalSupply: (1_000_000_000n * 10n ** 18n).toString(),
        lockedTokenDust: routerLaunch.expectedResult.lockedTokenDust.toString(),
        launcherBalance: "0",
        positionManagerBalance: "0",
      },
      derivedCodeHashes: {
        token: routerLaunch.stampRequest.components.find(
          (component) => component.resultIndex === 0,
        )!.runtimeCodeHash,
        rewardVault: routerLaunch.stampRequest.components.find(
          (component) => component.resultIndex === 1,
        )!.runtimeCodeHash,
        positionForwarder: routerLaunch.stampRequest.components.find(
          (component) => component.resultIndex === 2,
        )!.runtimeCodeHash,
        rewardVaultPredeployed: false,
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
            permit2Expiration: (BigInt(timestamps[name]) + 1_000n).toString(),
            permit2Nonce: "1",
            requiredAmount: swaps[name].inputBound,
          },
        ]),
      ),
    },
    invariants: {
      launchVerified: true,
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

function classicV4CanaryDraft(): LaunchDraft {
  return {
    ...createClassicV3Draft(),
    classicContractRelease: "classic-v4",
    tokenName: "Programmable Classic V4 Canary",
    tokenSymbol: "PCV4C",
    tokenDescription: "Programmable Classic V4 Mainnet lifecycle canary",
    tokenWebsite: "https://programmable.market",
    tokenImage: "",
    buySwapFeePercent: "1",
    sellSwapFeePercent: "2",
    initialBuyEth: "0.0006",
  };
}

type RouterFixtureRelease = {
  addresses: { launcher: Address; feeHook: Address };
  runtimeCodeHashes: Record<string, Hex>;
};

type RouterFixtureVariant =
  | "valid"
  | "permit-kind"
  | "expected-result"
  | "stamp-token"
  | "component-kind"
  | "component-runtime"
  | "signature"
  | "wrong-canonical-signature"
  | "noncanonical";

function preparedV4RouterTransaction(
  draft: LaunchDraft,
  manifest: RouterFixtureRelease,
  permitWindow: { validAfter: bigint; deadline: bigint } = {
    validAfter: 100n,
    deadline: 430n,
  },
  creatorSalt: Hex = salt,
  variant: RouterFixtureVariant = "valid",
) {
  const initialBuy = 600_000_000_000_000n;
  const token = address(30);
  const rewardVault = address(31);
  const positionRecipient = address(32);
  const hook = manifest.addresses.feeHook;
  const poolKey = {
    currency0: zeroAddress as Address,
    currency1: token,
    fee: 0,
    tickSpacing: 200,
    hooks: hook,
  } as const;
  const poolId = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
      ),
      [
        poolKey.currency0,
        poolKey.currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
      ],
    ),
  );
  const expectedResult = {
    token,
    rewardVault,
    positionRecipient,
    positionTokenId: 123n,
    tokenLiquidityAmount: 999_999_999n * 10n ** 18n,
    lockedTokenDust: 1n * 10n ** 18n,
    initialBuyNativeAmount:
      variant === "expected-result" ? initialBuy + 1n : initialBuy,
    initialBuyTokenAmount: 42_000n * 10n ** 18n,
    initialBuyCustody: zeroAddress as Address,
    poolId,
    launchHash: hash("router-launch-result"),
  } as const;
  const tokenRuntimeCodeHash =
    variant === "component-runtime"
      ? hash("router-token-runtime-tampered")
      : hash("router-token-runtime");
  const hookRuntimeCodeHash = manifest.runtimeCodeHashes.feeHook;
  const components = [
    {
      resultIndex: 255,
      account: hook,
      runtimeCodeHash: hookRuntimeCodeHash,
      kind: 2,
      scope: 2,
    },
    {
      resultIndex: 0,
      account: token,
      runtimeCodeHash: tokenRuntimeCodeHash,
      kind: variant === "component-kind" ? 0 : 1,
      scope: 1,
    },
    {
      resultIndex: 1,
      account: rewardVault,
      runtimeCodeHash: hash("router-reward-runtime"),
      kind: 0,
      scope: 1,
    },
    {
      resultIndex: 2,
      account: positionRecipient,
      runtimeCodeHash: hash("router-position-runtime"),
      kind: 0,
      scope: 1,
    },
  ].sort((left, right) =>
    BigInt(left.account) < BigInt(right.account) ? -1 : 1,
  );
  const direct = decodeFunctionData({
    abi: classicV4LaunchAbi,
    data: encodeClassicV4Launch(draft, creatorSalt, account),
  });
  if (direct.functionName !== "launchFor") throw new Error("fixture");
  const route = {
    launcher: manifest.addresses.launcher,
    launcherRuntimeCodeHash: manifest.runtimeCodeHashes.launcher,
    parameters: direct.args[1],
    expectedResult,
  } as const;
  const routePayload = encodeAbiParameters(routeParameters, [route]);

  const addressesHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typehash,address token,address rewardVault,address positionRecipient,address initialBuyCustody",
      ),
      [
        resultAddressesTypehash,
        token,
        rewardVault,
        positionRecipient,
        zeroAddress,
      ],
    ),
  );
  const amountsHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typehash,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount",
      ),
      [
        resultAmountsTypehash,
        expectedResult.positionTokenId,
        expectedResult.tokenLiquidityAmount,
        expectedResult.lockedTokenDust,
        expectedResult.initialBuyNativeAmount,
        expectedResult.initialBuyTokenAmount,
      ],
    ),
  );
  const expectedResultHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typehash,bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash",
      ),
      [
        resultTypehash,
        addressesHash,
        amountsHash,
        expectedResult.poolId,
        expectedResult.launchHash,
      ],
    ),
  );
  const componentHashes = components.map((component) =>
    keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "bytes32 typehash,uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope",
        ),
        [
          componentTypehash,
          component.resultIndex,
          component.account,
          component.runtimeCodeHash,
          component.kind,
          component.scope,
        ],
      ),
    ),
  );
  const componentSetHash = keccak256(
    concat(componentHashes as [Hex, ...Hex[]]),
  );
  const poolKeyHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typehash,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
      ),
      [
        poolKeyTypehash,
        poolKey.currency0,
        poolKey.currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
      ],
    ),
  );
  const stampRequest = {
    launchId: hash("router-launch-id"),
    token: variant === "stamp-token" ? address(99) : token,
    tokenRuntimeCodeHash,
    poolKey,
    hookRuntimeCodeHash,
    components,
  } as const;
  const stampRequestHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typehash,bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash",
      ),
      [
        stampRequestTypehash,
        stampRequest.launchId,
        stampRequest.token,
        stampRequest.tokenRuntimeCodeHash,
        poolKeyHash,
        stampRequest.hookRuntimeCodeHash,
        componentSetHash,
      ],
    ),
  );
  const permit = {
    chainId: 1n,
    router: CLASSIC_V4_LAUNCH_STAMP_ROUTER,
    launchWallet: account,
    kind: variant === "permit-kind" ? 1 : 2,
    routePayloadHash: keccak256(routePayload),
    expectedResultHash,
    stampRequestHash,
    nonce: hash("router-permit-nonce"),
    validAfter: permitWindow.validAfter,
    deadline: permitWindow.deadline,
    value: initialBuy,
  } as const;
  const signature =
    variant === "signature"
      ? (`0x${"00".repeat(65)}` as Hex)
      : variant === "wrong-canonical-signature"
        ? concat([toHex(2n, { size: 32 }), toHex(1n, { size: 32 }), "0x1b"])
        : concat([toHex(1n, { size: 32 }), toHex(1n, { size: 32 }), "0x1b"]);
  const canonicalData = encodeFunctionData({
    abi: routerAbi,
    functionName: "launchAndStampV1",
    args: [permit, stampRequest, routePayload, signature],
  });
  const data =
    variant === "noncanonical" ? (`${canonicalData}00` as Hex) : canonicalData;
  const transaction = {
    kind: "launch" as const,
    chainId: 1 as const,
    to: CLASSIC_V4_LAUNCH_STAMP_ROUTER,
    data,
    value: initialBuy.toString(),
    gasLimit: "2500000",
  };
  return {
    transaction,
    permitDigest: hashTypedData({
      domain: {
        name: "ProgrammableLaunchStampRouter",
        version: "1",
        chainId: 1,
        verifyingContract: CLASSIC_V4_LAUNCH_STAMP_ROUTER,
      },
      types: routerPermitTypes,
      primaryType: "ProgrammableLaunchPermitV1",
      message: permit,
    }),
    token,
    expectedResult,
    stampRequest,
    planHash: buildPlanHash(account, {
      kind: "launch",
      chainId: 1,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    }),
  };
}

function redigestRouterRelease(
  manifest: ReturnType<typeof activeReleaseManifest>,
) {
  const authorization = manifest.lifecycleEvidence.launchAuthorization;
  manifest.lifecycleEvidence.actions.launch.inputHash = keccak256(
    authorization.transaction.calldata,
  );
  manifest.lifecycleEvidence.launchAuthorizationDigest = digest(
    authorization,
    undefined,
    CLASSIC_V4_DIGEST_DOMAINS.lifecycleAuthorization,
  );
  manifest.lifecycleEvidence.evidenceDigest = digest(
    manifest.lifecycleEvidence,
    "evidenceDigest",
    CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
  );
  manifest.manifestDigest = digest(manifest, "manifestDigest");
  return manifest;
}

function trustedBindingFor(manifest: ReturnType<typeof activeReleaseManifest>) {
  const authorization = manifest.lifecycleEvidence.launchAuthorization;
  const launch = manifest.lifecycleEvidence.actions.launch;
  const decoded = decodeFunctionData({
    abi: routerAbi,
    data: authorization.transaction.calldata,
  });
  if (decoded.functionName !== "launchAndStampV1") {
    throw new Error("Classic V4 Router fixture is invalid");
  }
  return {
    chainId: 1 as const,
    launcher: manifest.addresses.launcher,
    manifestDigest: manifest.manifestDigest,
    releaseStatus:
      manifest.releaseStatus === "publicly-available"
        ? ("publicly-available" as const)
        : ("indexer-activated" as const),
    publicAvailable: manifest.verification.publicAvailable === true,
    transactionHash: launch.transactionHash as Hex,
    blockHash: launch.blockHash as Hex,
    blockNumber: launch.blockNumber as number,
    inputHash: launch.inputHash as Hex,
    launchId: decoded.args[1].launchId,
    stampHash: authorization.simulation.stampHash as Hex,
    permitDigest: authorization.permitDigest as Hex,
  };
}

function routerTamperedRelease(
  variant: RouterFixtureVariant,
  mutateRelease?: (release: RouterFixtureRelease) => void,
) {
  const manifest = activeReleaseManifest();
  const authorization = manifest.lifecycleEvidence.launchAuthorization;
  const release: RouterFixtureRelease = {
    addresses: {
      launcher: manifest.addresses.launcher,
      feeHook: manifest.addresses.feeHook,
    },
    runtimeCodeHashes: {
      launcher: manifest.runtimeCodeHashes.launcher,
      feeHook: manifest.runtimeCodeHashes.feeHook,
    },
  };
  mutateRelease?.(release);
  const creatorSalt = digestJson(
    {
      purpose: "programmable-classic-v4-mainnet-lifecycle-canary",
      releaseBindingDigest: manifest.lifecycleEvidence.releaseBindingDigest,
      operatorWallet: account,
    },
    CLASSIC_V4_DIGEST_DOMAINS.canaryCreatorSalt,
  );
  const prepared = preparedV4RouterTransaction(
    classicV4CanaryDraft(),
    release,
    {
      validAfter: BigInt(authorization.validAfter),
      deadline: BigInt(authorization.deadline),
    },
    creatorSalt,
    variant,
  );
  authorization.permitDigest = prepared.permitDigest;
  authorization.transaction.calldata = prepared.transaction.data;
  return redigestRouterRelease(manifest);
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
    const binding = trustedBindingFor(manifest);
    expect(parseClassicV4PublicRelease(manifest, binding)).toMatchObject({
      releaseStatus: "indexer-activated",
      verification: { indexerActivated: true, publicAvailable: false },
    });

    const parsedIndexerRelease = parseClassicV4PublicRelease(manifest, binding);
    expect(isClassicV4PublicActionRelease(parsedIndexerRelease)).toBe(false);

    const sourcifyMatch = structuredClone(manifest);
    for (const contract of Object.values(
      sourcifyMatch.sourceVerification.contracts,
    )) {
      contract.status = "match";
      contract.providers[0].status = "match";
    }
    sourcifyMatch.sourceVerification.evidenceDigest = digest(
      sourcifyMatch.sourceVerification,
      "evidenceDigest",
      CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
    );
    sourcifyMatch.lifecycleEvidence.sourceEvidenceDigest =
      sourcifyMatch.sourceVerification.evidenceDigest;
    sourcifyMatch.lifecycleEvidence.evidenceDigest = digest(
      sourcifyMatch.lifecycleEvidence,
      "evidenceDigest",
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
    );
    sourcifyMatch.manifestDigest = digest(sourcifyMatch, "manifestDigest");
    expect(
      parseClassicV4PublicRelease(
        sourcifyMatch,
        trustedBindingFor(sourcifyMatch),
      ),
    ).toBeNull();

    const canonicalSourcifyMatch = activeReleaseManifest("match");
    expect(
      parseClassicV4PublicRelease(
        canonicalSourcifyMatch,
        trustedBindingFor(canonicalSourcifyMatch),
      ),
    ).toMatchObject({ releaseStatus: "indexer-activated" });

    const directLauncher = structuredClone(manifest);
    Object.assign(directLauncher.lifecycleEvidence.actions.launch, {
      to: launcher,
    });
    Object.assign(
      directLauncher.lifecycleEvidence.launchAuthorization.transaction,
      { to: launcher },
    );
    directLauncher.lifecycleEvidence.launchAuthorizationDigest = digest(
      directLauncher.lifecycleEvidence.launchAuthorization,
      undefined,
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleAuthorization,
    );
    directLauncher.lifecycleEvidence.evidenceDigest = digest(
      directLauncher.lifecycleEvidence,
      "evidenceDigest",
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
    );
    directLauncher.manifestDigest = digest(directLauncher, "manifestDigest");
    expect(
      parseClassicV4PublicRelease(
        directLauncher,
        trustedBindingFor(directLauncher),
      ),
    ).toBeNull();

    const publicManifest = publiclyAvailableReleaseManifest();
    const parsedPublicRelease = parseClassicV4PublicRelease(
      publicManifest,
      trustedBindingFor(publicManifest),
    );
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
    expect(
      parseClassicV4PublicRelease(pending, trustedBindingFor(pending)),
    ).toBeNull();

    const forgedLifecycle = structuredClone(manifest);
    Object.assign(forgedLifecycle.lifecycleEvidence.actions.sellExactOutput, {
      success: false,
    });
    forgedLifecycle.lifecycleEvidence.evidenceDigest = digest(
      forgedLifecycle.lifecycleEvidence,
      "evidenceDigest",
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
    );
    forgedLifecycle.manifestDigest = digest(forgedLifecycle, "manifestDigest");
    expect(
      parseClassicV4PublicRelease(
        forgedLifecycle,
        trustedBindingFor(forgedLifecycle),
      ),
    ).toBeNull();

    const forgedFinality = structuredClone(manifest);
    forgedFinality.deploymentVerification.confirmations.launcher += 1;
    forgedFinality.manifestDigest = digest(forgedFinality, "manifestDigest");
    expect(
      parseClassicV4PublicRelease(
        forgedFinality,
        trustedBindingFor(forgedFinality),
      ),
    ).toBeNull();

    const missingFinality = structuredClone(manifest) as Record<
      string,
      unknown
    >;
    delete missingFinality.deploymentVerification;
    missingFinality.manifestDigest = digest(missingFinality, "manifestDigest");
    expect(
      parseClassicV4PublicRelease(
        missingFinality,
        trustedBindingFor(
          missingFinality as ReturnType<typeof activeReleaseManifest>,
        ),
      ),
    ).toBeNull();
  });

  it("rejects every tampered signed Router authorization binding", () => {
    const cases: readonly [
      string,
      () => ReturnType<typeof activeReleaseManifest>,
    ][] = [
      ["permit kind", () => routerTamperedRelease("permit-kind")],
      [
        "route launcher",
        () =>
          routerTamperedRelease("valid", (release) => {
            release.addresses.launcher = address(97);
          }),
      ],
      [
        "launcher runtime",
        () =>
          routerTamperedRelease("valid", (release) => {
            release.runtimeCodeHashes.launcher = hash(
              "foreign-launcher-runtime",
            );
          }),
      ],
      ["expected result", () => routerTamperedRelease("expected-result")],
      ["stamp request", () => routerTamperedRelease("stamp-token")],
      ["component semantics", () => routerTamperedRelease("component-kind")],
      ["component runtime", () => routerTamperedRelease("component-runtime")],
      ["signature", () => routerTamperedRelease("signature")],
      ["noncanonical calldata", () => routerTamperedRelease("noncanonical")],
      [
        "permit digest",
        () => {
          const manifest = activeReleaseManifest();
          manifest.lifecycleEvidence.launchAuthorization.permitDigest = hash(
            "tampered-permit-digest",
          );
          return redigestRouterRelease(manifest);
        },
      ],
    ];

    for (const [label, candidate] of cases) {
      const manifest = candidate();
      expect(
        parseClassicV4PublicRelease(manifest, trustedBindingFor(manifest)),
        label,
      ).toBeNull();
    }
  });

  it("requires the code-reviewed finalized launch anchor", () => {
    const exactManifest = publiclyAvailableReleaseManifest();
    const exactBinding = trustedBindingFor(exactManifest);
    expect(parseClassicV4PublicRelease(exactManifest, exactBinding)).toEqual(
      exactManifest,
    );
    expect(parseClassicV4PublicRelease(exactManifest, null)).toBeNull();
    for (const [label, tamper] of [
      ["transaction hash", { transactionHash: hash("false transaction") }],
      ["block hash", { blockHash: hash("false block") }],
      ["block number", { blockNumber: exactBinding.blockNumber + 1 }],
      ["input hash", { inputHash: hash("false input") }],
      ["launch id", { launchId: hash("false launch id") }],
      ["stamp hash", { stampHash: hash("false stamp") }],
      ["permit digest", { permitDigest: hash("false permit") }],
    ] as const) {
      expect(
        parseClassicV4PublicRelease(exactManifest, {
          ...exactBinding,
          ...tamper,
        }),
        label,
      ).toBeNull();
    }

    const wrongSignature = routerTamperedRelease("wrong-canonical-signature");
    Object.assign(wrongSignature, { releaseStatus: "publicly-available" });
    Object.assign(wrongSignature.verification, { publicAvailable: true });
    wrongSignature.manifestDigest = digest(wrongSignature, "manifestDigest");
    const selfBinding = trustedBindingFor(wrongSignature);

    expect(parseClassicV4PublicRelease(wrongSignature, null)).toBeNull();
    expect(
      parseClassicV4PublicRelease(wrongSignature, {
        ...selfBinding,
        inputHash: exactBinding.inputHash,
      }),
    ).toBeNull();
    expect(
      promoteClassicV4ReleaseToPublicAvailability(
        activeReleaseManifest(),
        null,
      ),
    ).toBeNull();
    expect(getConfiguredClassicV4PublicRelease("production")).toBeNull();
  });

  it("accepts only the exact signed Router handoff for the public release", () => {
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
    const indexerBinding = trustedBindingFor(indexerManifest);
    expect(() =>
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        indexerInput,
        indexerBinding,
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

    const browserBinding = trustedBindingFor(manifest);
    expect(() =>
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        input,
        browserBinding,
      ),
    ).toThrow("canonical Launch Stamp Router");
    const prepared = preparedV4RouterTransaction(draft, manifest);
    const routerInput = {
      ...input,
      transaction: prepared.transaction,
      planHash: prepared.planHash,
    };
    expect(
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        routerInput,
        browserBinding,
      ),
    ).toEqual(prepared.transaction);
    expect(() =>
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
        { ...routerInput, planHash: hash("tampered plan") },
        browserBinding,
      ),
    ).toThrow("connected wallet");
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
      validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(input, {
        ...browserBinding,
        manifestDigest: hash("another manifest"),
      }),
    ).toThrow("browser V4 release binding");
  });

  it("promotes the exact indexer manifest and derives its browser binding", () => {
    const indexed = activeReleaseManifest();
    const originalDigest = indexed.manifestDigest;
    const indexedBinding = trustedBindingFor(indexed);
    const promotion = promoteClassicV4ReleaseToPublicAvailability(
      indexed,
      indexedBinding,
    );

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
      transactionHash: indexedBinding.transactionHash,
      blockHash: indexedBinding.blockHash,
      blockNumber: indexedBinding.blockNumber,
      inputHash: indexedBinding.inputHash,
      launchId: indexedBinding.launchId,
      stampHash: indexedBinding.stampHash,
      permitDigest: indexedBinding.permitDigest,
    });
    expect(
      parseClassicV4PublicRelease(
        promotion?.release,
        promotion?.browserBinding ?? null,
      ),
    ).toEqual(promotion?.release);
    expect(isClassicV4PublicActionRelease(promotion?.release)).toBe(true);
    expect(
      promoteClassicV4ReleaseToPublicAvailability(
        promotion?.release,
        promotion?.browserBinding ?? null,
      ),
    ).toBeNull();
  });
});
