import type { Chain } from "viem";
import {
  mainnet,
  robinhood,
  robinhoodTestnet,
  sepolia,
} from "viem/chains";

export type ProgrammableChainRuntimeStatus =
  | "ready"
  | "integration-pending";

export type ProgrammableChainCapability = Readonly<{
  key:
    | "ethereum-mainnet"
    | "ethereum-sepolia"
    | "robinhood-mainnet"
    | "robinhood-testnet";
  chain: Chain;
  displayName: string;
  runtimeStatus: ProgrammableChainRuntimeStatus;
  walletConnection: true;
  productReads: boolean;
  preparedTransactions: boolean;
  launches: boolean;
  trades: boolean;
  statusReason: string;
}>;

const READY_REASON =
  "The active Programmable release has a separately verified deployment binding for this chain.";
const ROBINHOOD_PENDING_REASON =
  "Wallet connectivity is enabled, but Programmable contracts, routing, lifecycle evidence, and provider availability are not yet verified for this chain.";

export const PROGRAMMABLE_CHAIN_CAPABILITIES = Object.freeze([
  Object.freeze({
    key: "ethereum-mainnet",
    chain: mainnet,
    displayName: "Ethereum",
    runtimeStatus: "ready",
    walletConnection: true,
    productReads: true,
    preparedTransactions: true,
    launches: true,
    trades: true,
    statusReason: READY_REASON,
  }),
  Object.freeze({
    key: "ethereum-sepolia",
    chain: sepolia,
    displayName: "Sepolia",
    runtimeStatus: "ready",
    walletConnection: true,
    productReads: true,
    preparedTransactions: true,
    launches: true,
    trades: true,
    statusReason: READY_REASON,
  }),
  Object.freeze({
    key: "robinhood-mainnet",
    chain: robinhood,
    displayName: "Robinhood Chain",
    runtimeStatus: "integration-pending",
    walletConnection: true,
    productReads: false,
    preparedTransactions: false,
    launches: false,
    trades: false,
    statusReason: ROBINHOOD_PENDING_REASON,
  }),
  Object.freeze({
    key: "robinhood-testnet",
    chain: robinhoodTestnet,
    displayName: "Robinhood Chain Testnet",
    runtimeStatus: "integration-pending",
    walletConnection: true,
    productReads: false,
    preparedTransactions: false,
    launches: false,
    trades: false,
    statusReason: ROBINHOOD_PENDING_REASON,
  }),
] satisfies readonly ProgrammableChainCapability[]);

export const PROGRAMMABLE_WALLET_CHAINS = Object.freeze(
  PROGRAMMABLE_CHAIN_CAPABILITIES.map((entry) => entry.chain),
);

export function getProgrammableChainCapability(
  chainId: number,
): ProgrammableChainCapability | null {
  return PROGRAMMABLE_CHAIN_CAPABILITIES.find(
    (entry) => entry.chain.id === chainId,
  ) ?? null;
}

export function getPreparedTransactionChain(
  chainId: number,
): Chain | null {
  const capability = getProgrammableChainCapability(chainId);
  return capability?.preparedTransactions ? capability.chain : null;
}

function parseWalletChainId(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  const raw = normalized.startsWith("eip155:")
    ? normalized.slice("eip155:".length)
    : normalized;
  if (
    !raw ||
    (raw.startsWith("0x")
      ? !/^0x[0-9a-f]+$/u.test(raw)
      : !/^\d+$/u.test(raw))
  ) {
    return null;
  }

  const parsed = raw.startsWith("0x")
    ? Number.parseInt(raw.slice(2), 16)
    : Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getWalletChainDisplayName(value: string): string {
  const chainId = parseWalletChainId(value);
  return chainId === null
    ? value
    : getProgrammableChainCapability(chainId)?.displayName ?? value;
}
