import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isHex,
  parseAbi,
  parseSignature,
  parseUnits,
  serializeTypedData,
  type Address,
  type Hex,
} from "viem";

import {
  parsePreparedTransactionForAccount,
  type PreparedTransaction,
} from "./prepared-transaction";

export const MAIN_TOKEN_MIGRATION_CHAIN_ID = 1 as const;
export const MAIN_TOKEN_MIGRATION_WINDOW_SECONDS = 72 * 60 * 60;
export const MAIN_TOKEN_MIGRATION_RELEASE_ID =
  "v4-ethereum-to-robinhood-72h-2026-v2" as const;
export const MAIN_TOKEN_DECIMALS = 18;
export const MAIN_TOKEN_SYMBOL = "V4";
export const MAIN_TOKEN_NAME = "Programmable";
export const MAIN_TOKEN_PERMIT_VERSION = "1";
export const MAIN_TOKEN_PERMIT_DOMAIN_SEPARATOR =
  "0xe2ac19a052ba41dccaaa930f489a94353d986c7769e416830273d9362ad26a47" as const;
export const MAIN_TOKEN_TOTAL_SUPPLY_RAW =
  1_000_000_000_000_000_000_000_000_000n;
export const MAIN_TOKEN_RUNTIME_CODE_KECCAK256 =
  "0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad" as const;
export const MAIN_TOKEN_ADDRESS = getAddress(
  "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
);
export const MAIN_TOKEN_MIGRATION_WALLET = getAddress(
  "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D",
);

const UINT256_MAX = (1n << 256n) - 1n;
const EIP_7702_DELEGATION_INDICATOR = /^0xef0100[0-9a-f]{40}$/iu;
const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const permitDomainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;
const erc20TransferAbi = parseAbi([
  "function transfer(address to,uint256 amount) returns (bool)",
]);

export type MainTokenMigrationTransaction = Extract<
  PreparedTransaction,
  { kind: "main-token-migration" }
>;

export function isMainTokenMigrationWalletCodeEligible(
  code: Hex | undefined,
) {
  // viem normalizes the canonical `eth_getCode` result `0x` to `undefined`.
  // Both representations therefore mean a normal EOA with no runtime code.
  return code === undefined || code === "0x" ||
    EIP_7702_DELEGATION_INDICATOR.test(code);
}

export function isMainTokenMigrationDelegatedWalletCode(
  code: Hex | undefined,
) {
  return typeof code === "string" &&
    EIP_7702_DELEGATION_INDICATOR.test(code);
}

export type MainTokenMigrationPermitSignature = Readonly<{
  signature: Hex;
  v: number;
  r: Hex;
  s: Hex;
}>;

export function buildMainTokenMigrationPermitTypedData(input: Readonly<{
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}>) {
  if (input.value <= 0n || input.value > UINT256_MAX || input.nonce < 0n ||
    input.nonce > UINT256_MAX || input.deadline <= 0n ||
    input.deadline > UINT256_MAX) {
    throw new Error("The migration permit is outside uint256 bounds");
  }
  return {
    domain: {
      chainId: MAIN_TOKEN_MIGRATION_CHAIN_ID,
      name: MAIN_TOKEN_NAME,
      verifyingContract: MAIN_TOKEN_ADDRESS,
      version: MAIN_TOKEN_PERMIT_VERSION,
    },
    message: {
      deadline: input.deadline,
      nonce: input.nonce,
      owner: getAddress(input.owner),
      spender: getAddress(input.spender),
      value: input.value,
    },
    primaryType: "Permit" as const,
    types: permitTypes,
  };
}

export function serializeMainTokenMigrationPermitTypedData(
  typedData: ReturnType<typeof buildMainTokenMigrationPermitTypedData>,
) {
  const serialized = serializeTypedData({
    ...typedData,
    domain: {
      ...typedData.domain,
      chainId: BigInt(typedData.domain.chainId),
    },
    types: { ...permitDomainTypes, ...typedData.types },
  });
  const payload = JSON.parse(serialized) as {
    domain: { chainId: number | string };
  };
  payload.domain.chainId = MAIN_TOKEN_MIGRATION_CHAIN_ID;
  return JSON.stringify(payload);
}

export function parseMainTokenMigrationPermitSignature(
  signature: Hex,
): MainTokenMigrationPermitSignature {
  if (!isHex(signature, { strict: true }) || signature.length !== 132) {
    throw new Error("The wallet returned an invalid migration permit signature");
  }
  const parsed = parseSignature(signature);
  const v = parsed.v === undefined
    ? (parsed.yParity ?? -1) + 27
    : Number(parsed.v);
  if ((v !== 27 && v !== 28) || parsed.r.length !== 66 ||
    parsed.s.length !== 66) {
    throw new Error("The wallet returned an invalid migration permit signature");
  }
  return Object.freeze({ signature, v, r: parsed.r, s: parsed.s });
}

export function parseMainTokenMigrationAmount(value: string): bigint {
  const normalized = value.trim();
  if (
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u.test(normalized)
  ) {
    throw new Error("Enter a V4 amount with up to 18 decimal places");
  }

  const amount = parseUnits(normalized, MAIN_TOKEN_DECIMALS);
  if (amount <= 0n) {
    throw new Error("Enter an amount greater than zero");
  }
  if (amount > UINT256_MAX) {
    throw new Error("The V4 amount is too large");
  }
  return amount;
}

export function assertMainTokenMigrationBalance(
  amountRaw: bigint,
  balanceRaw: bigint,
) {
  if (balanceRaw < 0n) {
    throw new Error("The V4 balance is invalid");
  }
  if (amountRaw <= 0n) {
    throw new Error("Enter an amount greater than zero");
  }
  if (amountRaw > balanceRaw) {
    throw new Error("Amount exceeds your available V4 balance");
  }
  return amountRaw;
}

export function assertMainTokenMigrationTransaction(
  input: unknown,
  connectedAccount: string,
): MainTokenMigrationTransaction {
  const transaction = parsePreparedTransactionForAccount(
    input,
    connectedAccount,
  );
  if (transaction.kind !== "main-token-migration") {
    throw new Error("The transaction is not a V4 migration transfer");
  }
  if (
    transaction.chainId !== MAIN_TOKEN_MIGRATION_CHAIN_ID ||
    transaction.to.toLowerCase() !== MAIN_TOKEN_ADDRESS.toLowerCase() ||
    transaction.value !== "0"
  ) {
    throw new Error("The V4 migration transaction binding is invalid");
  }

  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({
      abi: erc20TransferAbi,
      data: transaction.data,
    });
  } catch {
    throw new Error("The V4 migration transfer calldata is invalid");
  }
  if (
    decoded.functionName !== "transfer" ||
    decoded.args === undefined ||
    decoded.args.length !== 2
  ) {
    throw new Error("The V4 migration transfer calldata is invalid");
  }

  const [recipient, amount] = decoded.args as readonly [Address, bigint];
  if (
    getAddress(recipient).toLowerCase() !==
      MAIN_TOKEN_MIGRATION_WALLET.toLowerCase() ||
    typeof amount !== "bigint" ||
    amount <= 0n
  ) {
    throw new Error("The V4 migration recipient or amount is invalid");
  }

  const canonicalData = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [MAIN_TOKEN_MIGRATION_WALLET, amount],
  });
  if (canonicalData.toLowerCase() !== transaction.data.toLowerCase()) {
    throw new Error("The V4 migration transfer calldata is not canonical");
  }

  return Object.freeze(transaction);
}

export function buildMainTokenMigrationTransaction(input: Readonly<{
  from: Address;
  amountRaw: bigint;
}>): MainTokenMigrationTransaction {
  if (input.amountRaw <= 0n || input.amountRaw > UINT256_MAX) {
    throw new Error("The V4 migration amount is invalid");
  }

  return assertMainTokenMigrationTransaction(
    {
      kind: "main-token-migration",
      chainId: MAIN_TOKEN_MIGRATION_CHAIN_ID,
      from: getAddress(input.from),
      to: MAIN_TOKEN_ADDRESS,
      data: encodeFunctionData({
        abi: erc20TransferAbi,
        functionName: "transfer",
        args: [MAIN_TOKEN_MIGRATION_WALLET, input.amountRaw],
      }),
      value: "0",
    },
    input.from,
  );
}
