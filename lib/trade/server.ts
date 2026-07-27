import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import appDeployments from "../../contracts/config/app-deployments.v1.json";
import mainnetDeployments from "../../contracts/dependencies/ethereum-mainnet.json";
import sepoliaDeployments from "../../contracts/dependencies/ethereum-sepolia.json";
import {
  NATIVE_ETH,
  amountOutMinimum,
  assertClassicDeadline,
  assertClassicTradeDeployment,
  buildClassicPermit2ApprovalTransaction,
  buildClassicSwapTransaction,
  buildClassicTokenApprovalTransaction,
  classicGasReserve,
  classicPermit2Abi,
  classicTokenAbi,
  createClassicPoolKey,
  getClassicPoolId,
  getClassicSellApprovalState,
  maximumClassicBuyAmount,
  quoteClassicExactInput,
  ClassicTradeInputError,
  type ClassicQuoteClient,
  type ClassicTradeDeployment,
  type ClassicTradeSide,
} from "./classic";
import type { ExploreReadModel } from "../onchain/types";

const UINT128_MAX = (1n << 128n) - 1n;
const REQUEST_FIELDS = new Set([
  "chainId",
  "owner",
  "token",
  "side",
  "amountIn",
  "slippageBps",
  "deadline",
]);

export type ClassicTradeRelease = ClassicTradeDeployment & {
  poolManagerRuntimeCodeHash: Hex;
  v4QuoterRuntimeCodeHash: Hex;
  universalRouterRuntimeCodeHash: Hex;
  permit2RuntimeCodeHash: Hex;
  hookRuntimeCodeHash: Hex;
};

type OfficialTradeStack = Omit<
  ClassicTradeRelease,
  "hook" | "hookRuntimeCodeHash"
>;

export type ClassicTradeRequest = {
  chainId: number;
  owner: Address;
  token: Address;
  side: ClassicTradeSide;
  amountIn: bigint;
  slippageBps: number;
  deadline: bigint;
};

export type ClassicTradeRuntimeClient = ClassicQuoteClient & {
  getBlock(): Promise<{ timestamp: bigint }>;
  getBalance(args: { address: Address }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  estimateGas(args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
  }): Promise<bigint>;
};

export class ClassicTradeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassicTradeUnavailableError";
  }
}

function requestAddress(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new ClassicTradeInputError(`${label} must be an address`);
  }
  try {
    const address = getAddress(value);
    if (address.toLowerCase() === NATIVE_ETH.toLowerCase()) {
      throw new Error("zero");
    }
    return address;
  } catch {
    throw new ClassicTradeInputError(
      `${label} must be a non-zero Ethereum address`,
    );
  }
}

function baseUnitInteger(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^[1-9]\d*$/.test(value)
  ) {
    throw new ClassicTradeInputError(
      `${label} must be a positive base-unit integer string`,
    );
  }
  const parsed = BigInt(value);
  if (parsed > UINT128_MAX) {
    throw new ClassicTradeInputError(
      `${label} exceeds the supported uint128 limit`,
    );
  }
  return parsed;
}

export function parseClassicTradeRequest(
  input: unknown,
): ClassicTradeRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ClassicTradeInputError("The trade request is missing");
  }
  const raw = input as Record<string, unknown>;
  const unsupported = Object.keys(raw).find(
    (field) => !REQUEST_FIELDS.has(field),
  );
  if (unsupported) {
    throw new ClassicTradeInputError(
      `The trade request contains unsupported field ${unsupported}`,
    );
  }
  if (!Number.isSafeInteger(raw.chainId) || Number(raw.chainId) <= 0) {
    throw new ClassicTradeInputError("Chain ID must be a positive integer");
  }
  if (raw.side !== "buy" && raw.side !== "sell") {
    throw new ClassicTradeInputError("Trade side must be buy or sell");
  }
  if (
    !Number.isInteger(raw.slippageBps) ||
    Number(raw.slippageBps) < 1 ||
    Number(raw.slippageBps) > 1_000
  ) {
    throw new ClassicTradeInputError(
      "Slippage must be an integer from 1 to 1000 basis points",
    );
  }

  return {
    chainId: Number(raw.chainId),
    owner: requestAddress(raw.owner, "Wallet"),
    token: requestAddress(raw.token, "Token"),
    side: raw.side,
    amountIn: baseUnitInteger(raw.amountIn, "Input amount"),
    slippageBps: Number(raw.slippageBps),
    deadline: baseUnitInteger(raw.deadline, "Deadline"),
  };
}

export function getPinnedOfficialTradeStack(
  chainId: number,
): OfficialTradeStack {
  const snapshot =
    chainId === 1
      ? mainnetDeployments
      : chainId === 11155111
        ? sepoliaDeployments
        : null;
  if (!snapshot) {
    throw new ClassicTradeUnavailableError(
      `Classic trading is not supported on chain ${chainId}`,
    );
  }
  if (snapshot.chainId !== chainId) {
    throw new ClassicTradeUnavailableError(
      "The pinned Uniswap deployment snapshot has the wrong chain ID",
    );
  }

  return {
    chainId,
    poolManager: getAddress(snapshot.contracts.poolManager.address),
    v4Quoter: getAddress(snapshot.contracts.v4Quoter.address),
    universalRouter: getAddress(
      snapshot.contracts.universalRouter.address,
    ),
    universalRouterVersion: "2.0",
    permit2: getAddress(snapshot.contracts.permit2.address),
    poolManagerRuntimeCodeHash:
      snapshot.contracts.poolManager.runtimeCodeHash as Hex,
    v4QuoterRuntimeCodeHash:
      snapshot.contracts.v4Quoter.runtimeCodeHash as Hex,
    universalRouterRuntimeCodeHash:
      snapshot.contracts.universalRouter.runtimeCodeHash as Hex,
    permit2RuntimeCodeHash:
      snapshot.contracts.permit2.runtimeCodeHash as Hex,
  };
}

export function resolveClassicTradeDeployment(
  chainId: number,
): ClassicTradeRelease {
  const official = getPinnedOfficialTradeStack(chainId);
  const app =
    chainId === 1
      ? appDeployments.production
      : chainId === 11155111
        ? appDeployments.rehearsal
        : null;
  if (!app || app.chainId !== chainId) {
    throw new ClassicTradeUnavailableError(
      `Classic trading is not configured on chain ${chainId}`,
    );
  }
  if (
    app.status !== "ready" ||
    app.memeLaunchStatus !== "ready" ||
    !app.ethCreatorFeeHook
  ) {
    throw new ClassicTradeUnavailableError(
      `Classic trading is not deployed on chain ${chainId}`,
    );
  }

  const hookRuntimeCodeHash = app.runtimeCodeHashes?.ethCreatorFeeHook;
  if (
    typeof hookRuntimeCodeHash !== "string" ||
    !isHex(hookRuntimeCodeHash) ||
    hookRuntimeCodeHash.length !== 66
  ) {
    throw new ClassicTradeUnavailableError(
      `Classic trading has no pinned hook runtime code on chain ${chainId}`,
    );
  }

  const deployment: ClassicTradeRelease = {
    ...official,
    hook: getAddress(app.ethCreatorFeeHook),
    hookRuntimeCodeHash,
  };
  assertClassicTradeDeployment(deployment);
  return deployment;
}

async function assertRuntimeContracts(
  client: ClassicTradeRuntimeClient,
  deployment: ClassicTradeRelease,
  token: Address,
) {
  const actualChainId = await client.getChainId();
  if (actualChainId !== deployment.chainId) {
    throw new ClassicTradeInputError(
      `RPC chain ${actualChainId} does not match deployment chain ${deployment.chainId}`,
    );
  }

  const contracts = [
    [
      "PoolManager",
      deployment.poolManager,
      deployment.poolManagerRuntimeCodeHash,
    ],
    [
      "V4Quoter",
      deployment.v4Quoter,
      deployment.v4QuoterRuntimeCodeHash,
    ],
    [
      "Universal Router",
      deployment.universalRouter,
      deployment.universalRouterRuntimeCodeHash,
    ],
    ["Permit2", deployment.permit2, deployment.permit2RuntimeCodeHash],
    ["Classic hook", deployment.hook, deployment.hookRuntimeCodeHash],
  ] as const;
  const code = await Promise.all(
    [...contracts, ["Token", token] as const].map(([, address]) =>
      client.getCode({ address }),
    ),
  );
  for (let index = 0; index < contracts.length; index += 1) {
    const contract = contracts[index];
    const runtimeCode = code[index];
    if (!runtimeCode || runtimeCode === "0x") {
      throw new ClassicTradeUnavailableError(
        `${contract[0]} code is missing at the pinned address`,
      );
    }
    if (
      keccak256(runtimeCode).toLowerCase() !==
      contract[2].toLowerCase()
    ) {
      throw new ClassicTradeUnavailableError(
        `${contract[0]} runtime code does not match the pinned release`,
      );
    }
  }
  if (!code[contracts.length] || code[contracts.length] === "0x") {
    throw new ClassicTradeUnavailableError(
      "Token code is missing at the verified launch address",
    );
  }
}

export function assertVerifiedClassicToken(
  model: ExploreReadModel,
  deployment: ClassicTradeRelease,
  token: Address,
) {
  if (
    model.status !== "ready" ||
    model.snapshot.chainId !== deployment.chainId
  ) {
    throw new ClassicTradeUnavailableError(
      "The verified Programmable launch registry is unavailable",
    );
  }
  const verified = model.tokens.find(
    (candidate) =>
      candidate.tokenAddress.toLowerCase() === token.toLowerCase(),
  );
  if (!verified || verified.liquidityPath !== "meme") {
    throw new ClassicTradeUnavailableError(
      "This token is not a verified Programmable launch",
    );
  }
  const expectedPoolId = getClassicPoolId(
    createClassicPoolKey(token, deployment),
    deployment,
  );
  if (
    verified.hookAddress.toLowerCase() !==
      deployment.hook.toLowerCase() ||
    verified.poolId.toLowerCase() !== expectedPoolId.toLowerCase()
  ) {
    throw new ClassicTradeUnavailableError(
      "The token does not match its verified Programmable pool",
    );
  }
  return verified;
}

async function requiredCall(
  client: ClassicTradeRuntimeClient,
  args: { to: Address; data: Hex; account?: Address },
  label: string,
) {
  const result = await client.call(args);
  if (!result.data || result.data === "0x") {
    throw new Error(`${label} returned no data`);
  }
  return result.data;
}

async function readSellAllowances(
  client: ClassicTradeRuntimeClient,
  deployment: ClassicTradeDeployment,
  owner: Address,
  token: Address,
) {
  const [tokenData, permit2Data] = await Promise.all([
    requiredCall(
      client,
      {
        to: token,
        data: encodeFunctionData({
          abi: classicTokenAbi,
          functionName: "allowance",
          args: [owner, deployment.permit2],
        }),
        account: owner,
      },
      "Token allowance",
    ),
    requiredCall(
      client,
      {
        to: deployment.permit2,
        data: encodeFunctionData({
          abi: classicPermit2Abi,
          functionName: "allowance",
          args: [owner, token, deployment.universalRouter],
        }),
        account: owner,
      },
      "Permit2 allowance",
    ),
  ]);

  const tokenAllowance = decodeFunctionResult({
    abi: classicTokenAbi,
    functionName: "allowance",
    data: tokenData,
  });
  const [permit2Allowance, permit2Expiration] =
    decodeFunctionResult({
      abi: classicPermit2Abi,
      functionName: "allowance",
      data: permit2Data,
    });

  return {
    tokenAllowance,
    permit2Allowance,
    permit2Expiration: BigInt(permit2Expiration),
  };
}

async function readTokenBalance(
  client: ClassicTradeRuntimeClient,
  owner: Address,
  token: Address,
) {
  const data = await requiredCall(
    client,
    {
      to: token,
      data: encodeFunctionData({
        abi: classicTokenAbi,
        functionName: "balanceOf",
        args: [owner],
      }),
      account: owner,
    },
    "Token balance",
  );
  return decodeFunctionResult({
    abi: classicTokenAbi,
    functionName: "balanceOf",
    data,
  });
}

function walletTransaction(transaction: {
  kind: "swap" | "token-to-permit2" | "permit2-to-router";
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
}) {
  return {
    kind: transaction.kind,
    chainId: transaction.chainId,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  };
}

async function simulatedSwapTransaction(
  client: ClassicTradeRuntimeClient,
  owner: Address,
  nativeBalance: bigint,
  side: ClassicTradeSide,
  transaction: {
    kind: "swap";
    chainId: number;
    to: Address;
    data: Hex;
    value: string;
  },
) {
  const value = BigInt(transaction.value);
  const request = {
    account: owner,
    to: transaction.to,
    data: transaction.data,
    value,
  };
  await client.call(request);
  const [estimatedGas, gasPrice] = await Promise.all([
    client.estimateGas(request),
    client.getGasPrice(),
  ]);
  if (estimatedGas <= 0n) {
    throw new ClassicTradeUnavailableError(
      "The prepared swap returned an invalid gas estimate",
    );
  }
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  if (gasPrice <= 0n) {
    throw new ClassicTradeUnavailableError(
      "The network returned an invalid gas price",
    );
  }
  if (side === "buy") {
    const maximumAmountIn = maximumClassicBuyAmount({
      nativeBalance,
      gasLimit,
      gasPrice,
    });
    if (value > maximumAmountIn) {
      throw new ClassicTradeInputError(
        "Enter a smaller ETH amount so the wallet keeps enough ETH for this buy and a later sell",
      );
    }
  } else {
    const reserve = classicGasReserve({ gasLimit, gasPrice });
    if (nativeBalance < reserve) {
      throw new ClassicTradeInputError(
        "The wallet needs more ETH to pay for the sell transaction",
      );
    }
  }
  return {
    ...walletTransaction(transaction),
    gasLimit: gasLimit.toString(),
  };
}

export async function prepareClassicTrade(
  client: ClassicTradeRuntimeClient,
  deployment: ClassicTradeRelease,
  request: ClassicTradeRequest,
  registry: ExploreReadModel,
) {
  assertClassicTradeDeployment(deployment);
  if (request.chainId !== deployment.chainId) {
    throw new ClassicTradeInputError(
      `Request chain ${request.chainId} does not match deployment chain ${deployment.chainId}`,
    );
  }

  const poolKey = createClassicPoolKey(request.token, deployment);
  assertVerifiedClassicToken(registry, deployment, poolKey.currency1);
  await assertRuntimeContracts(
    client,
    deployment,
    poolKey.currency1,
  );
  const nativeBalance = await client.getBalance({
    address: request.owner,
  });
  if (nativeBalance < 0n) {
    throw new ClassicTradeUnavailableError(
      "The network returned an invalid wallet ETH balance",
    );
  }
  if (request.side === "buy" && request.amountIn > nativeBalance) {
    throw new ClassicTradeInputError(
      "The buy amount exceeds the wallet ETH balance",
    );
  }
  if (request.side === "sell") {
    const tokenBalance = await readTokenBalance(
      client,
      request.owner,
      poolKey.currency1,
    );
    if (request.amountIn > tokenBalance) {
      throw new ClassicTradeInputError(
        "The sell amount exceeds the wallet token balance",
      );
    }
  }
  const block = await client.getBlock();
  assertClassicDeadline(block.timestamp, request.deadline);

  const quoted = await quoteClassicExactInput(client, {
    deployment,
    poolKey,
    owner: request.owner,
    side: request.side,
    amountIn: request.amountIn,
  });
  const minimum = amountOutMinimum(
    quoted.amountOut,
    request.slippageBps,
  );
  const quote = {
    amountIn: request.amountIn.toString(),
    amountOut: quoted.amountOut.toString(),
    amountOutMinimum: minimum.toString(),
    gasEstimate: quoted.gasEstimate.toString(),
    slippageBps: request.slippageBps,
    deadline: request.deadline.toString(),
  };

  if (request.side === "sell") {
    const allowances = await readSellAllowances(
      client,
      deployment,
      request.owner,
      poolKey.currency1,
    );
    const approvalState = getClassicSellApprovalState({
      amountIn: request.amountIn,
      ...allowances,
      now: block.timestamp,
    });
    if (approvalState === "token-to-permit2") {
      return {
        status: "approval-required" as const,
        chainId: deployment.chainId,
        owner: request.owner,
        token: poolKey.currency1,
        side: request.side,
        poolKey,
        quote,
        approvalState,
        transaction: walletTransaction(
          buildClassicTokenApprovalTransaction({
            deployment,
            token: poolKey.currency1,
            amountIn: request.amountIn,
          }),
        ),
      };
    }
    if (approvalState === "permit2-to-router") {
      return {
        status: "approval-required" as const,
        chainId: deployment.chainId,
        owner: request.owner,
        token: poolKey.currency1,
        side: request.side,
        poolKey,
        quote,
        approvalState,
        transaction: walletTransaction(
          buildClassicPermit2ApprovalTransaction({
            deployment,
            token: poolKey.currency1,
            amountIn: request.amountIn,
            now: block.timestamp,
            deadline: request.deadline,
          }),
        ),
      };
    }

    return {
      status: "ready" as const,
      chainId: deployment.chainId,
      owner: request.owner,
      token: poolKey.currency1,
      side: request.side,
      poolKey,
      quote,
      approvalState,
      transaction: await simulatedSwapTransaction(
        client,
        request.owner,
        nativeBalance,
        request.side,
        buildClassicSwapTransaction({
          deployment,
          poolKey,
          side: request.side,
          amountIn: request.amountIn,
          quotedAmountOut: quoted.amountOut,
          slippageBps: request.slippageBps,
          now: block.timestamp,
          deadline: request.deadline,
        }),
      ),
    };
  }

  return {
    status: "ready" as const,
    chainId: deployment.chainId,
    owner: request.owner,
    token: poolKey.currency1,
    side: request.side,
    poolKey,
    quote,
    transaction: await simulatedSwapTransaction(
      client,
      request.owner,
      nativeBalance,
      request.side,
      buildClassicSwapTransaction({
        deployment,
        poolKey,
        side: request.side,
        amountIn: request.amountIn,
        quotedAmountOut: quoted.amountOut,
        slippageBps: request.slippageBps,
        now: block.timestamp,
        deadline: request.deadline,
      }),
    ),
  };
}
