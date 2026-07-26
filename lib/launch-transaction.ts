import {
  encodeFunctionData,
  getCreate2Address,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

import type { LaunchDraft } from "@/lib/launch";

export const ETHEREUM_CHAIN_ID = 1;
export const STANDARD_LP_FEE_PERCENT = "0.30";
export const MIN_SQRT_PRICE = 4_295_128_739n;
export const MAX_SQRT_PRICE =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
export const HOOK_FLAG_MASK = (1n << 14n) - 1n;
export const STANDARD_HOOK_FLAGS = (1n << 13n) | (1n << 6n) | (1n << 2n);
export const BOUNDED_DYNAMIC_HOOK_FLAGS =
  (1n << 13n) |
  (1n << 12n) |
  (1n << 7n) |
  (1n << 6n) |
  (1n << 2n);
export const MAX_HOOK_SALT_ATTEMPTS = 160_444;

const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const Q192 = 1n << 192n;
const PRICE_SCALE = 10n ** 18n;
const PRICE_DENOMINATOR = PRICE_SCALE * 10n ** 18n;

export const directLiquidityLauncherAbi = parseAbi([
  "function launch((string name,string symbol,uint256 totalSupply,uint256 tokenLiquidityAmount,uint160 initialSqrtPriceX96,bytes32 creatorSalt,bytes32 hookSalt,(string description,string website,string image,uint256 xProofTweetId) metadata) parameters) payable returns ((address token,address hook,address positionRecipient,uint256 positionTokenId,uint256 nativeLiquidityAmount,uint256 tokenLiquidityAmount,bytes32 poolId,bytes32 launchHash) result)",
  "function launchExistingUERC20((address token,uint256 tokenLiquidityAmount,uint160 initialSqrtPriceX96,bytes32 hookSalt) parameters) payable returns ((address token,address hook,address positionRecipient,uint256 positionTokenId,uint256 nativeLiquidityAmount,uint256 tokenLiquidityAmount,bytes32 poolId,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function hookFactory() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function platformFeeRecipient() view returns (address)",
]);

export const platformFeeHookFactoryAbi = parseAbi([
  "function deploy(bytes32 salt,address poolManager,address authorized,address feeRecipient,address currency0,address currency1) returns (address hook)",
  "function predict(bytes32 salt,address poolManager,address authorized,address feeRecipient,address currency0,address currency1) view returns (address)",
  "function initCodeHash(address poolManager,address authorized,address feeRecipient,address currency0,address currency1) pure returns (bytes32)",
  "function configurationHashOf(address hook) view returns (bytes32)",
]);
export const boundedDynamicFeeHookFactoryAbi =
  platformFeeHookFactoryAbi;

export const lockedPositionFeeForwarderFactoryAbi = parseAbi([
  "function deploy(bytes32 salt,address feeRecipient) returns (address forwarder)",
  "function predict(bytes32 salt,address feeRecipient) view returns (address)",
  "function configurationHashOf(address forwarder) view returns (bytes32)",
  "function positionManager() view returns (address)",
]);

export const standardErc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function creator() view returns (address)",
  "function graffiti() view returns (bytes32)",
]);

export const uerc20FactoryAbi = parseAbi([
  "function getUERC20Address(string name,string symbol,uint8 decimals,address creator,bytes32 graffiti) view returns (address)",
]);

export type LaunchCheckStatus = "pass" | "blocked" | "pending";
export type LaunchCheckId =
  | "token"
  | "wallet"
  | "contracts"
  | "simulation";

export type LaunchPreflightCheck = {
  id: LaunchCheckId;
  label: string;
  status: LaunchCheckStatus;
  detail: string;
};

export type PreparedLaunchTransaction = {
  kind: "approval" | "lock-setup" | "hook-setup" | "launch";
  chainId: 1;
  to: Address;
  data: Hex;
  value: string;
  gasLimit: string;
};

export type LaunchPreflightResponse = {
  status: "blocked" | "approval-required" | "setup-required" | "ready";
  mode: LaunchDraft["liquidityMode"];
  title: string;
  detail: string;
  checks: LaunchPreflightCheck[];
  transaction?: PreparedLaunchTransaction;
  predictedToken?: Address;
  predictedHook?: Address;
  predictedAuction?: Address;
  positionRecipient?: Address;
  draftPatch?: Partial<LaunchDraft>;
  auctionDetails?: {
    startBlock: string;
    endBlock: string;
    minimumRaiseWei: string;
  };
  planHash?: Hex;
};

export type DirectLaunchAmounts = {
  nativeLiquidityAmount: bigint;
  tokenLiquidityAmount: bigint;
  totalSupply: bigint | null;
  initialSqrtPriceX96: bigint;
};

export class LaunchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchInputError";
  }
}

function powerOfTen(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new LaunchInputError("The token decimals are not supported");
  }
  return 10n ** BigInt(decimals);
}

export function parseDecimalAmount(
  value: string,
  decimals: number,
  label: string,
) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new LaunchInputError(`Enter ${label}`);
  }
  if (normalized.length > 96) {
    throw new LaunchInputError(`${label} is too large`);
  }

  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(normalized);
  if (!match) {
    throw new LaunchInputError(`Enter ${label} as a positive decimal number`);
  }

  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new LaunchInputError(
      `${label} supports up to ${decimals} decimal places`,
    );
  }

  const scale = powerOfTen(decimals);
  const whole = BigInt(match[1]) * scale;
  const fractional = fraction
    ? BigInt(fraction.padEnd(decimals, "0"))
    : 0n;
  const amount = whole + fractional;

  if (amount === 0n) {
    throw new LaunchInputError(`${label} must be greater than zero`);
  }
  if (amount > UINT256_MAX) {
    throw new LaunchInputError(`${label} exceeds the contract limit`);
  }
  return amount;
}

export function integerSquareRoot(value: bigint) {
  if (value < 0n) {
    throw new LaunchInputError("Square root input cannot be negative");
  }
  if (value < 2n) return value;

  let current = 1n << BigInt((value.toString(2).length + 1) >> 1);
  let next = (current + value / current) >> 1n;
  while (next < current) {
    current = next;
    next = (current + value / current) >> 1n;
  }
  return current;
}

export function tokensPerEthToSqrtPriceX96(
  tokensPerEth: string,
  tokenDecimals: number,
) {
  const scaledPrice = parseDecimalAmount(
    tokensPerEth,
    18,
    "an opening rate",
  );
  const rawRatioNumerator = scaledPrice * powerOfTen(tokenDecimals);
  const ratioX192 =
    (rawRatioNumerator * Q192) / PRICE_DENOMINATOR;
  const sqrtPriceX96 = integerSquareRoot(ratioX192);

  if (
    sqrtPriceX96 < MIN_SQRT_PRICE ||
    sqrtPriceX96 >= MAX_SQRT_PRICE
  ) {
    throw new LaunchInputError(
      "The opening rate falls outside the Uniswap v4 price range",
    );
  }
  return sqrtPriceX96;
}

export function validateStandardDirectConfiguration(draft: LaunchDraft) {
  if (draft.liquidityMode !== "direct") {
    throw new LaunchInputError(
      "Auction launches need a block schedule and floor price before a transaction can be prepared",
    );
  }
  if (
    draft.selectedBehaviors.length !== 1 ||
    draft.selectedBehaviors[0] !== "fixed-fee"
  ) {
    throw new LaunchInputError(
      "This behavior needs contract review before a transaction can be prepared",
    );
  }

  const feeHundredths = parseDecimalAmount(
    draft.lpFeePercent,
    2,
    "a pool fee",
  );
  if (feeHundredths !== 30n) {
    throw new LaunchInputError(
      "The tested direct launch uses a fixed 0.30% pool fee",
    );
  }
}

export function buildDirectLaunchAmounts(
  draft: LaunchDraft,
  tokenDecimals: number,
): DirectLaunchAmounts {
  validateStandardDirectConfiguration(draft);

  const nativeLiquidityAmount = parseDecimalAmount(
    draft.directEthAmount,
    18,
    "an ETH amount",
  );
  const tokenLiquidityAmount = parseDecimalAmount(
    draft.directTokenAmount,
    tokenDecimals,
    "a token amount",
  );
  const initialSqrtPriceX96 = tokensPerEthToSqrtPriceX96(
    draft.directTokensPerEth,
    tokenDecimals,
  );

  if (
    nativeLiquidityAmount > UINT128_MAX ||
    tokenLiquidityAmount > UINT128_MAX
  ) {
    throw new LaunchInputError(
      "The liquidity amount exceeds the direct launch limit",
    );
  }

  let totalSupply: bigint | null = null;
  if (draft.assetMode === "new") {
    if (!draft.tokenName.trim()) {
      throw new LaunchInputError("Enter a token name");
    }
    if (!draft.tokenSymbol.trim()) {
      throw new LaunchInputError("Enter a token symbol");
    }
    if (draft.tokenName.trim().length > 80) {
      throw new LaunchInputError("The token name is too long");
    }
    if (draft.tokenSymbol.trim().length > 16) {
      throw new LaunchInputError("The token symbol is too long");
    }
    if (draft.tokenDescription.trim().length > 1_000) {
      throw new LaunchInputError("The token description is too long");
    }

    totalSupply = parseDecimalAmount(
      draft.tokenSupply,
      18,
      "a token supply",
    );
    if (tokenLiquidityAmount > totalSupply) {
      throw new LaunchInputError(
        "Opening liquidity cannot exceed the token supply",
      );
    }
  } else if (!isAddress(draft.tokenAddress)) {
    throw new LaunchInputError("Enter a valid existing token address");
  }

  return {
    nativeLiquidityAmount,
    tokenLiquidityAmount,
    totalSupply,
    initialSqrtPriceX96,
  };
}

function mineHookSalt(
  factory: Address,
  initCodeHash: Hex,
  requiredFlags: bigint,
) {
  for (let attempt = 0; attempt < MAX_HOOK_SALT_ATTEMPTS; attempt += 1) {
    const salt = toHex(BigInt(attempt), { size: 32 });
    const address = getCreate2Address({
      from: factory,
      salt,
      bytecodeHash: initCodeHash,
    });
    if ((BigInt(address) & HOOK_FLAG_MASK) === requiredFlags) {
      return { address, salt, attempt };
    }
  }
  throw new LaunchInputError(
    "No valid v4 hook address was found within the audited search limit",
  );
}

export function mineStandardHookSalt(
  factory: Address,
  initCodeHash: Hex,
) {
  return mineHookSalt(
    factory,
    initCodeHash,
    STANDARD_HOOK_FLAGS,
  );
}

export function mineBoundedDynamicFeeHookSalt(
  factory: Address,
  initCodeHash: Hex,
) {
  return mineHookSalt(
    factory,
    initCodeHash,
    BOUNDED_DYNAMIC_HOOK_FLAGS,
  );
}

export function encodeNewDirectLaunch(
  draft: LaunchDraft,
  amounts: DirectLaunchAmounts,
  creatorSalt: Hex,
  hookSalt: Hex,
) {
  if (amounts.totalSupply === null) {
    throw new LaunchInputError("A new token supply is required");
  }
  return encodeFunctionData({
    abi: directLiquidityLauncherAbi,
    functionName: "launch",
    args: [
      {
        name: draft.tokenName.trim(),
        symbol: draft.tokenSymbol.trim(),
        totalSupply: amounts.totalSupply,
        tokenLiquidityAmount: amounts.tokenLiquidityAmount,
        initialSqrtPriceX96: amounts.initialSqrtPriceX96,
        creatorSalt,
        hookSalt,
        metadata: {
          description: draft.tokenDescription.trim(),
          website: "",
          image: "",
          xProofTweetId: 0n,
        },
      },
    ],
  });
}

export function encodeExistingDirectLaunch(
  token: Address,
  amounts: DirectLaunchAmounts,
  hookSalt: Hex,
) {
  return encodeFunctionData({
    abi: directLiquidityLauncherAbi,
    functionName: "launchExistingUERC20",
    args: [
      {
        token,
        tokenLiquidityAmount: amounts.tokenLiquidityAmount,
        initialSqrtPriceX96: amounts.initialSqrtPriceX96,
        hookSalt,
      },
    ],
  });
}

export function encodeTokenApproval(spender: Address, amount: bigint) {
  return encodeFunctionData({
    abi: standardErc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}

export function buildPlanHash(
  account: Address,
  transaction: Omit<PreparedLaunchTransaction, "gasLimit">,
) {
  return keccak256(
    toHex(
      JSON.stringify({
        account: account.toLowerCase(),
        kind: transaction.kind,
        chainId: transaction.chainId,
        to: transaction.to.toLowerCase(),
        data: transaction.data,
        value: transaction.value,
      }),
    ),
  );
}
