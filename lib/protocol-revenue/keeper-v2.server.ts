import "server-only";

import { DelegationManager } from "@metamask/delegation-abis";
import {
  getNativeTokenPeriodTransferEnforcerAvailableAmount,
} from "@metamask/smart-accounts-kit/actions";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import {
  decodeCaveat,
  decodeDelegations,
  encodeDelegations,
  encodeExecutionCalldatas,
} from "@metamask/smart-accounts-kit/utils";
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
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import { tradeActionRpcProviders } from "../server/action-rpc-quorum.server";
import {
  evaluateProtocolRevenueEconomics,
  evaluateProtocolRevenueV2Action,
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
const PERMISSION_PERIOD_AMOUNT = 5n * 10n ** 18n;
const PERMISSION_PERIOD_DURATION = 86_400;
const PRIVATE_SUBMISSION_ORIGIN = "https://rpc.flashbots.net/fast";
const MIN_PRIVATE_PRIORITY_FEE = parseGwei("0.1");
const SINGLE_DEFAULT_MODE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const SMART_ACCOUNTS_ENVIRONMENT = getSmartAccountsEnvironment(mainnet.id);

const COORDINATOR_ABI = parseAbi([
  "function keeper() view returns (address)",
  "function REVENUE_AUTHORITY() view returns (address)",
  "function CLASSIC_V1_HOOK() view returns (address)",
  "function CLASSIC_V2_HOOK() view returns (address)",
  "function MIN_ACCRUED_REVENUE() view returns (uint256)",
  "function accruedRevenue() view returns (uint256)",
  "function ready() view returns (bool)",
  "function nextClaimAt() view returns (uint256)",
  "function claim() returns (uint256)",
]);
const VAULT_ABI = parseAbi([
  "function keeper() view returns (address)",
  "function REVENUE_AUTHORITY() view returns (address)",
  "function TREASURY() view returns (address)",
  "function V4_TOKEN() view returns (address)",
  "function TREASURY_SHARE_BPS() view returns (uint16)",
  "function BUY_SHARE_BPS() view returns (uint16)",
  "function KEEPER_GAS_SHARE_BPS() view returns (uint16)",
  "function CYCLE_INTERVAL() view returns (uint64)",
  "function MAX_DAILY_REVENUE() view returns (uint256)",
  "function MIN_NEW_REVENUE() view returns (uint256)",
  "function MAX_OBSERVATION_AGE() view returns (uint64)",
  "function pendingRevenue() view returns (uint256)",
  "function nextRunAt() view returns (uint256)",
  "function currentMainPoolTick() view returns (int24)",
  "function process(uint64 observedAt,int24 referenceTick)",
]);

type KeeperConfiguration = Readonly<{
  coordinator: Address;
  coordinatorCodeHash: Hex;
  vault: Address;
  vaultCodeHash: Hex;
  permissionContext: Hex;
  delegationManager: Address;
  privateKey: Hex;
  maximumTransfer: bigint;
  maximumGasPrice: bigint;
  minimumRevenueGasMultiplier: bigint;
}>;

export type ProtocolRevenueKeeperV2Result =
  | Readonly<{ status: "disabled" }>
  | Readonly<{
      status:
        | "not_due"
        | "below_minimum"
        | "pending_transaction"
        | "permission_exhausted"
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
      action: "claim" | "transfer" | "process";
      transactionHash: Hex;
      finalizedBlockNumber: string;
      availableRevenue: string;
      maximumGasCost: string;
      keeperFunding: string;
    }>;

export class ProtocolRevenueKeeperV2Error extends Error {
  readonly code:
    | "configuration_invalid"
    | "rpc_quorum_failed"
    | "deployment_binding_failed"
    | "permission_binding_failed"
    | "observation_stale"
    | "simulation_failed"
    | "submission_failed";

  constructor(code: ProtocolRevenueKeeperV2Error["code"]) {
    super("Protocol revenue keeper V2 failed closed");
    this.name = "ProtocolRevenueKeeperV2Error";
    this.code = code;
  }
}

function configuredKeeper(env: Environment): KeeperConfiguration | null {
  if (env.PROTOCOL_REVENUE_AUTOMATION_ENABLED !== "true") return null;

  const coordinator = env.PROTOCOL_REVENUE_COORDINATOR_ADDRESS ?? "";
  const coordinatorCodeHash =
    env.PROTOCOL_REVENUE_COORDINATOR_CODE_HASH ?? "";
  const vault = env.PROTOCOL_REVENUE_VAULT_ADDRESS ?? "";
  const vaultCodeHash = env.PROTOCOL_REVENUE_VAULT_CODE_HASH ?? "";
  const permissionContext =
    env.PROTOCOL_REVENUE_PERMISSION_CONTEXT ?? "";
  const delegationManager =
    env.PROTOCOL_REVENUE_PERMISSION_DELEGATION_MANAGER ?? "";
  const privateKey = env.PROTOCOL_REVENUE_KEEPER_PRIVATE_KEY ?? "";
  const maximumTransfer =
    env.PROTOCOL_REVENUE_KEEPER_MAX_TRANSFER_WEI ??
    PERMISSION_PERIOD_AMOUNT.toString();
  const multiplier =
    env.PROTOCOL_REVENUE_KEEPER_MIN_REVENUE_GAS_MULTIPLIER ??
    PROTOCOL_REVENUE_MIN_GAS_MULTIPLIER.toString();
  const maximumGasPrice =
    env.PROTOCOL_REVENUE_KEEPER_MAX_GAS_PRICE_GWEI ?? "5";

  if (
    !isAddress(coordinator, { strict: true }) ||
    !isAddress(vault, { strict: true }) ||
    !isAddress(delegationManager, { strict: true }) ||
    !isHex(coordinatorCodeHash) ||
    coordinatorCodeHash.length !== 66 ||
    !isHex(vaultCodeHash) ||
    vaultCodeHash.length !== 66 ||
    !isHex(permissionContext) ||
    permissionContext.length < 4 ||
    !/^0x[0-9a-fA-F]{64}$/u.test(privateKey) ||
    !/^[0-9]{1,19}$/u.test(maximumTransfer) ||
    !/^[0-9]{3,5}$/u.test(multiplier)
  ) {
    throw new ProtocolRevenueKeeperV2Error("configuration_invalid");
  }

  let parsedMaximumGasPrice: bigint;
  let parsedMaximumTransfer: bigint;
  let parsedMultiplier: bigint;
  try {
    parsedMaximumGasPrice = parseGwei(maximumGasPrice);
    parsedMaximumTransfer = BigInt(maximumTransfer);
    parsedMultiplier = BigInt(multiplier);
  } catch {
    throw new ProtocolRevenueKeeperV2Error("configuration_invalid");
  }
  if (
    parsedMaximumGasPrice <= 0n ||
    parsedMaximumGasPrice > parseGwei("100") ||
    parsedMaximumTransfer <= 0n ||
    parsedMaximumTransfer > PERMISSION_PERIOD_AMOUNT ||
    parsedMultiplier < PROTOCOL_REVENUE_MIN_GAS_MULTIPLIER ||
    parsedMultiplier > 10_000n
  ) {
    throw new ProtocolRevenueKeeperV2Error("configuration_invalid");
  }

  const checksummedCoordinator = getAddress(coordinator);
  const checksummedVault = getAddress(vault);
  const checksummedManager = getAddress(delegationManager);
  if (
    checksummedCoordinator === REVENUE_AUTHORITY ||
    checksummedVault === REVENUE_AUTHORITY ||
    checksummedVault === TREASURY ||
    checksummedCoordinator === checksummedVault ||
    checksummedManager !== getAddress(SMART_ACCOUNTS_ENVIRONMENT.DelegationManager)
  ) {
    throw new ProtocolRevenueKeeperV2Error("configuration_invalid");
  }

  return {
    coordinator: checksummedCoordinator,
    coordinatorCodeHash: coordinatorCodeHash.toLowerCase() as Hex,
    vault: checksummedVault,
    vaultCodeHash: vaultCodeHash.toLowerCase() as Hex,
    permissionContext,
    delegationManager: checksummedManager,
    privateKey: privateKey as Hex,
    maximumTransfer: parsedMaximumTransfer,
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
  return JSON.stringify(left) === JSON.stringify(right);
}

async function agreed<T>(
  clients: readonly [PublicClient, PublicClient],
  read: (current: PublicClient) => Promise<T>,
): Promise<T> {
  let values: readonly [T, T];
  try {
    values = await Promise.all([read(clients[0]), read(clients[1])]);
  } catch {
    throw new ProtocolRevenueKeeperV2Error("rpc_quorum_failed");
  }
  if (!sameValue(values[0], values[1])) {
    throw new ProtocolRevenueKeeperV2Error("rpc_quorum_failed");
  }
  return values[0];
}

async function readContractAgreement<T>(input: Readonly<{
  clients: readonly [PublicClient, PublicClient];
  address: Address;
  abi: Abi;
  functionName: string;
  blockNumber: bigint;
}>): Promise<T> {
  return agreed(input.clients, (current) =>
    current.readContract({
      address: input.address,
      abi: input.abi,
      functionName: input.functionName,
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
    throw new ProtocolRevenueKeeperV2Error("rpc_quorum_failed");
  }
  const blockNumber = heads[0].number < heads[1].number
    ? heads[0].number
    : heads[1].number;
  const blocks = await Promise.all(
    clients.map((current) => current.getBlock({ blockNumber })),
  );
  if (
    !blocks[0].hash ||
    !blocks[1].hash ||
    blocks[0].hash.toLowerCase() !== blocks[1].hash.toLowerCase() ||
    blocks[0].timestamp !== blocks[1].timestamp
  ) {
    throw new ProtocolRevenueKeeperV2Error("rpc_quorum_failed");
  }
  return { blockNumber, timestamp: blocks[0].timestamp } as const;
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
    throw new ProtocolRevenueKeeperV2Error("deployment_binding_failed");
  }
}

function validatePermissionContext(input: Readonly<{
  permissionContext: Hex;
  keeper: Address;
  vault: Address;
}>) {
  let delegations;
  try {
    delegations = decodeDelegations(input.permissionContext);
  } catch {
    throw new ProtocolRevenueKeeperV2Error("permission_binding_failed");
  }
  const delegation = delegations[0];
  if (
    delegations.length !== 1 ||
    !delegation ||
    getAddress(delegation.delegate) !== input.keeper ||
    getAddress(delegation.delegator) !== REVENUE_AUTHORITY
  ) {
    throw new ProtocolRevenueKeeperV2Error("permission_binding_failed");
  }

  let decoded;
  try {
    decoded = delegation.caveats.map((caveat) =>
      decodeCaveat({ caveat, environment: SMART_ACCOUNTS_ENVIRONMENT }),
    );
  } catch {
    throw new ProtocolRevenueKeeperV2Error("permission_binding_failed");
  }
  const period = decoded.find(
    (caveat) => caveat.type === "nativeTokenPeriodTransfer",
  );
  const exactCalldata = decoded.find(
    (caveat) => caveat.type === "exactCalldata",
  );
  const redeemer = decoded.find((caveat) => caveat.type === "redeemer");
  const allowedTargets = decoded.find(
    (caveat) => caveat.type === "allowedTargets",
  );
  const nativePayment = decoded.find(
    (caveat) => caveat.type === "nativeTokenPayment",
  );
  const hasNonce = decoded.some((caveat) => caveat.type === "nonce");
  const hasFiniteExpiry = decoded.some((caveat) => {
    if (caveat.type !== "timestamp") return false;
    return caveat.beforeThreshold > Math.floor(Date.now() / 1_000);
  });
  const payeeBound =
    (allowedTargets?.type === "allowedTargets" &&
      allowedTargets.targets.length === 1 &&
      getAddress(allowedTargets.targets[0]!) === input.vault) ||
    (nativePayment?.type === "nativeTokenPayment" &&
      getAddress(nativePayment.recipient) === input.vault);
  if (
    period?.type !== "nativeTokenPeriodTransfer" ||
    period.periodAmount !== PERMISSION_PERIOD_AMOUNT ||
    period.periodDuration !== PERMISSION_PERIOD_DURATION ||
    exactCalldata?.type !== "exactCalldata" ||
    exactCalldata.calldata !== "0x" ||
    redeemer?.type !== "redeemer" ||
    redeemer.redeemers.length !== 1 ||
    getAddress(redeemer.redeemers[0]!) !== input.keeper ||
    !payeeBound ||
    !hasNonce ||
    !hasFiniteExpiry
  ) {
    throw new ProtocolRevenueKeeperV2Error("permission_binding_failed");
  }
  return delegation;
}

function privateSubmissionEndpoint() {
  const endpoint = new URL(PRIVATE_SUBMISSION_ORIGIN);
  endpoint.searchParams.set("originId", "programmable");
  return endpoint.toString();
}

type SubmissionRejectionCategory =
  | "fee_rejected"
  | "insufficient_funds"
  | "method_unsupported"
  | "nonce_conflict"
  | "provider_rejected"
  | "simulation_rejected"
  | "transport_failed"
  | "unknown";

function submissionErrorText(error: unknown) {
  const fragments: string[] = [];
  let current = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) {
      fragments.push(current.name, current.message);
      current = "cause" in current ? current.cause : undefined;
      continue;
    }
    if (typeof current === "object") {
      const candidate = current as Readonly<Record<string, unknown>>;
      for (const key of ["name", "message", "details", "shortMessage"]) {
        if (typeof candidate[key] === "string") fragments.push(candidate[key]);
      }
      current = candidate.cause;
      continue;
    }
    break;
  }
  return fragments.join(" ").toLowerCase();
}

export function classifyProtocolRevenueSubmissionError(
  error: unknown,
): SubmissionRejectionCategory {
  const message = submissionErrorText(error);
  if (/insufficient funds|insufficient balance/u.test(message)) {
    return "insufficient_funds";
  }
  if (/nonce too low|nonce too high|already known|replacement transaction/u.test(message)) {
    return "nonce_conflict";
  }
  if (/max fee per gas|priority fee|underpriced|fee cap|base fee/u.test(message)) {
    return "fee_rejected";
  }
  if (/method not found|method .* not (?:exist|available|supported)/u.test(message)) {
    return "method_unsupported";
  }
  if (/simulation|revert|execution reverted/u.test(message)) {
    return "simulation_rejected";
  }
  if (/fetch failed|network|timeout|timed out|socket|connection/u.test(message)) {
    return "transport_failed";
  }
  if (/rejected|denied|invalid transaction|rpc request/u.test(message)) {
    return "provider_rejected";
  }
  return "unknown";
}

function maximum(values: readonly bigint[]) {
  return values.reduce((current, value) => value > current ? value : current);
}

export function selectProtocolRevenuePrivateRelayFees(input: Readonly<{
  maxFeesPerGas: readonly bigint[];
  maxPriorityFeesPerGas: readonly bigint[];
}>) {
  const providerMaxFeePerGas = maximum(input.maxFeesPerGas);
  const providerMaxPriorityFeePerGas = maximum(
    input.maxPriorityFeesPerGas,
  );
  const maxPriorityFeePerGas = providerMaxPriorityFeePerGas <
      MIN_PRIVATE_PRIORITY_FEE
    ? MIN_PRIVATE_PRIORITY_FEE
    : providerMaxPriorityFeePerGas;
  return {
    maxFeePerGas: providerMaxFeePerGas +
      (maxPriorityFeePerGas - providerMaxPriorityFeePerGas),
    maxPriorityFeePerGas,
  } as const;
}

function requiredEip1559Fee(value: bigint | undefined) {
  if (value === undefined) {
    throw new ProtocolRevenueKeeperV2Error("rpc_quorum_failed");
  }
  return value;
}

function delegationRedemptionData(
  permissionContext: Hex,
  vault: Address,
  amount: bigint,
) {
  const executionCalldatas = encodeExecutionCalldatas([
    [{ target: vault, value: amount, callData: "0x" }],
  ]);
  return encodeFunctionData({
    abi: DelegationManager,
    functionName: "redeemDelegations",
    args: [
      [encodeDelegations(permissionContext)],
      [SINGLE_DEFAULT_MODE],
      executionCalldatas,
    ],
  });
}

export async function runConfiguredProtocolRevenueKeeperV2(
  env: Environment = process.env,
): Promise<ProtocolRevenueKeeperV2Result> {
  const configuration = configuredKeeper(env);
  if (!configuration) return { status: "disabled" };

  const providers = tradeActionRpcProviders(1, env);
  const clients = [
    client(providers[0].endpoint),
    client(providers[1].endpoint),
  ] as const;
  const observation = await finalizedObservation(clients);
  await Promise.all([
    assertCodeBinding({
      clients,
      address: configuration.coordinator,
      blockNumber: observation.blockNumber,
      expectedCodeHash: configuration.coordinatorCodeHash,
    }),
    assertCodeBinding({
      clients,
      address: configuration.vault,
      blockNumber: observation.blockNumber,
      expectedCodeHash: configuration.vaultCodeHash,
    }),
  ]);

  const account = privateKeyToAccount(configuration.privateKey);
  const delegation = validatePermissionContext({
    permissionContext: configuration.permissionContext,
    keeper: account.address,
    vault: configuration.vault,
  });

  const [
    coordinatorKeeper,
    coordinatorRevenueAuthority,
    claimMinimumRevenue,
    claimAccruedRevenue,
    claimReady,
    vaultKeeper,
    vaultRevenueAuthority,
    vaultTreasury,
    vaultToken,
    treasuryShareBps,
    buyShareBps,
    keeperGasShareBps,
    cycleInterval,
    maximumDailyRevenue,
    vaultMinimumRevenue,
    maximumObservationAge,
    pendingRevenue,
    vaultNextRunAt,
    referenceTick,
    rewardWalletBalance,
  ] = await Promise.all([
    readContractAgreement<Address>({ clients, address: configuration.coordinator, abi: COORDINATOR_ABI, functionName: "keeper", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: configuration.coordinator, abi: COORDINATOR_ABI, functionName: "REVENUE_AUTHORITY", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.coordinator, abi: COORDINATOR_ABI, functionName: "MIN_ACCRUED_REVENUE", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.coordinator, abi: COORDINATOR_ABI, functionName: "accruedRevenue", blockNumber: observation.blockNumber }),
    readContractAgreement<boolean>({ clients, address: configuration.coordinator, abi: COORDINATOR_ABI, functionName: "ready", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "keeper", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "REVENUE_AUTHORITY", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "TREASURY", blockNumber: observation.blockNumber }),
    readContractAgreement<Address>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "V4_TOKEN", blockNumber: observation.blockNumber }),
    readContractAgreement<number>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "TREASURY_SHARE_BPS", blockNumber: observation.blockNumber }),
    readContractAgreement<number>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "BUY_SHARE_BPS", blockNumber: observation.blockNumber }),
    readContractAgreement<number>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "KEEPER_GAS_SHARE_BPS", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "CYCLE_INTERVAL", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "MAX_DAILY_REVENUE", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "MIN_NEW_REVENUE", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "MAX_OBSERVATION_AGE", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "pendingRevenue", blockNumber: observation.blockNumber }),
    readContractAgreement<bigint>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "nextRunAt", blockNumber: observation.blockNumber }),
    readContractAgreement<number>({ clients, address: configuration.vault, abi: VAULT_ABI, functionName: "currentMainPoolTick", blockNumber: observation.blockNumber }),
    agreed(clients, (current) => current.getBalance({ address: REVENUE_AUTHORITY, blockNumber: observation.blockNumber })),
  ]);
  if (
    getAddress(coordinatorKeeper) !== account.address ||
    getAddress(vaultKeeper) !== account.address ||
    getAddress(coordinatorRevenueAuthority) !== REVENUE_AUTHORITY ||
    getAddress(vaultRevenueAuthority) !== REVENUE_AUTHORITY ||
    getAddress(vaultTreasury) !== TREASURY ||
    getAddress(vaultToken) !== V4_TOKEN ||
    treasuryShareBps !== 5_000 ||
    buyShareBps !== 4_950 ||
    keeperGasShareBps !== 50 ||
    cycleInterval !== 86_400n ||
    maximumDailyRevenue !== PERMISSION_PERIOD_AMOUNT ||
    maximumObservationAge !== 1_800n
  ) {
    throw new ProtocolRevenueKeeperV2Error("deployment_binding_failed");
  }

  const wallClock = BigInt(Math.floor(Date.now() / 1_000));
  if (
    observation.timestamp > wallClock ||
    wallClock - observation.timestamp > maximumObservationAge - 120n ||
    observation.timestamp > maxUint64
  ) {
    throw new ProtocolRevenueKeeperV2Error("observation_stale");
  }

  let permissionAvailable: bigint;
  try {
    const availability = await Promise.all(
      clients.map((current) =>
        getNativeTokenPeriodTransferEnforcerAvailableAmount(
          current,
          SMART_ACCOUNTS_ENVIRONMENT,
          { delegation },
        )
      ),
    );
    if (
      availability[0].availableAmount !== availability[1].availableAmount ||
      availability[0].currentPeriod !== availability[1].currentPeriod
    ) {
      throw new ProtocolRevenueKeeperV2Error("rpc_quorum_failed");
    }
    permissionAvailable = availability[0].availableAmount;
  } catch (error) {
    if (error instanceof ProtocolRevenueKeeperV2Error) throw error;
    throw new ProtocolRevenueKeeperV2Error("permission_binding_failed");
  }

  const privateEndpoint = privateSubmissionEndpoint();
  const privateClient = client(privateEndpoint);
  let latestNonce: number;
  let pendingNonce: number;
  try {
    const [latest, publicPendingA, publicPendingB, privatePending] =
      await Promise.all([
        agreed(clients, (current) => current.getTransactionCount({ address: account.address, blockTag: "latest" })),
        clients[0].getTransactionCount({ address: account.address, blockTag: "pending" }),
        clients[1].getTransactionCount({ address: account.address, blockTag: "pending" }),
        privateClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
      ]);
    latestNonce = latest;
    pendingNonce = Math.max(publicPendingA, publicPendingB, privatePending);
    if (pendingNonce < latestNonce) throw new Error();
  } catch {
    throw new ProtocolRevenueKeeperV2Error("rpc_quorum_failed");
  }

  const decision = evaluateProtocolRevenueV2Action({
    finalizedTimestamp: observation.timestamp,
    pendingRevenue,
    vaultNextRunAt,
    vaultMinimumRevenue,
    rewardWalletBalance,
    permissionAvailable,
    maximumTransfer: configuration.maximumTransfer < maximumDailyRevenue
      ? configuration.maximumTransfer
      : maximumDailyRevenue,
    claimReady,
    claimAccruedRevenue,
    claimMinimumRevenue,
    latestNonce,
    pendingNonce,
  });
  if (
    decision.status !== "process" &&
    decision.status !== "transfer" &&
    decision.status !== "claim"
  ) {
    return {
      status: decision.status,
      finalizedBlockNumber: observation.blockNumber.toString(),
      availableRevenue: (
        pendingRevenue + rewardWalletBalance + claimAccruedRevenue
      ).toString(),
      ...(decision.status === "not_due"
        ? { nextRunAt: decision.nextRunAt.toString() }
        : {}),
    };
  }

  const action = decision.status;
  const transaction = action === "process"
    ? {
        to: configuration.vault,
        data: encodeFunctionData({
          abi: VAULT_ABI,
          functionName: "process",
          args: [observation.timestamp, referenceTick],
        }),
        value: 0n,
        economicRevenue: decision.revenue,
      }
    : action === "transfer"
    ? {
        to: configuration.delegationManager,
        data: delegationRedemptionData(
          configuration.permissionContext,
          configuration.vault,
          decision.amount,
        ),
        value: 0n,
        economicRevenue: decision.amount,
      }
    : {
        to: configuration.coordinator,
        data: encodeFunctionData({
          abi: COORDINATOR_ABI,
          functionName: "claim",
        }),
        value: 0n,
        economicRevenue: decision.accruedRevenue,
      };

  try {
    await Promise.all(
      clients.map((current) =>
        current.call({
          account: account.address,
          to: transaction.to,
          data: transaction.data,
          value: transaction.value,
        }),
      ),
    );
  } catch {
    throw new ProtocolRevenueKeeperV2Error("simulation_failed");
  }

  let gasEstimates: readonly bigint[];
  let feeEstimates: Awaited<ReturnType<PublicClient["estimateFeesPerGas"]>>[];
  let keeperBalance: bigint;
  try {
    [gasEstimates, feeEstimates, keeperBalance] = await Promise.all([
      Promise.all(
        clients.map((current) =>
          current.estimateGas({
            account: account.address,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
          })
        ),
      ),
      Promise.all(clients.map((current) => current.estimateFeesPerGas())),
      agreed(clients, (current) => current.getBalance({ address: account.address, blockNumber: observation.blockNumber })),
    ]);
  } catch {
    throw new ProtocolRevenueKeeperV2Error("rpc_quorum_failed");
  }
  const { maxFeePerGas, maxPriorityFeePerGas } =
    selectProtocolRevenuePrivateRelayFees({
      maxFeesPerGas: feeEstimates.map((estimate) =>
        requiredEip1559Fee(estimate.maxFeePerGas)
      ),
      maxPriorityFeesPerGas: feeEstimates.map((estimate) =>
        requiredEip1559Fee(estimate.maxPriorityFeePerGas)
      ),
    });
  const economics = evaluateProtocolRevenueEconomics({
    availableRevenue: transaction.economicRevenue,
    gasEstimate: maximum(gasEstimates),
    maxFeePerGas,
    maximumGasPrice: configuration.maximumGasPrice,
    minimumRevenueGasMultiplier: configuration.minimumRevenueGasMultiplier,
    keeperBalance,
    keeperGasShareBps: BigInt(keeperGasShareBps),
  });
  if (economics.status !== "ready") {
    return {
      status: economics.status,
      finalizedBlockNumber: observation.blockNumber.toString(),
      availableRevenue: transaction.economicRevenue.toString(),
    };
  }

  let transactionHash: Hex;
  let submissionStage: "sign" | "broadcast" | "hash" = "sign";
  try {
    const serializedTransaction = await account.signTransaction({
      chainId: mainnet.id,
      data: transaction.data,
      gas: economics.gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce: latestNonce,
      to: transaction.to,
      type: "eip1559",
      value: transaction.value,
    });
    submissionStage = "broadcast";
    transactionHash = await privateClient.sendRawTransaction({
      serializedTransaction,
    });
    submissionStage = "hash";
    if (transactionHash.toLowerCase() !== keccak256(serializedTransaction)) {
      throw new Error();
    }
  } catch (error) {
    console.error("Programmable protocol revenue submission rejected", {
      action,
      stage: submissionStage,
      category: classifyProtocolRevenueSubmissionError(error),
    });
    throw new ProtocolRevenueKeeperV2Error("submission_failed");
  }

  return {
    status: "submitted",
    action,
    transactionHash,
    finalizedBlockNumber: observation.blockNumber.toString(),
    availableRevenue: transaction.economicRevenue.toString(),
    maximumGasCost: economics.maximumGasCost.toString(),
    keeperFunding: economics.keeperFunding.toString(),
  };
}

export function safeProtocolRevenueKeeperV2Error(error: unknown) {
  return {
    code: error instanceof ProtocolRevenueKeeperV2Error
      ? error.code
      : "unexpected_failure",
    retryable: true,
  } as const;
}
