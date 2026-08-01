export const TREASURY = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";

export const MAINNET_CHAIN_ID = "0x1";

export const SELECTORS = Object.freeze({
  launcherFeesAccrued: "0x1497233e",
  launcherAssetFeesAccrued: "0x31b8ca96",
  launcherFeeRecipient: "0x4c50e2c4",
  claimLauncherFees: "0x64d46b85",
  claimLauncherAssetFees: "0xaee8cd6f",
});

const NATIVE_CLAIMS = [
  {
    id: "classic-v3",
    name: "Classic",
    detail: "Current release",
    unit: "ETH",
    decimals: 18,
    kind: "native",
    address: "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC",
  },
  {
    id: "classic-v2",
    name: "Classic",
    detail: "Legacy release 2",
    unit: "ETH",
    decimals: 18,
    kind: "native",
    address: "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
  },
  {
    id: "classic-v1",
    name: "Classic",
    detail: "Legacy release 1",
    unit: "ETH",
    decimals: 18,
    kind: "native",
    address: "0x48bB2672c7fd2a12e7fb5D46c441ccD3726520Cc",
  },
  {
    id: "deep-v1",
    name: "Deep",
    detail: "Canary release",
    unit: "ETH",
    decimals: 18,
    kind: "native",
    address: "0x48dC3009eC1d3298BBA31f718A9A29d02fC9B0cC",
  },
];

const STOCK_V1_HOOK = "0x7773D183fe7B60d4F1885047fa42b815a62Fe0Cc";
const STOCK_CURRENT_HOOK = "0x90c67C1E866f86526F0e338459cD435E1F23A0cc";

const STOCK_V1_ASSETS = [
  ["NVDAon", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"],
  ["SPYon", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08"],
  ["GOOGLon", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc"],
  ["SLVon", "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4"],
  ["QQQon", "0x0e397938C1aa0680954093495B70a9f5E2249aBA"],
  ["TSLAon", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f"],
  ["AAPLon", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c"],
];

const STOCK_CURRENT_ASSETS = [
  ["NVDAon", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"],
  ["SPYon", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08"],
  ["GOOGLon", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc"],
  ["SLVon", "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4"],
  ["TSLAon", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f"],
  ["AAPLon", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c"],
  ["BABAon", "0x41765F0FcddC276309195166C7A62ae522fa09ef"],
  ["COPXon", "0x423a63dfe8d82cd9c6568c92210aa537d8ef6885"],
  ["CRCLon", "0x3632DeA96a953C11dAc2f00b4A05A32cd1063FAe"],
  ["TLTon", "0x992651bfeb9A0dcc4457610e284BA66d86489D4d"],
  ["USOon", "0x1f5Fc5C3c8b0f15c7e21af623936fF2b210b6415"],
];

function stockClaims(release, hook, assets) {
  return assets.map(([unit, asset]) => ({
    id: `stock-${release}-${unit.toLowerCase()}`,
    name: "Stock-Paired",
    detail: `${release} · ${unit}`,
    unit,
    decimals: 18,
    kind: "asset",
    address: hook,
    asset,
  }));
}

export const CLAIMS = Object.freeze([
  ...NATIVE_CLAIMS,
  ...stockClaims("Current", STOCK_CURRENT_HOOK, STOCK_CURRENT_ASSETS),
  ...stockClaims("Legacy", STOCK_V1_HOOK, STOCK_V1_ASSETS),
]);

export function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function isTreasury(value) {
  return normalizeAddress(value) === normalizeAddress(TREASURY);
}

export function decodeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("The hook returned an invalid treasury address");
  }

  return `0x${value.slice(-40)}`;
}

export function decodeUint256(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error("The hook returned an invalid fee balance");
  }

  return BigInt(value);
}

export function formatEth(value, maximumFractionDigits = 6) {
  return formatUnits(value, 18, maximumFractionDigits);
}

export function formatUnits(value, decimals, maximumFractionDigits = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const precision = Math.max(0, Math.min(decimals, maximumFractionDigits));

  if (precision === 0 || fraction === 0n) return whole.toString();

  const padded = fraction.toString().padStart(decimals, "0").slice(0, precision);
  const trimmed = padded.replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
}

export function encodeAddressArgument(address) {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("Expected an Ethereum address");
  }

  return address.slice(2).toLowerCase().padStart(64, "0");
}

export function readAccruedData(claim) {
  return claim.kind === "asset"
    ? `${SELECTORS.launcherAssetFeesAccrued}${encodeAddressArgument(claim.asset)}`
    : SELECTORS.launcherFeesAccrued;
}

export function claimData(claim) {
  return claim.kind === "asset"
    ? `${SELECTORS.claimLauncherAssetFees}${encodeAddressArgument(claim.asset)}`
    : SELECTORS.claimLauncherFees;
}

export function toQuantityHex(value) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error("Expected a non-negative bigint");
  }

  return `0x${value.toString(16)}`;
}

export function shortAddress(value) {
  if (typeof value !== "string" || value.length < 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
