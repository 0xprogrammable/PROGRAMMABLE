import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
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
  buildPlanHash,
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
} from "@/lib/launch-transaction";
import {
  createEmptyDraft,
  MEME_MIN_INITIAL_BUY_WEI,
  parseInitialBuyWei,
  type LaunchDraft,
} from "@/lib/launch";

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
  appDeployments[launchEnvironment] as ClassicDeployment;

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

type ClassicDeployment = {
  chainId: number;
  status: "not-deployed" | "ready" | "requires-redeploy";
  memeLaunchStatus:
    | "not-deployed"
    | "ready"
    | "requires-redeploy"
    | "lifecycle-pending";
  ethCreatorFeeHookFactory: string | null;
  ethCreatorFeeHook: string | null;
  memeLaunch: string | null;
  lockedPositionFeeForwarderFactory: string | null;
  runtimeCodeHashes: {
    ethCreatorFeeHookFactory: string | null;
    ethCreatorFeeHook: string | null;
    memeLaunch: string | null;
    lockedPositionFeeForwarderFactory: string | null;
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
    "updatedAt",
  ] as const;

  for (const field of stringFields) {
    if (typeof raw[field] === "string") {
      draft[field] = raw[field];
    }
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
  deployment: ClassicDeployment,
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
    return prepareMemeLaunch(
      account,
      draft,
      walletCheck(account, record.walletChainId),
      selectedManifest,
    );
  } catch (caught) {
    if (caught instanceof LaunchInputError) {
      return errorResponse(caught.message);
    }

    console.error("Launch preflight failed", caught);
    return errorResponse(
      `The ${networkName} simulation could not be completed safely`,
      502,
    );
  }
}
