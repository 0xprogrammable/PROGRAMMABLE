import "server-only";

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  maxUint64,
  parseAbi,
  parseGwei,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import { tradeActionRpcProviders } from "../server/action-rpc-quorum.server";
import {
  evaluateProtocolRevenueEconomics,
  evaluateProtocolRevenueState,
  PROTOCOL_REVENUE_MIN_GAS_MULTIPLIER,
} from "./keeper-policy";

type Environment = Readonly<Record<string, string | undefined>>;

const REVENUE_AUTHORITY = getAddress(
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
);
const TREASURY = getAddress(
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
);
const V4_TOKEN = getAddress(
  "0x7987f03462200b3d8a072e02c89a8a41dcb124ee",
);
const MEV_SUBMISSION_ORIGIN = "https://boost.rpc.mevblocker.io/noreverts";
const EXECUTOR_ABI = parseAbi([
  "function keeper() view returns (address)",
  "function router() view returns (address)",
  "function enforcer() view returns (address)",
  "function routerCodeHash() view returns (bytes32)",
  "function enforcerCodeHash() view returns (bytes32)",
  "function delegationHash() view returns (bytes32)",
  "function availableRevenue() view returns (uint256)",
  "function nextRunAt() view returns (uint256)",
  "function currentMainPoolTick() view returns (int24)",
  "function MAX_OBSERVATION_AGE() view returns (uint64)",
  "function executeKeeperCycle(uint64 observedAt, int24 referenceTick)",
]);
const ROUTER_ABI = parseAbi([
  "function REVENUE_AUTHORITY() view returns (address)",
  "function TREASURY() view returns (address)",
  "function V4_TOKEN() view returns (address)",
  "function keeper() view returns (address)",
  "function TREASURY_SHARE_BPS() view returns (uint16)",
  "function BUY_SHARE_BPS() view returns (uint16)",
  "function KEEPER_GAS_SHARE_BPS() view returns (uint16)",
  "function MIN_NEW_REVENUE() view returns (uint256)",
]);

export type ProtocolRevenueKeeperResult =
  | Readonly<{ status: "disabled" }>
  | Readonly<{
      status:
        | "delegation_missing"
        | "not_due"
        | "below_minimum"
        | "pending_transaction"
        | "gas_price_too_high"
        | "gas_estimate_too_high"
        | "uneconomic"
        | "keeper_balance_low";
      finalizedBlockNumber: string;
      availableRevenue: string;
      nextRunAt?: string;
    }>
  | Readonly<{
      status: "submitted";
      transactionHash: Hex;
      finalizedBlockNumber: string;
      availableRevenue: string;
      maximumGasCost: string;
      keeperFunding: string;
    }>;

export class ProtocolRevenueKeeperError extends Error {
  readonly code:
    | "configuration_invalid"
    | "rpc_quorum_failed"
    | "deployment_binding_failed"
    | "observation_stale"
    | "simulation_failed"
    | "submission_failed";

  constructor(code: ProtocolRevenueKeeperError["code"]) {
    super("Protocol revenue keeper failed closed");
    this.name = "ProtocolRevenueKeeperError";
    this.code = code;
  }
}

type KeeperConfiguration = Readonly<{
  executor: Address;
  executorCodeHash: Hex;
  privateKey: Hex;
  maximumGasPrice: bigint;
  minimumRevenueGasMultiplier: bigint;
}>;

function configuredKeeper(env: Environment): KeeperConfiguration | null {
  if (env.PROTOCOL_REVENUE_AUTOMATION_ENABLED !== "true") return null;

  const executor = env.PROTOCOL_REVENUE_EXECUTOR_ADDRESS ?? "";
  const executorCodeHash = env.PROTOCOL_REVENUE_EXECUTOR_CODE_HASH ?? "";
  const privateKey = env.PROTOCOL_REVENUE_KEEPER_PRIVATE_KEY ?? "";
  const multiplier = env.PROTOCOL_REVENUE_KEEPER_MIN_REVENUE_GAS_MULTIPLIER ??
    PROTOCOL_REVENUE_MIN_GAS_MULTIPLIER.toString();
  const maximumGasPrice =
    env.PROTOCOL_REVENUE_KEEPER_MAX_GAS_PRICE_GWEI ?? "5";

  if (
    !isAddress(executor, { strict: true }) ||
    !isHex(executorCodeHash) ||
    executorCodeHash.length !== 66 ||
    !/^0x[0-9a-fA-F]{64}$/u.test(privateKey) ||
    !/^[0-9]{3,5}$/u.test(multiplier)
  ) {
    throw new ProtocolRevenueKeeperError("configuration_invalid");
  }

  let parsedMaximumGasPrice: bigint;
  let parsedMultiplier: bigint;
  try {
    parsedMaximumGasPrice = parseGwei(maximumGasPrice);
    parsedMultiplier = BigInt(multiplier);
  } catch {
    throw new ProtocolRevenueKeeperError("configuration_invalid");
  }
  if (
    parsedMaximumGasPrice <= 0n ||
    parsedMaximumGasPrice > parseGwei("100") ||
    parsedMultiplier < PROTOCOL_REVENUE_MIN_GAS_MULTIPLIER ||
    parsedMultiplier > 10_000n
  ) {
    throw new ProtocolRevenueKeeperError("configuration_invalid");
  }

  const checksummedExecutor = getAddress(executor);
  if (
    checksummedExecutor === REVENUE_AUTHORITY ||
    checksummedExecutor === TREASURY
  ) {
    throw new ProtocolRevenueKeeperError("configuration_invalid");
  }

  return {
    executor: checksummedExecutor,
    executorCodeHash: executorCodeHash.toLowerCase() as Hex,
    privateKey: privateKey as Hex,
    maximumGasPrice: parsedMaximumGasPrice,
    minimumRevenueGasMultiplier: parsedMultiplier,
  };
}

function client(endpoint: string) {
  return createPublicClient({
    chain: mainnet,
    transport: http(endpoint, { retryCount: 1, timeout: 12_000 }),
  });
}

function sameValue(left: unknown, right: unknown) {
  if (typeof left === "bigint" || typeof right === "bigint") {
    return typeof left === "bigint" &&
      typeof right === "bigint" &&
      left === right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return Object.is(left, right);
}

async function agreed<T>(
  clients: readonly [PublicClient, PublicClient],
  read: (current: PublicClient) => Promise<T>,
): Promise<T> {
  let values: readonly [T, T];
  try {
    values = await Promise.all([read(clients[0]), read(clients[1])]);
  } catch {
    throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
  }
  if (!sameValue(values[0], values[1])) {
    throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
  }
  return values[0];
}

async function readContractAgreement<T>(input: Readonly<{
  clients: readonly [PublicClient, PublicClient];
  address: Address;
  abi: typeof EXECUTOR_ABI | typeof ROUTER_ABI;
  functionName: string;
  blockNumber: bigint;
}>): Promise<T> {
  return agreed(input.clients, (current) =>
    current.readContract({
      address: input.address,
      abi: input.abi,
      functionName: input.functionName as never,
      blockNumber: input.blockNumber,
    }) as Promise<T>,
  );
}

async function finalizedObservation(
  clients: readonly [PublicClient, PublicClient],
) {
  let heads;
  try {
    heads = await Promise.all(
      clients.map((current) => current.getBlock({ blockTag: "finalized" })),
    );
  } catch {
    throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
  }
  const firstNumber = heads[0].number;
  const secondNumber = heads[1].number;
  const blockNumber = firstNumber < secondNumber ? firstNumber : secondNumber;
  let blocks;
  try {
    blocks = await Promise.all(
      clients.map((current) => current.getBlock({ blockNumber })),
    );
  } catch {
    throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
  }
  if (
    !blocks[0].hash ||
    !blocks[1].hash ||
    blocks[0].hash.toLowerCase() !== blocks[1].hash.toLowerCase() ||
    blocks[0].timestamp !== blocks[1].timestamp
  ) {
    throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
  }
  return {
    blockNumber,
    blockHash: blocks[0].hash,
    timestamp: blocks[0].timestamp,
  } as const;
}

async function assertCodeBinding(input: Readonly<{
  clients: readonly [PublicClient, PublicClient];
  address: Address;
  blockNumber: bigint;
  expectedCodeHash: Hex;
}>) {
  const code = await agreed(input.clients, (current) =>
    current.getCode({ address: input.address, blockNumber: input.blockNumber }),
  );
  if (!code || keccak256(code).toLowerCase() !== input.expectedCodeHash) {
    throw new ProtocolRevenueKeeperError("deployment_binding_failed");
  }
}

function mevSubmissionClient(keeper: Address) {
  const endpoint = new URL(MEV_SUBMISSION_ORIGIN);
  endpoint.searchParams.set("refundRecipient", keeper);
  endpoint.searchParams.set("referrer", "programmable");
  return client(endpoint.toString());
}

function maximum(values: readonly bigint[]) {
  return values.reduce((current, value) =>
    value > current ? value : current,
  );
}

function requiredEip1559Fee(value: bigint | undefined) {
  if (value === undefined) {
    throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
  }
  return value;
}

export async function runConfiguredProtocolRevenueKeeper(
  env: Environment = process.env,
): Promise<ProtocolRevenueKeeperResult> {
  const configuration = configuredKeeper(env);
  if (!configuration) return { status: "disabled" };

  const providers = tradeActionRpcProviders(1, env);
  const clients = [
    client(providers[0].endpoint),
    client(providers[1].endpoint),
  ] as const;
  const observation = await finalizedObservation(clients);
  await assertCodeBinding({
    clients,
    address: configuration.executor,
    blockNumber: observation.blockNumber,
    expectedCodeHash: configuration.executorCodeHash,
  });

  const [
    keeper,
    router,
    enforcer,
    routerCodeHash,
    enforcerCodeHash,
    delegationHash,
    availableRevenue,
    nextRunAt,
    referenceTick,
    maximumObservationAge,
  ] = await Promise.all([
    readContractAgreement<Address>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "keeper", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "router", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "enforcer", blockNumber: observation.blockNumber }),
    readContractAgreement<Hex>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "routerCodeHash", blockNumber: observation.blockNumber }),
    readContractAgreement<Hex>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "enforcerCodeHash", blockNumber: observation.blockNumber }),
    readContractAgreement<Hex>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "delegationHash", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "availableRevenue", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "nextRunAt", blockNumber: observation.blockNumber }),
    readContractAgreement<number>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "currentMainPoolTick", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.executor, abi: EXECUTOR_ABI, functionName: "MAX_OBSERVATION_AGE", blockNumber: observation.blockNumber }),
  ]);

  const account = privateKeyToAccount(configuration.privateKey);
  if (getAddress(keeper) !== account.address || maximumObservationAge !== 1_800n) {
    throw new ProtocolRevenueKeeperError("deployment_binding_failed");
  }
  await Promise.all([
    assertCodeBinding({ clients, address: getAddress(router), blockNumber: observation.blockNumber, expectedCodeHash: routerCodeHash }),
    assertCodeBinding({ clients, address: getAddress(enforcer), blockNumber: observation.blockNumber, expectedCodeHash: enforcerCodeHash }),
  ]);

  const [
    routerRevenueAuthority,
    routerTreasury,
    routerToken,
    routerKeeper,
    treasuryShareBps,
    buyShareBps,
    keeperGasShareBps,
    minimumRevenue,
  ] = await Promise.all([
    readContractAgreement<Address>({ clients, address: getAddress(router), abi: ROUTER_ABI, functionName: "REVENUE_AUTHORITY", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: getAddress(router), abi: ROUTER_ABI, functionName: "TREASURY", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: getAddress(router), abi: ROUTER_ABI, functionName: "V4_TOKEN", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: getAddress(router), abi: ROUTER_ABI, functionName: "keeper", blockNumber: observation.blockNumber }),
    readContractAgreement<number>({ clients, address: getAddress(router), abi: ROUTER_ABI, functionName: "TREASURY_SHARE_BPS", blockNumber: observation.blockNumber }),
    readContractAgreement<number>({ clients, address: getAddress(router), abi: ROUTER_ABI, functionName: "BUY_SHARE_BPS", blockNumber: observation.blockNumber }),
    readContractAgreement<number>({ clients, address: getAddress(router), abi: ROUTER_ABI, functionName: "KEEPER_GAS_SHARE_BPS", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: getAddress(router), abi: ROUTER_ABI, functionName: "MIN_NEW_REVENUE", blockNumber: observation.blockNumber }),
  ]);
  if (
    getAddress(routerRevenueAuthority) !== REVENUE_AUTHORITY ||
    getAddress(routerTreasury) !== TREASURY ||
    getAddress(routerToken) !== V4_TOKEN ||
    getAddress(routerKeeper) !== account.address ||
    treasuryShareBps !== 5_000 ||
    buyShareBps !== 4_950 ||
    keeperGasShareBps !== 50
  ) {
    throw new ProtocolRevenueKeeperError("deployment_binding_failed");
  }

  const wallClock = BigInt(Math.floor(Date.now() / 1_000));
  if (
    observation.timestamp > wallClock ||
    wallClock - observation.timestamp > maximumObservationAge - 120n ||
    observation.timestamp > maxUint64
  ) {
    throw new ProtocolRevenueKeeperError("observation_stale");
  }

  const privateClient = mevSubmissionClient(account.address);
  let latestNonce: number;
  let pendingNonce: number;
  try {
    const [latest, publicPendingA, publicPendingB, privatePending] =
      await Promise.all([
        agreed(clients, (current) =>
          current.getTransactionCount({
            address: account.address,
            blockTag: "latest",
          }),
        ),
        clients[0].getTransactionCount({ address: account.address, blockTag: "pending" }),
        clients[1].getTransactionCount({ address: account.address, blockTag: "pending" }),
        privateClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
      ]);
    latestNonce = latest;
    pendingNonce = Math.max(publicPendingA, publicPendingB, privatePending);
    if (pendingNonce < latestNonce) {
      throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
    }
  } catch (error) {
    if (error instanceof ProtocolRevenueKeeperError) throw error;
    throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
  }

  const state = evaluateProtocolRevenueState({
    delegationHash,
    finalizedTimestamp: observation.timestamp,
    nextRunAt,
    availableRevenue,
    minimumRevenue,
    latestNonce,
    pendingNonce,
  });
  if (state.status !== "ready") {
    return {
      status: state.status,
      finalizedBlockNumber: observation.blockNumber.toString(),
      availableRevenue: availableRevenue.toString(),
      ...(state.status === "not_due"
        ? { nextRunAt: state.nextRunAt.toString() }
        : {}),
    };
  }

  const args = [observation.timestamp, referenceTick] as const;
  try {
    await Promise.all(
      clients.map((current) =>
        current.simulateContract({
          account: account.address,
          address: configuration.executor,
          abi: EXECUTOR_ABI,
          functionName: "executeKeeperCycle",
          args,
        }),
      ),
    );
  } catch {
    throw new ProtocolRevenueKeeperError("simulation_failed");
  }

  let gasEstimates: readonly bigint[];
  let feeEstimates: Awaited<ReturnType<PublicClient["estimateFeesPerGas"]>>[];
  let keeperBalance: bigint;
  try {
    [gasEstimates, feeEstimates, keeperBalance] = await Promise.all([
      Promise.all(
        clients.map((current) =>
          current.estimateContractGas({
            account: account.address,
            address: configuration.executor,
            abi: EXECUTOR_ABI,
            functionName: "executeKeeperCycle",
            args,
          }),
        ),
      ),
      Promise.all(clients.map((current) => current.estimateFeesPerGas())),
      agreed(clients, (current) =>
        current.getBalance({
          address: account.address,
          blockNumber: observation.blockNumber,
        }),
      ),
    ]);
  } catch {
    throw new ProtocolRevenueKeeperError("rpc_quorum_failed");
  }

  const maxFeePerGas = maximum(
    feeEstimates.map((estimate) =>
      requiredEip1559Fee(estimate.maxFeePerGas),
    ),
  );
  const maxPriorityFeePerGas = maximum(
    feeEstimates.map((estimate) =>
      requiredEip1559Fee(estimate.maxPriorityFeePerGas),
    ),
  );
  const economics = evaluateProtocolRevenueEconomics({
    availableRevenue,
    gasEstimate: maximum(gasEstimates),
    maxFeePerGas,
    maximumGasPrice: configuration.maximumGasPrice,
    minimumRevenueGasMultiplier:
      configuration.minimumRevenueGasMultiplier,
    keeperBalance,
    keeperGasShareBps: BigInt(keeperGasShareBps),
  });
  if (economics.status !== "ready") {
    return {
      status: economics.status,
      finalizedBlockNumber: observation.blockNumber.toString(),
      availableRevenue: availableRevenue.toString(),
    };
  }

  const data = encodeFunctionData({
    abi: EXECUTOR_ABI,
    functionName: "executeKeeperCycle",
    args,
  });
  let serializedTransaction: Hex;
  try {
    serializedTransaction = await account.signTransaction({
      chainId: mainnet.id,
      data,
      gas: economics.gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce: latestNonce,
      to: configuration.executor,
      type: "eip1559",
      value: 0n,
    });
  } catch {
    throw new ProtocolRevenueKeeperError("submission_failed");
  }

  try {
    const transactionHash = await privateClient.sendRawTransaction({
      serializedTransaction,
    });
    if (transactionHash.toLowerCase() !== keccak256(serializedTransaction)) {
      throw new ProtocolRevenueKeeperError("submission_failed");
    }
    return {
      status: "submitted",
      transactionHash,
      finalizedBlockNumber: observation.blockNumber.toString(),
      availableRevenue: availableRevenue.toString(),
      maximumGasCost: economics.maximumGasCost.toString(),
      keeperFunding: economics.keeperFunding.toString(),
    };
  } catch (error) {
    if (error instanceof ProtocolRevenueKeeperError) throw error;
    throw new ProtocolRevenueKeeperError("submission_failed");
  }
}

export function safeProtocolRevenueKeeperError(error: unknown) {
  return {
    code:
      error instanceof ProtocolRevenueKeeperError
        ? error.code
        : "unexpected_failure",
    retryable: true,
  } as const;
}
