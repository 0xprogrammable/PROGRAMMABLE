import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  http,
  isAddress,
  isHex,
  keccak256,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import appDeployments from "@/contracts/config/app-deployments.v1.json";
import deploymentInputs from "@/contracts/config/deployment-inputs.v1.json";
import mainnetDeployments from "@/contracts/dependencies/ethereum-mainnet.json";
import sepoliaDeployments from "@/contracts/dependencies/ethereum-sepolia.json";
import { isClassicDeploymentReady } from "@/lib/launch-deployment";
import {
  classicV3HookAbi,
  classicV3HookFactoryAbi,
  classicV3LaunchAbi,
  encodeClassicV3Launch,
  isClassicV3DeploymentReady,
  validateClassicV3LaunchDraft,
  type ClassicV3DeploymentManifest,
} from "@/lib/classic-v3";
import {
  buildPlanHash,
  adaptiveCurveHookFactoryAbi,
  adaptiveCurveLaunchAbi,
  encodeAdaptiveLaunch,
  encodeMemeLaunch,
  ethCreatorFeeHookAbi,
  ethCreatorFeeHookFactoryAbi,
  LaunchInputError,
  lockedPositionFeeForwarderFactoryAbi,
  memeLaunchAbi,
  type LaunchPreflightCheck,
  type LaunchPreflightResponse,
  type PreparedLaunchTransaction,
  validateMemeLaunchDraft,
  validateAdaptiveLaunchDraft,
} from "@/lib/launch-transaction";
import {
  createEmptyDraft,
  MEME_MIN_INITIAL_BUY_WEI,
  parseOptionalInitialBuyWei,
  parseInitialBuyWei,
  type LaunchDraft,
} from "@/lib/launch";
import { safeServerErrorSummary } from "@/lib/server/safe-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 50_000;
const REQUIRED_FEE_HOOK_FLAGS = 8_396n;
const HOOK_FLAG_MASK = (1n << 14n) - 1n;

const launchEnvironment =
  process.env.PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const launchChain = launchEnvironment === "rehearsal" ? sepolia : mainnet;
const networkName =
  launchEnvironment === "rehearsal" ? "Sepolia" : "Ethereum";
const selectedDeployments =
  launchEnvironment === "rehearsal"
    ? sepoliaDeployments
    : mainnetDeployments;
const selectedManifest =
  appDeployments[launchEnvironment] as ReleaseDeployment;

const client = createPublicClient({
  chain: launchChain,
  transport: http(
    launchEnvironment === "rehearsal"
      ? process.env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org"
      : process.env.ETHEREUM_RPC_URL ?? "https://eth.drpc.org",
    {
      retryCount: 1,
      timeout: 12_000,
    },
  ),
});

const officialPoolManager = getAddress(
  selectedDeployments.contracts.poolManager.address,
);
const officialPositionManager = getAddress(
  selectedDeployments.contracts.positionManager.address,
);
const officialTokenFactory = getAddress(
  selectedDeployments.contracts.uerc20Factory.address,
);
const platformTreasury = getAddress(deploymentInputs.platform.treasury);

type ReleaseDeployment = {
  chainId: number;
  status: "not-deployed" | "ready" | "requires-redeploy";
  memeLaunchStatus:
    | "not-deployed"
    | "ready"
    | "requires-redeploy"
    | "lifecycle-pending";
  adaptiveLaunchStatus: "not-deployed" | "ready" | "requires-redeploy";
  classicV3Status?: "not-deployed" | "ready" | "requires-redeploy";
  ethCreatorFeeHookFactory: string | null;
  ethCreatorFeeHook: string | null;
  memeLaunch: string | null;
  adaptiveCurveFeeHookFactory: string | null;
  adaptiveCurveLaunch: string | null;
  ethCreatorFeeHookFactoryV3?: string | null;
  ethCreatorFeeHookV3?: string | null;
  feeSplitVaultFactoryV1?: string | null;
  memeLaunchV2?: string | null;
  lockedPositionFeeForwarderFactory: string | null;
  runtimeCodeHashes: {
    ethCreatorFeeHookFactory: string | null;
    ethCreatorFeeHook: string | null;
    memeLaunch: string | null;
    adaptiveCurveFeeHookFactory: string | null;
    adaptiveCurveLaunch: string | null;
    ethCreatorFeeHookFactoryV3?: string | null;
    ethCreatorFeeHookV3?: string | null;
    feeSplitVaultFactoryV1?: string | null;
    memeLaunchV2?: string | null;
    lockedPositionFeeForwarderFactory: string | null;
  };
  deploymentBlocks?: {
    memeLaunchV2?: number | null;
  };
};

function response(body: LaunchPreflightResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function parseDraft(input: unknown): LaunchDraft {
  if (!input || typeof input !== "object") {
    throw new LaunchInputError("The launch setup is missing");
  }

  const raw = input as Record<string, unknown>;
  const draft = createEmptyDraft();
  const stringFields = [
    "tokenName",
    "tokenSymbol",
    "tokenDescription",
    "tokenWebsite",
    "tokenImage",
    "tokenX",
    "tokenTelegram",
    "totalSwapFeePercent",
    "initialBuyEth",
    "launchSalt",
    "hookSaltNonce",
    "buySwapFeePercent",
    "sellSwapFeePercent",
    "rewardExternalAddress",
    "updatedAt",
  ] as const;

  for (const field of stringFields) {
    if (typeof raw[field] === "string") {
      draft[field] = raw[field];
    }
  }

  if (raw.launchModel === "adaptive") {
    draft.launchModel = "adaptive";
  } else if (raw.launchModel === "classic-v3") {
    draft.launchModel = "classic-v3";
  }
  if (
    raw.rewardDestinationMode === "launcher" ||
    raw.rewardDestinationMode === "external" ||
    raw.rewardDestinationMode === "split"
  ) {
    draft.rewardDestinationMode = raw.rewardDestinationMode;
  }
  if (Array.isArray(raw.rewardSplits)) {
    draft.rewardSplits = raw.rewardSplits.slice(0, 8).map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new LaunchInputError("The reward split is invalid");
      }
      const row = value as Record<string, unknown>;
      if (
        typeof row.beneficiary !== "string" ||
        typeof row.sharePercent !== "string"
      ) {
        throw new LaunchInputError("The reward split is invalid");
      }
      return {
        beneficiary: row.beneficiary,
        sharePercent: row.sharePercent,
      };
    });
  }
  if (Array.isArray(raw.adaptiveCurvePoints)) {
    draft.adaptiveCurvePoints = raw.adaptiveCurvePoints
      .slice(0, 8)
      .map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new LaunchInputError("The Adaptive curve is invalid");
        }
        const point = value as Record<string, unknown>;
        if (
          typeof point.fdvIndex !== "number" ||
          !Number.isSafeInteger(point.fdvIndex) ||
          typeof point.totalSwapFeeBps !== "number" ||
          !Number.isSafeInteger(point.totalSwapFeeBps)
        ) {
          throw new LaunchInputError("The Adaptive curve is invalid");
        }
        return {
          fdvIndex: point.fdvIndex,
          totalSwapFeeBps: point.totalSwapFeeBps,
        };
      });
  }

  // The API intentionally ignores obsolete client-supplied product switches.
  draft.assetMode = "new";
  draft.tokenSupply = "1000000000";
  draft.liquidityMode = "meme";
  draft.selectedBehaviors = ["fixed-fee"];
  draft.lpFeePercent = "0";
  return draft;
}

function walletCheck(
  account: Address,
  walletChainId: unknown,
): LaunchPreflightCheck {
  const decimalChainId = launchChain.id;
  const hexadecimalChainId = `0x${decimalChainId.toString(16)}`;
  const onSelectedNetwork =
    walletChainId === hexadecimalChainId ||
    walletChainId === String(decimalChainId) ||
    walletChainId === `eip155:${decimalChainId}` ||
    walletChainId === decimalChainId;
  return {
    id: "wallet",
    label: "Wallet",
    status: onSelectedNetwork ? "pass" : "blocked",
    detail: onSelectedNetwork
      ? `${account.slice(0, 6)}…${account.slice(-4)} on ${networkName}`
      : `Switch the connected wallet to ${networkName}`,
  };
}

function validateLaunchSalt(value: string): asserts value is Hex {
  if (!isHex(value, { strict: true }) || value.length !== 66) {
    throw new LaunchInputError(
      "Create a fresh launch identifier before checking the transaction",
    );
  }
}

async function assertRuntimeCodeHash(
  address: Address,
  expected: Hex,
  label: string,
) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new Error(`${label} has no runtime bytecode`);
  }
  const actual = keccak256(code);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `${label} runtime bytecode does not match the release manifest`,
    );
  }
}

async function estimatePreparedTransaction(
  account: Address,
  transaction: Omit<PreparedLaunchTransaction, "gasLimit">,
) {
  const value = BigInt(transaction.value);
  const balance = await client.getBalance({ address: account });
  if (balance <= value) {
    throw new LaunchInputError(
      "The wallet does not have enough ETH for this transaction and network fees",
    );
  }

  await client.call({
    account,
    to: transaction.to,
    data: transaction.data,
    value,
  });
  const [estimatedGas, gasPrice] = await Promise.all([
    client.estimateGas({
      account,
      to: transaction.to,
      data: transaction.data,
      value,
    }),
    client.getGasPrice(),
  ]);
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;

  if (balance < value + gasLimit * gasPrice) {
    throw new LaunchInputError(
      "The wallet does not have enough ETH for this transaction and the current network fee",
    );
  }
  return gasLimit;
}

async function assertMemeReleaseInfrastructure(
  launcher: Address,
  feeHook: Address,
  hookFactory: Address,
  positionForwarderFactory: Address,
  codeHashes: {
    ethCreatorFeeHookFactory: Hex;
    ethCreatorFeeHook: Hex;
    memeLaunch: Hex;
    lockedPositionFeeForwarderFactory: Hex;
  },
) {
  await Promise.all([
    assertRuntimeCodeHash(
      officialPoolManager,
      selectedDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
    ),
    assertRuntimeCodeHash(
      officialPositionManager,
      selectedDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
    ),
    assertRuntimeCodeHash(
      officialTokenFactory,
      selectedDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
    ),
    assertRuntimeCodeHash(
      hookFactory,
      codeHashes.ethCreatorFeeHookFactory,
      "ETH creator fee hook factory",
    ),
    assertRuntimeCodeHash(
      feeHook,
      codeHashes.ethCreatorFeeHook,
      "ETH creator fee hook",
    ),
    assertRuntimeCodeHash(
      positionForwarderFactory,
      codeHashes.lockedPositionFeeForwarderFactory,
      "Locked position factory",
    ),
    assertRuntimeCodeHash(
      launcher,
      codeHashes.memeLaunch,
      "Classic",
    ),
  ]);

  const [
    configuredPoolManager,
    configuredPositionManager,
    configuredTokenFactory,
    configuredFeeHook,
    configuredForwarderFactory,
    forwarderPositionManager,
    hookPoolManager,
    hookTreasury,
    launcherFeeBps,
    lpFeePips,
    tickSpacing,
    minimumInitialBuyWei,
    factoryRecognizesHook,
  ] = await Promise.all([
    client.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "tokenFactory",
    }),
    client.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "feeHook",
    }),
    client.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "positionForwarderFactory",
    }),
    client.readContract({
      address: positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "launcherFeeRecipient",
    }),
    client.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "LAUNCHER_FEE_BPS",
    }),
    client.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "LP_FEE_PIPS",
    }),
    client.readContract({
      address: feeHook,
      abi: ethCreatorFeeHookAbi,
      functionName: "TICK_SPACING",
    }),
    client.readContract({
      address: launcher,
      abi: memeLaunchAbi,
      functionName: "MIN_INITIAL_BUY_WEI",
    }),
    client.readContract({
      address: hookFactory,
      abi: ethCreatorFeeHookFactoryAbi,
      functionName: "isFactoryHook",
      args: [feeHook],
    }),
  ]);

  const expected = [
    [configuredPoolManager, officialPoolManager, "PoolManager"],
    [configuredPositionManager, officialPositionManager, "PositionManager"],
    [configuredTokenFactory, officialTokenFactory, "UERC20Factory"],
    [configuredFeeHook, feeHook, "fee hook"],
    [configuredForwarderFactory, positionForwarderFactory, "position factory"],
    [
      forwarderPositionManager,
      officialPositionManager,
      "position factory PositionManager",
    ],
    [hookPoolManager, officialPoolManager, "hook PoolManager"],
    [hookTreasury, platformTreasury, "treasury"],
  ] as const;

  for (const [actual, wanted, label] of expected) {
    if (actual.toLowerCase() !== wanted.toLowerCase()) {
      throw new Error(
        `The Classic ${label} does not match the release manifest`,
      );
    }
  }

  if (!factoryRecognizesHook) {
    throw new Error("The fee hook was not deployed by the release factory");
  }
  if (
    launcherFeeBps !== 10 ||
    lpFeePips !== 0 ||
    tickSpacing !== 200 ||
    minimumInitialBuyWei !== MEME_MIN_INITIAL_BUY_WEI
  ) {
    throw new Error(
      "The fee hook economics do not match the release manifest",
    );
  }
  if ((BigInt(feeHook) & HOOK_FLAG_MASK) !== REQUIRED_FEE_HOOK_FLAGS) {
    throw new Error(
      "The fee hook callback mask does not match the release manifest",
    );
  }
}

async function prepareMemeLaunch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
  deployment: ReleaseDeployment,
) {
  const totalSwapFeeBps = validateMemeLaunchDraft(draft);
  const initialBuyWei = parseInitialBuyWei(draft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new LaunchInputError("Enter a valid Dev Buy");
  }
  validateLaunchSalt(draft.launchSalt);

  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Token setup",
    status: "pass",
    detail: `Fixed supply, locked one-sided liquidity and ${(
      totalSwapFeeBps / 100
    ).toFixed(2)}% fixed total swap fee are valid`,
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "meme",
      title: `Switch the wallet to ${networkName}`,
      detail: `The launch transaction is fixed to ${networkName}`,
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Programmable contracts",
          status: "pending",
          detail: "Verification continues after the network is corrected",
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pending",
          detail: "Waiting for the wallet network",
        },
      ],
    });
  }

  const {
    ethCreatorFeeHookFactory,
    ethCreatorFeeHook,
    memeLaunch,
    lockedPositionFeeForwarderFactory,
    runtimeCodeHashes,
  } = deployment;
  if (
    !isClassicDeploymentReady(deployment, launchChain.id) ||
    !ethCreatorFeeHookFactory ||
    !ethCreatorFeeHook ||
    !memeLaunch ||
    !lockedPositionFeeForwarderFactory ||
    !runtimeCodeHashes.ethCreatorFeeHookFactory ||
    !runtimeCodeHashes.ethCreatorFeeHook ||
    !runtimeCodeHashes.memeLaunch ||
    !runtimeCodeHashes.lockedPositionFeeForwarderFactory
  ) {
    return response({
      status: "blocked",
      mode: "meme",
      title: `Classic is not deployed on ${networkName} yet`,
      detail:
        `Wallet transactions stay disabled until the exact ${networkName} release is deployed and verified`,
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Programmable contracts",
          status: "blocked",
          detail:
            `No approved ${networkName} deployment is recorded in the release manifest`,
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pending",
          detail: "Runs only against the recorded release deployment",
        },
      ],
    });
  }

  const launcher = getAddress(memeLaunch);
  const hook = getAddress(ethCreatorFeeHook);
  const hookFactory = getAddress(ethCreatorFeeHookFactory);
  const positionForwarderFactory = getAddress(
    lockedPositionFeeForwarderFactory,
  );
  await assertMemeReleaseInfrastructure(
    launcher,
    hook,
    hookFactory,
    positionForwarderFactory,
    {
      ethCreatorFeeHookFactory:
        runtimeCodeHashes.ethCreatorFeeHookFactory as Hex,
      ethCreatorFeeHook: runtimeCodeHashes.ethCreatorFeeHook as Hex,
      memeLaunch: runtimeCodeHashes.memeLaunch as Hex,
      lockedPositionFeeForwarderFactory:
        runtimeCodeHashes.lockedPositionFeeForwarderFactory as Hex,
    },
  );

  const [predictedToken] = await client.readContract({
    address: launcher,
    abi: memeLaunchAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const existingCode = await client.getCode({ address: predictedToken });
  if (existingCode && existingCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const launchBase = {
    kind: "launch" as const,
    chainId: launchChain.id,
    to: launcher,
    data: encodeMemeLaunch(draft, draft.launchSalt),
    value: initialBuyWei.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(account, launchBase);
  return response({
    status: "ready",
    mode: "meme",
    title: "Ready for wallet review",
    detail:
      `The exact launch and selected Dev Buy succeeded in a read-only ${networkName} simulation`,
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Programmable contracts",
        status: "pass",
        detail:
          "Runtime bytecode, immutable dependencies, fee split and permanent LP custody match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail:
          "The atomic token, locked-liquidity and Dev Buy transaction succeeds",
      },
    ],
    transaction: { ...launchBase, gasLimit: gasLimit.toString() },
    predictedToken,
    predictedHook: hook,
    planHash: buildPlanHash(account, launchBase),
  });
}

async function assertClassicV3Infrastructure(
  launcher: Address,
  hook: Address,
  hookFactory: Address,
  vaultFactory: Address,
  positionForwarderFactory: Address,
  codeHashes: {
    ethCreatorFeeHookFactoryV3: Hex;
    ethCreatorFeeHookV3: Hex;
    feeSplitVaultFactoryV1: Hex;
    memeLaunchV2: Hex;
    lockedPositionFeeForwarderFactory: Hex;
  },
) {
  await Promise.all([
    assertRuntimeCodeHash(
      officialPoolManager,
      selectedDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
    ),
    assertRuntimeCodeHash(
      officialPositionManager,
      selectedDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
    ),
    assertRuntimeCodeHash(
      officialTokenFactory,
      selectedDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
    ),
    assertRuntimeCodeHash(
      hookFactory,
      codeHashes.ethCreatorFeeHookFactoryV3,
      "Classic hook factory",
    ),
    assertRuntimeCodeHash(
      hook,
      codeHashes.ethCreatorFeeHookV3,
      "Classic hook",
    ),
    assertRuntimeCodeHash(
      vaultFactory,
      codeHashes.feeSplitVaultFactoryV1,
      "Classic reward factory",
    ),
    assertRuntimeCodeHash(
      positionForwarderFactory,
      codeHashes.lockedPositionFeeForwarderFactory,
      "Locked position factory",
    ),
    assertRuntimeCodeHash(
      launcher,
      codeHashes.memeLaunchV2,
      "Classic launcher",
    ),
  ]);

  const [
    configuredPoolManager,
    configuredPositionManager,
    configuredTokenFactory,
    configuredHook,
    configuredVaultFactory,
    configuredForwarderFactory,
    hookPoolManager,
    hookTreasury,
    hookVaultFactory,
    launcherFeeBps,
    minimumFeeBps,
    maximumFeeBps,
    feeStepBps,
    transferTaxBps,
    lpFeePips,
    tickSpacing,
    minimumInitialBuyWei,
    factoryRecognizesHook,
    forwarderPositionManager,
  ] = await Promise.all([
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "tokenFactory",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "feeHook",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "feeSplitVaultFactory",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "positionForwarderFactory",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "launcherFeeRecipient",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "feeSplitVaultFactory",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "LAUNCHER_FEE_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "MIN_TOTAL_SWAP_FEE_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "MAX_TOTAL_SWAP_FEE_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "TOTAL_SWAP_FEE_STEP_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "TRANSFER_TAX_BPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "LP_FEE_PIPS",
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "TICK_SPACING",
    }),
    client.readContract({
      address: launcher,
      abi: classicV3LaunchAbi,
      functionName: "MIN_INITIAL_BUY_WEI",
    }),
    client.readContract({
      address: hookFactory,
      abi: classicV3HookFactoryAbi,
      functionName: "isFactoryHook",
      args: [hook],
    }),
    client.readContract({
      address: positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "positionManager",
    }),
  ]);

  const expectedAddresses = [
    [configuredPoolManager, officialPoolManager, "PoolManager"],
    [configuredPositionManager, officialPositionManager, "PositionManager"],
    [configuredTokenFactory, officialTokenFactory, "UERC20Factory"],
    [configuredHook, hook, "fee hook"],
    [configuredVaultFactory, vaultFactory, "reward factory"],
    [configuredForwarderFactory, positionForwarderFactory, "position factory"],
    [hookPoolManager, officialPoolManager, "hook PoolManager"],
    [hookTreasury, platformTreasury, "treasury"],
    [hookVaultFactory, vaultFactory, "hook reward factory"],
    [
      forwarderPositionManager,
      officialPositionManager,
      "position factory PositionManager",
    ],
  ] as const;
  for (const [actual, expected, label] of expectedAddresses) {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `The Classic ${label} does not match the release manifest`,
      );
    }
  }
  if (
    !factoryRecognizesHook ||
    launcherFeeBps !== 10 ||
    minimumFeeBps !== 100 ||
    maximumFeeBps !== 1_000 ||
    feeStepBps !== 100 ||
    transferTaxBps !== 0 ||
    lpFeePips !== 0 ||
    tickSpacing !== 200 ||
    minimumInitialBuyWei !== MEME_MIN_INITIAL_BUY_WEI ||
    (BigInt(hook) & HOOK_FLAG_MASK) !== REQUIRED_FEE_HOOK_FLAGS
  ) {
    throw new Error(
      "The Classic economics do not match the release manifest",
    );
  }
}

async function prepareClassicV3Launch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
  deployment: ReleaseDeployment,
) {
  const configuration = validateClassicV3LaunchDraft(draft, account);
  const initialBuyWei = parseInitialBuyWei(draft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new LaunchInputError("Enter a valid Dev Buy");
  }
  validateLaunchSalt(draft.launchSalt);
  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Token setup",
    status: "pass",
    detail: `Immutable ${(configuration.fees.buySwapFeeBps / 100).toFixed(2)}% buy and ${(configuration.fees.sellSwapFeeBps / 100).toFixed(2)}% sell fees with ${configuration.rewards.beneficiaries.length} reward recipient${configuration.rewards.beneficiaries.length === 1 ? "" : "s"}`,
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "classic-v3",
      title: `Switch the wallet to ${networkName}`,
      detail: `The launch transaction is fixed to ${networkName}`,
      checks: [tokenCheck, connectedWalletCheck],
    });
  }
  if (
    !isClassicV3DeploymentReady(
      deployment as ClassicV3DeploymentManifest,
      launchChain.id,
    )
  ) {
    return response({
      status: "blocked",
      mode: "classic-v3",
      title: `Classic is not deployed on ${networkName} yet`,
      detail:
        "The setup is available for review. Wallet transactions stay disabled until every release address, runtime hash and deployment block is recorded",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Classic contracts",
          status: "blocked",
          detail: `No approved ${networkName} Classic deployment is recorded`,
        },
      ],
    });
  }

  const launcher = getAddress(deployment.memeLaunchV2 as string);
  const hook = getAddress(deployment.ethCreatorFeeHookV3 as string);
  const hookFactory = getAddress(
    deployment.ethCreatorFeeHookFactoryV3 as string,
  );
  const vaultFactory = getAddress(
    deployment.feeSplitVaultFactoryV1 as string,
  );
  const positionForwarderFactory = getAddress(
    deployment.lockedPositionFeeForwarderFactory as string,
  );
  await assertClassicV3Infrastructure(
    launcher,
    hook,
    hookFactory,
    vaultFactory,
    positionForwarderFactory,
    {
      ethCreatorFeeHookFactoryV3:
        deployment.runtimeCodeHashes.ethCreatorFeeHookFactoryV3 as Hex,
      ethCreatorFeeHookV3:
        deployment.runtimeCodeHashes.ethCreatorFeeHookV3 as Hex,
      feeSplitVaultFactoryV1:
        deployment.runtimeCodeHashes.feeSplitVaultFactoryV1 as Hex,
      memeLaunchV2: deployment.runtimeCodeHashes.memeLaunchV2 as Hex,
      lockedPositionFeeForwarderFactory:
        deployment.runtimeCodeHashes.lockedPositionFeeForwarderFactory as Hex,
    },
  );

  const [predictedToken] = await client.readContract({
    address: launcher,
    abi: classicV3LaunchAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const predictedRewardVault = await client.readContract({
    address: launcher,
    abi: classicV3LaunchAbi,
    functionName: "predictRewardVault",
    args: [
      predictedToken,
      account,
      configuration.rewards.beneficiaries,
      configuration.rewards.sharesBps,
    ],
  });
  const existingCode = await client.getCode({ address: predictedToken });
  if (existingCode && existingCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const launchBase = {
    kind: "launch" as const,
    chainId: launchChain.id,
    to: launcher,
    data: encodeClassicV3Launch(draft, draft.launchSalt, account),
    value: initialBuyWei.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(account, launchBase);
  return response({
    status: "ready",
    mode: "classic-v3",
    title: "Ready for wallet review",
    detail: `The exact Classic launch succeeded in a read-only ${networkName} simulation`,
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Classic contracts",
        status: "pass",
        detail:
          "Runtime bytecode, immutable directional fees and reward ownership match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail: `The token, locked liquidity and reward vault at ${predictedRewardVault.slice(0, 8)}…${predictedRewardVault.slice(-6)} are prepared atomically`,
      },
    ],
    transaction: { ...launchBase, gasLimit: gasLimit.toString() },
    predictedToken,
    predictedHook: hook,
    planHash: buildPlanHash(account, launchBase),
  });
}

const adaptiveHookSaltParameters = parseAbiParameters(
  "address creator,bytes32 creatorSalt,bytes32 hookSaltNonce",
);

function adaptiveEffectiveHookSalt(
  account: Address,
  launchSalt: Hex,
  hookSaltNonce: Hex,
) {
  return keccak256(
    encodeAbiParameters(adaptiveHookSaltParameters, [
      account,
      launchSalt,
      hookSaltNonce,
    ]),
  );
}

function mineAdaptiveHookSaltNonce(
  account: Address,
  launchSalt: Hex,
  factory: Address,
  initCodeHash: Hex,
) {
  for (let counter = 0; counter < 250_000; counter += 1) {
    const hookSaltNonce = toHex(counter, { size: 32 });
    const effectiveSalt = adaptiveEffectiveHookSalt(
      account,
      launchSalt,
      hookSaltNonce,
    );
    const hook = getCreate2Address({
      from: factory,
      salt: effectiveSalt,
      bytecodeHash: initCodeHash,
    });
    if ((BigInt(hook) & HOOK_FLAG_MASK) === REQUIRED_FEE_HOOK_FLAGS) {
      return { hookSaltNonce, hook };
    }
  }
  throw new Error("A valid deterministic Adaptive hook address was not found");
}

async function assertAdaptiveReleaseInfrastructure(
  launcher: Address,
  hookFactory: Address,
  positionForwarderFactory: Address,
  codeHashes: {
    adaptiveCurveFeeHookFactory: Hex;
    adaptiveCurveLaunch: Hex;
    lockedPositionFeeForwarderFactory: Hex;
  },
) {
  await Promise.all([
    assertRuntimeCodeHash(
      officialPoolManager,
      selectedDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
    ),
    assertRuntimeCodeHash(
      officialPositionManager,
      selectedDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
    ),
    assertRuntimeCodeHash(
      officialTokenFactory,
      selectedDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
    ),
    assertRuntimeCodeHash(
      hookFactory,
      codeHashes.adaptiveCurveFeeHookFactory,
      "Adaptive hook factory",
    ),
    assertRuntimeCodeHash(
      positionForwarderFactory,
      codeHashes.lockedPositionFeeForwarderFactory,
      "Locked position factory",
    ),
    assertRuntimeCodeHash(
      launcher,
      codeHashes.adaptiveCurveLaunch,
      "Adaptive launcher",
    ),
  ]);

  const [
    configuredPoolManager,
    configuredPositionManager,
    configuredTokenFactory,
    configuredHookFactory,
    configuredForwarderFactory,
    configuredTreasury,
    forwarderPositionManager,
    requiredFlags,
  ] = await Promise.all([
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "tokenFactory",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "adaptiveHookFactory",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "positionForwarderFactory",
    }),
    client.readContract({
      address: launcher,
      abi: adaptiveCurveLaunchAbi,
      functionName: "launcherFeeRecipient",
    }),
    client.readContract({
      address: positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: hookFactory,
      abi: adaptiveCurveHookFactoryAbi,
      functionName: "REQUIRED_HOOK_FLAGS",
    }),
  ]);

  const expected = [
    [configuredPoolManager, officialPoolManager, "PoolManager"],
    [configuredPositionManager, officialPositionManager, "PositionManager"],
    [configuredTokenFactory, officialTokenFactory, "UERC20Factory"],
    [configuredHookFactory, hookFactory, "hook factory"],
    [
      configuredForwarderFactory,
      positionForwarderFactory,
      "position factory",
    ],
    [configuredTreasury, platformTreasury, "treasury"],
    [
      forwarderPositionManager,
      officialPositionManager,
      "position factory PositionManager",
    ],
  ] as const;
  for (const [actual, wanted, label] of expected) {
    if (actual.toLowerCase() !== wanted.toLowerCase()) {
      throw new Error(
        `The Adaptive ${label} does not match the release manifest`,
      );
    }
  }
  if (requiredFlags !== REQUIRED_FEE_HOOK_FLAGS) {
    throw new Error(
      "The Adaptive hook callback mask does not match the release manifest",
    );
  }
}

async function prepareAdaptiveLaunch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
  deployment: ReleaseDeployment,
) {
  validateAdaptiveLaunchDraft(draft);
  validateLaunchSalt(draft.launchSalt);
  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Adaptive curve",
    status: "pass",
    detail:
      "The immutable market-cap curve and its fee bounds are valid",
  };

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "adaptive",
      title: `Switch the wallet to ${networkName}`,
      detail: `The launch transaction is fixed to ${networkName}`,
      checks: [tokenCheck, connectedWalletCheck],
    });
  }

  const {
    adaptiveLaunchStatus,
    adaptiveCurveFeeHookFactory,
    adaptiveCurveLaunch,
    lockedPositionFeeForwarderFactory,
    runtimeCodeHashes,
  } = deployment;
  if (
    adaptiveLaunchStatus !== "ready" ||
    !adaptiveCurveFeeHookFactory ||
    !adaptiveCurveLaunch ||
    !lockedPositionFeeForwarderFactory ||
    !runtimeCodeHashes.adaptiveCurveFeeHookFactory ||
    !runtimeCodeHashes.adaptiveCurveLaunch ||
    !runtimeCodeHashes.lockedPositionFeeForwarderFactory
  ) {
    return response({
      status: "blocked",
      mode: "adaptive",
      title: `Adaptive is not deployed on ${networkName} yet`,
      detail:
        "The editor is available for review. Wallet transactions remain disabled until the exact deployment is recorded and verified",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Adaptive contracts",
          status: "blocked",
          detail: `No approved ${networkName} deployment is recorded`,
        },
      ],
    });
  }

  const launcher = getAddress(adaptiveCurveLaunch);
  const hookFactory = getAddress(adaptiveCurveFeeHookFactory);
  const positionForwarderFactory = getAddress(
    lockedPositionFeeForwarderFactory,
  );
  await assertAdaptiveReleaseInfrastructure(
    launcher,
    hookFactory,
    positionForwarderFactory,
    {
      adaptiveCurveFeeHookFactory:
        runtimeCodeHashes.adaptiveCurveFeeHookFactory as Hex,
      adaptiveCurveLaunch: runtimeCodeHashes.adaptiveCurveLaunch as Hex,
      lockedPositionFeeForwarderFactory:
        runtimeCodeHashes.lockedPositionFeeForwarderFactory as Hex,
    },
  );

  const initCodeHash = await client.readContract({
    address: hookFactory,
    abi: adaptiveCurveHookFactoryAbi,
    functionName: "initCodeHash",
    args: [officialPoolManager, platformTreasury],
  });
  if (
    !isHex(draft.hookSaltNonce, { strict: true }) ||
    draft.hookSaltNonce.length !== 66
  ) {
    const mined = mineAdaptiveHookSaltNonce(
      account,
      draft.launchSalt,
      hookFactory,
      initCodeHash,
    );
    return response({
      status: "blocked",
      mode: "adaptive",
      title: "Adaptive address prepared",
      detail: "Checking the deterministic hook and launch transaction",
      checks: [tokenCheck, connectedWalletCheck],
      predictedHook: mined.hook,
      draftPatch: { hookSaltNonce: mined.hookSaltNonce },
    });
  }

  validateAdaptiveLaunchDraft(draft, { requireHookSaltNonce: true });
  const effectiveSalt = adaptiveEffectiveHookSalt(
    account,
    draft.launchSalt,
    draft.hookSaltNonce,
  );
  const locallyPredictedHook = getCreate2Address({
    from: hookFactory,
    salt: effectiveSalt,
    bytecodeHash: initCodeHash,
  });
  const predictedHook = await client.readContract({
    address: launcher,
    abi: adaptiveCurveLaunchAbi,
    functionName: "predictFeeHook",
    args: [account, draft.launchSalt, draft.hookSaltNonce],
  });
  if (predictedHook.toLowerCase() !== locallyPredictedHook.toLowerCase()) {
    throw new Error(
      "The Adaptive hook prediction does not match the deployed launcher",
    );
  }
  if ((BigInt(predictedHook) & HOOK_FLAG_MASK) !== REQUIRED_FEE_HOOK_FLAGS) {
    throw new LaunchInputError(
      "The deterministic hook address has invalid callback permissions",
    );
  }

  const [predictedToken] = await client.readContract({
    address: launcher,
    abi: adaptiveCurveLaunchAbi,
    functionName: "predictTokenAddress",
    args: [
      draft.tokenName.trim(),
      draft.tokenSymbol.trim(),
      account,
      draft.launchSalt,
    ],
  });
  const existingTokenCode = await client.getCode({ address: predictedToken });
  if (existingTokenCode && existingTokenCode !== "0x") {
    throw new LaunchInputError(
      "This deterministic token address is already in use",
    );
  }

  const initialBuyWei = parseOptionalInitialBuyWei(draft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new LaunchInputError("Enter a valid optional Dev Buy");
  }
  const launchBase = {
    kind: "launch" as const,
    chainId: launchChain.id,
    to: launcher,
    data: encodeAdaptiveLaunch(draft, draft.launchSalt),
    value: initialBuyWei.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(account, launchBase);
  return response({
    status: "ready",
    mode: "adaptive",
    title: "Ready for wallet review",
    detail:
      `The Adaptive launch succeeded in a read-only ${networkName} simulation`,
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Adaptive contracts",
        status: "pass",
        detail:
          "Runtime bytecode, official dependencies and deterministic hook permissions match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail: "The complete atomic launch succeeds",
      },
    ],
    transaction: { ...launchBase, gasLimit: gasLimit.toString() },
    predictedToken,
    predictedHook,
    planHash: buildPlanHash(account, launchBase),
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse("The launch setup is too large", 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("The launch setup is not valid JSON");
    }
    if (!body || typeof body !== "object") {
      return errorResponse("The launch setup is missing");
    }

    const record = body as Record<string, unknown>;
    if (typeof record.account !== "string" || !isAddress(record.account)) {
      return errorResponse("Connect a valid Ethereum wallet");
    }

    const account = getAddress(record.account);
    const draft = parseDraft(record.draft);
    const connectedWalletCheck = walletCheck(
      account,
      record.walletChainId,
    );
    if (draft.launchModel === "adaptive") {
      return await prepareAdaptiveLaunch(
        account,
        draft,
        connectedWalletCheck,
        selectedManifest,
      );
    }
    if (draft.launchModel === "classic-v3") {
      return await prepareClassicV3Launch(
        account,
        draft,
        connectedWalletCheck,
        selectedManifest,
      );
    }
    return await prepareMemeLaunch(
      account,
      draft,
      connectedWalletCheck,
      selectedManifest,
    );
  } catch (caught) {
    if (caught instanceof LaunchInputError) {
      return errorResponse(caught.message);
    }

    console.error(
      "Launch preflight failed",
      safeServerErrorSummary(caught),
    );
    return errorResponse(
      `The ${networkName} simulation could not be completed safely`,
      502,
    );
  }
}
