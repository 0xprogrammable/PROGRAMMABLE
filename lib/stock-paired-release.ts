import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import mainnetReleaseJson from "../contracts/deployments/mainnet-stock-paired-v1.json";
import mainnetReleaseV2Json from "../contracts/deployments/mainnet-stock-paired-v2.json";
import mainnetReleaseV3Json from "../contracts/deployments/mainnet-stock-paired-v3.json";
import stockAssetsV1Json from "../config/stock-paired-assets.v1.json";
import { STOCK_PAIRED_V2_QUOTE_ASSETS } from "./stock-paired-v2";
import {
  STOCK_PAIRED_V3_CONFIG,
  STOCK_PAIRED_V3_QUOTE_ASSETS,
} from "./stock-paired-v3";

export const STOCK_PAIRED_INTERNAL_RELEASE = "stock-paired-v1" as const;
export const STOCK_PAIRED_V2_INTERNAL_RELEASE = "stock-paired-v2" as const;
export const STOCK_PAIRED_V3_INTERNAL_RELEASE = "stock-paired-v3" as const;

const runtimeFields = [
  "quoteRegistry",
  "positionPlanner",
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
  "launcher",
  "ethLaunchCoordinator",
  "positionForwarderFactory",
] as const;

const deployedFields = runtimeFields.filter(
  (field) => field !== "positionForwarderFactory",
);
const officialDependencyFields = [
  "poolManager",
  "positionManager",
  "stateView",
  "v4Quoter",
  "permit2",
  "universalRouter",
  "uerc20Factory",
  "v3Factory",
  "v3SwapRouter",
  "v3Quoter",
  "weth",
  "usdc",
] as const;

const EXPECTED_TREASURY = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c" as const;
const EXPECTED_POSITION_FORWARDER_FACTORY =
  "0x291a9ff1059d225d02B1659430804486404dB507" as const;
const EXPECTED_ONDO_BEACON =
  "0x985462C9aA4D6c3Ad59Ae6e1e9c0C11347ED1598" as const;
const EXPECTED_ONDO_IMPLEMENTATION =
  "0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250" as const;
const EXPECTED_ONDO_GM_TOKEN_MANAGER =
  "0x2c158BC456e027b2AfFCCadF1BDBD9f5fC4c5C8c" as const;
const EXPECTED_ONDO_GM_TOKEN_MANAGER_CODE_HASH =
  "0x6d111c0eae4517448b28f089392aef41d2b865ea8420f504e5d57d238fb8e821" as const;
const EXPECTED_OFFICIAL_DEPENDENCIES = {
  poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  positionManager: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
  stateView: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
  v4Quoter: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  universalRouter: "0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA",
  uerc20Factory: "0x000000e200088D55C39a11F609E5F667729ad49b",
  v3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  v3SwapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  v3Quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
} as const;

type RuntimeField = (typeof runtimeFields)[number];
type DeployedField = (typeof deployedFields)[number];
type OfficialDependencyField = (typeof officialDependencyFields)[number];
type StockPairedInternalRelease =
  | typeof STOCK_PAIRED_INTERNAL_RELEASE
  | typeof STOCK_PAIRED_V2_INTERNAL_RELEASE
  | typeof STOCK_PAIRED_V3_INTERNAL_RELEASE;
type ExpectedQuoteAsset = { symbol: string; address: string };

const EXPECTED_V1_QUOTE_ASSETS = (
  stockAssetsV1Json as { assets: ExpectedQuoteAsset[] }
).assets;
const EXPECTED_V2_QUOTE_ASSETS = STOCK_PAIRED_V2_QUOTE_ASSETS.map(
  ({ symbol, address }) => ({ symbol, address }),
);
const EXPECTED_V3_QUOTE_ASSETS = STOCK_PAIRED_V3_QUOTE_ASSETS.map(
  ({ symbol, address }) => ({ symbol, address }),
);

export type StockPairedReleaseManifest = {
  schemaVersion?: unknown;
  model?: unknown;
  internalContractRelease?: unknown;
  status?: unknown;
  chainId?: unknown;
  releaseCommit?: unknown;
  sourceCommitment?: unknown;
  ethCoordinatorReleaseCommit?: unknown;
  ethCoordinatorSourceCommitment?: unknown;
  ethCoordinatorNonce?: unknown;
  startingNonce?: unknown;
  startBlock?: unknown;
  addresses?: Partial<Record<RuntimeField | "deployer" | "treasury", unknown>>;
  transactions?: Partial<Record<DeployedField, unknown>>;
  runtimeCodeHashes?: Partial<Record<RuntimeField, unknown>>;
  officialDependencies?: Partial<
    Record<
      OfficialDependencyField,
      { address?: unknown; runtimeCodeHash?: unknown }
    >
  >;
  issuerRuntime?: {
    tokenRuntimeCodeHash?: unknown;
    beacon?: unknown;
    beaconRuntimeCodeHash?: unknown;
    implementation?: unknown;
    implementationRuntimeCodeHash?: unknown;
    gmTokenManager?: unknown;
    gmTokenManagerRuntimeCodeHash?: unknown;
  };
  quoteAssets?: unknown;
  pricePolicy?: unknown;
  sourceVerification?: {
    status?: unknown;
    quoteRegistry?: unknown;
    positionPlanner?: unknown;
    feeSplitVaultFactory?: unknown;
    hookFactory?: unknown;
    feeHook?: unknown;
    launcher?: unknown;
    ethLaunchCoordinator?: unknown;
  };
  lifecycleEvidence?: {
    status?: unknown;
    releaseEligible?: unknown;
    independentRpcCount?: unknown;
    deploymentTransactionsVerified?: unknown;
    runtimeBindingsVerified?: unknown;
    ethCoordinatorDeploymentVerified?: unknown;
    canaryLaunchTransaction?: unknown;
    canaryQuoteAsset?: unknown;
    positionLockVerified?: unknown;
    buyAndSellVerified?: unknown;
    ethFirstLaunchVerified?: unknown;
    ethBuyAndSellVerified?: unknown;
    creatorClaimVerified?: unknown;
    launcherClaimVerified?: unknown;
  };
};

export type VerifiedStockPairedRelease = {
  internalContractRelease: StockPairedInternalRelease;
  chainId: 1;
  releaseCommit: string;
  sourceCommitment: Hex;
  ethCoordinatorReleaseCommit: string;
  ethCoordinatorSourceCommitment: Hex;
  ethCoordinatorNonce: number;
  startBlock: number;
  addresses: Record<RuntimeField | "deployer" | "treasury", Address>;
  transactions: Record<DeployedField, Hex>;
  runtimeCodeHashes: Record<RuntimeField, Hex>;
  officialDependencies: Record<
    OfficialDependencyField,
    { address: Address; runtimeCodeHash: Hex }
  >;
  issuerRuntime: {
    tokenRuntimeCodeHash: Hex;
    beacon: Address;
    beaconRuntimeCodeHash: Hex;
    implementation: Address;
    implementationRuntimeCodeHash: Hex;
    gmTokenManager?: Address;
    gmTokenManagerRuntimeCodeHash?: Hex;
  };
};

function validAddress(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value);
}

function validHash(value: unknown): value is Hex {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function validReleaseCommit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function verifiedExplorerRecord(value: unknown) {
  if (typeof value === "string") {
    return value === "verified";
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as {
    status?: unknown;
    etherscan?: { status?: unknown; matchedAddress?: unknown };
  };
  return (
    record.status === "verified" &&
    record.etherscan?.status === "exact-match" &&
    (record.etherscan.matchedAddress === undefined ||
      record.etherscan.matchedAddress === null ||
      record.etherscan.matchedAddress === "")
  );
}

function sameAddress(left: unknown, right: unknown) {
  return (
    validAddress(left) &&
    validAddress(right) &&
    getAddress(left).toLowerCase() === getAddress(right).toLowerCase()
  );
}

function etherscanCodeUrlMatches(value: unknown, address: unknown) {
  if (typeof value !== "string" || !validAddress(address)) return false;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/address\/(0x[0-9a-f]{40})$/iu);
    return (
      url.protocol === "https:" &&
      url.origin === "https://etherscan.io" &&
      url.search === "" &&
      url.hash === "#code" &&
      match !== null &&
      sameAddress(match[1], address)
    );
  } catch {
    return false;
  }
}

function sourcifyContractUrlMatches(value: unknown, address: unknown) {
  if (typeof value !== "string" || !validAddress(address)) return false;
  try {
    const url = new URL(value);
    const match = url.pathname.match(
      /^\/server\/v2\/contract\/1\/(0x[0-9a-f]{40})$/iu,
    );
    return (
      url.origin === "https://sourcify.dev" &&
      url.search === "" &&
      url.hash === "" &&
      match !== null &&
      sameAddress(match[1], address)
    );
  } catch {
    return false;
  }
}

function verifiedV2SourceRecords(
  sourceVerification: StockPairedReleaseManifest["sourceVerification"],
  addresses: StockPairedReleaseManifest["addresses"],
  requiredExactEtherscanMatches: number | null = 1,
) {
  if (sourceVerification?.status !== "verified" || !addresses) return false;
  let exactEtherscanMatches = 0;
  for (const field of deployedFields) {
    const value = sourceVerification[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const record = value as {
      status?: unknown;
      address?: unknown;
      etherscan?: {
        status?: unknown;
        matchedAddress?: unknown;
        url?: unknown;
        matchedUrl?: unknown;
      };
      sourcify?: {
        status?: unknown;
        creationMatch?: unknown;
        runtimeMatch?: unknown;
        url?: unknown;
      };
    };
    const deployedAddress = addresses[field];
    if (
      record.status !== "verified" ||
      !sameAddress(record.address, deployedAddress) ||
      record.sourcify?.status !== "match" ||
      record.sourcify.creationMatch !== "match" ||
      record.sourcify.runtimeMatch !== "match" ||
      !sourcifyContractUrlMatches(record.sourcify.url, deployedAddress) ||
      !etherscanCodeUrlMatches(record.etherscan?.url, deployedAddress)
    ) {
      return false;
    }
    if (record.etherscan?.status === "exact-match") {
      if (
        record.etherscan.matchedAddress !== undefined &&
        record.etherscan.matchedAddress !== null &&
        record.etherscan.matchedAddress !== ""
      ) {
        return false;
      }
      exactEtherscanMatches += 1;
      continue;
    }
    if (
      record.etherscan?.status !== "similar-match" ||
      !validAddress(record.etherscan.matchedAddress) ||
      sameAddress(record.etherscan.matchedAddress, deployedAddress) ||
      !etherscanCodeUrlMatches(
        record.etherscan.matchedUrl,
        record.etherscan.matchedAddress,
      )
    ) {
      return false;
    }
  }
  return (
    requiredExactEtherscanMatches === null ||
    exactEtherscanMatches === requiredExactEtherscanMatches
  );
}

function exactQuoteAssets(
  value: unknown,
  expectedAssets: readonly ExpectedQuoteAsset[],
) {
  if (!Array.isArray(value) || value.length !== expectedAssets.length) {
    return false;
  }
  return value.every((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return false;
    }
    const record = candidate as { symbol?: unknown; address?: unknown };
    const expected = expectedAssets[index];
    return (
      record.symbol === expected.symbol &&
      sameAddress(record.address, expected.address)
    );
  });
}

function exactV3PricePolicy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as {
    status?: unknown;
    targetInitialFdvEth?: unknown;
    tickSpacing?: unknown;
    calibrationBlockNumber?: unknown;
    calibrationBlockHash?: unknown;
    maximumReferenceDriftBps?: unknown;
    maximumTickRoundingDeviationBps?: unknown;
    maximumInitialFdvDeviationBps?: unknown;
    maximumActivationEvidenceAgeSeconds?: unknown;
    finalActivationPricing?: unknown;
    quoteTicks?: unknown;
  };
  if (
    policy.status !== "reviewed-current-release" ||
    policy.targetInitialFdvEth !==
      STOCK_PAIRED_V3_CONFIG.targetInitialFdvEth ||
    policy.tickSpacing !== STOCK_PAIRED_V3_CONFIG.tickSpacing ||
    policy.calibrationBlockNumber !==
      STOCK_PAIRED_V3_CONFIG.calibration.blockNumber ||
    policy.calibrationBlockHash !==
      STOCK_PAIRED_V3_CONFIG.calibration.blockHash ||
    policy.maximumReferenceDriftBps !==
      STOCK_PAIRED_V3_CONFIG.calibration.maximumReferenceDriftBps ||
    policy.maximumTickRoundingDeviationBps !==
      STOCK_PAIRED_V3_CONFIG.calibration.maximumTickRoundingDeviationBps ||
    policy.maximumInitialFdvDeviationBps !==
      STOCK_PAIRED_V3_CONFIG.calibration.maximumInitialFdvDeviationBps ||
    policy.maximumActivationEvidenceAgeSeconds !==
      STOCK_PAIRED_V3_CONFIG.calibration.maximumActivationEvidenceAgeSeconds ||
    !policy.finalActivationPricing ||
    typeof policy.finalActivationPricing !== "object" ||
    Array.isArray(policy.finalActivationPricing) ||
    !Array.isArray(policy.quoteTicks) ||
    policy.quoteTicks.length !== STOCK_PAIRED_V3_QUOTE_ASSETS.length
  ) {
    return false;
  }
  const finalActivationPricing = policy.finalActivationPricing as {
    status?: unknown;
    evidencePath?: unknown;
    evidenceSha256?: unknown;
    verifiedAt?: unknown;
  };
  if (
    finalActivationPricing.status !== "verified-current-release" ||
    finalActivationPricing.evidencePath !==
      "contracts/deployments/evidence/stock-paired-v3-final-pricing.json" ||
    typeof finalActivationPricing.evidenceSha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(finalActivationPricing.evidenceSha256) ||
    typeof finalActivationPricing.verifiedAt !== "string" ||
    Number.isNaN(Date.parse(finalActivationPricing.verifiedAt))
  ) {
    return false;
  }
  return policy.quoteTicks.every((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return false;
    }
    const record = candidate as {
      symbol?: unknown;
      address?: unknown;
      initialAbsoluteTick?: unknown;
      targetQuoteAmountWad?: unknown;
    };
    const expected = STOCK_PAIRED_V3_QUOTE_ASSETS[index];
    return (
      record.symbol === expected.symbol &&
      sameAddress(record.address, expected.address) &&
      record.initialAbsoluteTick === expected.initialAbsoluteTick &&
      record.targetQuoteAmountWad === expected.targetQuoteAmountWad
    );
  });
}

type StockPairedReleaseDefinition = {
  schemaVersion: 1 | 2 | 3;
  internalContractRelease: StockPairedInternalRelease;
  quoteAssets: readonly ExpectedQuoteAsset[];
  requiresGMTokenManager: boolean;
  allowsReadableSimilarMatches: boolean;
  requiresV3PricePolicy: boolean;
  requiredExactEtherscanMatches: number | null;
};

const stockPairedV1ReleaseDefinition: StockPairedReleaseDefinition = {
  schemaVersion: 1,
  internalContractRelease: STOCK_PAIRED_INTERNAL_RELEASE,
  quoteAssets: EXPECTED_V1_QUOTE_ASSETS,
  requiresGMTokenManager: false,
  allowsReadableSimilarMatches: false,
  requiresV3PricePolicy: false,
  requiredExactEtherscanMatches: null,
};

const stockPairedV2ReleaseDefinition: StockPairedReleaseDefinition = {
  schemaVersion: 2,
  internalContractRelease: STOCK_PAIRED_V2_INTERNAL_RELEASE,
  quoteAssets: EXPECTED_V2_QUOTE_ASSETS,
  requiresGMTokenManager: true,
  allowsReadableSimilarMatches: true,
  requiresV3PricePolicy: false,
  requiredExactEtherscanMatches: 1,
};

const stockPairedV3ReleaseDefinition: StockPairedReleaseDefinition = {
  schemaVersion: 3,
  internalContractRelease: STOCK_PAIRED_V3_INTERNAL_RELEASE,
  quoteAssets: EXPECTED_V3_QUOTE_ASSETS,
  requiresGMTokenManager: true,
  allowsReadableSimilarMatches: true,
  requiresV3PricePolicy: true,
  requiredExactEtherscanMatches: null,
};

function validIssuerManager(
  release: StockPairedReleaseManifest,
  required: boolean,
) {
  if (!required) return true;
  return (
    sameAddress(
      release.issuerRuntime?.gmTokenManager,
      EXPECTED_ONDO_GM_TOKEN_MANAGER,
    ) &&
    validHash(release.issuerRuntime?.gmTokenManagerRuntimeCodeHash) &&
    release.issuerRuntime?.gmTokenManagerRuntimeCodeHash.toLowerCase() ===
      EXPECTED_ONDO_GM_TOKEN_MANAGER_CODE_HASH.toLowerCase()
  );
}

function resolveStockPairedRelease(
  input: unknown,
  definition: StockPairedReleaseDefinition,
): VerifiedStockPairedRelease | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const release = input as StockPairedReleaseManifest;
  const addresses = release.addresses;
  const transactions = release.transactions;
  const runtimeCodeHashes = release.runtimeCodeHashes;
  const sourceVerification = release.sourceVerification;
  const officialDependencies = release.officialDependencies;

  if (
    release.schemaVersion !== definition.schemaVersion ||
    release.model !== "stock-paired" ||
    release.internalContractRelease !== definition.internalContractRelease ||
    release.status !== "deployment-source-and-lifecycle-verified" ||
    release.chainId !== 1 ||
    !validReleaseCommit(release.releaseCommit) ||
    !validHash(release.sourceCommitment) ||
    !validReleaseCommit(release.ethCoordinatorReleaseCommit) ||
    !validHash(release.ethCoordinatorSourceCommitment) ||
    !Number.isSafeInteger(release.ethCoordinatorNonce) ||
    Number(release.ethCoordinatorNonce) < 0 ||
    !Number.isSafeInteger(release.startingNonce) ||
    Number(release.startingNonce) < 0 ||
    !Number.isSafeInteger(release.startBlock) ||
    Number(release.startBlock) <= 0 ||
    !addresses ||
    !transactions ||
    !runtimeCodeHashes ||
    !officialDependencies ||
    !validHash(release.issuerRuntime?.tokenRuntimeCodeHash) ||
    !validAddress(release.issuerRuntime?.beacon) ||
    !validHash(release.issuerRuntime?.beaconRuntimeCodeHash) ||
    !validAddress(release.issuerRuntime?.implementation) ||
    !validHash(release.issuerRuntime?.implementationRuntimeCodeHash) ||
    !sameAddress(release.issuerRuntime?.beacon, EXPECTED_ONDO_BEACON) ||
    !sameAddress(
      release.issuerRuntime?.implementation,
      EXPECTED_ONDO_IMPLEMENTATION,
    ) ||
    !validIssuerManager(release, definition.requiresGMTokenManager) ||
    !exactQuoteAssets(release.quoteAssets, definition.quoteAssets) ||
    (definition.requiresV3PricePolicy &&
      !exactV3PricePolicy(release.pricePolicy)) ||
    sourceVerification?.status !== "verified" ||
    release.lifecycleEvidence?.status !== "verified-current-release" ||
    release.lifecycleEvidence.releaseEligible !== true ||
    !Number.isSafeInteger(release.lifecycleEvidence.independentRpcCount) ||
    Number(release.lifecycleEvidence.independentRpcCount) < 2 ||
    release.lifecycleEvidence.deploymentTransactionsVerified !== true ||
    release.lifecycleEvidence.runtimeBindingsVerified !== true ||
    release.lifecycleEvidence.ethCoordinatorDeploymentVerified !== true ||
    !validHash(release.lifecycleEvidence.canaryLaunchTransaction) ||
    !validAddress(release.lifecycleEvidence.canaryQuoteAsset) ||
    !definition.quoteAssets.some((asset) =>
      sameAddress(release.lifecycleEvidence?.canaryQuoteAsset, asset.address),
    ) ||
    release.lifecycleEvidence.positionLockVerified !== true ||
    release.lifecycleEvidence.buyAndSellVerified !== true ||
    release.lifecycleEvidence.ethFirstLaunchVerified !== true ||
    release.lifecycleEvidence.ethBuyAndSellVerified !== true ||
    release.lifecycleEvidence.creatorClaimVerified !== true ||
    release.lifecycleEvidence.launcherClaimVerified !== true
  ) {
    return null;
  }

  const addressKeys = [...runtimeFields, "deployer", "treasury"] as const;
  if (!addressKeys.every((field) => validAddress(addresses[field]))) {
    return null;
  }
  if (
    !sameAddress(addresses.treasury, EXPECTED_TREASURY) ||
    !sameAddress(
      addresses.positionForwarderFactory,
      EXPECTED_POSITION_FORWARDER_FACTORY,
    )
  ) {
    return null;
  }
  if (!deployedFields.every((field) => validHash(transactions[field]))) {
    return null;
  }
  if (!runtimeFields.every((field) => validHash(runtimeCodeHashes[field]))) {
    return null;
  }
  if (
    !officialDependencyFields.every(
      (field) =>
        validAddress(officialDependencies[field]?.address) &&
        validHash(officialDependencies[field]?.runtimeCodeHash) &&
        sameAddress(
          officialDependencies[field]?.address,
          EXPECTED_OFFICIAL_DEPENDENCIES[field],
        ),
    )
  ) {
    return null;
  }
  const sourcesVerified = definition.allowsReadableSimilarMatches
    ? verifiedV2SourceRecords(
        sourceVerification,
        addresses,
        definition.requiredExactEtherscanMatches,
      )
    : deployedFields.every((field) =>
        verifiedExplorerRecord(sourceVerification[field]),
      );
  if (!sourcesVerified) {
    return null;
  }

  return {
    internalContractRelease: definition.internalContractRelease,
    chainId: 1,
    releaseCommit: release.releaseCommit,
    sourceCommitment: release.sourceCommitment,
    ethCoordinatorReleaseCommit: release.ethCoordinatorReleaseCommit,
    ethCoordinatorSourceCommitment: release.ethCoordinatorSourceCommitment,
    ethCoordinatorNonce: Number(release.ethCoordinatorNonce),
    startBlock: Number(release.startBlock),
    addresses: Object.fromEntries(
      addressKeys.map((field) => [
        field,
        getAddress(addresses[field] as string),
      ]),
    ) as VerifiedStockPairedRelease["addresses"],
    transactions: Object.fromEntries(
      deployedFields.map((field) => [field, transactions[field] as Hex]),
    ) as VerifiedStockPairedRelease["transactions"],
    runtimeCodeHashes: Object.fromEntries(
      runtimeFields.map((field) => [field, runtimeCodeHashes[field] as Hex]),
    ) as VerifiedStockPairedRelease["runtimeCodeHashes"],
    officialDependencies: Object.fromEntries(
      officialDependencyFields.map((field) => [
        field,
        {
          address: getAddress(officialDependencies[field]?.address as string),
          runtimeCodeHash: officialDependencies[field]?.runtimeCodeHash as Hex,
        },
      ]),
    ) as VerifiedStockPairedRelease["officialDependencies"],
    issuerRuntime: {
      tokenRuntimeCodeHash: release.issuerRuntime?.tokenRuntimeCodeHash as Hex,
      beacon: getAddress(release.issuerRuntime?.beacon as string),
      beaconRuntimeCodeHash: release.issuerRuntime
        ?.beaconRuntimeCodeHash as Hex,
      implementation: getAddress(
        release.issuerRuntime?.implementation as string,
      ),
      implementationRuntimeCodeHash: release.issuerRuntime
        ?.implementationRuntimeCodeHash as Hex,
      ...(definition.requiresGMTokenManager
        ? {
            gmTokenManager: getAddress(
              release.issuerRuntime?.gmTokenManager as string,
            ),
            gmTokenManagerRuntimeCodeHash: release.issuerRuntime
              ?.gmTokenManagerRuntimeCodeHash as Hex,
          }
        : {}),
    },
  };
}

export function resolveVerifiedStockPairedRelease(
  input: unknown = mainnetReleaseJson,
) {
  return resolveStockPairedRelease(input, stockPairedV1ReleaseDefinition);
}

export function resolveVerifiedStockPairedV2Release(
  input: unknown = mainnetReleaseV2Json,
) {
  return resolveStockPairedRelease(input, stockPairedV2ReleaseDefinition);
}

export function resolveVerifiedStockPairedV3Release(
  input: unknown = mainnetReleaseV3Json,
) {
  return resolveStockPairedRelease(input, stockPairedV3ReleaseDefinition);
}

export function getConfiguredStockPairedReleases() {
  return [
    resolveVerifiedStockPairedRelease(mainnetReleaseJson),
    resolveVerifiedStockPairedV2Release(mainnetReleaseV2Json),
    resolveVerifiedStockPairedV3Release(mainnetReleaseV3Json),
  ].filter(
    (release): release is VerifiedStockPairedRelease => release !== null,
  );
}

export function getConfiguredStockPairedRelease() {
  return getConfiguredStockPairedReleases().at(-1) ?? null;
}

export function getConfiguredStockPairedLaunchRelease() {
  return resolveVerifiedStockPairedV3Release(mainnetReleaseV3Json);
}

export function findStockPairedReleaseByHook(
  releases: readonly VerifiedStockPairedRelease[],
  hook: string,
) {
  if (!validAddress(hook)) return null;
  return (
    releases.find((release) => sameAddress(release.addresses.feeHook, hook)) ??
    null
  );
}

export function getConfiguredStockPairedReleaseByHook(hook: string) {
  return findStockPairedReleaseByHook(getConfiguredStockPairedReleases(), hook);
}

export function isConfiguredStockPairedReleaseReady(
  environment: "production" | "rehearsal",
) {
  return (
    environment === "production" &&
    getConfiguredStockPairedLaunchRelease() !== null
  );
}
