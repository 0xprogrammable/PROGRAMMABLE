import "server-only";

import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  classicGraduationVaultFactoryV1Abi,
  classicGraduationVaultV1Abi,
  classicV4HookAbi,
  classicV4LaunchAbi,
} from "../classic-v4";
import {
  isClassicV4PublicActionRelease,
  type ClassicV4PublicRelease,
} from "../classic-v4-release";
import type { ExploreReadModel } from "../onchain/types";
import type { PreparedBondingGraduation } from "./client";
import { ClassicTradeInputError } from "./classic";
import { ClassicTradeUnavailableError } from "./server";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const REQUEST_FIELDS = new Set(["chainId", "owner", "token"]);
const BONDING_STATE = 2;
const READY_STATE = 3;
const GRADUATED_STATE = 5;
const QUOTE_VALIDITY_SECONDS = 300n;

export type ClassicBondingGraduationRequest = {
  chainId: 1;
  owner: Address;
  token: Address;
};

export type ClassicBondingGraduationRuntimeClient = {
  getBalance(args: { address: Address }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getCode(args: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  readContract(input: Record<string, unknown>): Promise<unknown>;
  call(args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
  }): Promise<{ data?: Hex }>;
  estimateGas(args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
  }): Promise<bigint>;
};

export class ClassicBondingInactiveError extends ClassicTradeUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "ClassicBondingInactiveError";
  }
}

function requestAddress(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new ClassicTradeInputError(`${label} must be an address`);
  }
  try {
    const parsed = getAddress(value);
    if (parsed === ZERO_ADDRESS) throw new Error("zero");
    return parsed;
  } catch {
    throw new ClassicTradeInputError(
      `${label} must be a non-zero Ethereum address`,
    );
  }
}

export function parseClassicBondingGraduationRequest(
  input: unknown,
): ClassicBondingGraduationRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ClassicTradeInputError("The Bonding request must be an object");
  }
  const record = input as Record<string, unknown>;
  const unsupported = Object.keys(record).find(
    (field) => !REQUEST_FIELDS.has(field),
  );
  if (unsupported) {
    throw new ClassicTradeInputError(
      `The Bonding request contains unsupported field ${unsupported}`,
    );
  }
  if (record.chainId !== 1) {
    throw new ClassicTradeUnavailableError(
      "Classic V4 Bonding is only available on Ethereum mainnet",
    );
  }
  return {
    chainId: 1,
    owner: requestAddress(record.owner, "owner"),
    token: requestAddress(record.token, "token"),
  };
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function requireAddress(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new ClassicTradeUnavailableError(`${label} is unavailable`);
  }
  try {
    const parsed = getAddress(value);
    if (parsed === ZERO_ADDRESS) throw new Error("zero");
    return parsed;
  } catch {
    throw new ClassicTradeUnavailableError(`${label} is unavailable`);
  }
}

function requireBigInt(value: unknown, label: string, allowZero = false) {
  if (typeof value !== "bigint" || value < 0n || (!allowZero && value === 0n)) {
    throw new ClassicTradeUnavailableError(`${label} is unavailable`);
  }
  return value;
}

function verifiedClassicV4Token(
  registry: ExploreReadModel,
  request: ClassicBondingGraduationRequest,
  release: ClassicV4PublicRelease,
) {
  if (!isClassicV4PublicActionRelease(release)) {
    throw new ClassicTradeUnavailableError(
      "Classic V4 Bonding is not publicly available",
    );
  }
  const token = registry.tokens.find(
    (candidate) =>
      candidate.tokenAddress.toLowerCase() === request.token.toLowerCase(),
  );
  if (
    registry.status !== "ready" ||
    !token ||
    token.launchModel !== "classic" ||
    token.launchModelVersion !== "classic-v4" ||
    token.hookAddress.toLowerCase() !== release.addresses.feeHook.toLowerCase()
  ) {
    throw new ClassicTradeUnavailableError(
      "This token is not a verified Classic V4 launch",
    );
  }
  return token;
}

export async function prepareClassicBondingGraduation(
  client: ClassicBondingGraduationRuntimeClient,
  release: ClassicV4PublicRelease,
  registry: ExploreReadModel,
  request: ClassicBondingGraduationRequest,
  blockNumber: bigint,
): Promise<PreparedBondingGraduation> {
  const token = verifiedClassicV4Token(registry, request, release);
  const launcher = release.addresses.launcher;
  const hook = release.addresses.feeHook;
  const factory = release.addresses.graduationVaultFactory;

  const [factoryCode, launcherFactory, vaultValue, block] = await Promise.all([
    client.getCode({ address: factory, blockNumber }),
    client.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "graduationVaultFactory",
      blockNumber,
    }),
    client.readContract({
      address: launcher,
      abi: classicV4LaunchAbi,
      functionName: "graduationVaultOf",
      args: [request.token],
      blockNumber,
    }),
    client.getBlock({ blockNumber }),
  ]);

  if (
    !factoryCode ||
    factoryCode === "0x" ||
    !sameHex(
      keccak256(factoryCode),
      release.runtimeCodeHashes.graduationVaultFactory,
    )
  ) {
    throw new ClassicTradeUnavailableError(
      "The verified graduation factory runtime is unavailable",
    );
  }
  if (
    !sameHex(requireAddress(launcherFactory, "Graduation factory"), factory)
  ) {
    throw new ClassicTradeUnavailableError(
      "The launcher graduation factory does not match the verified release",
    );
  }
  let vault: Address;
  try {
    vault = requireAddress(vaultValue, "Graduation vault");
  } catch {
    throw new ClassicBondingInactiveError(
      "This token does not use the Bonding lifecycle",
    );
  }

  const [factoryVault, vaultPoolId, graduated, progressValue] =
    await Promise.all([
      client.readContract({
        address: factory,
        abi: classicGraduationVaultFactoryV1Abi,
        functionName: "isFactoryVault",
        args: [vault],
        blockNumber,
      }),
      client.readContract({
        address: vault,
        abi: classicGraduationVaultV1Abi,
        functionName: "poolId",
        blockNumber,
      }),
      client.readContract({
        address: vault,
        abi: classicGraduationVaultV1Abi,
        functionName: "graduated",
        blockNumber,
      }),
      client.readContract({
        address: hook,
        abi: classicV4HookAbi,
        functionName: "bondingProgress",
        args: [token.poolId],
        blockNumber,
      }),
    ]);
  if (factoryVault !== true) {
    throw new ClassicTradeUnavailableError(
      "This token does not have an active verified graduation vault",
    );
  }
  if (typeof vaultPoolId !== "string" || !sameHex(vaultPoolId, token.poolId)) {
    throw new ClassicTradeUnavailableError(
      "The graduation vault does not match the canonical pool",
    );
  }
  if (graduated !== false) {
    throw new ClassicBondingInactiveError(
      "This token has already completed Bonding",
    );
  }
  if (!Array.isArray(progressValue) || progressValue.length !== 4) {
    throw new ClassicTradeUnavailableError("Bonding progress is unavailable");
  }
  const state = Number(progressValue[0]);
  const progressBps = Number(progressValue[1]);
  const tokenRemaining = requireBigInt(
    progressValue[2],
    "Remaining Bonding tokens",
    true,
  );
  const nativeRemainingNet = requireBigInt(
    progressValue[3],
    "Remaining Bonding principal",
    true,
  );

  if (state === GRADUATED_STATE) {
    throw new ClassicBondingInactiveError(
      "This token has already completed Bonding",
    );
  }

  if (state === READY_STATE) {
    if (
      progressBps !== 10_000 ||
      tokenRemaining !== 0n ||
      nativeRemainingNet !== 0n
    ) {
      throw new ClassicTradeUnavailableError(
        "The completed Bonding curve state is inconsistent",
      );
    }
    const data = encodeFunctionData({
      abi: classicV4LaunchAbi,
      functionName: "graduate",
      args: [request.token],
    });
    const simulationRequest = {
      account: request.owner,
      to: launcher,
      data,
      value: 0n,
    };
    const simulation = await client.call(simulationRequest);
    if (!simulation.data || simulation.data === "0x") {
      throw new ClassicTradeUnavailableError(
        "The graduation simulation returned no result",
      );
    }
    const finalPositionTokenId = decodeFunctionResult({
      abi: classicV4LaunchAbi,
      functionName: "graduate",
      data: simulation.data,
    });
    if (
      typeof finalPositionTokenId !== "bigint" ||
      finalPositionTokenId <= 0n
    ) {
      throw new ClassicTradeUnavailableError(
        "The graduation simulation returned an invalid final position",
      );
    }
    const [estimatedGas, gasPrice, nativeBalance] = await Promise.all([
      client.estimateGas(simulationRequest),
      client.getGasPrice(),
      client.getBalance({ address: request.owner }),
    ]);
    if (estimatedGas <= 0n || gasPrice <= 0n) {
      throw new ClassicTradeUnavailableError(
        "The graduation gas estimate is unavailable",
      );
    }
    const gasLimit = (estimatedGas * 120n + 99n) / 100n;
    if (nativeBalance < gasLimit * gasPrice) {
      throw new ClassicTradeInputError(
        "The wallet needs more ETH for the graduation network fee",
      );
    }

    return {
      status: "ready",
      launchModel: "classic",
      launchModelVersion: "classic-v4",
      chainId: 1,
      owner: request.owner,
      token: request.token,
      hook,
      poolId: token.poolId,
      vault,
      side: "buy",
      poolKey: {
        currency0: ZERO_ADDRESS,
        currency1: request.token,
        fee: 0,
        tickSpacing: 200,
        hooks: hook,
      },
      bonding: {
        state: "ready",
        progressBps,
        samePool: true,
        finalLiquidityLocked: true,
      },
      quote: {
        amountIn: "0",
        amountOut: "0",
        amountOutMinimum: "0",
        gasEstimate: estimatedGas.toString(),
        slippageBps: 0,
        deadline: (block.timestamp + QUOTE_VALIDITY_SECONDS).toString(),
      },
      transaction: {
        kind: "bonding-graduate",
        chainId: 1,
        to: launcher,
        data,
        value: "0",
        gasLimit: gasLimit.toString(),
      },
    };
  }

  if (
    state !== BONDING_STATE ||
    !Number.isInteger(progressBps) ||
    progressBps < 0 ||
    progressBps >= 10_000 ||
    tokenRemaining === 0n ||
    nativeRemainingNet === 0n
  ) {
    throw new ClassicBondingInactiveError(
      "This token does not have an active Bonding curve",
    );
  }

  const maxQuote = await client.readContract({
    address: vault,
    abi: classicGraduationVaultV1Abi,
    functionName: "bondingMaxBuyQuote",
    blockNumber,
  });
  if (!Array.isArray(maxQuote) || maxQuote.length !== 2) {
    throw new ClassicTradeUnavailableError(
      "The Bonding Max quote is unavailable",
    );
  }
  const grossNativeAmount = requireBigInt(maxQuote[0], "Bonding Max input");
  const quotedNetNativeAmount = requireBigInt(
    maxQuote[1],
    "Bonding Max principal",
  );
  if (quotedNetNativeAmount !== nativeRemainingNet) {
    throw new ClassicTradeUnavailableError(
      "The Bonding Max quote does not match current curve state",
    );
  }

  const data = encodeFunctionData({
    abi: classicV4LaunchAbi,
    functionName: "maxBuyAndGraduate",
    args: [request.token, request.owner],
  });
  const simulationRequest = {
    account: request.owner,
    to: launcher,
    data,
    value: grossNativeAmount,
  };
  const simulation = await client.call(simulationRequest);
  if (!simulation.data || simulation.data === "0x") {
    throw new ClassicTradeUnavailableError(
      "The Bonding completion simulation returned no result",
    );
  }
  const [simulatedTokenAmount] = decodeFunctionResult({
    abi: classicV4LaunchAbi,
    functionName: "maxBuyAndGraduate",
    data: simulation.data,
  });
  if (simulatedTokenAmount <= 0n || simulatedTokenAmount > tokenRemaining) {
    throw new ClassicTradeUnavailableError(
      "The Bonding completion simulation returned an invalid token amount",
    );
  }

  const [estimatedGas, gasPrice, nativeBalance] = await Promise.all([
    client.estimateGas(simulationRequest),
    client.getGasPrice(),
    client.getBalance({ address: request.owner }),
  ]);
  if (estimatedGas <= 0n || gasPrice <= 0n) {
    throw new ClassicTradeUnavailableError(
      "The Bonding completion gas estimate is unavailable",
    );
  }
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  if (nativeBalance < grossNativeAmount + gasLimit * gasPrice) {
    throw new ClassicTradeInputError(
      "The wallet needs more ETH for the remaining curve and network fee",
    );
  }

  return {
    status: "ready",
    launchModel: "classic",
    launchModelVersion: "classic-v4",
    chainId: 1,
    owner: request.owner,
    token: request.token,
    hook,
    poolId: token.poolId,
    vault,
    side: "buy",
    poolKey: {
      currency0: ZERO_ADDRESS,
      currency1: request.token,
      fee: 0,
      tickSpacing: 200,
      hooks: hook,
    },
    bonding: {
      state: "bonding",
      progressBps,
      samePool: true,
      finalLiquidityLocked: true,
    },
    quote: {
      amountIn: grossNativeAmount.toString(),
      amountOut: simulatedTokenAmount.toString(),
      amountOutMinimum: simulatedTokenAmount.toString(),
      gasEstimate: estimatedGas.toString(),
      slippageBps: 0,
      deadline: (block.timestamp + QUOTE_VALIDITY_SECONDS).toString(),
    },
    transaction: {
      kind: "bonding-max-buy",
      chainId: 1,
      to: launcher,
      data,
      value: grossNativeAmount.toString(),
      gasLimit: gasLimit.toString(),
    },
  };
}
