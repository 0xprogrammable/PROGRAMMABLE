import {
  getAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { ROBINHOOD_CHAIN_ID } from "./chains";

export const ETHEREUM_MAINNET_CHAIN_ID = 1 as const;
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11_155_111 as const;
export type PreparedTransactionChainId =
  | typeof ETHEREUM_MAINNET_CHAIN_ID
  | typeof ETHEREUM_SEPOLIA_CHAIN_ID
  | typeof ROBINHOOD_CHAIN_ID;

export type PreparedTransactionKind =
  | "launch"
  | "main-token-migration"
  | "prediction-market-launch"
  | "prediction-market-action"
  | "token-to-permit2"
  | "permit2-to-router"
  | "swap"
  | "claim-creator-fees"
  | "claim-classic-v3-rewards"
  | "update-classic-v3-payout"
  | "claim-deep-rewards"
  | "update-deep-payout"
  | "claim-stock-paired-rewards"
  | "update-stock-paired-payout";

type PreparedTransactionBase = {
  chainId: PreparedTransactionChainId;
  to: Address;
  data: Hex;
  value: string;
};

type PreparedApprovalTransactionBase = PreparedTransactionBase & {
  gasLimit?: string;
  from?: never;
};

type PreparedApprovalTransaction =
  | (PreparedApprovalTransactionBase & { kind: "token-to-permit2" })
  | (PreparedApprovalTransactionBase & { kind: "permit2-to-router" });

type PreparedSwapTransaction = PreparedTransactionBase & {
  kind: "swap";
  gasLimit: string;
  from?: never;
};

export type PreparedTradeTransaction =
  | PreparedApprovalTransaction
  | PreparedSwapTransaction;

type PreparedLaunchTransaction = PreparedTransactionBase & {
  kind: "launch";
  gasLimit: string;
  from?: never;
};

type PreparedMainTokenMigrationTransaction = PreparedTransactionBase & {
  kind: "main-token-migration";
  from: Address;
  gasLimit?: string;
};

type PreparedPredictionMarketTransaction = PreparedTransactionBase & {
  kind: "prediction-market-launch" | "prediction-market-action";
  gasLimit: string;
  from?: never;
};

type PreparedClaimTransactionBase = PreparedTransactionBase & {
  from: Address;
  gasLimit: string;
};

type PreparedClaimTransaction =
  | (PreparedClaimTransactionBase & { kind: "claim-creator-fees" })
  | (PreparedClaimTransactionBase & {
      kind: "claim-classic-v3-rewards";
    })
  | (PreparedClaimTransactionBase & {
      kind: "update-classic-v3-payout";
    })
  | (PreparedClaimTransactionBase & {
      kind: "claim-deep-rewards";
    })
  | (PreparedClaimTransactionBase & {
      kind: "update-deep-payout";
    })
  | (PreparedClaimTransactionBase & {
      kind: "claim-stock-paired-rewards";
    })
  | (PreparedClaimTransactionBase & {
      kind: "update-stock-paired-payout";
    });

export type PreparedTransaction =
  | PreparedTradeTransaction
  | PreparedLaunchTransaction
  | PreparedMainTokenMigrationTransaction
  | PreparedPredictionMarketTransaction
  | PreparedClaimTransaction;

export type PreparedTransactionReview = {
  description: string;
  buttonText: string;
  successHeader: string;
};

const UINT256_MAX = (1n << 256n) - 1n;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const kinds = new Set<PreparedTransactionKind>([
  "launch",
  "main-token-migration",
  "prediction-market-launch",
  "prediction-market-action",
  "token-to-permit2",
  "permit2-to-router",
  "swap",
  "claim-creator-fees",
  "claim-classic-v3-rewards",
  "update-classic-v3-payout",
  "claim-deep-rewards",
  "update-deep-payout",
  "claim-stock-paired-rewards",
  "update-stock-paired-payout",
]);
const commonFields = new Set([
  "kind",
  "chainId",
  "to",
  "data",
  "value",
  "gasLimit",
]);
const claimFields = new Set([...commonFields, "from"]);

function readAddress(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`The transaction ${label} is not a valid address`);
  }

  try {
    const address = getAddress(value);
    if (address.toLowerCase() === zeroAddress) throw new Error("zero");
    return address;
  } catch {
    throw new Error(`The transaction ${label} is not a valid address`);
  }
}

function readUintString(
  value: unknown,
  label: "value" | "gas limit",
  allowZero: boolean,
) {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^(0|[1-9]\d*)$/.test(value)
  ) {
    throw new Error(`The transaction ${label} is invalid`);
  }

  const parsed = BigInt(value);
  if ((!allowZero && parsed === 0n) || parsed > UINT256_MAX) {
    throw new Error(`The transaction ${label} is invalid`);
  }
  return value;
}

function readCalldata(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(value)
  ) {
    throw new Error("The transaction calldata is invalid");
  }
  if (
    value.length < 10 ||
    value.length % 2 !== 0
  ) {
    throw new Error("The transaction must contain function calldata");
  }
  if (value.length > 131_074) {
    throw new Error("The transaction calldata is too large");
  }
  return value as Hex;
}

export function parsePreparedTransaction(
  input: unknown,
): PreparedTransaction {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    throw new Error("The prepared transaction is invalid");
  }

  const record = input as Record<string, unknown>;
  if (
    typeof record.kind !== "string" ||
    !kinds.has(record.kind as PreparedTransactionKind)
  ) {
    throw new Error("The transaction kind is not supported");
  }
  const kind = record.kind as PreparedTransactionKind;
  const allowedFields =
    kind === "main-token-migration" ||
    kind === "claim-creator-fees" ||
    kind === "claim-classic-v3-rewards" ||
    kind === "update-classic-v3-payout" ||
    kind === "claim-deep-rewards" ||
    kind === "update-deep-payout" ||
    kind === "claim-stock-paired-rewards" ||
    kind === "update-stock-paired-payout"
      ? claimFields
      : commonFields;
  const unsupportedField = Object.keys(record).find(
    (field) => !allowedFields.has(field),
  );
  if (unsupportedField) {
    throw new Error(
      `The prepared transaction contains unsupported field ${unsupportedField}`,
    );
  }
  if (
    kind === "main-token-migration"
  ) {
    if (record.chainId !== ETHEREUM_MAINNET_CHAIN_ID) {
      throw new Error("Main token migration is limited to Ethereum Mainnet");
    }
  } else if (
    kind === "prediction-market-launch" ||
    kind === "prediction-market-action"
  ) {
    if (record.chainId !== ROBINHOOD_CHAIN_ID) {
      throw new Error("Prediction market launches are limited to Robinhood Chain");
    }
  } else if (
    record.chainId !== ETHEREUM_MAINNET_CHAIN_ID &&
    record.chainId !== ETHEREUM_SEPOLIA_CHAIN_ID
  ) {
    throw new Error("Transactions are limited to Ethereum Mainnet or Sepolia");
  }

  const base = {
    chainId: record.chainId,
    to: readAddress(record.to, "destination"),
    data: readCalldata(record.data),
    value: readUintString(record.value, "value", true),
  };

  if (
    kind === "launch" ||
    kind === "prediction-market-launch" ||
    kind === "prediction-market-action"
  ) {
    return {
      ...base,
      kind,
      gasLimit: readUintString(record.gasLimit, "gas limit", false),
    };
  }
  if (
    kind === "main-token-migration"
  ) {
    return {
      ...base,
      kind,
      from: readAddress(record.from, "sender"),
      ...(record.gasLimit === undefined
        ? {}
        : { gasLimit: readUintString(record.gasLimit, "gas limit", false) }),
    };
  }
  if (
    kind === "claim-creator-fees" ||
    kind === "claim-classic-v3-rewards" ||
    kind === "update-classic-v3-payout" ||
    kind === "claim-deep-rewards" ||
    kind === "update-deep-payout" ||
    kind === "claim-stock-paired-rewards" ||
    kind === "update-stock-paired-payout"
  ) {
    return {
      ...base,
      kind,
      from: readAddress(record.from, "sender"),
      gasLimit: readUintString(record.gasLimit, "gas limit", false),
    };
  }
  if (kind === "swap") {
    return {
      ...base,
      kind,
      gasLimit: readUintString(record.gasLimit, "gas limit", false),
    };
  }

  return {
    ...base,
    kind,
    ...(record.gasLimit === undefined
      ? {}
      : {
          gasLimit: readUintString(
            record.gasLimit,
            "gas limit",
            false,
          ),
        }),
  };
}

export function parsePreparedTransactionForAccount(
  input: unknown,
  account: string,
) {
  const transaction = parsePreparedTransaction(input);
  const connectedAccount = readAddress(account, "connected wallet");
  if (
    (transaction.kind === "main-token-migration" ||
      transaction.kind === "claim-creator-fees" ||
      transaction.kind === "claim-classic-v3-rewards" ||
      transaction.kind === "update-classic-v3-payout" ||
      transaction.kind === "claim-deep-rewards" ||
      transaction.kind === "update-deep-payout" ||
      transaction.kind === "claim-stock-paired-rewards" ||
      transaction.kind === "update-stock-paired-payout") &&
    transaction.from.toLowerCase() !== connectedAccount.toLowerCase()
  ) {
    throw new Error(
      transaction.kind === "main-token-migration"
        ? "The migration sender does not match the connected wallet"
        : "The creator fee claim does not match the connected wallet",
    );
  }
  return transaction;
}

export function buildPrivyTransactionRequest(input: unknown) {
  const transaction = parsePreparedTransaction(input);
  return {
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.value),
    ...(transaction.gasLimit === undefined
      ? {}
      : { gasLimit: BigInt(transaction.gasLimit) }),
    chainId: transaction.chainId,
  };
}

export function buildEip1193TransactionRequest(
  input: unknown,
  account: string,
) {
  const transaction = parsePreparedTransactionForAccount(input, account);

  return {
    from: getAddress(account),
    to: transaction.to,
    data: transaction.data,
    value: toHex(BigInt(transaction.value)),
    ...(transaction.gasLimit === undefined
      ? {}
      : { gas: toHex(BigInt(transaction.gasLimit)) }),
  };
}

export function parseSubmittedTransactionHash(value: unknown): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value)
  ) {
    throw new Error("The wallet returned an invalid transaction hash");
  }

  return value as Hex;
}

export function getPreparedTransactionReview(
  kind: PreparedTransactionKind,
): PreparedTransactionReview {
  if (kind === "main-token-migration") {
    return {
      description: "Send V4 to the fixed migration wallet on Ethereum",
      buttonText: "Send V4",
      successHeader: "Migration transfer submitted",
    };
  }
  if (kind === "launch") {
    return {
      description: "Submit the prepared token launch on Ethereum",
      buttonText: "Launch token",
      successHeader: "Launch submitted",
    };
  }
  if (kind === "prediction-market-launch") {
    return {
      description: "Create this fully backed BTC market on Robinhood Chain",
      buttonText: "Create market",
      successHeader: "Market creation submitted",
    };
  }
  if (kind === "prediction-market-action") {
    return {
      description: "Submit this prediction-market action on Robinhood Chain",
      buttonText: "Confirm action",
      successHeader: "Market action submitted",
    };
  }
  if (kind === "token-to-permit2") {
    return {
      description:
        "Allow Permit2 to use only the token amount prepared for this trade. This approval is not a swap",
      buttonText: "Approve token",
      successHeader: "Token approval submitted",
    };
  }
  if (kind === "permit2-to-router") {
    return {
      description:
        "Allow the Uniswap router to use only the token amount prepared for this trade through Permit2. This approval is not a swap",
      buttonText: "Approve Uniswap",
      successHeader: "Router approval submitted",
    };
  }
  if (kind === "claim-classic-v3-rewards") {
    return {
      description: "Claim your Classic creator rewards",
      buttonText: "Claim rewards",
      successHeader: "Reward claim submitted",
    };
  }
  if (kind === "update-classic-v3-payout") {
    return {
      description: "Update where your Classic rewards are paid",
      buttonText: "Update payout address",
      successHeader: "Payout update submitted",
    };
  }
  if (kind === "claim-deep-rewards") {
    return {
      description: "Claim your Deep creator rewards",
      buttonText: "Claim rewards",
      successHeader: "Reward claim submitted",
    };
  }
  if (kind === "update-deep-payout") {
    return {
      description: "Update where your Deep rewards are paid",
      buttonText: "Update payout address",
      successHeader: "Payout update submitted",
    };
  }
  if (kind === "claim-stock-paired-rewards") {
    return {
      description: "Claim your Stock-Paired creator rewards",
      buttonText: "Claim rewards",
      successHeader: "Reward claim submitted",
    };
  }
  if (kind === "update-stock-paired-payout") {
    return {
      description: "Update where your Stock-Paired rewards are paid",
      buttonText: "Update payout address",
      successHeader: "Payout update submitted",
    };
  }
  if (kind === "swap") {
    return {
      description: "Submit the prepared swap through Uniswap v4",
      buttonText: "Submit swap",
      successHeader: "Swap submitted",
    };
  }
  return {
    description:
      "Send this token’s accrued creator fees to the recorded creator wallet",
    buttonText: "Submit claim",
    successHeader: "Claim submitted",
  };
}
