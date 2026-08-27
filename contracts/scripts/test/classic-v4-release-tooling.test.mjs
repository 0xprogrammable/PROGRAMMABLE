import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import {
  encodeFunctionData,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_INDEXER_HOOK_EVENTS,
  CLASSIC_V4_INDEXER_LAUNCHER_EVENTS,
  CLASSIC_V4_LIFECYCLE_ACTIONS,
  CLASSIC_V4_NEW_CONTRACTS,
  buildClassicV4LifecycleCanaryPlan,
  buildClassicV4PreparationPlan,
  computeClassicV4BuildCommitments,
  computeClassicV4SourceCommitment,
  createClassicV4ReleaseManifest,
  digestJson,
  expectedLifecycleLaunchCalldata,
  expectedLifecycleSwapCalldata,
  normalizeRuntimeImmutables,
  validateClassicV4DeploymentEvidence,
  validateClassicV4LifecycleEvidence,
  validateClassicV4PreparationPlan,
  validateClassicV4SourceEvidence,
} from "../../../scripts/classic-v4-release-core.mjs";
import {
  assertExactEtherscanMatch,
  assertExactSourcifyMatch,
  verifyClassicV4SourceProviders,
} from "../verify-classic-v4-mainnet-sources.mjs";
import {
  assertClassicV4DeploymentBlockBinding,
  verifyClassicV4DeploymentAtFixedBlock,
} from "../verify-classic-v4-mainnet-deployment.mjs";
import {
  assertCleanClassicV4FoundryEnvironment,
  compileClassicV4FreshArtifacts,
  loadClassicV4SealedBuild,
  loadClassicV4SharedObservedBlock,
  verifyClassicV4SourcePins,
} from "../prepare-classic-v4-mainnet-release.mjs";
import { loadClassicV4BlockAtExactNumber } from "../verify-classic-v4-lifecycle-canary.mjs";
import { verifyClassicV4ReleasePrerequisites } from "../verify-classic-v4-release-prerequisites.mjs";
import {
  assertFreshDeploymentEvidence,
  assertFreshLifecycleEvidence,
  assertFreshSourceEvidence,
} from "../capture-classic-v4-mainnet-release.mjs";

const testPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(testPath), "..", "..", "..");
function artifactFixture(label, immutableReferences = {}) {
  const seed = keccak256(stringToHex(`classic-v4-artifact:${label}`)).slice(2);
  const object = `0x60006000${seed}`;
  return {
    bytecode: { object },
    deployedBytecode: { object, immutableReferences },
    metadata: {
      compiler: { version: "0.8.26+commit.8a97fa7a" },
      settings: {
        optimizer: { enabled: true, runs: 1_000 },
        evmVersion: "cancun",
        metadata: { bytecodeHash: "none", appendCBOR: false },
      },
      sources: {
        [`src/${label}.sol`]: {
          keccak256: keccak256(stringToHex(`source:${label}`)),
        },
        "lib/v4-core/src/Test.sol": {
          keccak256: keccak256(stringToHex("dependency:v4-core:Test.sol")),
        },
      },
    },
  };
}

const artifacts = {
  hookFactory: artifactFixture("hookFactory"),
  feeHook: artifactFixture("feeHook", {
    1: [{ start: 4, length: 20 }],
  }),
  positionPlanner: artifactFixture("positionPlanner"),
  launcher: artifactFixture("launcher"),
};
const schema = JSON.parse(
  await readFile(
    path.join(
      repositoryRoot,
      "contracts/deployments/schema/classic-v4-release-v1.schema.json",
    ),
    "utf8",
  ),
);
const validateSchema = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(schema);
const deploymentSchema = JSON.parse(
  await readFile(
    path.join(
      repositoryRoot,
      "contracts/deployments/schema/classic-v4-deployment-evidence-v1.schema.json",
    ),
    "utf8",
  ),
);
const validateDeploymentSchema = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(deploymentSchema);
const sourcePins = JSON.parse(
  await readFile(
    path.join(repositoryRoot, "contracts/dependencies/source-pins.json"),
    "utf8",
  ),
);
const localDependencyDirectoryByName = Object.freeze({
  BlockNumberish: "blocknumberish",
  "Uniswap Continuous Clearing Auction": "continuous-clearing-auction",
  "Forge Standard Library": "forge-std",
  "Uniswap Liquidity Launcher": "liquidity-launcher",
  "OpenZeppelin Contracts": "openzeppelin-contracts",
  "OpenZeppelin Uniswap Hooks": "openzeppelin-uniswap-hooks",
  Permit2: "permit2",
  Solady: "solady",
  Solmate: "solmate",
  "Uniswap UERC20 Factory": "uerc20-factory",
  "Uniswap v4 Core": "v4-core",
  "Uniswap v4 Periphery": "v4-periphery",
});

function localPinnedDependencies() {
  return sourcePins.dependencies.filter(
    (dependency) => localDependencyDirectoryByName[dependency.name],
  );
}

function exactPinnedDependencyGitStates() {
  return Object.fromEntries(
    localPinnedDependencies().map((dependency) => {
      const root = localDependencyDirectoryByName[dependency.name];
      return [
        root,
        {
          topLevel: path.join(repositoryRoot, "contracts/lib", root),
          head: dependency.commit,
          clean: true,
          remoteUrl: dependency.repository,
        },
      ];
    }),
  );
}

function txHash(label) {
  return keccak256(stringToHex(`classic-v4-test:${label}`));
}

function withDigest(value, domain) {
  return { ...value, evidenceDigest: digestJson(value, domain) };
}

function verifiedPreflight(
  artifactSet = artifacts,
  sourcePinsDigest = txHash("source-pins"),
) {
  const buildCommitments = computeClassicV4BuildCommitments(artifactSet);
  return {
    independentRpcCount: 2,
    freshDeterministicBuild: true,
    compilerVersion: "0.8.26+commit.8a97fa7a",
    evmVersion: "cancun",
    optimizerRuns: 1_000,
    metadataBytecodeHash: "none",
    officialDependencyRuntimeVerified: true,
    sharedDependencyRuntimeVerified: true,
    sharedDependencyBindingsVerified: true,
    predictedAddressesVacant: true,
    deployerNonceReconciled: true,
    foundryEnvironmentSanitized: true,
    freshControlledOutput: true,
    sourcePinsVerified: true,
    sourcePinsDigest,
    buildArtifactsDigest: buildCommitments.buildArtifactsDigest,
    dependencyClosureDigest: buildCommitments.dependencyClosureDigest,
    dependencySourceCount: buildCommitments.dependencySourceCount,
    dependencyRoots: buildCommitments.dependencyRoots,
  };
}

function preparationPlan({
  artifactSet = artifacts,
  releaseCommit = "1".repeat(40),
  releaseTree = "2".repeat(40),
  sourcePinsDigest = txHash("source-pins"),
} = {}) {
  return buildClassicV4PreparationPlan({
    artifacts: artifactSet,
    deployer: "0xa11CE00000000000000000000000000000000004",
    startingNonce: 42,
    releaseCommit,
    releaseTree,
    repositoryClean: true,
    observedAtBlock: 25_700_000,
    observedAtBlockHash: `0x${"ab".repeat(32)}`,
    preflight: verifiedPreflight(artifactSet, sourcePinsDigest),
  });
}

function deploymentEvidence(plan) {
  const verificationBlock = 25_700_120;
  const contracts = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name, index) => {
      const transaction = plan.transactions[index];
      return [
        name,
        {
          transactionHash: txHash(`${name}:deployment`),
          blockNumber: 25_700_100 + index,
          blockHash: txHash(`${name}:block`),
          confirmations: verificationBlock - (25_700_100 + index) + 1,
          address: plan.predictedAddresses[name],
          nonce: transaction.nonce,
          from: transaction.from,
          to: transaction.to,
          dataHash: transaction.dataHash,
          value: "0",
          runtimeCodeHash: txHash(`${name}:runtime`),
          runtimeTemplateHash: plan.runtimeTemplates[name].runtimeTemplateHash,
        },
      ];
    }),
  );
  return withDigest({
    schemaVersion: 1,
    chainId: 1,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "finalized",
    checkedAt: "2026-08-27T10:00:00.000Z",
    verificationBlock,
    verificationBlockHash: txHash("deployment-verification-block"),
    independentRpcCount: 2,
    deploymentLive: true,
    runtimeCodeVerified: true,
    constructorBindingsVerified: true,
    contracts,
  }, CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence);
}

function sourceEvidence(plan, deployment) {
  const names = {
    hookFactory: "EthCreatorFeeHookFactoryV4",
    feeHook: "EthCreatorFeeHookV4",
    positionPlanner: "ClassicPositionPlannerV1",
    launcher: "MemeLaunchV3",
  };
  const sourceFiles = {
    hookFactory: "src/EthCreatorFeeHookFactoryV4.sol",
    feeHook: "src/EthCreatorFeeHookV4.sol",
    positionPlanner: "src/ClassicPositionPlannerV1.sol",
    launcher: "src/MemeLaunchV3.sol",
  };
  return withDigest({
    schemaVersion: 1,
    chainId: 1,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "verified",
    checkedAt: "2026-08-27T10:05:00.000Z",
    contracts: Object.fromEntries(
      CLASSIC_V4_NEW_CONTRACTS.map((name) => [
        name,
        {
          address: deployment.contracts[name].address,
          contractName: names[name],
          fqcn: `${sourceFiles[name]}:${names[name]}`,
          encodedConstructorArguments: plan.constructorArguments[name],
          deploymentTransaction: deployment.contracts[name].transactionHash,
          deploymentBlock: deployment.contracts[name].blockNumber,
          status: "exact-match",
          providers: [
            {
              name: "Sourcify",
              status: "exact-match",
              url: `https://sourcify.dev/server/v2/contract/1/${deployment.contracts[name].address}`,
            },
          ],
        },
      ]),
    ),
  }, CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence);
}

function lifecycleEvidence(plan, deployment, source) {
  const operatorWallet = plan.deployer;
  const canaryToken = "0x0000000000000000000000000000000000000001";
  const rewardVault = "0x0000000000000000000000000000000000000002";
  const positionRecipient = "0x0000000000000000000000000000000000000003";
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const releaseBindingDigest = digestJson(
    {
      planDigest: plan.planDigest,
      deploymentEvidence: deployment,
      sourceEvidence: source,
    },
    CLASSIC_V4_DIGEST_DOMAINS.releaseBinding,
  );
  const canary = buildClassicV4LifecycleCanaryPlan(
    {
      internalContractRelease: "classic-v4",
      chainId: 1,
      releaseCommit: plan.releaseCommit,
      sourceCommitment: plan.sourceCommitment,
      releaseBindingDigest,
      addresses: {
        deployer: plan.deployer,
        launcherFeeRecipient: plan.launcherFeeRecipient,
        ...Object.fromEntries(
          Object.entries(plan.sharedDependencies).map(([name, value]) => [
            name,
            value.address,
          ]),
        ),
        ...plan.predictedAddresses,
      },
      officialDependencies: plan.officialDependencies,
      verification: {
        deploymentLive: true,
        runtimeCodeVerified: true,
        constructorBindingsVerified: true,
        sourceVerified: true,
      },
    },
    operatorWallet,
  );
  const verificationBlock = 25_700_220;
  const timestamps = Object.fromEntries(
    CLASSIC_V4_LIFECYCLE_ACTIONS.map((name, index) => [
      name,
      (1_788_000_000n + BigInt(index) * 12n).toString(),
    ]),
  );
  const actionEvents = {
    launch: [
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
  };
  const actions = Object.fromEntries(
    CLASSIC_V4_LIFECYCLE_ACTIONS.map((name, index) => {
      const blockNumber = 25_700_200 + index;
      const swapIdentity = {
        buyExactInput: ["buy", "exact-input"],
        buyExactOutput: ["buy", "exact-output"],
        sellExactInput: ["sell", "exact-input"],
        sellExactOutput: ["sell", "exact-output"],
      }[name];
      const values = {
        launch: canary.launchFixture.initialBuyWei,
        buyExactInput: canary.swapFixture.buyExactInput.amountIn,
        buyExactOutput: "1010000000",
        sellExactInput: "0",
        sellExactOutput: "0",
        creatorClaim: "0",
        launcherClaim: "0",
      };
      const target =
        name === "launch"
          ? canary.launcher
          : swapIdentity
            ? canary.dependencies.universalRouter
            : name === "creatorClaim"
              ? rewardVault
              : canary.feeHook;
      return [
        name,
        {
          transactionHash: txHash(`action:${name}`),
          inputHash: txHash(`input:${name}`),
          blockNumber,
          blockHash: txHash(`block:${name}`),
          blockTimestamp: timestamps[name],
          transactionIndex: index,
          nonce: name === "launcherClaim" ? 77 : 100 + index,
          from:
            name === "launcherClaim"
              ? plan.launcherFeeRecipient
              : operatorWallet,
          to: target,
          value: values[name],
          confirmations: verificationBlock - blockNumber + 1,
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
  );
  const grossSplit = (gross, bps) => {
    const total = (gross * BigInt(bps)) / 10_000n;
    const launcher = (gross * 10n) / 10_000n;
    return { creator: total - launcher, launcher, total };
  };
  const netSplit = (net, bps) => {
    const denominator = 10_000n - BigInt(bps);
    const gross = (net * 10_000n + denominator - 1n) / denominator;
    const total = gross - net;
    const launcher = (gross * 10n) / 10_000n;
    return { creator: total - launcher, launcher, total, gross };
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
  };
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
          routerDeadline: (BigInt(timestamps[name]) + 300n).toString(),
          executionPath: "single-hop-all",
          quote: {
            policy: canary.swapFixture.quotePolicy,
            function: `V4Quoter.${
              exactInput ? "quoteExactInputSingle" : "quoteExactOutputSingle"
            }`,
            blockNumber: actions[name].blockNumber - 1,
            blockHash: txHash(`quote-block:${name}`),
            exactAmount: exactInput
              ? canary.swapFixture[name].amountIn
              : canary.swapFixture[name].amountOut,
            quotedAmount: row.quotedAmount,
            gasEstimate: "100000",
            slippageBps: 100,
            bound: exactInput ? row.outputBound : row.inputBound,
          },
        },
      ];
    }),
  );
  actions.launch.inputHash = keccak256(
    expectedLifecycleLaunchCalldata(canary),
  );
  for (const name of [
    "buyExactInput",
    "buyExactOutput",
    "sellExactInput",
    "sellExactOutput",
  ]) {
    actions[name].inputHash = keccak256(
      expectedLifecycleSwapCalldata(
        canary,
        canaryToken,
        swaps[name].side,
        swaps[name].exactness,
        swaps[name],
      ),
    );
  }
  actions.creatorClaim.inputHash = keccak256(
    encodeFunctionData({
      abi: parseAbi(["function claim() returns (uint256)"]),
      functionName: "claim",
    }),
  );
  actions.launcherClaim.inputHash = keccak256(
    encodeFunctionData({
      abi: parseAbi(["function claimLauncherFees() returns (uint256)"]),
      functionName: "claimLauncherFees",
    }),
  );
  const initialFee = grossSplit(BigInt(canary.launchFixture.initialBuyWei), 100);
  const creatorTotal =
    initialFee.creator +
    Object.values(swapRows).reduce((sum, row) => sum + row.fee.creator, 0n);
  const launcherTotal =
    initialFee.launcher +
    Object.values(swapRows).reduce((sum, row) => sum + row.fee.launcher, 0n);
  const hookSnapshot = (registered, creator, launcher) => ({
    rewardVault: registered ? rewardVault : zeroAddress,
    registrar: registered ? plan.predictedAddresses.launcher : zeroAddress,
    buySwapFeeBps: registered ? 100 : 0,
    sellSwapFeeBps: registered ? 200 : 0,
    registered,
    creatorFeesAccrued: creator.toString(),
    launcherFeesAccrued: launcher.toString(),
    totalNativeFeesAccrued: (creator + launcher).toString(),
    poolManagerNativeClaims: (creator + launcher).toString(),
    poolManagerTokenClaims: "0",
    rawNativeBalance: "0",
  });
  const vaultSnapshot = (amount) => ({
    totalCreatorFeesReceived: amount.toString(),
    totalCreatorFeesClaimed: amount.toString(),
    beneficiaryClaimed: amount.toString(),
    beneficiaryClaimable: "0",
    rawNativeBalance: "0",
  });
  return withDigest({
    schemaVersion: 1,
    chainId: 1,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "verified-current-release",
    checkedAt: "2026-08-27T10:10:00.000Z",
    independentRpcCount: 2,
    releaseEligible: true,
    canaryPlanDigest: canary.planDigest,
    releaseBindingDigest,
    deploymentEvidenceDigest: deployment.evidenceDigest,
    sourceEvidenceDigest: source.evidenceDigest,
    verificationBlock,
    verificationBlockHash: txHash("lifecycle-verification-block"),
    latestLifecycleBlock: actions.launcherClaim.blockNumber,
    confirmations: actions.launcherClaim.confirmations,
    operatorWallet,
    launcher: plan.predictedAddresses.launcher,
    feeHook: plan.predictedAddresses.feeHook,
    canaryToken,
    rewardVault,
    poolId: txHash("pool"),
    positionRecipient,
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
        launchHash: txHash("launch-hash"),
        rewardVault,
        initialBuyCustody: zeroAddress,
      },
      poolFeeConfig: {
        rewardVault,
        registrar: plan.predictedAddresses.launcher,
        buySwapFeeBps: 100,
        sellSwapFeeBps: 200,
        registered: true,
        creatorFeesAccrued: "0",
      },
      rewardVault: {
        configurationHash: txHash("vault-config"),
        activeConfigurationHash: txHash("vault-active-config"),
        configurationEpoch: 1,
        beneficiary: operatorWallet,
        shareBps: 10_000,
      },
      positionLock: {
        owner: positionRecipient,
        approved: zeroAddress,
        tokenId: "42",
        positionLiquidity: "1000000",
        activePoolLiquidity: "1000000",
        tickLower: 174_800,
        tickUpper: 204_200,
        manager: plan.officialDependencies.positionManager.address,
        operator: zeroAddress,
        timelockBlockNumber: ((1n << 256n) - 1n).toString(),
        feeRecipient: operatorWallet,
        factoryConfigurationHash: txHash("forwarder-config"),
      },
      tokenCustody: {
        totalSupply: (1_000_000_000n * 10n ** 18n).toString(),
        lockedTokenDust: "1",
        launcherBalance: "0",
        positionManagerBalance: "0",
      },
      derivedCodeHashes: {
        token: txHash("token-code"),
        rewardVault: txHash("vault-code"),
        positionForwarder: txHash("forwarder-code"),
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
          blockNumber: actions.launch.blockNumber - 1,
          hook: hookSnapshot(false, 0n, 0n),
        },
        beforeCreatorClaim: {
          blockNumber: actions.creatorClaim.blockNumber - 1,
          hook: hookSnapshot(true, creatorTotal, launcherTotal),
          vault: vaultSnapshot(0n),
        },
        afterCreatorClaim: {
          blockNumber: actions.creatorClaim.blockNumber,
          hook: hookSnapshot(true, 0n, launcherTotal),
          vault: vaultSnapshot(creatorTotal),
        },
        beforeLauncherClaim: {
          blockNumber: actions.launcherClaim.blockNumber - 1,
          hook: hookSnapshot(true, 0n, launcherTotal),
        },
        final: {
          blockNumber: verificationBlock,
          hook: hookSnapshot(true, 0n, 0n),
          vault: vaultSnapshot(creatorTotal),
        },
      },
    },
    observations: {
      exclusiveHookActivity: {
        fromBlock: actions.launch.blockNumber,
        toBlock: verificationBlock,
        nativeAccrualEvents: 5,
        creatorClaimEvents: 1,
        launcherClaimEvents: 1,
      },
      sellApprovals: Object.fromEntries(
        ["sellExactInput", "sellExactOutput"].map((name) => [
          name,
          {
            blockNumber: actions[name].blockNumber - 1,
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
  }, CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence);
}

test("preparation binds four transactions, source bytes, treasury and hook flags", () => {
  const plan = preparationPlan();
  assert.equal(plan.transactions.length, 4);
  assert.deepEqual(
    plan.transactions.map((transaction) => transaction.name),
    CLASSIC_V4_NEW_CONTRACTS,
  );
  assert.deepEqual(
    plan.transactions.map((transaction) => transaction.nonce),
    [42, 43, 44, 45],
  );
  assert.equal(BigInt(plan.predictedAddresses.feeHook) & 16_383n, 8_396n);
  assert.equal(plan.executionBoundary.signs, false);
  assert.equal(plan.executionBoundary.broadcasts, false);
  assert.equal(
    plan.sourceCommitment,
    computeClassicV4SourceCommitment(artifacts),
  );
  assert.equal(validateClassicV4PreparationPlan(plan, artifacts), plan);
});

test("preparation rejects transaction or source drift", () => {
  const plan = preparationPlan();
  const transactionDrift = structuredClone(plan);
  transactionDrift.transactions[3].data = `${transactionDrift.transactions[3].data}00`;
  assert.throws(
    () => validateClassicV4PreparationPlan(transactionDrift, artifacts),
    /transaction launcher differs/,
  );

  const artifactDrift = structuredClone(artifacts);
  artifactDrift.positionPlanner.bytecode.object = `${artifactDrift.positionPlanner.bytecode.object}00`;
  assert.notEqual(
    computeClassicV4SourceCommitment(artifactDrift),
    plan.sourceCommitment,
  );
  assert.throws(
    () => validateClassicV4PreparationPlan(plan, artifactDrift),
    /build or dependency closure differs|source commitment differs/,
  );

  const staleBuildClaim = structuredClone(plan);
  staleBuildClaim.preflight.freshDeterministicBuild = false;
  const staleBuildCore = structuredClone(staleBuildClaim);
  delete staleBuildCore.planDigest;
  staleBuildClaim.planDigest = digestJson(
    staleBuildCore,
    CLASSIC_V4_DIGEST_DOMAINS.preparationPlan,
  );
  assert.throws(
    () => validateClassicV4PreparationPlan(staleBuildClaim, artifacts),
    /preflight is incomplete/,
  );
});

test("preparation rejects tampered observation, init hash, transaction type and execution boundary", () => {
  const redigest = (value) => {
    const unsigned = structuredClone(value);
    delete unsigned.planDigest;
    value.planDigest = digestJson(
      unsigned,
      CLASSIC_V4_DIGEST_DOMAINS.preparationPlan,
    );
    return value;
  };
  const cases = [
    {
      mutate: (plan) => {
        plan.observedAtBlock = 0;
      },
      message: /observed block must be positive/i,
    },
    {
      mutate: (plan) => {
        plan.observedAtBlockHash = `0x${"00".repeat(32)}`;
      },
      message: /Invalid plan observed block hash/,
    },
    {
      mutate: (plan) => {
        plan.hookInitCodeHash = txHash("forged-init-code");
      },
      message: /hook init code hash differs/,
    },
    {
      mutate: (plan) => {
        plan.transactions[1].transactionType = "CREATE";
      },
      message: /transaction feeHook differs/,
    },
    {
      mutate: (plan) => {
        plan.executionBoundary.broadcasts = true;
      },
      message: /execution boundary differs/,
    },
  ];
  for (const { mutate, message } of cases) {
    const plan = preparationPlan();
    mutate(plan);
    redigest(plan);
    assert.throws(() => validateClassicV4PreparationPlan(plan, artifacts), message);
  }
});

test("artifact digests are domain-separated, typed and hex-canonical", () => {
  const domain = CLASSIC_V4_DIGEST_DOMAINS.generic;
  assert.notEqual(
    digestJson({ value: 1n }, domain),
    digestJson({ value: "1" }, domain),
  );
  assert.notEqual(
    digestJson({ value: 1 }, domain),
    digestJson({ value: "1" }, domain),
  );
  assert.equal(
    digestJson(
      { address: "0xA11CE00000000000000000000000000000000004" },
      domain,
    ),
    digestJson(
      { address: "0xa11ce00000000000000000000000000000000004" },
      domain,
    ),
  );
  assert.notEqual(
    digestJson({ value: "same" }, CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence),
    digestJson(
      { value: "same" },
      CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
    ),
  );
  assert.throws(
    () => digestJson({ unsupported: undefined }, domain),
    /unsupported undefined/,
  );
});

test("release build rejects inherited Foundry overrides and reads only its fresh temp output", async () => {
  assert.throws(
    () =>
      assertCleanClassicV4FoundryEnvironment({
        PATH: "/usr/bin",
        FOUNDRY_OUT: "/tmp/attacker-out",
      }),
    /FOUNDRY_OUT is forbidden/,
  );
  assert.throws(
    () =>
      assertCleanClassicV4FoundryEnvironment({
        PATH: "/usr/bin",
        REMAPPINGS: "@openzeppelin/=\/tmp\/attacker\/",
      }),
    /REMAPPINGS is forbidden/,
  );

  const temporaryRoot = "/tmp/classic-v4-controlled-build";
  let executed;
  let loadedFrom;
  let removed;
  const freshArtifacts = structuredClone(artifacts);
  const result = await compileClassicV4FreshArtifacts({
    environment: {
      PATH: "/usr/bin",
      HOME: "/tmp/classic-v4-controlled-home",
    },
    contractsDirectory: path.join(repositoryRoot, "contracts"),
    temporaryParent: "/tmp",
    createTemporaryDirectory: async () => temporaryRoot,
    execute: async (command, args, options) => {
      executed = { command, args, options };
    },
    artifactLoader: async (outputDirectory) => {
      loadedFrom = outputDirectory;
      return freshArtifacts;
    },
    removeTemporaryDirectory: async (directory) => {
      removed = directory;
    },
  });
  assert.equal(result, freshArtifacts);
  assert.equal(loadedFrom, path.join(temporaryRoot, "out"));
  assert.equal(removed, temporaryRoot);
  assert.equal(executed.command, "forge");
  assert.equal(
    executed.args[executed.args.indexOf("--out") + 1],
    path.join(temporaryRoot, "out"),
  );
  assert.equal(
    executed.args[executed.args.indexOf("--cache-path") + 1],
    path.join(temporaryRoot, "cache"),
  );
  assert.notEqual(
    loadedFrom,
    path.join(repositoryRoot, "contracts", "out"),
  );
  assert.equal("FOUNDRY_OUT" in executed.options.env, false);
  assert.equal("REMAPPINGS" in executed.options.env, false);
});

test("source pins require compiled libraries to be clean pinned Git checkouts", () => {
  const localDependencies = localPinnedDependencies();
  const localDirectories = localDependencies.map(
    (dependency) => localDependencyDirectoryByName[dependency.name],
  );
  const v4CorePin = localDependencies.find(
    (dependency) =>
      localDependencyDirectoryByName[dependency.name] === "v4-core",
  );
  const dependencyGitStates = {
    "v4-core": {
      topLevel: path.join(repositoryRoot, "contracts/lib/v4-core"),
      head: v4CorePin.commit,
      clean: true,
      remoteUrl: v4CorePin.repository,
    },
  };
  assert.doesNotThrow(() =>
    verifyClassicV4SourcePins({
      sourcePins,
      localDirectories,
      dependencyRoots: ["v4-core"],
      dependencyGitStates,
    }),
  );
  const forgedGitState = structuredClone(dependencyGitStates);
  forgedGitState["v4-core"].head = "0".repeat(40);
  assert.throws(
    () =>
      verifyClassicV4SourcePins({
        sourcePins,
        localDirectories,
        dependencyRoots: ["v4-core"],
        dependencyGitStates: forgedGitState,
      }),
    /Pinned Git checkout differs for v4-core/,
  );
});

test("downstream sealed builds reject forged fixed-out artifacts and arbitrary source-pin claims", async () => {
  const readRevision = (revision) => {
    const result = spawnSync("git", ["rev-parse", revision], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().toLowerCase();
  };
  const releaseCommit = readRevision("HEAD");
  const releaseTree = readRevision("HEAD^{tree}");
  const sourcePinsDigest = digestJson(
    sourcePins,
    CLASSIC_V4_DIGEST_DOMAINS.sourcePins,
  );
  const sealedOptions = {
    environment: { PATH: "/usr/bin" },
    identityReader: async () => ({
      repositoryTopLevel: repositoryRoot,
      releaseCommit,
      releaseTree,
      repositoryClean: true,
    }),
    sourcePinsReader: async () => structuredClone(sourcePins),
    localDirectoryReader: async () =>
      localPinnedDependencies().map(
        (dependency) => localDependencyDirectoryByName[dependency.name],
      ),
    dependencyGitStatesReader: async () =>
      exactPinnedDependencyGitStates(),
    artifactBuilder: async () => structuredClone(artifacts),
  };
  const sealedPlan = preparationPlan({
    releaseCommit,
    releaseTree,
    sourcePinsDigest,
  });
  assert.deepEqual(
    await loadClassicV4SealedBuild(sealedPlan, sealedOptions),
    artifacts,
  );

  const forgedArtifacts = structuredClone(artifacts);
  forgedArtifacts.launcher.bytecode.object =
    `${forgedArtifacts.launcher.bytecode.object}00`;
  forgedArtifacts.launcher.deployedBytecode.object =
    `${forgedArtifacts.launcher.deployedBytecode.object}00`;
  const arbitraryPinPlan = preparationPlan({
    artifactSet: forgedArtifacts,
    releaseCommit,
    releaseTree,
    sourcePinsDigest: txHash("attacker-selected-source-pins"),
  });
  await assert.rejects(
    loadClassicV4SealedBuild(arbitraryPinPlan, sealedOptions),
    /source pins differ from the sealed dependency checkout/,
  );

  const selfConsistentForgedPlan = preparationPlan({
    artifactSet: forgedArtifacts,
    releaseCommit,
    releaseTree,
    sourcePinsDigest,
  });
  await assert.rejects(
    loadClassicV4SealedBuild(selfConsistentForgedPlan, sealedOptions),
    /build or dependency closure differs|source commitment differs/,
  );
});

test("deployment replay rejects a plan observed block hash that is not canonical", async () => {
  const plan = preparationPlan();
  const txHashes = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name) => [
      name,
      txHash(`${name}:deployment`),
    ]),
  );
  const verificationBlock = 25_700_120;
  const verificationBlockTag = `0x${verificationBlock.toString(16)}`;
  const observedBlockTag = `0x${plan.observedAtBlock.toString(16)}`;
  const rpcClient = async (_endpoint, method, params = []) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") {
      if (params[0] === verificationBlockTag) {
        return {
          hash: txHash("verification-head"),
          number: verificationBlockTag,
          timestamp: "0x6a000000",
        };
      }
      assert.equal(params[0], observedBlockTag);
      return {
        hash: txHash("wrong-observed-head"),
        number: observedBlockTag,
      };
    }
    throw new Error(`Unexpected RPC method ${method}`);
  };
  await assert.rejects(
    verifyClassicV4DeploymentAtFixedBlock({
      endpoints: ["https://rpc-a.example", "https://rpc-b.example"],
      plan,
      txHashes,
      verificationBlock,
      artifacts,
      rpcClient,
    }),
    /observed block hash differs from the canonical chain/,
  );

  const wrongObservedNumberRpcClient = async (
    _endpoint,
    method,
    params = [],
  ) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") {
      if (params[0] === verificationBlockTag) {
        return {
          hash: txHash("verification-head"),
          number: verificationBlockTag,
          timestamp: "0x6a000000",
        };
      }
      assert.equal(params[0], observedBlockTag);
      return {
        hash: plan.observedAtBlockHash,
        number: `0x${(plan.observedAtBlock + 1).toString(16)}`,
      };
    }
    throw new Error(`Unexpected RPC method ${method}`);
  };
  await assert.rejects(
    verifyClassicV4DeploymentAtFixedBlock({
      endpoints: ["https://rpc-a.example", "https://rpc-b.example"],
      plan,
      txHashes,
      verificationBlock,
      artifacts,
      rpcClient: wrongObservedNumberRpcClient,
    }),
    /observed block hash differs from the canonical chain/,
  );
});

test("numeric RPC block tags reject N-plus-one response headers", async () => {
  const endpoints = ["https://rpc-a.example", "https://rpc-b.example"];
  const observedAtBlock = 25_700_000;
  const observedTag = `0x${observedAtBlock.toString(16)}`;
  for (const forgedEndpoint of endpoints) {
    await assert.rejects(
      loadClassicV4SharedObservedBlock(
        endpoints,
        observedAtBlock,
        async (endpoint, method, params) => {
          assert.equal(method, "eth_getBlockByNumber");
          assert.deepEqual(params, [observedTag, false]);
          return {
            number: `0x${(
              observedAtBlock + (endpoint === forgedEndpoint ? 1 : 0)
            ).toString(16)}`,
            hash: txHash("shared-observed-block"),
          };
        },
      ),
      /disagree on the shared observed block/,
    );
  }

  const receiptBlock = 25_700_100;
  await assert.rejects(
    loadClassicV4BlockAtExactNumber(
      endpoints[0],
      receiptBlock,
      "launch canonical",
      async (_endpoint, method, params) => {
        assert.equal(method, "eth_getBlockByNumber");
        assert.deepEqual(params, [`0x${receiptBlock.toString(16)}`, false]);
        return {
          number: `0x${(receiptBlock + 1).toString(16)}`,
          hash: txHash("lifecycle-receipt-block"),
        };
      },
    ),
    /block number differs from the requested tag/,
  );
});

test("deployment receipts and transactions must bind to the fetched canonical block", () => {
  const blockNumber = 25_700_100;
  const blockHash = txHash("canonical-deployment-block");
  const block = {
    number: `0x${blockNumber.toString(16)}`,
    hash: blockHash,
  };
  const transaction = {
    blockNumber: block.number,
    blockHash,
  };
  const receipt = {
    blockNumber: block.number,
    blockHash,
  };
  assert.doesNotThrow(() =>
    assertClassicV4DeploymentBlockBinding({
      transaction,
      receipt,
      block,
      blockNumber,
      label: "launcher",
    }),
  );
  assert.throws(
    () =>
      assertClassicV4DeploymentBlockBinding({
        transaction,
        receipt: { ...receipt, blockHash: txHash("forged-receipt-block") },
        block,
        blockNumber,
        label: "launcher",
      }),
    /transaction or receipt block binding differs/,
  );
});

test("preparation rejects the zero address as a deployer", () => {
  assert.throws(
    () =>
      buildClassicV4PreparationPlan({
        artifacts,
        deployer: "0x0000000000000000000000000000000000000000",
        startingNonce: 42,
        releaseCommit: "1".repeat(40),
        releaseTree: "2".repeat(40),
        repositoryClean: true,
        observedAtBlock: 25_700_000,
        observedAtBlockHash: `0x${"ab".repeat(32)}`,
        preflight: verifiedPreflight(),
      }),
    /Invalid deployer/,
  );
});

test("runtime template ignores only compiler-declared immutable slots", () => {
  const artifact = artifacts.feeHook;
  const runtime = artifact.deployedBytecode.object;
  const firstReference = Object.values(
    artifact.deployedBytecode.immutableReferences,
  ).flat()[0];
  assert.ok(firstReference);
  const chars = runtime.slice(2).split("");
  chars.fill(
    "f",
    firstReference.start * 2,
    (firstReference.start + firstReference.length) * 2,
  );
  const immutableOnlyChange = `0x${chars.join("")}`;
  assert.equal(
    normalizeRuntimeImmutables(runtime, artifact),
    normalizeRuntimeImmutables(immutableOnlyChange, artifact),
  );

  const nonImmutableChange = `${runtime.slice(0, 2)}${runtime.slice(2, 4) === "00" ? "01" : "00"}${runtime.slice(4)}`;
  assert.notEqual(
    normalizeRuntimeImmutables(runtime, artifact),
    normalizeRuntimeImmutables(nonImmutableChange, artifact),
  );
});

test("deployment, source and lifecycle evidence fail closed on drift", () => {
  const plan = preparationPlan();
  const deployment = deploymentEvidence(plan);
  const source = sourceEvidence(plan, deployment);
  const lifecycle = lifecycleEvidence(plan, deployment, source);
  assert.doesNotThrow(() =>
    validateClassicV4DeploymentEvidence(plan, deployment),
  );
  assert.equal(
    validateDeploymentSchema(deployment),
    true,
    JSON.stringify(validateDeploymentSchema.errors),
  );
  assert.doesNotThrow(() =>
    validateClassicV4SourceEvidence(plan, deployment, source),
  );
  assert.doesNotThrow(() =>
    validateClassicV4LifecycleEvidence(plan, deployment, source, lifecycle),
  );

  const runtimeDrift = structuredClone(deployment);
  runtimeDrift.contracts.feeHook.runtimeTemplateHash = txHash("wrong-template");
  runtimeDrift.evidenceDigest = digestJson(
    Object.fromEntries(
      Object.entries(runtimeDrift).filter(([key]) => key !== "evidenceDigest"),
    ),
    CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
  );
  assert.throws(
    () => validateClassicV4DeploymentEvidence(plan, runtimeDrift),
    /runtime template differs/,
  );

  const constructorDrift = structuredClone(source);
  constructorDrift.contracts.launcher.encodedConstructorArguments = "0x";
  constructorDrift.evidenceDigest = digestJson(
    Object.fromEntries(
      Object.entries(constructorDrift).filter(
        ([key]) => key !== "evidenceDigest",
      ),
    ),
    CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
  );
  assert.throws(
    () => validateClassicV4SourceEvidence(plan, deployment, constructorDrift),
    /constructor arguments differ/,
  );

  const weakSourceMatch = structuredClone(source);
  weakSourceMatch.contracts.feeHook.providers[0].status = "match";
  weakSourceMatch.evidenceDigest = digestJson(
    Object.fromEntries(
      Object.entries(weakSourceMatch).filter(
        ([key]) => key !== "evidenceDigest",
      ),
    ),
    CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
  );
  assert.throws(
    () => validateClassicV4SourceEvidence(plan, deployment, weakSourceMatch),
    /source verification is incomplete/,
  );

  const wrongSourceIdentity = structuredClone(source);
  wrongSourceIdentity.contracts.launcher.fqcn = "src/Wrong.sol:MemeLaunchV3";
  wrongSourceIdentity.evidenceDigest = digestJson(
    Object.fromEntries(
      Object.entries(wrongSourceIdentity).filter(
        ([key]) => key !== "evidenceDigest",
      ),
    ),
    CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
  );
  assert.throws(
    () =>
      validateClassicV4SourceEvidence(plan, deployment, wrongSourceIdentity),
    /source identity differs/,
  );

  const missingQuadrant = structuredClone(lifecycle);
  delete missingQuadrant.actions.sellExactOutput;
  missingQuadrant.evidenceDigest = digestJson(
    Object.fromEntries(
      Object.entries(missingQuadrant).filter(
        ([key]) => key !== "evidenceDigest",
      ),
    ),
    CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
  );
  assert.throws(
    () =>
      validateClassicV4LifecycleEvidence(
        plan,
        deployment,
        source,
        missingQuadrant,
      ),
    /Lifecycle actions keys differ/,
  );
});

test("duplicate deployment transactions and self-certified release prerequisites fail closed", async () => {
  const plan = preparationPlan();
  const deployment = deploymentEvidence(plan);
  const source = sourceEvidence(plan, deployment);

  const duplicate = structuredClone(deployment);
  duplicate.contracts.feeHook.transactionHash =
    duplicate.contracts.hookFactory.transactionHash;
  const duplicateUnsigned = structuredClone(duplicate);
  delete duplicateUnsigned.evidenceDigest;
  duplicate.evidenceDigest = digestJson(
    duplicateUnsigned,
    CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
  );
  assert.throws(
    () => validateClassicV4DeploymentEvidence(plan, duplicate),
    /transaction hashes must be unique/,
  );

  const fabricatedDeployment = structuredClone(deployment);
  fabricatedDeployment.contracts.feeHook.runtimeCodeHash = txHash(
    "fabricated-runtime",
  );
  const fabricatedDeploymentUnsigned = structuredClone(fabricatedDeployment);
  delete fabricatedDeploymentUnsigned.evidenceDigest;
  fabricatedDeployment.evidenceDigest = digestJson(
    fabricatedDeploymentUnsigned,
    CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
  );
  assert.doesNotThrow(() =>
    validateClassicV4DeploymentEvidence(plan, fabricatedDeployment),
  );
  assert.throws(
    () => assertFreshDeploymentEvidence(fabricatedDeployment, deployment),
    /fresh fixed-block independent two-RPC verification/,
  );
  await assert.rejects(
    verifyClassicV4ReleasePrerequisites({
      endpoints: ["https://rpc-a.example", "https://rpc-b.example"],
      plan,
      deploymentEvidence: fabricatedDeployment,
      sourceEvidence: source,
      artifacts,
      deploymentVerifier: async () => deployment,
      sourceVerifier: async () => source,
    }),
    /fresh fixed-block independent two-RPC verification/,
  );

  const fabricatedSource = structuredClone(source);
  fabricatedSource.contracts.feeHook.providers.push({
    name: "Etherscan",
    status: "exact-match",
    url: `https://etherscan.io/address/${deployment.contracts.feeHook.address}#code`,
  });
  const fabricatedSourceUnsigned = structuredClone(fabricatedSource);
  delete fabricatedSourceUnsigned.evidenceDigest;
  fabricatedSource.evidenceDigest = digestJson(
    fabricatedSourceUnsigned,
    CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
  );
  assert.doesNotThrow(() =>
    validateClassicV4SourceEvidence(plan, deployment, fabricatedSource),
  );
  assert.throws(
    () => assertFreshSourceEvidence(fabricatedSource, source),
    /fresh source-provider verification/,
  );
  await assert.rejects(
    verifyClassicV4ReleasePrerequisites({
      endpoints: ["https://rpc-a.example", "https://rpc-b.example"],
      plan,
      deploymentEvidence: deployment,
      sourceEvidence: fabricatedSource,
      artifacts,
      deploymentVerifier: async () => deployment,
      sourceVerifier: async () => source,
    }),
    /fresh source-provider verification/,
  );

  const futureSource = structuredClone(source);
  futureSource.checkedAt = "2099-01-01T00:00:00.000Z";
  const futureUnsigned = structuredClone(futureSource);
  delete futureUnsigned.evidenceDigest;
  futureSource.evidenceDigest = digestJson(
    futureUnsigned,
    CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
  );
  await assert.rejects(
    verifyClassicV4ReleasePrerequisites({
      endpoints: ["https://rpc-a.example", "https://rpc-b.example"],
      plan,
      deploymentEvidence: deployment,
      sourceEvidence: futureSource,
      artifacts,
      deploymentVerifier: async () => deployment,
      sourceVerifier: async () => source,
    }),
    /checkedAt is later than the fresh provider replay/,
  );
});

test("final manifest is schema-valid and exposes exact indexer handoff", () => {
  const plan = preparationPlan();
  const deployment = deploymentEvidence(plan);
  const source = sourceEvidence(plan, deployment);
  const lifecycle = lifecycleEvidence(plan, deployment, source);
  const manifest = createClassicV4ReleaseManifest({
    plan,
    deploymentEvidence: deployment,
    sourceEvidence: source,
    lifecycleEvidence: lifecycle,
    capturedAt: lifecycle.checkedAt,
  });
  assert.equal(manifest.startBlock, 25_700_100);
  assert.equal(
    manifest.deploymentVerification.verificationBlock,
    deployment.verificationBlock,
  );
  assert.equal(
    manifest.deploymentVerification.evidenceDigest,
    deployment.evidenceDigest,
  );
  assert.equal(manifest.indexerHandoff.sources.launcher.startBlock, 25_700_103);
  assert.equal(manifest.indexerHandoff.sources.feeHook.startBlock, 25_700_101);
  assert.deepEqual(
    manifest.indexerHandoff.sources.launcher.events,
    CLASSIC_V4_INDEXER_LAUNCHER_EVENTS,
  );
  assert.deepEqual(
    manifest.indexerHandoff.sources.feeHook.events,
    CLASSIC_V4_INDEXER_HOOK_EVENTS,
  );
  assert.ok(!manifest.indexerHandoff.sources.feeHook.events.includes("HookFee"));
  assert.ok(!manifest.indexerHandoff.sources.feeHook.events.includes("HookSwap"));
  assert.equal(manifest.indexerHandoff.releaseVersion, "classic-v4");
  assert.equal(manifest.indexerHandoff.activationEligible, true);
  assert.equal(manifest.indexerHandoff.activated, false);
  assert.equal(manifest.verification.indexerActivated, false);
  assert.equal(manifest.verification.publicAvailable, false);
  assert.equal(
    validateSchema(manifest),
    true,
    JSON.stringify(validateSchema.errors),
  );

  const contradictory = structuredClone(manifest);
  contradictory.releaseStatus = "publicly-available";
  const contradictoryCore = structuredClone(contradictory);
  delete contradictoryCore.manifestDigest;
  contradictory.manifestDigest = digestJson(
    contradictoryCore,
    CLASSIC_V4_DIGEST_DOMAINS.releaseManifest,
  );
  assert.equal(validateSchema(contradictory), false);

  for (const mutate of [
    (value) => value.indexerHandoff.sources.feeHook.events.push("HookFee"),
    (value) => value.indexerHandoff.sources.feeHook.events.pop(),
    (value) => value.indexerHandoff.sources.feeHook.events.reverse(),
  ]) {
    const inexactEvents = structuredClone(manifest);
    mutate(inexactEvents);
    assert.equal(validateSchema(inexactEvents), false);
  }
});

test("capture requires a fresh two-RPC lifecycle result", () => {
  const plan = preparationPlan();
  const deployment = deploymentEvidence(plan);
  const source = sourceEvidence(plan, deployment);
  const lifecycle = lifecycleEvidence(plan, deployment, source);
  assert.doesNotThrow(() =>
    assertFreshLifecycleEvidence(lifecycle, structuredClone(lifecycle)),
  );

  const stale = structuredClone(lifecycle);
  stale.checkedAt = "2026-08-27T10:15:01.000Z";
  assert.throws(
    () => assertFreshLifecycleEvidence(lifecycle, stale),
    /fresh independent two-RPC verification/,
  );

  const capture = path.join(
    repositoryRoot,
    "contracts/scripts/capture-classic-v4-mainnet-release.mjs",
  );
  const oldFileOnlyPath = spawnSync(
    process.execPath,
    [
      capture,
      "--plan=/tmp/classic-v4-plan.json",
      "--deployment-evidence=/tmp/classic-v4-deployment.json",
      "--source-evidence=/tmp/classic-v4-source.json",
      "--lifecycle-evidence=/tmp/classic-v4-lifecycle.json",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.notEqual(oldFileOnlyPath.status, 0);
  assert.match(oldFileOnlyPath.stderr, /--canary-plan is required/);
});

test("lifecycle receipts, calldata, quotes, claims and global baseline cannot self-certify", () => {
  const plan = preparationPlan();
  const deployment = deploymentEvidence(plan);
  const source = sourceEvidence(plan, deployment);
  const lifecycle = lifecycleEvidence(plan, deployment, source);
  const redigest = (value) => {
    value.evidenceDigest = digestJson(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "evidenceDigest"),
      ),
      CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
    );
    return value;
  };

  const forgedCalldata = redigest(structuredClone(lifecycle));
  forgedCalldata.actions.buyExactInput.inputHash = txHash("forged-calldata");
  redigest(forgedCalldata);
  assert.throws(
    () =>
      validateClassicV4LifecycleEvidence(
        plan,
        deployment,
        source,
        forgedCalldata,
      ),
    /calldata differs from the canary plan/,
  );

  const forgedQuote = structuredClone(lifecycle);
  forgedQuote.swaps.buyExactOutput.quote.quotedAmount = (
    BigInt(forgedQuote.swaps.buyExactOutput.quote.quotedAmount) + 1n
  ).toString();
  redigest(forgedQuote);
  assert.throws(
    () =>
      validateClassicV4LifecycleEvidence(
        plan,
        deployment,
        source,
        forgedQuote,
      ),
    /canonical quote binding differs/,
  );

  const foreignBaseline = structuredClone(lifecycle);
  foreignBaseline.feeConservation.checkpoints.preLaunch.hook.launcherFeesAccrued =
    "1";
  redigest(foreignBaseline);
  assert.throws(
    () =>
      validateClassicV4LifecycleEvidence(
        plan,
        deployment,
        source,
        foreignBaseline,
      ),
    /Pre-launch hook accounting differs/,
  );

  const forgedClaim = structuredClone(lifecycle);
  forgedClaim.claims.creator.beneficiaryAmount = (
    BigInt(forgedClaim.claims.creator.beneficiaryAmount) + 1n
  ).toString();
  redigest(forgedClaim);
  assert.throws(
    () =>
      validateClassicV4LifecycleEvidence(
        plan,
        deployment,
        source,
        forgedClaim,
      ),
    /claims do not equal exact canary accruals/,
  );

  const forgedOrder = structuredClone(lifecycle);
  forgedOrder.actions.sellExactOutput.blockNumber =
    forgedOrder.actions.sellExactInput.blockNumber;
  forgedOrder.actions.sellExactOutput.confirmations =
    forgedOrder.verificationBlock -
    forgedOrder.actions.sellExactOutput.blockNumber +
    1;
  redigest(forgedOrder);
  assert.throws(
    () =>
      validateClassicV4LifecycleEvidence(
        plan,
        deployment,
        source,
        forgedOrder,
      ),
    /not canonically ordered/,
  );

  const forgedLock = structuredClone(lifecycle);
  forgedLock.postState.positionLock.timelockBlockNumber = "123";
  redigest(forgedLock);
  assert.throws(
    () =>
      validateClassicV4LifecycleEvidence(
        plan,
        deployment,
        source,
        forgedLock,
      ),
    /Permanent Deep30 position lock differs/,
  );
});

test("canary preparation covers launch, all four swap quadrants and both claims", () => {
  const plan = preparationPlan();
  const deployment = deploymentEvidence(plan);
  const source = sourceEvidence(plan, deployment);
  const lifecycle = lifecycleEvidence(plan, deployment, source);
  const manifest = createClassicV4ReleaseManifest({
    plan,
    deploymentEvidence: deployment,
    sourceEvidence: source,
    lifecycleEvidence: lifecycle,
    capturedAt: lifecycle.checkedAt,
  });
  const canary = buildClassicV4LifecycleCanaryPlan(
    manifest,
    "0xa11CE00000000000000000000000000000000004",
  );
  assert.deepEqual(
    canary.actions.map((action) => action.key),
    CLASSIC_V4_LIFECYCLE_ACTIONS,
  );
  assert.equal(canary.launchFixture.liquidityPreset, 1);
  assert.equal(canary.launchFixture.name, "Programmable Classic V4 Canary");
  assert.equal(canary.swapFixture.slippageBps, 100);
  assert.equal(canary.universalRouterBinding.version, "V2_0");
  assert.equal(canary.universalRouterBinding.exactInputSingleAction, "0x06");
  assert.equal(canary.universalRouterBinding.exactOutputSingleAction, "0x08");
  assert.equal(canary.executionBoundary.signs, false);
  assert.equal(canary.executionBoundary.broadcasts, false);
  assert.match(canary.actions[1].guard, /amountOutMinimum>0/);
  assert.match(canary.actions[2].guard, /amountInMaximum>0/);
  assert.equal(
    canary.actions.at(-1).requiredSigner,
    manifest.addresses.launcherFeeRecipient,
  );
});

test("operational canary preparation fails closed until the canonical Router handoff exists", async () => {
  const source = await readFile(
    path.join(
      repositoryRoot,
      "contracts/scripts/prepare-classic-v4-lifecycle-canary.mjs",
    ),
    "utf8",
  );
  const prerequisite = source.indexOf("await verifyClassicV4ReleasePrerequisites");
  const blocker = source.indexOf("Canonical Classic Router handoff is not installed");
  const planConstruction = source.indexOf(
    "const canaryPlan = buildClassicV4LifecycleCanaryPlan",
  );
  assert.ok(prerequisite >= 0);
  assert.ok(blocker > prerequisite);
  assert.ok(planConstruction > blocker);
});

test("every operator rejects private keys and broadcast flags", () => {
  for (const operator of [
    "prepare-classic-v4-mainnet-release.mjs",
    "verify-classic-v4-mainnet-deployment.mjs",
    "verify-classic-v4-mainnet-sources.mjs",
    "prepare-classic-v4-lifecycle-canary.mjs",
    "verify-classic-v4-lifecycle-canary.mjs",
    "capture-classic-v4-mainnet-release.mjs",
  ]) {
    const file = path.join(repositoryRoot, "contracts/scripts", operator);
    for (const forbidden of [
      "--private-key=CLASSIC_V4_SECRET_SENTINEL",
      "--mnemonic=CLASSIC_V4_SECRET_SENTINEL",
      "--broadcast",
    ]) {
      const result = spawnSync(process.execPath, [file, forbidden], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0, `${operator} accepted ${forbidden}`);
      assert.match(result.stderr, /forbidden/);
      assert.doesNotMatch(result.stderr, /CLASSIC_V4_SECRET_SENTINEL/);
      assert.doesNotMatch(result.stdout, /CLASSIC_V4_SECRET_SENTINEL/);
    }
    const unknown = spawnSync(
      process.execPath,
      [file, "--unknown=CLASSIC_V4_SECRET_SENTINEL"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.notEqual(unknown.status, 0);
    assert.doesNotMatch(unknown.stderr, /CLASSIC_V4_SECRET_SENTINEL/);
    assert.doesNotMatch(unknown.stdout, /CLASSIC_V4_SECRET_SENTINEL/);
  }
});

test("preparation rejects two aliases on one RPC hostname", () => {
  const file = path.join(
    repositoryRoot,
    "contracts/scripts/prepare-classic-v4-mainnet-release.mjs",
  );
  const result = spawnSync(
    process.execPath,
    [
      file,
      "--deployer=0xa11CE00000000000000000000000000000000004",
      "--rpc-a=https://rpc.example/a",
      "--rpc-b=https://rpc.example/b",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /independent Mainnet RPC hostnames/);
});

test("Sourcify v2 lookup requests exact source fields and preserves canonical evidence URLs", async () => {
  const plan = preparationPlan();
  const deployment = deploymentEvidence(plan);
  const nameByAddress = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name) => [
      deployment.contracts[name].address.toLowerCase(),
      name,
    ]),
  );
  const requestedUrls = [];
  const evidence = await verifyClassicV4SourceProviders({
    plan,
    deploymentEvidence: deployment,
    artifacts,
    checkedAt: "2026-08-27T10:05:00.000Z",
    etherscanApiKey: null,
    fetchJsonClient: async (url) => {
      requestedUrls.push(url.toString());
      assert.deepEqual([...url.searchParams.entries()], [["fields", "sources"]]);
      const address = url.pathname.split("/").at(-1).toLowerCase();
      const name = nameByAddress[address];
      assert.ok(name, `Unexpected Sourcify address ${address}`);
      return {
        match: "exact_match",
        creationMatch: "exact_match",
        runtimeMatch: "exact_match",
        sources: Object.fromEntries(
          Object.keys(artifacts[name].metadata.sources).map((sourcePath) => [
            sourcePath,
            {
              content: sourcePath.startsWith("src/")
                ? `source:${name}`
                : "dependency:v4-core:Test.sol",
            },
          ]),
        ),
      };
    },
  });
  assert.equal(requestedUrls.length, CLASSIC_V4_NEW_CONTRACTS.length);
  for (const name of CLASSIC_V4_NEW_CONTRACTS) {
    assert.equal(
      evidence.contracts[name].providers[0].url,
      `https://sourcify.dev/server/v2/contract/1/${deployment.contracts[name].address}`,
    );
  }
});

test("source providers require exact matches and reject Etherscan similarity", () => {
  const providerArtifact = artifacts.launcher;
  const providerSources = {
    "src/launcher.sol": { content: "source:launcher" },
    "lib/v4-core/src/Test.sol": {
      content: "dependency:v4-core:Test.sol",
    },
  };
  const sourcify = {
    match: "exact_match",
    creationMatch: "exact_match",
    runtimeMatch: "exact_match",
    sources: providerSources,
  };
  assert.doesNotThrow(() =>
    assertExactSourcifyMatch(sourcify, "0xa11ce", providerArtifact),
  );
  assert.throws(
    () =>
      assertExactSourcifyMatch(
        { ...sourcify, runtimeMatch: "match" },
        "0xa11ce",
        providerArtifact,
      ),
    /not a Sourcify exact match/,
  );
  assert.throws(
    () =>
      assertExactSourcifyMatch(
        {
          match: "exact_match",
          creationMatch: "exact_match",
          runtimeMatch: "exact_match",
        },
        "0xa11ce",
        providerArtifact,
      ),
    /source path closure differs/,
  );

  const target = {
    contractName: "MemeLaunchV3",
    fqcn: "src/MemeLaunchV3.sol:MemeLaunchV3",
  };
  const settings = {
    compilerVersion: "v0.8.26+commit.8a97fa7a",
    optimizationUsed: "1",
    optimizerRuns: "1000",
    evmVersion: "cancun",
  };
  const source = {
    ContractName: target.contractName,
    ContractFileName: "src/MemeLaunchV3.sol",
    CompilerType: "solc",
    CompilerVersion: settings.compilerVersion,
    OptimizationUsed: settings.optimizationUsed,
    Runs: settings.optimizerRuns,
    EVMVersion: settings.evmVersion,
    Proxy: "0",
    Implementation: "",
    SimilarMatch: "",
    ConstructorArguments: "1234",
    SourceCode: JSON.stringify({
      language: "Solidity",
      sources: providerSources,
      settings: {},
    }),
  };
  assert.doesNotThrow(() =>
    assertExactEtherscanMatch(
      { status: "1" },
      source,
      target,
      "0x1234",
      settings,
      providerArtifact,
    ),
  );
  assert.throws(
    () =>
      assertExactEtherscanMatch(
        { status: "1" },
        {
          ...source,
          SimilarMatch: "0x0000000000000000000000000000000000000001",
        },
        target,
        "0x1234",
        settings,
        providerArtifact,
      ),
    /Etherscan metadata differs/,
  );
  assert.throws(
    () =>
      assertExactEtherscanMatch(
        { status: "1" },
        {
          ...source,
          SourceCode: JSON.stringify({
            language: "Solidity",
            sources: {
              ...providerSources,
              "src/launcher.sol": { content: "forged source bytes" },
            },
          }),
        },
        target,
        "0x1234",
        settings,
        providerArtifact,
      ),
    /source bytes differ/,
  );
  assert.throws(
    () =>
      assertExactSourcifyMatch(
        {
          ...sourcify,
          sources: {
            ...providerSources,
            "lib/rogue/Rogue.sol": { content: "contract Rogue {}" },
          },
        },
        "0xa11ce",
        providerArtifact,
      ),
    /source path closure differs/,
  );
  assert.throws(
    () =>
      assertExactSourcifyMatch(
        {
          ...sourcify,
          sources: {
            ...providerSources,
            "src/launcher.sol": { content: "forged source bytes" },
          },
        },
        "0xa11ce",
        providerArtifact,
      ),
    /source bytes differ at src\/launcher\.sol/,
  );
});
