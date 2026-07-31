import "server-only";

import {
  canonicalAddress,
  canonicalBytes32,
  parseNonnegativeIntegerText,
  parseUint256Text,
  type HexAddress,
  type HexBytes32,
} from "./codecs";

const BASIS_POINTS = 10_000n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type ProjectorRewardModel =
  | "classic-v3"
  | "stock-paired";

export type ProjectorRewardAllocation = Readonly<{
  allocationIndex: number;
  beneficiary: HexAddress;
  payoutAddress: HexAddress;
  shareBps: string;
}>;

export type ProjectorRewardBalance = Readonly<{
  account: HexAddress;
  payoutAddress: HexAddress;
  claimableAccrued: string;
  claimedTotal: string;
}>;

export type ProjectorRewardBaseline = Readonly<{
  vault: HexAddress;
  poolId: HexBytes32;
  configurationEpoch: string;
  activeConfigurationHash: HexBytes32 | null;
  allocations: readonly ProjectorRewardAllocation[];
  balances: readonly ProjectorRewardBalance[];
}>;

export type ProjectorRewardEvent = Readonly<{
  occurrenceId: string;
  vault: HexAddress;
  blockNumber: string;
  transactionIndex: string;
  blockGlobalLogIndex: string;
  kind:
    | "creator-fee-checkpoint"
    | "beneficiary-claim"
    | "payout-change"
    | "reward-configuration-activation";
  values: Readonly<Record<string, string | readonly string[]>>;
}>;

export type ProjectorRewardSnapshot = Readonly<{
  vault: HexAddress;
  poolId: HexBytes32;
  configurationEpoch: string;
  activeConfigurationHash: HexBytes32 | null;
  totalCreatorFeesReceived: string;
  allocations: readonly ProjectorRewardAllocation[];
  balances: readonly ProjectorRewardBalance[];
  snapshotSourceOccurrenceId: string;
}>;

type MutableAllocation = {
  allocationIndex: number;
  beneficiary: HexAddress;
  payoutAddress: HexAddress;
  shareBps: bigint;
};

type MutableBalance = {
  account: HexAddress;
  payoutAddress: HexAddress;
  claimableAccrued: bigint;
  claimedTotal: bigint;
};

function rejected(reason: string): never {
  throw new TypeError(`Projector reward fold rejected ${reason}`);
}

function exactUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return rejected("occurrence id");
  return value;
}

function uint(value: unknown): bigint {
  try {
    return BigInt(parseUint256Text(value));
  } catch {
    return rejected("uint256 value");
  }
}

function uint64(value: unknown): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(parseNonnegativeIntegerText(value, 20));
  } catch {
    return rejected("uint64 value");
  }
  if (parsed > MAX_UINT64) return rejected("uint64 value");
  return parsed;
}

function index(value: unknown): number {
  let parsed: bigint;
  try {
    parsed = BigInt(parseNonnegativeIntegerText(value, 3));
  } catch {
    return rejected("allocation index");
  }
  if (parsed > 7n) return rejected("allocation index");
  return Number(parsed);
}

function stringValue(
  values: Readonly<Record<string, string | readonly string[]>>,
  key: string,
): string {
  const value = values[key];
  if (typeof value !== "string") return rejected(`missing ${key}`);
  return value;
}

function arrayValue(
  values: Readonly<Record<string, string | readonly string[]>>,
  key: string,
): readonly string[] {
  const value = values[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return rejected(`missing ${key}`);
  }
  return value;
}

function checkedAdd(left: bigint, right: bigint): bigint {
  const sum = left + right;
  if (sum > MAX_UINT256) return rejected("uint256 overflow");
  return sum;
}

function validateAllocations(
  model: ProjectorRewardModel,
  allocations: readonly ProjectorRewardAllocation[],
): MutableAllocation[] {
  const maximum = model === "classic-v3" ? 5 : 8;
  if (allocations.length < 1 || allocations.length > maximum) {
    return rejected("allocation count");
  }
  const normalized = [...allocations]
    .map((allocation) => {
      const allocationIndex = index(String(allocation.allocationIndex));
      const shareBps = uint(allocation.shareBps);
      if (shareBps < 1n || shareBps > BASIS_POINTS) {
        return rejected("allocation share");
      }
      return {
        allocationIndex,
        beneficiary: canonicalAddress(allocation.beneficiary),
        payoutAddress: canonicalAddress(allocation.payoutAddress),
        shareBps,
      };
    })
    .sort((left, right) => left.allocationIndex - right.allocationIndex);
  if (
    normalized.some((allocation, allocationIndex) =>
      allocation.allocationIndex !== allocationIndex
    ) ||
    normalized.reduce((sum, allocation) => sum + allocation.shareBps, 0n) !==
      BASIS_POINTS
  ) {
    return rejected("allocation set");
  }
  if (
    model !== "classic-v3" &&
    new Set(normalized.map(({ beneficiary }) => beneficiary)).size !==
      normalized.length
  ) {
    return rejected("immutable beneficiary uniqueness");
  }
  if (
    model === "classic-v3" &&
    normalized.some(
      ({ beneficiary, payoutAddress }) => beneficiary !== payoutAddress,
    )
  ) {
    return rejected("classic payout identity");
  }
  return normalized;
}

function validateBalances(
  model: ProjectorRewardModel,
  allocations: readonly MutableAllocation[],
  balances: readonly ProjectorRewardBalance[],
): Map<HexAddress, MutableBalance> {
  const normalized = new Map<HexAddress, MutableBalance>();
  for (const balance of balances) {
    const account = canonicalAddress(balance.account);
    if (normalized.has(account)) return rejected("duplicate balance");
    const payoutAddress = canonicalAddress(balance.payoutAddress);
    if (model === "classic-v3" && payoutAddress !== account) {
      return rejected("classic balance payout");
    }
    normalized.set(account, {
      account,
      payoutAddress,
      claimableAccrued: uint(balance.claimableAccrued),
      claimedTotal: uint(balance.claimedTotal),
    });
  }
  for (const allocation of allocations) {
    const balance = normalized.get(allocation.beneficiary);
    if (!balance || balance.payoutAddress !== allocation.payoutAddress) {
      return rejected("active beneficiary balance");
    }
  }
  if (
    model !== "classic-v3" &&
    [...normalized.keys()].some(
      (account) => !allocations.some(({ beneficiary }) => beneficiary === account),
    )
  ) {
    return rejected("historical immutable beneficiary");
  }
  return normalized;
}

function totalReceived(balances: ReadonlyMap<HexAddress, MutableBalance>): bigint {
  let total = 0n;
  for (const balance of balances.values()) {
    total = checkedAdd(total, balance.claimableAccrued);
    total = checkedAdd(total, balance.claimedTotal);
  }
  return total;
}

function entitlements(
  amount: bigint,
  allocations: readonly MutableAllocation[],
): readonly bigint[] {
  let allocated = 0n;
  return allocations.map((allocation, allocationIndex) => {
    if (allocationIndex === allocations.length - 1) return amount - allocated;
    const share = (amount * allocation.shareBps) / BASIS_POINTS;
    allocated += share;
    return share;
  });
}

function ensureBalance(
  balances: Map<HexAddress, MutableBalance>,
  model: ProjectorRewardModel,
  account: HexAddress,
  payoutAddress: HexAddress,
): MutableBalance {
  const current = balances.get(account);
  if (current) {
    if (model !== "classic-v3") current.payoutAddress = payoutAddress;
    return current;
  }
  const created = {
    account,
    payoutAddress: model === "classic-v3" ? account : payoutAddress,
    claimableAccrued: 0n,
    claimedTotal: 0n,
  };
  balances.set(account, created);
  return created;
}

function recomputeCumulativeBalances(
  allocations: readonly MutableAllocation[],
  balances: Map<HexAddress, MutableBalance>,
  received: bigint,
  mode: "assert" | "update",
) {
  const entitlement = entitlements(received, allocations);
  for (let allocationIndex = 0; allocationIndex < allocations.length; allocationIndex += 1) {
    const allocation = allocations[allocationIndex]!;
    const balance = ensureBalance(
      balances,
      "stock-paired",
      allocation.beneficiary,
      allocation.payoutAddress,
    );
    const allocationEntitlement = entitlement[allocationIndex]!;
    if (balance.claimedTotal > allocationEntitlement) {
      return rejected("cumulative claimed total exceeds entitlement");
    }
    const expectedClaimable = allocationEntitlement - balance.claimedTotal;
    if (mode === "assert" && balance.claimableAccrued !== expectedClaimable) {
      return rejected("cumulative baseline entitlement");
    }
    balance.claimableAccrued = expectedClaimable;
  }
}

function validateEventOrder(events: readonly ProjectorRewardEvent[]) {
  const occurrences = new Set<string>();
  let previous: readonly [bigint, bigint, bigint] | null = null;
  for (const event of events) {
    const occurrenceId = exactUuid(event.occurrenceId);
    if (occurrences.has(occurrenceId)) return rejected("duplicate event");
    occurrences.add(occurrenceId);
    const key = [
      BigInt(parseNonnegativeIntegerText(event.blockNumber)),
      BigInt(parseNonnegativeIntegerText(event.transactionIndex)),
      BigInt(parseNonnegativeIntegerText(event.blockGlobalLogIndex)),
    ] as const;
    if (
      previous &&
      (key[0] < previous[0] ||
        (key[0] === previous[0] && key[1] < previous[1]) ||
        (key[0] === previous[0] &&
          key[1] === previous[1] &&
          key[2] <= previous[2]))
    ) {
      return rejected("event order");
    }
    previous = key;
  }
}

export function foldProjectorRewardState(input: Readonly<{
  model: ProjectorRewardModel;
  baseline: ProjectorRewardBaseline;
  events: readonly ProjectorRewardEvent[];
}>): ProjectorRewardSnapshot {
  if (input.events.length < 1) return rejected("empty event set");
  const vault = canonicalAddress(input.baseline.vault);
  const poolId = canonicalBytes32(input.baseline.poolId);
  let configurationEpoch = uint64(input.baseline.configurationEpoch);
  let activeConfigurationHash =
    input.baseline.activeConfigurationHash === null
      ? null
      : canonicalBytes32(input.baseline.activeConfigurationHash);
  if (input.model === "classic-v3" && activeConfigurationHash === null) {
    return rejected("classic configuration hash");
  }
  let allocations = validateAllocations(input.model, input.baseline.allocations);
  const balances = validateBalances(
    input.model,
    allocations,
    input.baseline.balances,
  );
  let received = totalReceived(balances);
  if (input.model !== "classic-v3") {
    recomputeCumulativeBalances(allocations, balances, received, "assert");
  }
  validateEventOrder(input.events);

  for (const event of input.events) {
    if (canonicalAddress(event.vault) !== vault) return rejected("vault mismatch");
    const values = event.values;
    if (event.kind === "creator-fee-checkpoint") {
      if (input.model !== "classic-v3") return rejected("cumulative checkpoint");
      if (canonicalBytes32(stringValue(values, "poolId")) !== poolId) {
        return rejected("checkpoint pool");
      }
      if (uint64(stringValue(values, "configurationEpoch")) !== configurationEpoch) {
        return rejected("checkpoint epoch");
      }
      const amount = uint(stringValue(values, "amount"));
      if (amount === 0n) return rejected("empty checkpoint");
      const expectedTotal = checkedAdd(received, amount);
      if (uint(stringValue(values, "totalCreatorFeesReceived")) !== expectedTotal) {
        return rejected("checkpoint total");
      }
      const allocationAmounts = entitlements(amount, allocations);
      allocations.forEach((allocation, allocationIndex) => {
        const balance = ensureBalance(
          balances,
          "classic-v3",
          allocation.beneficiary,
          allocation.beneficiary,
        );
        balance.claimableAccrued = checkedAdd(
          balance.claimableAccrued,
          allocationAmounts[allocationIndex]!,
        );
      });
      received = expectedTotal;
      continue;
    }

    if (event.kind === "beneficiary-claim") {
      const beneficiary = canonicalAddress(stringValue(values, "beneficiary"));
      const balance = balances.get(beneficiary);
      if (!balance) return rejected("unknown beneficiary claim");
      const vaultTotalReceived = uint(stringValue(values, "vaultTotalReceived"));
      if (input.model !== "classic-v3") {
        if (vaultTotalReceived < received) return rejected("cumulative received total regression");
        received = vaultTotalReceived;
        recomputeCumulativeBalances(allocations, balances, received, "update");
      } else if (vaultTotalReceived !== received) {
        return rejected("classic received total mismatch");
      }
      const amount = uint(stringValue(values, "amount"));
      const expectedClaimed = checkedAdd(balance.claimedTotal, amount);
      if (
        amount === 0n ||
        balance.claimableAccrued !== amount ||
        uint(stringValue(values, "beneficiaryTotalClaimed")) !== expectedClaimed
      ) {
        return rejected("claim amount");
      }
      if (typeof values.payoutAddress === "string") {
        const payoutAddress = canonicalAddress(values.payoutAddress);
        if (input.model === "classic-v3" || payoutAddress !== balance.payoutAddress) {
          return rejected("claim payout");
        }
      }
      balance.claimableAccrued = 0n;
      balance.claimedTotal = expectedClaimed;
      continue;
    }

    if (event.kind === "payout-change") {
      if (input.model === "classic-v3") {
        if (canonicalBytes32(stringValue(values, "poolId")) !== poolId) {
          return rejected("payout pool");
        }
        const allocationIndex = index(stringValue(values, "allocationIndex"));
        const allocation = allocations[allocationIndex];
        if (!allocation) return rejected("payout allocation");
        const previous = canonicalAddress(stringValue(values, "previousPayoutWallet"));
        const next = canonicalAddress(stringValue(values, "newPayoutWallet"));
        const nextEpoch = uint64(stringValue(values, "configurationEpoch"));
        if (
          previous !== allocation.beneficiary ||
          previous === next ||
          uint(stringValue(values, "shareBps")) !== allocation.shareBps ||
          nextEpoch !== configurationEpoch + 1n ||
          uint(stringValue(values, "effectiveTotalCreatorFeesReceived")) !== received
        ) {
          return rejected("classic payout transition");
        }
        allocation.beneficiary = next;
        allocation.payoutAddress = next;
        ensureBalance(balances, "classic-v3", next, next);
        configurationEpoch = nextEpoch;
        activeConfigurationHash = canonicalBytes32(
          stringValue(values, "activeConfigurationHash"),
        );
      } else {
        const beneficiary = canonicalAddress(stringValue(values, "beneficiary"));
        const allocation = allocations.find(
          (candidate) => candidate.beneficiary === beneficiary,
        );
        const balance = balances.get(beneficiary);
        const previous = canonicalAddress(stringValue(values, "previousPayoutAddress"));
        const next = canonicalAddress(stringValue(values, "newPayoutAddress"));
        if (
          !allocation ||
          !balance ||
          previous !== allocation.payoutAddress ||
          previous !== balance.payoutAddress ||
          previous === next
        ) {
          return rejected("immutable payout transition");
        }
        allocation.payoutAddress = next;
        balance.payoutAddress = next;
      }
      continue;
    }

    if (input.model !== "classic-v3" || activeConfigurationHash === null) {
      return rejected("immutable configuration activation");
    }
    if (canonicalBytes32(stringValue(values, "poolId")) !== poolId) {
      return rejected("activation pool");
    }
    const nextEpoch = uint64(stringValue(values, "configurationEpoch"));
    const previousHash = canonicalBytes32(
      stringValue(values, "previousConfigurationHash"),
    );
    const nextHash = canonicalBytes32(stringValue(values, "newConfigurationHash"));
    const beneficiaries = arrayValue(values, "beneficiaries");
    const shares = arrayValue(values, "sharesBps");
    if (
      previousHash !== activeConfigurationHash ||
      nextEpoch !== configurationEpoch + 1n ||
      uint(stringValue(values, "effectiveTotalCreatorFeesReceived")) !== received ||
      beneficiaries.length !== shares.length
    ) {
      return rejected("configuration transition");
    }
    allocations = validateAllocations(
      "classic-v3",
      beneficiaries.map((beneficiary, allocationIndex) => ({
        allocationIndex,
        beneficiary: canonicalAddress(beneficiary),
        payoutAddress: canonicalAddress(beneficiary),
        shareBps: shares[allocationIndex]!,
      })),
    );
    if (
      new Set(allocations.map(({ beneficiary }) => beneficiary)).size !==
      allocations.length
    ) {
      return rejected("activation beneficiary uniqueness");
    }
    allocations.forEach(({ beneficiary }) =>
      ensureBalance(balances, "classic-v3", beneficiary, beneficiary),
    );
    configurationEpoch = nextEpoch;
    activeConfigurationHash = nextHash;
  }

  const activeAccounts = new Set(allocations.map(({ beneficiary }) => beneficiary));
  const finalBalances = [...balances.values()]
    .filter(
      (balance) =>
        activeAccounts.has(balance.account) ||
        balance.claimableAccrued > 0n ||
        balance.claimedTotal > 0n,
    )
    .sort((left, right) => left.account.localeCompare(right.account));
  if (totalReceived(new Map(finalBalances.map((balance) => [balance.account, balance]))) !== received) {
    return rejected("reward conservation");
  }
  return Object.freeze({
    vault,
    poolId,
    configurationEpoch: configurationEpoch.toString(),
    activeConfigurationHash,
    totalCreatorFeesReceived: received.toString(),
    allocations: Object.freeze(
      allocations.map((allocation) =>
        Object.freeze({
          allocationIndex: allocation.allocationIndex,
          beneficiary: allocation.beneficiary,
          payoutAddress: allocation.payoutAddress,
          shareBps: allocation.shareBps.toString(),
        }),
      ),
    ),
    balances: Object.freeze(
      finalBalances.map((balance) =>
        Object.freeze({
          account: balance.account,
          payoutAddress: balance.payoutAddress,
          claimableAccrued: balance.claimableAccrued.toString(),
          claimedTotal: balance.claimedTotal.toString(),
        }),
      ),
    ),
    snapshotSourceOccurrenceId: exactUuid(input.events.at(-1)!.occurrenceId),
  });
}
