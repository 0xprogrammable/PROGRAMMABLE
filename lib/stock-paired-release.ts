import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import mainnetReleaseJson from "../contracts/deployments/mainnet-stock-paired-v1.json";
import { STOCK_QUOTE_ASSETS } from "./stock-paired";

export const STOCK_PAIRED_INTERNAL_RELEASE = "stock-paired-v1" as const;

const runtimeFields = [
  "quoteRegistry",
  "positionPlanner",
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
  "launcher",
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
] as const;

const EXPECTED_TREASURY =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c" as const;
const EXPECTED_POSITION_FORWARDER_FACTORY =
  "0x291a9ff1059d225d02B1659430804486404dB507" as const;
const EXPECTED_ONDO_BEACON =
  "0x985462C9aA4D6c3Ad59Ae6e1e9c0C11347ED1598" as const;
const EXPECTED_ONDO_IMPLEMENTATION =
  "0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250" as const;
const EXPECTED_OFFICIAL_DEPENDENCIES = {
  poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  positionManager: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
  stateView: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
  v4Quoter: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  universalRouter: "0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA",
  uerc20Factory: "0x000000e200088D55C39a11F609E5F667729ad49b",
} as const;

type RuntimeField = (typeof runtimeFields)[number];
type DeployedField = (typeof deployedFields)[number];
type OfficialDependencyField = (typeof officialDependencyFields)[number];

export type StockPairedReleaseManifest = {
  schemaVersion?: unknown;
  model?: unknown;
  internalContractRelease?: unknown;
  status?: unknown;
  chainId?: unknown;
  releaseCommit?: unknown;
  sourceCommitment?: unknown;
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
  };
  quoteAssets?: unknown;
  sourceVerification?: {
    status?: unknown;
    quoteRegistry?: unknown;
    positionPlanner?: unknown;
    feeSplitVaultFactory?: unknown;
    hookFactory?: unknown;
    feeHook?: unknown;
    launcher?: unknown;
  };
  lifecycleEvidence?: {
    status?: unknown;
    releaseEligible?: unknown;
    independentRpcCount?: unknown;
    deploymentTransactionsVerified?: unknown;
    runtimeBindingsVerified?: unknown;
    canaryLaunchTransaction?: unknown;
    canaryQuoteAsset?: unknown;
    positionLockVerified?: unknown;
    buyAndSellVerified?: unknown;
    creatorClaimVerified?: unknown;
    launcherClaimVerified?: unknown;
  };
};

export type VerifiedStockPairedRelease = {
  chainId: 1;
  releaseCommit: string;
  sourceCommitment: Hex;
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
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { status?: unknown }).status === "verified"
  );
}

function sameAddress(left: unknown, right: string) {
  return (
    validAddress(left) &&
    getAddress(left).toLowerCase() === getAddress(right).toLowerCase()
  );
}

function exactQuoteAssets(value: unknown) {
  if (!Array.isArray(value) || value.length !== STOCK_QUOTE_ASSETS.length) {
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
    const expected = STOCK_QUOTE_ASSETS[index];
    return (
      record.symbol === expected.symbol &&
      sameAddress(record.address, expected.address)
    );
  });
}

export function resolveVerifiedStockPairedRelease(
  input: unknown = mainnetReleaseJson,
): VerifiedStockPairedRelease | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const release = input as StockPairedReleaseManifest;
  const addresses = release.addresses;
  const transactions = release.transactions;
  const runtimeCodeHashes = release.runtimeCodeHashes;
  const sourceVerification = release.sourceVerification;
  const officialDependencies = release.officialDependencies;

  if (
    release.schemaVersion !== 1 ||
    release.model !== "stock-paired" ||
    release.internalContractRelease !== STOCK_PAIRED_INTERNAL_RELEASE ||
    release.status !== "deployment-source-and-lifecycle-verified" ||
    release.chainId !== 1 ||
    !validReleaseCommit(release.releaseCommit) ||
    !validHash(release.sourceCommitment) ||
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
    !exactQuoteAssets(release.quoteAssets) ||
    sourceVerification?.status !== "verified" ||
    release.lifecycleEvidence?.status !== "verified-current-release" ||
    release.lifecycleEvidence.releaseEligible !== true ||
    !Number.isSafeInteger(release.lifecycleEvidence.independentRpcCount) ||
    Number(release.lifecycleEvidence.independentRpcCount) < 2 ||
    release.lifecycleEvidence.deploymentTransactionsVerified !== true ||
    release.lifecycleEvidence.runtimeBindingsVerified !== true ||
    !validHash(release.lifecycleEvidence.canaryLaunchTransaction) ||
    !validAddress(release.lifecycleEvidence.canaryQuoteAsset) ||
    !STOCK_QUOTE_ASSETS.some((asset) =>
      sameAddress(release.lifecycleEvidence?.canaryQuoteAsset, asset.address),
    ) ||
    release.lifecycleEvidence.positionLockVerified !== true ||
    release.lifecycleEvidence.buyAndSellVerified !== true ||
    release.lifecycleEvidence.creatorClaimVerified !== true ||
    release.lifecycleEvidence.launcherClaimVerified !== true
  ) {
    return null;
  }

  const addressKeys = [
    ...runtimeFields,
    "deployer",
    "treasury",
  ] as const;
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
  if (
    !deployedFields.every((field) =>
      verifiedExplorerRecord(sourceVerification[field]),
    )
  ) {
    return null;
  }

  return {
    chainId: 1,
    releaseCommit: release.releaseCommit,
    sourceCommitment: release.sourceCommitment,
    startBlock: Number(release.startBlock),
    addresses: Object.fromEntries(
      addressKeys.map((field) => [field, getAddress(addresses[field] as string)]),
    ) as VerifiedStockPairedRelease["addresses"],
    transactions: Object.fromEntries(
      deployedFields.map((field) => [field, transactions[field] as Hex]),
    ) as VerifiedStockPairedRelease["transactions"],
    runtimeCodeHashes: Object.fromEntries(
      runtimeFields.map((field) => [
        field,
        runtimeCodeHashes[field] as Hex,
      ]),
    ) as VerifiedStockPairedRelease["runtimeCodeHashes"],
    officialDependencies: Object.fromEntries(
      officialDependencyFields.map((field) => [
        field,
        {
          address: getAddress(
            officialDependencies[field]?.address as string,
          ),
          runtimeCodeHash: officialDependencies[field]
            ?.runtimeCodeHash as Hex,
        },
      ]),
    ) as VerifiedStockPairedRelease["officialDependencies"],
    issuerRuntime: {
      tokenRuntimeCodeHash: release.issuerRuntime
        ?.tokenRuntimeCodeHash as Hex,
      beacon: getAddress(release.issuerRuntime?.beacon as string),
      beaconRuntimeCodeHash: release.issuerRuntime
        ?.beaconRuntimeCodeHash as Hex,
      implementation: getAddress(
        release.issuerRuntime?.implementation as string,
      ),
      implementationRuntimeCodeHash: release.issuerRuntime
        ?.implementationRuntimeCodeHash as Hex,
    },
  };
}

export function getConfiguredStockPairedRelease() {
  return resolveVerifiedStockPairedRelease(mainnetReleaseJson);
}

export function isConfiguredStockPairedReleaseReady(
  environment: "production" | "rehearsal",
) {
  return environment === "production" && getConfiguredStockPairedRelease() !== null;
}
