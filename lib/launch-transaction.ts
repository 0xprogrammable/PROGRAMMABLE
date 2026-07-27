import {
  encodeFunctionData,
  keccak256,
  parseAbi,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";

import {
  MEME_MIN_INITIAL_BUY_ETH_LABEL,
  parseInitialBuyWei,
  parseTotalSwapFeeBps,
  type LaunchDraft,
} from "./launch";
import {
  characterLength,
  hasUnsafeDisplayCharacters,
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_EXTRA_DATA_BYTES,
  MAX_SOCIAL_URL_BYTES,
  MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_NAME_CHARACTERS,
  MAX_TOKEN_SYMBOL_BYTES,
  MAX_TOKEN_SYMBOL_CHARACTERS,
  isValidTokenSymbol,
  utf8ByteLength,
} from "./metadata-policy";
import type { PreparedTransaction } from "./prepared-transaction";

export const ETHEREUM_CHAIN_ID = 1;
export {
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_EXTRA_DATA_BYTES,
  MAX_SOCIAL_URL_BYTES,
  MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_NAME_CHARACTERS,
  MAX_TOKEN_SYMBOL_BYTES,
  MAX_TOKEN_SYMBOL_CHARACTERS,
  characterLength,
  utf8ByteLength,
} from "./metadata-policy";

export const memeLaunchAbi = parseAbi([
  "function launch((string name,string symbol,uint16 totalSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata) parameters) payable returns ((address token,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,bytes32 poolId,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
]);

export const ethCreatorFeeHookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);

export const ethCreatorFeeHookFactoryAbi = parseAbi([
  "function isFactoryHook(address hook) view returns (bool)",
]);

export const lockedPositionFeeForwarderFactoryAbi = parseAbi([
  "function positionManager() view returns (address)",
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

export type PreparedLaunchTransaction = Extract<
  PreparedTransaction,
  { kind: "launch" }
>;

export type LaunchPreflightResponse = {
  status: "blocked" | "ready";
  mode: "meme";
  title: string;
  detail: string;
  checks: LaunchPreflightCheck[];
  transaction?: PreparedLaunchTransaction;
  predictedToken?: Address;
  predictedHook?: Address;
  draftPatch?: Partial<LaunchDraft>;
  planHash?: Hex;
};

export class LaunchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchInputError";
  }
}

function addHttpsProtocol(value: string) {
  if (/^http:\/\//i.test(value)) {
    return `https://${value.slice("http://".length)}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}

export function normalizeOptionalHttpsUrl(
  value: string,
  label: string,
  maximumBytes: number,
) {
  const input = value.trim();
  if (!input) return "";
  const normalized = addHttpsProtocol(input);

  if (utf8ByteLength(normalized) > maximumBytes) {
    throw new LaunchInputError(`Shorten ${label}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new LaunchInputError(`Enter ${label} as a complete HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    throw new LaunchInputError(`Enter ${label} as a complete HTTPS URL`);
  }
  return normalized;
}

export function normalizeOptionalSocialUrl(
  value: string,
  label: string,
  maximumBytes: number,
  kind: "x" | "telegram",
) {
  const input = value.trim();
  if (!input) return "";
  const handle = input.startsWith("@") ? input.slice(1) : input;
  const expanded =
    kind === "x" && /^[A-Za-z0-9_]{1,15}$/.test(handle)
      ? `https://x.com/${handle}`
      : kind === "telegram" && /^[A-Za-z0-9_]{5,32}$/.test(handle)
        ? `https://t.me/${handle}`
        : input;
  const normalized = normalizeOptionalHttpsUrl(
    expanded,
    label,
    maximumBytes,
  );
  if (!normalized) return "";

  const parsed = new URL(normalized);
  const hostname = parsed.hostname.toLowerCase();
  const allowed =
    kind === "x"
      ? hostname === "x.com" ||
        hostname === "www.x.com" ||
        hostname === "twitter.com" ||
        hostname === "www.twitter.com"
      : hostname === "t.me" ||
        hostname === "www.t.me" ||
        hostname === "telegram.me" ||
        hostname === "www.telegram.me";
  if (!allowed || parsed.pathname === "/") {
    throw new LaunchInputError(
      kind === "x"
        ? "Enter the X link on x.com or twitter.com"
        : "Enter the Telegram link on t.me or telegram.me",
    );
  }
  return normalized;
}

function getValidatedMetadata(draft: LaunchDraft) {
  return {
    website: normalizeOptionalHttpsUrl(
      draft.tokenWebsite,
      "the website",
      MAX_METADATA_URL_BYTES,
    ),
    image: normalizeOptionalHttpsUrl(
      draft.tokenImage,
      "the token image URL",
      MAX_METADATA_URL_BYTES,
    ),
    x: normalizeOptionalSocialUrl(
      draft.tokenX,
      "the X link",
      MAX_SOCIAL_URL_BYTES,
      "x",
    ),
    telegram: normalizeOptionalSocialUrl(
      draft.tokenTelegram,
      "the Telegram link",
      MAX_SOCIAL_URL_BYTES,
      "telegram",
    ),
  };
}

export function encodeMemeMetadataExtraData(draft: LaunchDraft): Hex {
  const { x, telegram } = getValidatedMetadata(draft);
  if (!x && !telegram) return "0x";

  const metadata = {
    v: 1,
    ...(x ? { x } : {}),
    ...(telegram ? { telegram } : {}),
  };
  const json = JSON.stringify(metadata);
  if (utf8ByteLength(json) > MAX_SOCIAL_EXTRA_DATA_BYTES) {
    throw new LaunchInputError(
      `Keep social metadata within ${MAX_SOCIAL_EXTRA_DATA_BYTES} bytes`,
    );
  }
  return stringToHex(json);
}

export function validateMemeLaunchDraft(draft: LaunchDraft) {
  if (draft.liquidityMode !== "meme") {
    throw new LaunchInputError("Choose the Classic launch model");
  }
  if (draft.assetMode !== "new") {
    throw new LaunchInputError("Classic creates a new token");
  }
  if (draft.tokenSupply.trim() !== "1000000000") {
    throw new LaunchInputError(
      "Classic uses a fixed supply of 1,000,000,000 tokens",
    );
  }
  if (!draft.tokenName.trim()) {
    throw new LaunchInputError("Enter a token name");
  }
  if (!draft.tokenSymbol.trim()) {
    throw new LaunchInputError("Enter a token symbol");
  }
  const tokenName = draft.tokenName.trim();
  const tokenSymbol = draft.tokenSymbol.trim();
  if (characterLength(tokenName) > MAX_TOKEN_NAME_CHARACTERS) {
    throw new LaunchInputError(
      `Keep the token name within ${MAX_TOKEN_NAME_CHARACTERS} characters`,
    );
  }
  if (utf8ByteLength(tokenName) > MAX_TOKEN_NAME_BYTES) {
    throw new LaunchInputError("Shorten the token name");
  }
  if (hasUnsafeDisplayCharacters(tokenName)) {
    throw new LaunchInputError(
      "Remove line breaks or invisible characters from the token name",
    );
  }
  if (characterLength(tokenSymbol) > MAX_TOKEN_SYMBOL_CHARACTERS) {
    throw new LaunchInputError(
      `Keep the token symbol within ${MAX_TOKEN_SYMBOL_CHARACTERS} characters`,
    );
  }
  if (utf8ByteLength(tokenSymbol) > MAX_TOKEN_SYMBOL_BYTES) {
    throw new LaunchInputError("Shorten the token symbol");
  }
  if (!isValidTokenSymbol(tokenSymbol)) {
    throw new LaunchInputError(
      "Use only uppercase letters and numbers in the token symbol",
    );
  }
  if (
    utf8ByteLength(draft.tokenDescription.trim()) >
    MAX_TOKEN_DESCRIPTION_BYTES
  ) {
    throw new LaunchInputError("Shorten the token description");
  }

  getValidatedMetadata(draft);
  encodeMemeMetadataExtraData(draft);

  const totalSwapFeeBps = parseTotalSwapFeeBps(
    draft.totalSwapFeePercent,
  );
  if (totalSwapFeeBps === null) {
    throw new LaunchInputError("Choose a total swap fee from 1% to 10%");
  }
  if (parseInitialBuyWei(draft.initialBuyEth) === null) {
    throw new LaunchInputError(
      `Enter a Dev Buy of at least ${MEME_MIN_INITIAL_BUY_ETH_LABEL}`,
    );
  }
  return totalSwapFeeBps;
}

export function encodeMemeLaunch(
  draft: LaunchDraft,
  creatorSalt: Hex,
) {
  const totalSwapFeeBps = validateMemeLaunchDraft(draft);
  const metadata = getValidatedMetadata(draft);
  return encodeFunctionData({
    abi: memeLaunchAbi,
    functionName: "launch",
    args: [
      {
        name: draft.tokenName.trim(),
        symbol: draft.tokenSymbol.trim(),
        totalSwapFeeBps,
        creatorSalt,
        metadata: {
          description: draft.tokenDescription.trim(),
          website: metadata.website,
          image: metadata.image,
          extraData: encodeMemeMetadataExtraData(draft),
        },
      },
    ],
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
