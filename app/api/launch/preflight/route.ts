import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";
import {
  getRegisteredInitializer,
  isV4PoolInitialized,
  LBP_STRATEGY_ABI,
  predictAuctionAddress,
  predictTokenAddress,
} from "@uniswap/liquidity-launcher-sdk";

import appDeployments from "@/contracts/config/app-deployments.v1.json";
import deploymentInputs from "@/contracts/config/deployment-inputs.v1.json";
import mainnetDeployments from "@/contracts/dependencies/ethereum-mainnet.json";
import {
  buildDirectLaunchAmounts,
  buildPlanHash,
  boundedDynamicFeeHookFactoryAbi,
  directLiquidityLauncherAbi,
  encodeExistingDirectLaunch,
  encodeNewDirectLaunch,
  encodeTokenApproval,
  LaunchInputError,
  lockedPositionFeeForwarderFactoryAbi,
  mineBoundedDynamicFeeHookSalt,
  mineStandardHookSalt,
  platformFeeHookFactoryAbi,
  standardErc20Abi,
  type LaunchPreflightCheck,
  type LaunchPreflightResponse,
  type PreparedLaunchTransaction,
  uerc20FactoryAbi,
} from "@/lib/launch-transaction";
import {
  buildStandardAuctionEconomics,
  buildStandardAuctionPlan,
  buildStandardAuctionTokenPredictionParams,
  derivePositionForwarderSalt,
  getOfficialEthereumAuctionAddresses,
  isSameOfficialAuctionStack,
  resolveStandardAuctionSchedule,
  type StandardAuctionAddresses,
} from "@/lib/auction-transaction";
import {
  behaviorDefinitions,
  createEmptyDraft,
  type BehaviorId,
  type LaunchDraft,
} from "@/lib/launch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
const MAX_REQUEST_BYTES = 50_000;
const auctionStackConfigurationAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function initializerFactory() view returns (address)",
]);
const ccaFactoryConfigurationAbi = parseAbi([
  "function protocolFeeController() view returns (address)",
]);
const knownBehaviors = new Set(
  behaviorDefinitions.map(({ id }) => id),
);

const client = createPublicClient({
  chain: mainnet,
  transport: http(
    process.env.ETHEREUM_RPC_URL ?? "https://eth.drpc.org",
    {
      retryCount: 1,
      timeout: 12_000,
    },
  ),
});

const officialPoolManager = getAddress(
  mainnetDeployments.contracts.poolManager.address,
);
const officialPositionManager = getAddress(
  mainnetDeployments.contracts.positionManager.address,
);
const officialStateView = getAddress(
  mainnetDeployments.contracts.stateView.address,
);
const officialTokenFactory = getAddress(
  mainnetDeployments.contracts.uerc20Factory.address,
);
const officialLiquidityLauncher = getAddress(
  mainnetDeployments.contracts.liquidityLauncher.address,
);
const officialLbpStrategy = getAddress(
  mainnetDeployments.contracts.lbpStrategy.address,
);
const officialCcaFactory = getAddress(
  mainnetDeployments.contracts.continuousClearingAuctionFactory.address,
);
const platformTreasury = getAddress(deploymentInputs.platform.treasury);
const officialAuctionAddresses: StandardAuctionAddresses = {
  liquidityLauncher: officialLiquidityLauncher,
  lbpStrategy: officialLbpStrategy,
  uerc20Factory: officialTokenFactory,
};

type ExistingTokenState = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  creator: Address;
  graffiti: Hex;
};

type ProductionDeployment = {
  chainId: 1;
  status: "not-deployed" | "ready";
  platformFeeHookFactory: string | null;
  boundedDynamicFeeHookFactory: string | null;
  lockedPositionFeeForwarderFactory: string | null;
  directLiquidityLauncher: string | null;
  runtimeCodeHashes: {
    platformFeeHookFactory: string | null;
    boundedDynamicFeeHookFactory: string | null;
    lockedPositionFeeForwarderFactory: string | null;
    directLiquidityLauncher: string | null;
  };
  blocker: string;
};

function response(
  body: LaunchPreflightResponse,
  status = 200,
) {
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
    "tokenSupply",
    "tokenDescription",
    "tokenAddress",
    "existingTokenName",
    "existingTokenSymbol",
    "existingTokenSupply",
    "auctionSalePercent",
    "auctionLiquidityPercent",
    "auctionFloorValuationEth",
    "auctionStartBlock",
    "auctionEndBlock",
    "auctionClaimBlock",
    "auctionMigrationBlock",
    "directEthAmount",
    "directTokenAmount",
    "directTokensPerEth",
    "lpFeePercent",
    "customHookAddress",
    "customHookSource",
    "launchSalt",
    "updatedAt",
  ] as const;

  for (const field of stringFields) {
    if (typeof raw[field] === "string") {
      draft[field] = raw[field];
    }
  }

  draft.assetMode = raw.assetMode === "existing" ? "existing" : "new";
  draft.liquidityMode =
    raw.liquidityMode === "direct" ? "direct" : "auction";
  if (Array.isArray(raw.selectedBehaviors)) {
    draft.selectedBehaviors = raw.selectedBehaviors.filter(
      (value): value is BehaviorId =>
        typeof value === "string" &&
        knownBehaviors.has(value as BehaviorId),
    );
  }
  return draft;
}

function walletCheck(
  account: Address,
  walletChainId: unknown,
): LaunchPreflightCheck {
  const onEthereum =
    walletChainId === "0x1" ||
    walletChainId === "1" ||
    walletChainId === "eip155:1";
  return {
    id: "wallet",
    label: "Wallet",
    status: onEthereum ? "pass" : "blocked",
    detail: onEthereum
      ? `${account.slice(0, 6)}…${account.slice(-4)} on Ethereum`
      : "Switch the connected wallet to Ethereum",
  };
}

function validateLaunchSalt(value: string): asserts value is Hex {
  if (!isHex(value, { strict: true }) || value.length !== 66) {
    throw new LaunchInputError(
      "Create a fresh launch identifier before checking the transaction",
    );
  }
}

async function readExistingToken(
  address: Address,
  expectedCreator: Address,
): Promise<ExistingTokenState> {
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new LaunchInputError(
      "No token contract was found at this address on Ethereum",
    );
  }

  const [name, symbol, decimals, totalSupply, creator, graffiti] =
    await Promise.all([
      client.readContract({
        address,
        abi: standardErc20Abi,
        functionName: "name",
      }),
      client.readContract({
        address,
        abi: standardErc20Abi,
        functionName: "symbol",
      }),
      client.readContract({
        address,
        abi: standardErc20Abi,
        functionName: "decimals",
      }),
      client.readContract({
        address,
        abi: standardErc20Abi,
        functionName: "totalSupply",
      }),
      client.readContract({
        address,
        abi: standardErc20Abi,
        functionName: "creator",
      }),
      client.readContract({
        address,
        abi: standardErc20Abi,
        functionName: "graffiti",
      }),
    ]);

  const recordedCreator = getAddress(creator);
  if (recordedCreator.toLowerCase() !== expectedCreator.toLowerCase()) {
    throw new LaunchInputError(
      "The connected wallet is not the creator recorded by this token",
    );
  }

  const predicted = await client.readContract({
    address: officialTokenFactory,
    abi: uerc20FactoryAbi,
    functionName: "getUERC20Address",
    args: [
      name,
      symbol,
      decimals,
      recordedCreator,
      graffiti,
    ],
  });
  if (predicted.toLowerCase() !== address.toLowerCase()) {
    throw new LaunchInputError(
      "This token was not created by the configured Uniswap UERC20Factory",
    );
  }

  return {
    address,
    name,
    symbol,
    decimals,
    totalSupply,
    creator: recordedCreator,
    graffiti,
  };
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
    throw new Error(`${label} runtime bytecode does not match the release manifest`);
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
  const estimatedGas = await client.estimateGas({
    account,
    to: transaction.to,
    data: transaction.data,
    value,
  });
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  const fees = await client.estimateFeesPerGas();
  const gasPrice = fees.maxFeePerGas;

  if (balance < value + gasLimit * gasPrice) {
    throw new LaunchInputError(
      "The wallet does not have enough ETH for this transaction and the current maximum network fee",
    );
  }
  return gasLimit;
}

async function assertProductionInfrastructure(
  launcher: Address,
  hookFactory: Address,
  positionForwarderFactory: Address,
  codeHashes: {
    platformFeeHookFactory: Hex;
    lockedPositionFeeForwarderFactory: Hex;
    directLiquidityLauncher: Hex;
  },
) {
  await Promise.all([
    assertRuntimeCodeHash(
      officialPoolManager,
      mainnetDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
    ),
    assertRuntimeCodeHash(
      officialPositionManager,
      mainnetDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
    ),
    assertRuntimeCodeHash(
      officialTokenFactory,
      mainnetDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
    ),
    assertRuntimeCodeHash(
      hookFactory,
      codeHashes.platformFeeHookFactory,
      "Platform fee hook factory",
    ),
    assertRuntimeCodeHash(
      positionForwarderFactory,
      codeHashes.lockedPositionFeeForwarderFactory,
      "Locked position factory",
    ),
    assertRuntimeCodeHash(
      launcher,
      codeHashes.directLiquidityLauncher,
      "Direct liquidity launcher",
    ),
  ]);

  const [
    configuredPoolManager,
    configuredPositionManager,
    configuredTokenFactory,
    configuredHookFactory,
    configuredForwarderFactory,
    configuredTreasury,
  ] = await Promise.all([
    client.readContract({
      address: launcher,
      abi: directLiquidityLauncherAbi,
      functionName: "poolManager",
    }),
    client.readContract({
      address: launcher,
      abi: directLiquidityLauncherAbi,
      functionName: "positionManager",
    }),
    client.readContract({
      address: launcher,
      abi: directLiquidityLauncherAbi,
      functionName: "tokenFactory",
    }),
    client.readContract({
      address: launcher,
      abi: directLiquidityLauncherAbi,
      functionName: "hookFactory",
    }),
    client.readContract({
      address: launcher,
      abi: directLiquidityLauncherAbi,
      functionName: "positionForwarderFactory",
    }),
    client.readContract({
      address: launcher,
      abi: directLiquidityLauncherAbi,
      functionName: "platformFeeRecipient",
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
  ] as const;

  for (const [actual, wanted, label] of expected) {
    if (actual.toLowerCase() !== wanted.toLowerCase()) {
      throw new Error(`The launcher ${label} does not match the release manifest`);
    }
  }
}

async function assertAuctionProductionInfrastructure(
  hookFactory: Address,
  positionForwarderFactory: Address,
  codeHashes: {
    hookFactory: Hex;
    lockedPositionFeeForwarderFactory: Hex;
  },
  hookFactoryLabel: string,
) {
  const sdkAddresses = getOfficialEthereumAuctionAddresses();
  if (
    !sdkAddresses ||
    !isSameOfficialAuctionStack(
      sdkAddresses,
      officialAuctionAddresses,
    )
  ) {
    throw new Error(
      "The installed Uniswap SDK does not match the pinned Ethereum deployment snapshot",
    );
  }

  await Promise.all([
    assertRuntimeCodeHash(
      officialPoolManager,
      mainnetDeployments.contracts.poolManager.runtimeCodeHash as Hex,
      "Uniswap PoolManager",
    ),
    assertRuntimeCodeHash(
      officialPositionManager,
      mainnetDeployments.contracts.positionManager.runtimeCodeHash as Hex,
      "Uniswap PositionManager",
    ),
    assertRuntimeCodeHash(
      officialStateView,
      mainnetDeployments.contracts.stateView.runtimeCodeHash as Hex,
      "Uniswap StateView",
    ),
    assertRuntimeCodeHash(
      officialTokenFactory,
      mainnetDeployments.contracts.uerc20Factory.runtimeCodeHash as Hex,
      "Uniswap UERC20Factory",
    ),
    assertRuntimeCodeHash(
      officialLiquidityLauncher,
      mainnetDeployments.contracts.liquidityLauncher
        .runtimeCodeHash as Hex,
      "Uniswap LiquidityLauncher",
    ),
    assertRuntimeCodeHash(
      officialLbpStrategy,
      mainnetDeployments.contracts.lbpStrategy.runtimeCodeHash as Hex,
      "Uniswap LBPStrategy",
    ),
    assertRuntimeCodeHash(
      officialCcaFactory,
      mainnetDeployments.contracts.continuousClearingAuctionFactory
        .runtimeCodeHash as Hex,
      "Uniswap Continuous Clearing Auction factory",
    ),
    assertRuntimeCodeHash(
      hookFactory,
      codeHashes.hookFactory,
      hookFactoryLabel,
    ),
    assertRuntimeCodeHash(
      positionForwarderFactory,
      codeHashes.lockedPositionFeeForwarderFactory,
      "Locked position factory",
    ),
  ]);

  const [
    configuredPoolManager,
    configuredStrategyPositionManager,
    initializerFactory,
    protocolFeeController,
    configuredPositionManager,
  ] =
    await Promise.all([
      client.readContract({
        address: officialLbpStrategy,
        abi: auctionStackConfigurationAbi,
        functionName: "poolManager",
      }),
      client.readContract({
        address: officialLbpStrategy,
        abi: auctionStackConfigurationAbi,
        functionName: "positionManager",
      }),
      client.readContract({
        address: officialLbpStrategy,
        abi: LBP_STRATEGY_ABI,
        functionName: "initializerFactory",
      }),
      client.readContract({
        address: officialCcaFactory,
        abi: ccaFactoryConfigurationAbi,
        functionName: "protocolFeeController",
      }),
      client.readContract({
        address: positionForwarderFactory,
        abi: lockedPositionFeeForwarderFactoryAbi,
        functionName: "positionManager",
      }),
    ]);

  if (
    configuredPoolManager.toLowerCase() !==
    officialPoolManager.toLowerCase()
  ) {
    throw new Error(
      "The official LBPStrategy does not point to the pinned PoolManager",
    );
  }
  if (
    configuredStrategyPositionManager.toLowerCase() !==
    officialPositionManager.toLowerCase()
  ) {
    throw new Error(
      "The official LBPStrategy does not point to the pinned PositionManager",
    );
  }
  if (
    initializerFactory.toLowerCase() !==
    officialCcaFactory.toLowerCase()
  ) {
    throw new Error(
      "The official LBPStrategy does not point to the pinned auction factory",
    );
  }
  if (protocolFeeController !== ZERO_ADDRESS) {
    throw new Error(
      "The pinned auction factory no longer guarantees that all auction proceeds reach the pool",
    );
  }
  if (
    configuredPositionManager.toLowerCase() !==
    officialPositionManager.toLowerCase()
  ) {
    throw new Error(
      "The locked position factory does not point to the official PositionManager",
    );
  }
}

async function isFactoryDeployment(
  factory: Address,
  abi:
    | typeof platformFeeHookFactoryAbi
    | typeof lockedPositionFeeForwarderFactoryAbi,
  target: Address,
) {
  const code = await client.getCode({ address: target });
  if (!code || code === "0x") return false;

  const configurationHash = await client.readContract({
    address: factory,
    abi,
    functionName: "configurationHashOf",
    args: [target],
  });
  if (configurationHash === ZERO_HASH) {
    throw new Error(
      "A contract exists at the deterministic setup address without matching factory provenance",
    );
  }
  return true;
}

async function prepareAuctionLaunch(
  account: Address,
  draft: LaunchDraft,
  connectedWalletCheck: LaunchPreflightCheck,
  production: ProductionDeployment,
) {
  validateLaunchSalt(draft.launchSalt);

  const validationSchedule = resolveStandardAuctionSchedule(draft, 0n);
  const validationDraft = {
    ...draft,
    ...(validationSchedule.draftPatch ?? {}),
  };
  buildStandardAuctionEconomics(validationDraft);
  const usesDynamicFee =
    validationDraft.selectedBehaviors[0] === "dynamic-fee";

  const tokenCheck: LaunchPreflightCheck = {
    id: "token",
    label: "Token setup",
    status: "pass",
    detail:
      "Fixed supply, 50/50 allocation and minimum valuation are valid",
  };

  if (production.status !== "ready") {
    return response({
      status: "blocked",
      mode: "auction",
      title: "Mainnet launch contracts are not enabled",
      detail: production.blocker,
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Launcher contracts",
          status: "blocked",
          detail:
            "Awaiting verified mainnet deployment and independent review",
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pending",
          detail: "Runs only against the verified deployment",
        },
      ],
    });
  }

  if (connectedWalletCheck.status !== "pass") {
    return response({
      status: "blocked",
      mode: "auction",
      title: "Switch the wallet to Ethereum",
      detail:
        "The auction and its setup transactions are fixed to Ethereum mainnet",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Launcher contracts",
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
    platformFeeHookFactory,
    boundedDynamicFeeHookFactory,
    lockedPositionFeeForwarderFactory,
    runtimeCodeHashes,
  } = production;
  const selectedHookFactory = usesDynamicFee
    ? boundedDynamicFeeHookFactory
    : platformFeeHookFactory;
  const selectedHookFactoryCodeHash = usesDynamicFee
    ? runtimeCodeHashes.boundedDynamicFeeHookFactory
    : runtimeCodeHashes.platformFeeHookFactory;
  if (
    !selectedHookFactory ||
    !lockedPositionFeeForwarderFactory ||
    !selectedHookFactoryCodeHash ||
    !runtimeCodeHashes.lockedPositionFeeForwarderFactory
  ) {
    throw new Error("The production auction manifest is incomplete");
  }

  const hookFactory = getAddress(selectedHookFactory);
  const hookFactoryAbi = usesDynamicFee
    ? boundedDynamicFeeHookFactoryAbi
    : platformFeeHookFactoryAbi;
  const positionForwarderFactory = getAddress(
    lockedPositionFeeForwarderFactory,
  );
  await assertAuctionProductionInfrastructure(
    hookFactory,
    positionForwarderFactory,
    {
      hookFactory: selectedHookFactoryCodeHash as Hex,
      lockedPositionFeeForwarderFactory:
        runtimeCodeHashes.lockedPositionFeeForwarderFactory as Hex,
    },
    usesDynamicFee
      ? "Bounded dynamic fee hook factory"
      : "Platform fee hook factory",
  );

  const currentBlock = await client.getBlockNumber();
  const scheduleResolution = resolveStandardAuctionSchedule(
    draft,
    currentBlock,
  );
  if (scheduleResolution.draftPatch) {
    return response({
      status: "blocked",
      mode: "auction",
      title: "Auction timing prepared",
      detail:
        "The exact four-hour block window has been saved. Run the check once more to prepare the first setup transaction",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Launcher contracts",
          status: "pass",
          detail:
            "Official addresses and Launcher factory bytecode match",
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pending",
          detail: "Runs after the fixed block window is saved",
        },
      ],
      draftPatch: scheduleResolution.draftPatch,
    });
  }

  const economics = buildStandardAuctionEconomics(draft);
  const predictedToken = getAddress(
    await predictTokenAddress(
      client,
      buildStandardAuctionTokenPredictionParams(
        draft,
        account,
        officialAuctionAddresses,
      ),
    ),
  );
  const tokenCode = await client.getCode({ address: predictedToken });
  if (tokenCode && tokenCode !== "0x") {
    throw new LaunchInputError(
      "A token with this name and symbol already exists for the connected creator",
    );
  }

  const positionSalt = derivePositionForwarderSalt(
    account,
    predictedToken,
    draft.launchSalt,
  );
  const positionRecipient = getAddress(
    await client.readContract({
      address: positionForwarderFactory,
      abi: lockedPositionFeeForwarderFactoryAbi,
      functionName: "predict",
      args: [positionSalt, account],
    }),
  );

  const initCodeHash = await client.readContract({
    address: hookFactory,
    abi: hookFactoryAbi,
    functionName: "initCodeHash",
    args: [
      officialPoolManager,
      officialLbpStrategy,
      platformTreasury,
      ZERO_ADDRESS,
      predictedToken,
    ],
  });
  const minedHook = usesDynamicFee
    ? mineBoundedDynamicFeeHookSalt(hookFactory, initCodeHash)
    : mineStandardHookSalt(hookFactory, initCodeHash);

  const auctionDetails = {
    startBlock: economics.schedule.startBlock.toString(),
    endBlock: economics.schedule.endBlock.toString(),
    minimumRaiseWei:
      economics.requiredCurrencyRaised.toString(),
  };

  if (
    !(await isFactoryDeployment(
      positionForwarderFactory,
      lockedPositionFeeForwarderFactoryAbi,
      positionRecipient,
    ))
  ) {
    const lockSetupBase = {
      kind: "lock-setup" as const,
      chainId: 1 as const,
      to: positionForwarderFactory,
      data: encodeFunctionData({
        abi: lockedPositionFeeForwarderFactoryAbi,
        functionName: "deploy",
        args: [positionSalt, account],
      }),
      value: "0",
    };
    const gasLimit = await estimatePreparedTransaction(
      account,
      lockSetupBase,
    );
    return response({
      status: "setup-required",
      mode: "auction",
      title: "Create the permanent LP lock",
      detail:
        "This deterministic contract will hold the initial position and forward LP fees to the creator",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Launcher contracts",
          status: "pass",
          detail:
            "Official addresses and Launcher factory bytecode match",
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pass",
          detail: "The exact LP lock deployment succeeds in a read-only call",
        },
      ],
      transaction: {
        ...lockSetupBase,
        gasLimit: gasLimit.toString(),
      },
      predictedToken,
      predictedHook: minedHook.address,
      positionRecipient,
      auctionDetails,
      planHash: buildPlanHash(account, lockSetupBase),
    });
  }

  if (
    !(await isFactoryDeployment(
      hookFactory,
      hookFactoryAbi,
      minedHook.address,
    ))
  ) {
    const hookSetupBase = {
      kind: "hook-setup" as const,
      chainId: 1 as const,
      to: hookFactory,
      data: encodeFunctionData({
        abi: hookFactoryAbi,
        functionName: "deploy",
        args: [
          minedHook.salt,
          officialPoolManager,
          officialLbpStrategy,
          platformTreasury,
          ZERO_ADDRESS,
          predictedToken,
        ],
      }),
      value: "0",
    };
    const gasLimit = await estimatePreparedTransaction(
      account,
      hookSetupBase,
    );
    return response({
      status: "setup-required",
      mode: "auction",
      title: "Create the Launcher fee hook",
      detail:
        usesDynamicFee
          ? "This deterministic hook binds the token, the official LBPStrategy, the bounded pool fee rule and the fixed 0.10% Launcher fee"
          : "This deterministic hook binds the token, the official LBPStrategy and the fixed 0.10% Launcher fee",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Permanent LP lock",
          status: "pass",
          detail: "Factory provenance and immutable fee recipient match",
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pass",
          detail: "The exact hook deployment succeeds in a read-only call",
        },
      ],
      transaction: {
        ...hookSetupBase,
        gasLimit: gasLimit.toString(),
      },
      predictedToken,
      predictedHook: minedHook.address,
      positionRecipient,
      auctionDetails,
      planHash: buildPlanHash(account, hookSetupBase),
    });
  }

  const plan = buildStandardAuctionPlan({
    draft,
    account,
    predictedToken,
    hook: minedHook.address,
    positionRecipient,
    addresses: officialAuctionAddresses,
  });
  const [registeredInitializer, poolInitialized] = await Promise.all([
    getRegisteredInitializer(client, {
      lbpStrategy: officialLbpStrategy,
      poolId: plan.poolId,
    }),
    isV4PoolInitialized(client, {
      stateView: officialStateView,
      poolId: plan.poolId,
    }),
  ]);
  if (registeredInitializer !== ZERO_ADDRESS) {
    throw new LaunchInputError(
      "This token's Launcher v4 pool is already reserved by an auction",
    );
  }
  if (poolInitialized) {
    throw new LaunchInputError(
      "This token's Launcher v4 pool is already initialized",
    );
  }

  const predictedAuction = getAddress(
    await predictAuctionAddress(client, {
      strategy: officialLbpStrategy,
      token: predictedToken,
      auctionSupply: plan.auctionSupply,
      auctionParams: plan.auctionParametersData,
      initializerSalt: plan.initializerSalt,
    }),
  );
  const auctionCode = await client.getCode({
    address: predictedAuction,
  });
  if (auctionCode && auctionCode !== "0x") {
    throw new LaunchInputError(
      "The deterministic auction address is already in use",
    );
  }

  const launchBase = {
    kind: "launch" as const,
    chainId: 1 as const,
    to: plan.transaction.to,
    data: plan.transaction.data,
    value: plan.transaction.value.toString(),
  };
  const gasLimit = await estimatePreparedTransaction(
    account,
    launchBase,
  );
  return response({
    status: "ready",
    mode: "auction",
    title: "Ready for wallet review",
    detail:
      "The exact official LiquidityLauncher call succeeded in a read-only Ethereum simulation",
    checks: [
      tokenCheck,
      connectedWalletCheck,
      {
        id: "contracts",
        label: "Launcher composition",
        status: "pass",
        detail:
          usesDynamicFee
            ? "Official auction stack, bounded dynamic fee hook and permanent LP lock match"
            : "Official auction stack, fixed fee hook and permanent LP lock match",
      },
      {
        id: "simulation",
        label: "Simulation",
        status: "pass",
        detail: "The exact atomic token and auction launch succeeds",
      },
    ],
    transaction: {
      ...launchBase,
      gasLimit: gasLimit.toString(),
    },
    predictedToken,
    predictedHook: minedHook.address,
    predictedAuction,
    positionRecipient,
    auctionDetails,
    planHash: buildPlanHash(account, launchBase),
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_BYTES) {
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
    const production =
      appDeployments.production as ProductionDeployment;

    if (draft.liquidityMode === "auction") {
      return prepareAuctionLaunch(
        account,
        draft,
        connectedWalletCheck,
        production,
      );
    }

    validateLaunchSalt(draft.launchSalt);
    let existingToken: ExistingTokenState | null = null;
    let tokenDecimals = 18;
    if (draft.assetMode === "existing") {
      if (!isAddress(draft.tokenAddress)) {
        throw new LaunchInputError("Enter a valid existing token address");
      }
      existingToken = await readExistingToken(
        getAddress(draft.tokenAddress),
        account,
      );
      tokenDecimals = existingToken.decimals;
    }

    const amounts = buildDirectLaunchAmounts(draft, tokenDecimals);
    const tokenCheck: LaunchPreflightCheck = {
      id: "token",
      label: "Token setup",
      status: "pass",
      detail:
        draft.assetMode === "new"
          ? "Fixed supply and opening price are valid"
          : "Factory provenance and creator address are verified",
    };

    if (production.status !== "ready") {
      return response({
        status: "blocked",
        mode: "direct",
        title: "Mainnet launch contracts are not enabled",
        detail: production.blocker,
        checks: [
          tokenCheck,
          connectedWalletCheck,
          {
            id: "contracts",
            label: "Launcher contracts",
            status: "blocked",
            detail: "Awaiting verified mainnet deployment and independent review",
          },
          {
            id: "simulation",
            label: "Simulation",
            status: "pending",
            detail: "Runs only against the verified deployment",
          },
        ],
      });
    }

    if (connectedWalletCheck.status !== "pass") {
      return response({
        status: "blocked",
        mode: "direct",
        title: "Switch the wallet to Ethereum",
        detail:
          "The prepared transaction is fixed to Ethereum mainnet",
        checks: [
          tokenCheck,
          connectedWalletCheck,
          {
            id: "contracts",
            label: "Launcher contracts",
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
      platformFeeHookFactory,
      lockedPositionFeeForwarderFactory,
      directLiquidityLauncher,
      runtimeCodeHashes,
    } = production;
    if (
      !platformFeeHookFactory ||
      !lockedPositionFeeForwarderFactory ||
      !directLiquidityLauncher ||
      !runtimeCodeHashes.platformFeeHookFactory ||
      !runtimeCodeHashes.lockedPositionFeeForwarderFactory ||
      !runtimeCodeHashes.directLiquidityLauncher
    ) {
      throw new Error("The production deployment manifest is incomplete");
    }

    const launcher = getAddress(directLiquidityLauncher);
    const hookFactory = getAddress(platformFeeHookFactory);
    const positionForwarderFactory = getAddress(
      lockedPositionFeeForwarderFactory,
    );
    await assertProductionInfrastructure(
      launcher,
      hookFactory,
      positionForwarderFactory,
      {
        platformFeeHookFactory:
          runtimeCodeHashes.platformFeeHookFactory as Hex,
        lockedPositionFeeForwarderFactory:
          runtimeCodeHashes.lockedPositionFeeForwarderFactory as Hex,
        directLiquidityLauncher:
          runtimeCodeHashes.directLiquidityLauncher as Hex,
      },
    );

    let predictedToken: Address;
    if (existingToken) {
      predictedToken = existingToken.address;
    } else {
      [predictedToken] = await client.readContract({
        address: launcher,
        abi: directLiquidityLauncherAbi,
        functionName: "predictTokenAddress",
        args: [
          draft.tokenName.trim(),
          draft.tokenSymbol.trim(),
          account,
          draft.launchSalt,
        ],
      });
    }

    const initCodeHash = await client.readContract({
      address: hookFactory,
      abi: platformFeeHookFactoryAbi,
      functionName: "initCodeHash",
      args: [
        officialPoolManager,
        launcher,
        platformTreasury,
        ZERO_ADDRESS,
        predictedToken,
      ],
    });
    const minedHook = mineStandardHookSalt(
      hookFactory,
      initCodeHash,
    );

    if (existingToken) {
      const [balance, allowance] = await Promise.all([
        client.readContract({
          address: existingToken.address,
          abi: standardErc20Abi,
          functionName: "balanceOf",
          args: [account],
        }),
        client.readContract({
          address: existingToken.address,
          abi: standardErc20Abi,
          functionName: "allowance",
          args: [account, launcher],
        }),
      ]);
      if (balance < amounts.tokenLiquidityAmount) {
        throw new LaunchInputError(
          "The wallet does not hold the token amount entered for liquidity",
        );
      }

      if (allowance < amounts.tokenLiquidityAmount) {
        const approvalBase = {
          kind: "approval" as const,
          chainId: 1 as const,
          to: existingToken.address,
          data: encodeTokenApproval(
            launcher,
            amounts.tokenLiquidityAmount,
          ),
          value: "0",
        };
        const gasLimit = await estimatePreparedTransaction(
          account,
          approvalBase,
        );
        return response({
          status: "approval-required",
          mode: "direct",
          title: "Approve the liquidity amount",
          detail:
            "This approval is limited to the token amount entered for the launch",
          checks: [
            tokenCheck,
            connectedWalletCheck,
            {
              id: "contracts",
              label: "Launcher contracts",
              status: "pass",
              detail: "Addresses, bytecode and immutable settings match",
            },
            {
              id: "simulation",
              label: "Simulation",
              status: "pass",
              detail: "The exact approval succeeds in a read-only call",
            },
          ],
          transaction: {
            ...approvalBase,
            gasLimit: gasLimit.toString(),
          },
          predictedToken,
          predictedHook: minedHook.address,
          planHash: buildPlanHash(account, approvalBase),
        });
      }
    }

    const data = existingToken
      ? encodeExistingDirectLaunch(
          existingToken.address,
          amounts,
          minedHook.salt,
        )
      : encodeNewDirectLaunch(
          draft,
          amounts,
          draft.launchSalt,
          minedHook.salt,
        );
    const launchBase = {
      kind: "launch" as const,
      chainId: 1 as const,
      to: launcher,
      data,
      value: amounts.nativeLiquidityAmount.toString(),
    };
    const gasLimit = await estimatePreparedTransaction(
      account,
      launchBase,
    );

    return response({
      status: "ready",
      mode: "direct",
      title: "Ready for wallet review",
      detail:
        "The exact call succeeded in a read-only Ethereum simulation",
      checks: [
        tokenCheck,
        connectedWalletCheck,
        {
          id: "contracts",
          label: "Launcher contracts",
          status: "pass",
          detail: "Addresses, bytecode and immutable settings match",
        },
        {
          id: "simulation",
          label: "Simulation",
          status: "pass",
          detail: "The exact launch call succeeds at the current block",
        },
      ],
      transaction: {
        ...launchBase,
        gasLimit: gasLimit.toString(),
      },
      predictedToken,
      predictedHook: minedHook.address,
      planHash: buildPlanHash(account, launchBase),
    });
  } catch (caught) {
    if (caught instanceof LaunchInputError) {
      return errorResponse(caught.message);
    }

    console.error("Launch preflight failed", caught);
    return errorResponse(
      "The Ethereum simulation could not be completed safely",
      502,
    );
  }
}
