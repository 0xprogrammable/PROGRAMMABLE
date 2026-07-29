import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

export const STOCK_PAIRED_CHAIN_ID = 1;
export const STOCK_PAIRED_CHAIN_ID_HEX = "0x1";
export const STOCK_PAIRED_DEPLOYER =
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E";
export const STOCK_PAIRED_TREASURY =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const STOCK_PAIRED_FINALITY_CONFIRMATIONS = 12;
export const STOCK_PAIRED_MAX_RUNTIME_BYTES = 24_576;
export const STOCK_PAIRED_MAX_INITCODE_BYTES = 49_152;
export const STOCK_PAIRED_REQUIRED_HOOK_FLAGS = 8_396n;
export const STOCK_PAIRED_HOOK_ADDRESS_MASK = (1n << 14n) - 1n;
export const STOCK_PAIRED_MAX_FEE_PER_GAS_WEI = 100_000_000_000n;
export const STOCK_PAIRED_MAX_PRIORITY_FEE_PER_GAS_WEI = 5_000_000_000n;
export const STOCK_PAIRED_MIN_PRIORITY_FEE_PER_GAS_WEI = 100_000_000n;
export const STOCK_PAIRED_GAS_PADDING_BPS = 12_000n;

export const STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS = Object.freeze([
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
]);

export const STOCK_PAIRED_DEPENDENCIES = Object.freeze({
  poolManager: {
    address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  },
  positionManager: {
    address: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
  },
  stateView: {
    address: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
    runtimeCodeHash:
      "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
  },
  v4Quoter: {
    address: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
    runtimeCodeHash:
      "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
  },
  permit2: {
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash:
      "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
  },
  universalRouter: {
    address: "0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA",
    runtimeCodeHash:
      "0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face",
  },
  uerc20Factory: {
    address: "0x000000e200088D55C39a11F609E5F667729ad49b",
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
  },
  positionForwarderFactory: {
    address: "0x291a9ff1059d225d02B1659430804486404dB507",
    runtimeCodeHash:
      "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2",
  },
});

export const STOCK_PAIRED_ISSUER_RUNTIME = Object.freeze({
  tokenRuntimeCodeHash:
    "0x9806c8207a455c012b2799be651ac0146d54866f92db90b502e5e2efa283bee9",
  beacon: "0x985462C9aA4D6c3Ad59Ae6e1e9c0C11347ED1598",
  beaconRuntimeCodeHash:
    "0xfeff50d5e739b863fc9e0db874d5558375a3e2c81bc20c24923a685263d639bd",
  implementation: "0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250",
  implementationRuntimeCodeHash:
    "0x7480293a8fad3f98f01f39aa59cd4e4c30d7fc4e7019e8f6e691eb5a9be53d11",
});

export const STOCK_PAIRED_ASSETS = Object.freeze([
  ["NVDAon", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"],
  ["SPYon", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08"],
  ["GOOGLon", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc"],
  ["SLVon", "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4"],
  ["QQQon", "0x0e397938C1Aa0680954093495B70A9F5e2249aBa"],
  ["TSLAon", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f"],
  ["AAPLon", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c"],
]);

export const STOCK_PAIRED_MANIFEST_PATH =
  "contracts/deployments/mainnet-stock-paired-v1.json";
export const STOCK_PAIRED_DRY_RUN_PATH =
  "contracts/broadcast/DeployMainnetStockPairedInfrastructureV1.s.sol/1/dry-run/run-latest.json";

export const STOCK_PAIRED_RELEASE_PATHS = Object.freeze([
  "config/stock-paired-assets.v1.json",
  "contracts/src/interfaces/IQuoteAssetCreatorFeeHookV1.sol",
  "contracts/src/StockQuoteRegistryV1.sol",
  "contracts/src/StockPairedPositionPlannerV1.sol",
  "contracts/src/QuoteAssetFeeSplitVaultV1.sol",
  "contracts/src/QuoteAssetFeeSplitVaultFactoryV1.sol",
  "contracts/src/QuoteAssetCreatorFeeHookV1.sol",
  "contracts/src/QuoteAssetCreatorFeeHookFactoryV1.sol",
  "contracts/src/StockPairedLaunchV1.sol",
  "contracts/script/DeployMainnetStockPairedInfrastructureV1.s.sol",
  "contracts/test/StockPairedLaunchV1.t.sol",
  "contracts/test/StockPairedMainnetFork.t.sol",
  "contracts/test/invariant/StockPairedFeeAccountingInvariant.t.sol",
  "contracts/test/DeployMainnetStockPairedInfrastructureV1.t.sol",
  "contracts/scripts/capture-stock-paired-release.mjs",
  "contracts/scripts/capture-stock-paired-lifecycle.mjs",
  "contracts/scripts/verify-stock-paired-sources.mjs",
  "contracts/scripts/test/stock-paired-operator.test.mjs",
  "contracts/scripts/test/stock-paired-canary.test.mjs",
  "contracts/security/STOCK-PAIRED-V1.md",
  "contracts/foundry.toml",
  "contracts/remappings.txt",
  "docs/superpowers/specs/2026-07-29-stock-paired-v1-design.md",
  "scripts/stock-paired-mainnet-operator-core.mjs",
  "scripts/serve-stock-paired-mainnet-operator.mjs",
  "scripts/stock-paired-mainnet-canary-core.mjs",
  "scripts/serve-stock-paired-mainnet-canary.mjs",
]);

const artifactPaths = Object.freeze({
  quoteRegistry:
    "contracts/out/StockQuoteRegistryV1.sol/StockQuoteRegistryV1.json",
  positionPlanner:
    "contracts/out/StockPairedPositionPlannerV1.sol/StockPairedPositionPlannerV1.json",
  feeSplitVaultFactory:
    "contracts/out/QuoteAssetFeeSplitVaultFactoryV1.sol/QuoteAssetFeeSplitVaultFactoryV1.json",
  hookFactory:
    "contracts/out/QuoteAssetCreatorFeeHookFactoryV1.sol/QuoteAssetCreatorFeeHookFactoryV1.json",
  feeHook:
    "contracts/out/QuoteAssetCreatorFeeHookV1.sol/QuoteAssetCreatorFeeHookV1.json",
  launcher: "contracts/out/StockPairedLaunchV1.sol/StockPairedLaunchV1.json",
});

const hookFactoryAbi = parseAbi([
  "function deploy(bytes32 salt,address poolManager,address launcherFeeRecipient,address quoteRegistry,address feeSplitVaultFactory) returns (address hook)",
  "function isFactoryHook(address hook) view returns (bool)",
  "function ALL_HOOK_MASK() view returns (uint160)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
]);
const registryAbi = parseAbi([
  "function assetCount() view returns (uint256)",
  "function assetAt(uint256 index) view returns (address)",
  "function isSupported(address asset) view returns (bool)",
  "function beacon() view returns (address)",
  "function reviewedImplementation() view returns (address)",
  "function expectedTokenCodeHash() view returns (bytes32)",
  "function expectedBeaconCodeHash() view returns (bytes32)",
  "function expectedImplementationCodeHash() view returns (bytes32)",
]);
const plannerAbi = parseAbi([
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function INITIAL_ABSOLUTE_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
]);
const hookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function quoteRegistry() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function TOTAL_SWAP_FEE_BPS() view returns (uint16)",
  "function CREATOR_FEE_BPS() view returns (uint16)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
]);
const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function quoteRegistry() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function TOKEN_SUPPLY() view returns (uint256)",
  "function MIN_INITIAL_BUY_QUOTE_AMOUNT() view returns (uint256)",
  "function MAX_REWARD_BENEFICIARIES() view returns (uint256)",
  "function REWARD_SHARE_BASIS_POINTS() view returns (uint16)",
  "function INITIAL_ABSOLUTE_TICK() view returns (int24)",
  "function TICK_SPACING() view returns (int24)",
  "function LP_FEE_PIPS() view returns (uint24)",
]);

export function normalizeStockPairedHex(value) {
  return String(value ?? "").toLowerCase();
}

export function stockPairedQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

export function assertStockPairedReleaseCheckout(root, releaseCommit) {
  if (
    typeof releaseCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(releaseCommit)
  ) {
    throw new Error(
      "A full 40-character Stock-Paired release commit is required",
    );
  }
  execFileSync("git", ["cat-file", "-e", `${releaseCommit}^{commit}`], {
    cwd: root,
    stdio: "ignore",
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (head !== releaseCommit) {
    throw new Error(
      "The operator checkout is not at the exact Stock-Paired release commit",
    );
  }
  const dirty = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ...STOCK_PAIRED_RELEASE_PATHS,
    ],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (dirty) {
    throw new Error("The Stock-Paired release files have uncommitted changes");
  }
}

function canonicalAddress(value) {
  return getAddress(String(value).toLowerCase());
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function digest(value) {
  return keccak256(stringToHex(JSON.stringify(stableValue(value))));
}

function artifactBytecode(artifact, label) {
  const value = artifact?.bytecode?.object;
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} creation bytecode is unavailable`);
  }
  return value;
}

function artifactRuntime(artifact, label) {
  const value = artifact?.deployedBytecode?.object;
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} runtime bytecode is unavailable`);
  }
  return value;
}

function hexByteLength(value) {
  return (value.length - 2) / 2;
}

export function assertStockPairedArtifactSizeLimits(artifacts) {
  for (const [field, artifact] of Object.entries(artifacts)) {
    const label = String(artifact?.contractName ?? field);
    const creationBytes = hexByteLength(artifactBytecode(artifact, label));
    const runtimeBytes = hexByteLength(artifactRuntime(artifact, label));
    if (creationBytes > STOCK_PAIRED_MAX_INITCODE_BYTES) {
      throw new Error(
        `${label} creation bytecode exceeds the EIP-3860 limit`,
      );
    }
    if (runtimeBytes > STOCK_PAIRED_MAX_RUNTIME_BYTES) {
      throw new Error(
        `${label} runtime bytecode exceeds the EIP-170 limit`,
      );
    }
  }
}

function encodeHashTuple(values) {
  return keccak256(
    encodeAbiParameters(
      values.map(() => ({ type: "bytes32" })),
      values,
    ),
  );
}

function addressResult(value) {
  return encodeAbiParameters(
    [{ type: "address" }],
    [canonicalAddress(value)],
  ).toLowerCase();
}

function uintResult(value, type = "uint256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]).toLowerCase();
}

function intResult(value, type = "int256") {
  return encodeAbiParameters([{ type }], [BigInt(value)]).toLowerCase();
}

function boolResult(value) {
  return encodeAbiParameters([{ type: "bool" }], [value]).toLowerCase();
}

function bytes32Result(value) {
  return encodeAbiParameters([{ type: "bytes32" }], [value]).toLowerCase();
}

function callCheck(label, target, abi, functionName, expected, args = []) {
  return {
    label,
    target: canonicalAddress(target),
    data: encodeFunctionData({ abi, functionName, args }),
    expected: normalizeStockPairedHex(expected),
  };
}

export function computeStockPairedSourceCommitment(artifacts) {
  const bytecodeCommitment = encodeHashTuple([
    keccak256(
      artifactBytecode(artifacts.quoteRegistry, "StockQuoteRegistryV1"),
    ),
    keccak256(
      artifactBytecode(
        artifacts.positionPlanner,
        "StockPairedPositionPlannerV1",
      ),
    ),
    keccak256(
      artifactBytecode(
        artifacts.feeSplitVaultFactory,
        "QuoteAssetFeeSplitVaultFactoryV1",
      ),
    ),
    keccak256(
      artifactBytecode(
        artifacts.hookFactory,
        "QuoteAssetCreatorFeeHookFactoryV1",
      ),
    ),
    keccak256(
      artifactBytecode(artifacts.feeHook, "QuoteAssetCreatorFeeHookV1"),
    ),
    keccak256(artifactBytecode(artifacts.launcher, "StockPairedLaunchV1")),
  ]);
  const dependency = STOCK_PAIRED_DEPENDENCIES;
  const coreDependencyCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
      ],
      [
        canonicalAddress(dependency.poolManager.address),
        dependency.poolManager.runtimeCodeHash,
        canonicalAddress(dependency.positionManager.address),
        dependency.positionManager.runtimeCodeHash,
        canonicalAddress(dependency.stateView.address),
        dependency.stateView.runtimeCodeHash,
        canonicalAddress(dependency.v4Quoter.address),
        dependency.v4Quoter.runtimeCodeHash,
      ],
    ),
  );
  const routingDependencyCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
      ],
      [
        canonicalAddress(dependency.permit2.address),
        dependency.permit2.runtimeCodeHash,
        canonicalAddress(dependency.universalRouter.address),
        dependency.universalRouter.runtimeCodeHash,
        canonicalAddress(dependency.uerc20Factory.address),
        dependency.uerc20Factory.runtimeCodeHash,
      ],
    ),
  );
  const lockingDependencyCommitment = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [
        canonicalAddress(dependency.positionForwarderFactory.address),
        dependency.positionForwarderFactory.runtimeCodeHash,
      ],
    ),
  );
  const dependencyCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
      ],
      [
        coreDependencyCommitment,
        routingDependencyCommitment,
        lockingDependencyCommitment,
        canonicalAddress(STOCK_PAIRED_TREASURY),
      ],
    ),
  );
  const assetAddresses = STOCK_PAIRED_ASSETS.map(([, address]) =>
    canonicalAddress(address),
  );
  const symbolHashes = STOCK_PAIRED_ASSETS.map(([symbol]) =>
    keccak256(stringToHex(symbol)),
  );
  const assetCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "address[]" },
        { type: "bytes32[]" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
      ],
      [
        assetAddresses,
        symbolHashes,
        STOCK_PAIRED_ISSUER_RUNTIME.tokenRuntimeCodeHash,
        canonicalAddress(STOCK_PAIRED_ISSUER_RUNTIME.beacon),
        STOCK_PAIRED_ISSUER_RUNTIME.beaconRuntimeCodeHash,
        canonicalAddress(STOCK_PAIRED_ISSUER_RUNTIME.implementation),
        STOCK_PAIRED_ISSUER_RUNTIME.implementationRuntimeCodeHash,
      ],
    ),
  );
  const economicsCommitment = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "int256" },
        { type: "int256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        1_000_000_000n * 10n ** 18n,
        10n ** 16n,
        100n,
        90n,
        10n,
        0n,
        0n,
        191_200n,
        200n,
        8n,
        10_000n,
        keccak256(stringToHex("permanently-locked-one-sided-position")),
        keccak256(stringToHex("immutable-beneficiaries-and-shares")),
        keccak256(
          stringToHex("beneficiary-authorized-claim-and-payout-update"),
        ),
      ],
    ),
  );
  return encodeHashTuple([
    keccak256(
      stringToHex("programmable.stock-paired.infrastructure.v1.ethereum"),
    ),
    bytecodeCommitment,
    dependencyCommitment,
    assetCommitment,
    economicsCommitment,
  ]);
}

function assertManifestPins(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.model !== "stock-paired" ||
    manifest?.internalContractRelease !== "stock-paired-v1" ||
    manifest?.chainId !== STOCK_PAIRED_CHAIN_ID ||
    manifest?.candidatePlan?.transactionCount !== 6
  ) {
    throw new Error("The Stock-Paired manifest identity is invalid");
  }
  if (
    normalizeStockPairedHex(manifest.addresses?.treasury) !==
    normalizeStockPairedHex(STOCK_PAIRED_TREASURY)
  ) {
    throw new Error("The Stock-Paired treasury pin drifted");
  }
  for (const [name, expected] of Object.entries(STOCK_PAIRED_DEPENDENCIES)) {
    const actual = manifest.officialDependencies?.[name];
    if (
      normalizeStockPairedHex(actual?.address) !==
        normalizeStockPairedHex(expected.address) ||
      normalizeStockPairedHex(actual?.runtimeCodeHash) !==
        normalizeStockPairedHex(expected.runtimeCodeHash)
    ) {
      throw new Error(`The Stock-Paired dependency pin drifted at ${name}`);
    }
  }
  for (const [field, expected] of Object.entries(STOCK_PAIRED_ISSUER_RUNTIME)) {
    if (
      normalizeStockPairedHex(manifest.issuerRuntime?.[field]) !==
      normalizeStockPairedHex(expected)
    ) {
      throw new Error(`The Stock-Paired issuer pin drifted at ${field}`);
    }
  }
  if (
    !Array.isArray(manifest.quoteAssets) ||
    manifest.quoteAssets.length !== STOCK_PAIRED_ASSETS.length ||
    manifest.quoteAssets.some(
      (asset, index) =>
        asset?.symbol !== STOCK_PAIRED_ASSETS[index][0] ||
        normalizeStockPairedHex(asset?.address) !==
          normalizeStockPairedHex(STOCK_PAIRED_ASSETS[index][1]),
    )
  ) {
    throw new Error("The Stock-Paired quote-asset allowlist drifted");
  }
}

function assertCandidateAddress(candidate, field, expected) {
  if (
    normalizeStockPairedHex(candidate?.[field]) !==
    normalizeStockPairedHex(expected)
  ) {
    throw new Error(`The Stock-Paired candidate drifted at ${field}`);
  }
}

function runtimeDescriptor(artifact, label, immutable) {
  const runtime = artifactRuntime(artifact, label);
  return {
    runtimeBytes: (runtime.length - 2) / 2,
    runtimeCodeHash: immutable ? null : keccak256(runtime),
  };
}

export async function loadStockPairedReleasePlan(
  repositoryRoot,
  { releaseCommit = null } = {},
) {
  const root = path.resolve(repositoryRoot);
  if (
    releaseCommit !== null &&
    (typeof releaseCommit !== "string" || !/^[0-9a-f]{40}$/.test(releaseCommit))
  ) {
    throw new Error("The Stock-Paired release commit is invalid");
  }
  const [manifest, dryRun, ...artifactValues] = await Promise.all([
    readFile(path.join(root, STOCK_PAIRED_MANIFEST_PATH), "utf8").then(
      JSON.parse,
    ),
    readFile(path.join(root, STOCK_PAIRED_DRY_RUN_PATH), "utf8").then(
      JSON.parse,
    ),
    ...Object.values(artifactPaths).map((file) =>
      readFile(path.join(root, file), "utf8").then(JSON.parse),
    ),
  ]);
  const artifacts = Object.fromEntries(
    Object.keys(artifactPaths).map((field, index) => [
      field,
      artifactValues[index],
    ]),
  );
  assertStockPairedArtifactSizeLimits(artifacts);
  assertManifestPins(manifest);
  const sourceCommitment = computeStockPairedSourceCommitment(artifacts);
  if (normalizeStockPairedHex(manifest.sourceCommitment) !== sourceCommitment) {
    throw new Error(
      "The Stock-Paired artifacts do not match the manifest source commitment",
    );
  }
  if (
    dryRun.chain !== STOCK_PAIRED_CHAIN_ID ||
    !Array.isArray(dryRun.transactions) ||
    dryRun.transactions.length !== 6 ||
    !Array.isArray(dryRun.receipts) ||
    dryRun.receipts.length !== 0 ||
    !Array.isArray(dryRun.pending) ||
    dryRun.pending.length !== 0 ||
    dryRun.transactions.some((entry) => entry.hash !== null)
  ) {
    throw new Error(
      "The Stock-Paired plan must be a six-step, unbroadcast Mainnet simulation",
    );
  }
  const entries = dryRun.transactions;
  const expectedTypes = [
    "CREATE",
    "CREATE",
    "CREATE",
    "CREATE",
    "CALL",
    "CREATE",
  ];
  const expectedContracts = [
    "StockQuoteRegistryV1",
    "StockPairedPositionPlannerV1",
    "QuoteAssetFeeSplitVaultFactoryV1",
    "QuoteAssetCreatorFeeHookFactoryV1",
    "QuoteAssetCreatorFeeHookFactoryV1",
    "StockPairedLaunchV1",
  ];
  const startingNonce = Number(BigInt(entries[0]?.transaction?.nonce));
  if (!Number.isSafeInteger(startingNonce) || startingNonce < 0) {
    throw new Error("The Stock-Paired starting nonce is invalid");
  }
  entries.forEach((entry, index) => {
    const transaction = entry?.transaction ?? {};
    if (
      entry.transactionType !== expectedTypes[index] ||
      entry.contractName !== expectedContracts[index] ||
      normalizeStockPairedHex(transaction.from) !==
        normalizeStockPairedHex(STOCK_PAIRED_DEPLOYER) ||
      normalizeStockPairedHex(transaction.chainId) !==
        STOCK_PAIRED_CHAIN_ID_HEX ||
      stockPairedQuantity(transaction.value) !== "0x0" ||
      Number(BigInt(transaction.nonce)) !== startingNonce + index ||
      typeof transaction.input !== "string" ||
      !/^0x[0-9a-f]+$/i.test(transaction.input) ||
      BigInt(transaction.gas) <= 21_000n
    ) {
      throw new Error(
        `The Stock-Paired simulation drifted at step ${index + 1}`,
      );
    }
  });
  const [
    registryEntry,
    plannerEntry,
    vaultFactoryEntry,
    hookFactoryEntry,
    hookEntry,
    launcherEntry,
  ] = entries;
  const quoteRegistry = canonicalAddress(registryEntry.contractAddress);
  const positionPlanner = canonicalAddress(plannerEntry.contractAddress);
  const feeSplitVaultFactory = canonicalAddress(
    vaultFactoryEntry.contractAddress,
  );
  const hookFactory = canonicalAddress(hookFactoryEntry.contractAddress);
  const feeHook = canonicalAddress(hookEntry.additionalContracts?.[0]?.address);
  const launcher = canonicalAddress(launcherEntry.contractAddress);
  const createAddresses = [0, 1, 2, 3, 5].map((offset) =>
    getContractAddress({
      from: STOCK_PAIRED_DEPLOYER,
      nonce: BigInt(startingNonce + offset),
    }),
  );
  [
    quoteRegistry,
    positionPlanner,
    feeSplitVaultFactory,
    hookFactory,
    launcher,
  ].forEach((actual, index) => {
    if (
      normalizeStockPairedHex(actual) !==
      normalizeStockPairedHex(createAddresses[index])
    ) {
      throw new Error("A Stock-Paired CREATE address prediction drifted");
    }
  });
  const candidate = manifest.candidatePlan;
  if (candidate?.startingNonce !== startingNonce) {
    throw new Error("The Stock-Paired candidate nonce drifted");
  }
  assertCandidateAddress(candidate, "deployer", STOCK_PAIRED_DEPLOYER);
  assertCandidateAddress(candidate, "quoteRegistry", quoteRegistry);
  assertCandidateAddress(candidate, "positionPlanner", positionPlanner);
  assertCandidateAddress(
    candidate,
    "feeSplitVaultFactory",
    feeSplitVaultFactory,
  );
  assertCandidateAddress(candidate, "hookFactory", hookFactory);
  assertCandidateAddress(candidate, "feeHook", feeHook);
  assertCandidateAddress(candidate, "launcher", launcher);
  const hookSalt = String(candidate.hookSalt ?? "");
  if (!/^0x[0-9a-f]{64}$/i.test(hookSalt) || BigInt(hookSalt) === 0n) {
    throw new Error("The Stock-Paired hook salt is invalid");
  }
  const assetAddresses = STOCK_PAIRED_ASSETS.map(([, address]) =>
    canonicalAddress(address),
  );
  const symbolHashes = STOCK_PAIRED_ASSETS.map(([symbol]) =>
    keccak256(stringToHex(symbol)),
  );
  const registryConstructor = encodeAbiParameters(
    [
      { type: "address[]" },
      { type: "bytes32[]" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [
      assetAddresses,
      symbolHashes,
      canonicalAddress(STOCK_PAIRED_ISSUER_RUNTIME.beacon),
      canonicalAddress(STOCK_PAIRED_ISSUER_RUNTIME.implementation),
      STOCK_PAIRED_ISSUER_RUNTIME.tokenRuntimeCodeHash,
      STOCK_PAIRED_ISSUER_RUNTIME.beaconRuntimeCodeHash,
      STOCK_PAIRED_ISSUER_RUNTIME.implementationRuntimeCodeHash,
    ],
  );
  const expectedRegistryInput =
    artifactBytecode(artifacts.quoteRegistry, "StockQuoteRegistryV1") +
    registryConstructor.slice(2);
  const exactCreateInputs = [
    expectedRegistryInput,
    artifactBytecode(artifacts.positionPlanner, "StockPairedPositionPlannerV1"),
    artifactBytecode(
      artifacts.feeSplitVaultFactory,
      "QuoteAssetFeeSplitVaultFactoryV1",
    ),
    artifactBytecode(
      artifacts.hookFactory,
      "QuoteAssetCreatorFeeHookFactoryV1",
    ),
  ];
  [registryEntry, plannerEntry, vaultFactoryEntry, hookFactoryEntry].forEach(
    (entry, index) => {
      if (
        normalizeStockPairedHex(entry.transaction.input) !==
        normalizeStockPairedHex(exactCreateInputs[index])
      ) {
        throw new Error(
          `Stock-Paired creation bytecode drifted at step ${index + 1}`,
        );
      }
    },
  );
  if (
    hookEntry.function !== "deploy(bytes32,address,address,address,address)" ||
    normalizeStockPairedHex(hookEntry.transaction.to) !==
      normalizeStockPairedHex(hookFactory) ||
    hookEntry.additionalContracts?.length !== 1 ||
    hookEntry.additionalContracts[0]?.transactionType !== "CREATE2" ||
    hookEntry.additionalContracts[0]?.contractName !==
      "QuoteAssetCreatorFeeHookV1"
  ) {
    throw new Error("The Stock-Paired CREATE2 hook shape drifted");
  }
  const expectedHookCall = encodeFunctionData({
    abi: hookFactoryAbi,
    functionName: "deploy",
    args: [
      hookSalt,
      canonicalAddress(STOCK_PAIRED_DEPENDENCIES.poolManager.address),
      canonicalAddress(STOCK_PAIRED_TREASURY),
      quoteRegistry,
      feeSplitVaultFactory,
    ],
  });
  const decodedHookCall = decodeFunctionData({
    abi: hookFactoryAbi,
    data: hookEntry.transaction.input,
  });
  if (
    decodedHookCall.functionName !== "deploy" ||
    normalizeStockPairedHex(hookEntry.transaction.input) !==
      normalizeStockPairedHex(expectedHookCall)
  ) {
    throw new Error("The Stock-Paired hook deployment calldata drifted");
  }
  const hookConstructor = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
    [
      canonicalAddress(STOCK_PAIRED_DEPENDENCIES.poolManager.address),
      canonicalAddress(STOCK_PAIRED_TREASURY),
      quoteRegistry,
      feeSplitVaultFactory,
    ],
  );
  const hookInitCode =
    artifactBytecode(artifacts.feeHook, "QuoteAssetCreatorFeeHookV1") +
    hookConstructor.slice(2);
  if (
    normalizeStockPairedHex(hookEntry.additionalContracts[0]?.initCode) !==
      normalizeStockPairedHex(hookInitCode) ||
    normalizeStockPairedHex(
      getCreate2Address({
        from: hookFactory,
        salt: hookSalt,
        bytecodeHash: keccak256(hookInitCode),
      }),
    ) !== normalizeStockPairedHex(feeHook) ||
    (BigInt(feeHook) & STOCK_PAIRED_HOOK_ADDRESS_MASK) !==
      STOCK_PAIRED_REQUIRED_HOOK_FLAGS
  ) {
    throw new Error("The Stock-Paired hook CREATE2 commitment drifted");
  }
  const launcherConstructor = encodeAbiParameters(
    Array.from({ length: 8 }, () => ({ type: "address" })),
    [
      canonicalAddress(STOCK_PAIRED_DEPENDENCIES.poolManager.address),
      canonicalAddress(STOCK_PAIRED_DEPENDENCIES.positionManager.address),
      canonicalAddress(STOCK_PAIRED_DEPENDENCIES.uerc20Factory.address),
      feeHook,
      quoteRegistry,
      positionPlanner,
      feeSplitVaultFactory,
      canonicalAddress(
        STOCK_PAIRED_DEPENDENCIES.positionForwarderFactory.address,
      ),
    ],
  );
  const expectedLauncherInput =
    artifactBytecode(artifacts.launcher, "StockPairedLaunchV1") +
    launcherConstructor.slice(2);
  if (
    normalizeStockPairedHex(launcherEntry.transaction.input) !==
    normalizeStockPairedHex(expectedLauncherInput)
  ) {
    throw new Error(
      "The Stock-Paired launcher bytecode or constructor arguments drifted",
    );
  }
  const returnValue = String(dryRun?.returns?.result?.value ?? "");
  if (
    !returnValue.toLowerCase().includes(sourceCommitment.slice(2)) ||
    !returnValue.toLowerCase().includes(hookSalt.slice(2).toLowerCase())
  ) {
    throw new Error(
      "The Stock-Paired simulation result omits its reviewed commitments",
    );
  }
  const runtime = {
    quoteRegistry: runtimeDescriptor(
      artifacts.quoteRegistry,
      "StockQuoteRegistryV1",
      true,
    ),
    positionPlanner: runtimeDescriptor(
      artifacts.positionPlanner,
      "StockPairedPositionPlannerV1",
      false,
    ),
    feeSplitVaultFactory: runtimeDescriptor(
      artifacts.feeSplitVaultFactory,
      "QuoteAssetFeeSplitVaultFactoryV1",
      false,
    ),
    hookFactory: runtimeDescriptor(
      artifacts.hookFactory,
      "QuoteAssetCreatorFeeHookFactoryV1",
      false,
    ),
    feeHook: runtimeDescriptor(
      artifacts.feeHook,
      "QuoteAssetCreatorFeeHookV1",
      true,
    ),
    launcher: runtimeDescriptor(
      artifacts.launcher,
      "StockPairedLaunchV1",
      true,
    ),
  };
  const shared = {
    chainId: STOCK_PAIRED_CHAIN_ID_HEX,
    from: canonicalAddress(STOCK_PAIRED_DEPLOYER),
    value: "0x0",
  };
  const baseTransaction = (entry, field, label, address, to = null) => ({
    ...shared,
    field,
    label,
    transactionType: entry.transactionType,
    address,
    to,
    nonce: stockPairedQuantity(entry.transaction.nonce),
    data: entry.transaction.input,
    calldataHash: keccak256(entry.transaction.input),
    reviewedGasLimit: stockPairedQuantity(entry.transaction.gas),
    ...runtime[field],
  });
  const transactions = [
    {
      ...baseTransaction(
        registryEntry,
        "quoteRegistry",
        "Quote asset registry",
        quoteRegistry,
      ),
      checks: [
        callCheck(
          "asset count",
          quoteRegistry,
          registryAbi,
          "assetCount",
          uintResult(7),
        ),
        callCheck(
          "issuer beacon",
          quoteRegistry,
          registryAbi,
          "beacon",
          addressResult(STOCK_PAIRED_ISSUER_RUNTIME.beacon),
        ),
        callCheck(
          "issuer implementation",
          quoteRegistry,
          registryAbi,
          "reviewedImplementation",
          addressResult(STOCK_PAIRED_ISSUER_RUNTIME.implementation),
        ),
        callCheck(
          "quote token runtime",
          quoteRegistry,
          registryAbi,
          "expectedTokenCodeHash",
          bytes32Result(STOCK_PAIRED_ISSUER_RUNTIME.tokenRuntimeCodeHash),
        ),
        ...assetAddresses.flatMap((asset, index) => [
          callCheck(
            `asset ${index + 1}`,
            quoteRegistry,
            registryAbi,
            "assetAt",
            addressResult(asset),
            [BigInt(index)],
          ),
          callCheck(
            `asset ${index + 1} supported`,
            quoteRegistry,
            registryAbi,
            "isSupported",
            boolResult(true),
            [asset],
          ),
        ]),
      ],
    },
    {
      ...baseTransaction(
        plannerEntry,
        "positionPlanner",
        "Position planner",
        positionPlanner,
      ),
      checks: [
        callCheck(
          "token supply",
          positionPlanner,
          plannerAbi,
          "TOKEN_SUPPLY",
          uintResult(1_000_000_000n * 10n ** 18n),
        ),
        callCheck(
          "initial absolute tick",
          positionPlanner,
          plannerAbi,
          "INITIAL_ABSOLUTE_TICK",
          intResult(191_200, "int24"),
        ),
        callCheck(
          "tick spacing",
          positionPlanner,
          plannerAbi,
          "TICK_SPACING",
          intResult(200, "int24"),
        ),
      ],
    },
    {
      ...baseTransaction(
        vaultFactoryEntry,
        "feeSplitVaultFactory",
        "Reward vault factory",
        feeSplitVaultFactory,
      ),
      checks: [],
    },
    {
      ...baseTransaction(
        hookFactoryEntry,
        "hookFactory",
        "Creator fee hook factory",
        hookFactory,
      ),
      checks: [
        callCheck(
          "hook address mask",
          hookFactory,
          hookFactoryAbi,
          "ALL_HOOK_MASK",
          uintResult(STOCK_PAIRED_HOOK_ADDRESS_MASK, "uint160"),
        ),
        callCheck(
          "required hook flags",
          hookFactory,
          hookFactoryAbi,
          "REQUIRED_HOOK_FLAGS",
          uintResult(STOCK_PAIRED_REQUIRED_HOOK_FLAGS, "uint160"),
        ),
      ],
    },
    {
      ...baseTransaction(
        hookEntry,
        "feeHook",
        "Quote asset fee hook",
        feeHook,
        hookFactory,
      ),
      checks: [
        callCheck(
          "factory provenance",
          hookFactory,
          hookFactoryAbi,
          "isFactoryHook",
          boolResult(true),
          [feeHook],
        ),
        callCheck(
          "PoolManager",
          feeHook,
          hookAbi,
          "poolManager",
          addressResult(STOCK_PAIRED_DEPENDENCIES.poolManager.address),
        ),
        callCheck(
          "treasury",
          feeHook,
          hookAbi,
          "launcherFeeRecipient",
          addressResult(STOCK_PAIRED_TREASURY),
        ),
        callCheck(
          "quote registry",
          feeHook,
          hookAbi,
          "quoteRegistry",
          addressResult(quoteRegistry),
        ),
        callCheck(
          "reward vault factory",
          feeHook,
          hookAbi,
          "feeSplitVaultFactory",
          addressResult(feeSplitVaultFactory),
        ),
        callCheck(
          "total swap fee",
          feeHook,
          hookAbi,
          "TOTAL_SWAP_FEE_BPS",
          uintResult(100, "uint16"),
        ),
        callCheck(
          "creator fee",
          feeHook,
          hookAbi,
          "CREATOR_FEE_BPS",
          uintResult(90, "uint16"),
        ),
        callCheck(
          "Programmable fee",
          feeHook,
          hookAbi,
          "LAUNCHER_FEE_BPS",
          uintResult(10, "uint16"),
        ),
        callCheck(
          "zero transfer tax",
          feeHook,
          hookAbi,
          "TRANSFER_TAX_BPS",
          uintResult(0, "uint16"),
        ),
        callCheck(
          "zero LP fee",
          feeHook,
          hookAbi,
          "LP_FEE_PIPS",
          uintResult(0, "uint24"),
        ),
        callCheck(
          "tick spacing",
          feeHook,
          hookAbi,
          "TICK_SPACING",
          intResult(200, "int24"),
        ),
      ],
    },
    {
      ...baseTransaction(
        launcherEntry,
        "launcher",
        "Stock-Paired launcher",
        launcher,
      ),
      checks: [
        callCheck(
          "PoolManager",
          launcher,
          launcherAbi,
          "poolManager",
          addressResult(STOCK_PAIRED_DEPENDENCIES.poolManager.address),
        ),
        callCheck(
          "PositionManager",
          launcher,
          launcherAbi,
          "positionManager",
          addressResult(STOCK_PAIRED_DEPENDENCIES.positionManager.address),
        ),
        callCheck(
          "UERC20 factory",
          launcher,
          launcherAbi,
          "tokenFactory",
          addressResult(STOCK_PAIRED_DEPENDENCIES.uerc20Factory.address),
        ),
        callCheck(
          "fee hook",
          launcher,
          launcherAbi,
          "feeHook",
          addressResult(feeHook),
        ),
        callCheck(
          "quote registry",
          launcher,
          launcherAbi,
          "quoteRegistry",
          addressResult(quoteRegistry),
        ),
        callCheck(
          "position planner",
          launcher,
          launcherAbi,
          "positionPlanner",
          addressResult(positionPlanner),
        ),
        callCheck(
          "reward vault factory",
          launcher,
          launcherAbi,
          "feeSplitVaultFactory",
          addressResult(feeSplitVaultFactory),
        ),
        callCheck(
          "locked position factory",
          launcher,
          launcherAbi,
          "positionForwarderFactory",
          addressResult(
            STOCK_PAIRED_DEPENDENCIES.positionForwarderFactory.address,
          ),
        ),
        callCheck(
          "minimum initial buy",
          launcher,
          launcherAbi,
          "MIN_INITIAL_BUY_QUOTE_AMOUNT",
          uintResult(10n ** 16n),
        ),
        callCheck(
          "token supply",
          launcher,
          launcherAbi,
          "TOKEN_SUPPLY",
          uintResult(1_000_000_000n * 10n ** 18n),
        ),
        callCheck(
          "maximum beneficiaries",
          launcher,
          launcherAbi,
          "MAX_REWARD_BENEFICIARIES",
          uintResult(8),
        ),
        callCheck(
          "reward share denominator",
          launcher,
          launcherAbi,
          "REWARD_SHARE_BASIS_POINTS",
          uintResult(10_000, "uint16"),
        ),
        callCheck(
          "initial absolute tick",
          launcher,
          launcherAbi,
          "INITIAL_ABSOLUTE_TICK",
          intResult(191_200, "int24"),
        ),
        callCheck(
          "zero LP fee",
          launcher,
          launcherAbi,
          "LP_FEE_PIPS",
          uintResult(0, "uint24"),
        ),
      ],
    },
  ];
  const reviewedGas = transactions.reduce(
    (total, transaction) => total + BigInt(transaction.reviewedGasLimit),
    0n,
  );
  if (
    candidate.estimatedGas !== reviewedGas.toString() ||
    candidate.transactionCount !== transactions.length
  ) {
    throw new Error("The Stock-Paired reviewed gas commitment drifted");
  }
  const planCommitment = {
    chainId: STOCK_PAIRED_CHAIN_ID,
    releaseCommit,
    deployer: canonicalAddress(STOCK_PAIRED_DEPLOYER),
    treasury: canonicalAddress(STOCK_PAIRED_TREASURY),
    sourceCommitment,
    startingNonce,
    hookSalt: hookSalt.toLowerCase(),
    transactions: transactions.map((transaction) => ({
      field: transaction.field,
      transactionType: transaction.transactionType,
      address: transaction.address,
      to: transaction.to,
      nonce: transaction.nonce,
      value: transaction.value,
      calldataHash: transaction.calldataHash,
      reviewedGasLimit: transaction.reviewedGasLimit,
    })),
  };
  return {
    schemaVersion: 1,
    release: "stock-paired-v1",
    network: "Ethereum Mainnet",
    chainId: STOCK_PAIRED_CHAIN_ID,
    chainIdHex: STOCK_PAIRED_CHAIN_ID_HEX,
    explorer: "https://etherscan.io",
    releaseCommit,
    deployer: canonicalAddress(STOCK_PAIRED_DEPLOYER),
    treasury: canonicalAddress(STOCK_PAIRED_TREASURY),
    sourceCommitment,
    simulationCommit: String(dryRun.commit ?? ""),
    simulationTimestamp: dryRun.timestamp,
    simulationDigest: digest(
      transactions.map((transaction) => ({
        nonce: transaction.nonce,
        address: transaction.address,
        calldataHash: transaction.calldataHash,
        reviewedGasLimit: transaction.reviewedGasLimit,
      })),
    ),
    planDigest: digest(planCommitment),
    startingNonce,
    endingNonce: startingNonce + transactions.length,
    hookSalt: hookSalt.toLowerCase(),
    reviewedGas: reviewedGas.toString(),
    addresses: {
      quoteRegistry,
      positionPlanner,
      feeSplitVaultFactory,
      hookFactory,
      feeHook,
      launcher,
    },
    transactions,
  };
}

export function assertStockPairedSequenceState(plan, state) {
  const confirmedNonce = Number(BigInt(state.confirmedNonce));
  const pendingNonce = Number(BigInt(state.pendingNonce));
  if (
    confirmedNonce < plan.startingNonce ||
    confirmedNonce > plan.endingNonce ||
    pendingNonce < confirmedNonce ||
    pendingNonce > plan.endingNonce ||
    !Array.isArray(state.deployments) ||
    state.deployments.length !== plan.transactions.length
  ) {
    throw new Error("The wallet nonce is outside the reviewed release plan");
  }
  const completed = confirmedNonce - plan.startingNonce;
  state.deployments.forEach((deployment, index) => {
    if (index < completed && !deployment.verified) {
      throw new Error(
        "A reviewed nonce confirmed without its expected deployment",
      );
    }
    if (index >= completed && deployment.verified) {
      throw new Error(
        "A Stock-Paired contract exists before its reviewed nonce",
      );
    }
  });
  return completed;
}

export function stockPairedFeePolicy(state) {
  const baseFee = BigInt(state.baseFeePerGas);
  const gasPrice = BigInt(state.gasPrice);
  let priority =
    gasPrice > baseFee
      ? gasPrice - baseFee
      : STOCK_PAIRED_MIN_PRIORITY_FEE_PER_GAS_WEI;
  if (priority < STOCK_PAIRED_MIN_PRIORITY_FEE_PER_GAS_WEI) {
    priority = STOCK_PAIRED_MIN_PRIORITY_FEE_PER_GAS_WEI;
  }
  priority = (priority * 125n + 99n) / 100n;
  const marketBuffer = (gasPrice * 125n + 99n) / 100n;
  const baseFeeBuffer = baseFee * 2n + priority;
  const maxFeePerGas =
    marketBuffer > baseFeeBuffer ? marketBuffer : baseFeeBuffer;
  if (
    priority > STOCK_PAIRED_MAX_PRIORITY_FEE_PER_GAS_WEI ||
    maxFeePerGas > STOCK_PAIRED_MAX_FEE_PER_GAS_WEI
  ) {
    throw new Error("Current Mainnet fees exceed the release policy");
  }
  return {
    maxFeePerGas: stockPairedQuantity(maxFeePerGas),
    maxPriorityFeePerGas: stockPairedQuantity(priority),
  };
}

export function stockPairedCostRequirement(plan, state) {
  const completed = assertStockPairedSequenceState(plan, state);
  const feePolicy = stockPairedFeePolicy(state);
  const remainingGas = plan.transactions
    .slice(completed)
    .reduce(
      (total, transaction) => total + BigInt(transaction.reviewedGasLimit),
      0n,
    );
  const requiredBalance = remainingGas * BigInt(feePolicy.maxFeePerGas);
  const balance = BigInt(state.balance);
  return {
    remainingGas: stockPairedQuantity(remainingGas),
    maxFeePerGas: feePolicy.maxFeePerGas,
    maxPriorityFeePerGas: feePolicy.maxPriorityFeePerGas,
    requiredBalance: stockPairedQuantity(requiredBalance),
    balance: stockPairedQuantity(balance),
    shortfall:
      balance < requiredBalance
        ? stockPairedQuantity(requiredBalance - balance)
        : "0x0",
    sufficient: balance >= requiredBalance,
  };
}

export function prepareStockPairedDeploymentTransaction(
  plan,
  state,
  simulations,
) {
  const completed = assertStockPairedSequenceState(plan, state);
  if (state.confirmedNonce !== state.pendingNonce) {
    throw new Error(
      "Another transaction is pending from the deployment wallet",
    );
  }
  if (completed === plan.transactions.length) return null;
  if (!Array.isArray(simulations) || simulations.length !== 2) {
    throw new Error("Two independent live simulations are required");
  }
  const transaction = plan.transactions[completed];
  const estimates = simulations.map((simulation) => {
    if (
      normalizeStockPairedHex(simulation.callResult) !==
      normalizeStockPairedHex(simulations[0].callResult)
    ) {
      throw new Error("Independent Mainnet simulations disagree");
    }
    const estimate = BigInt(simulation.estimatedGas);
    if (estimate <= 21_000n) {
      throw new Error("A Mainnet RPC returned an invalid gas estimate");
    }
    return estimate;
  });
  const highEstimate =
    estimates[0] > estimates[1] ? estimates[0] : estimates[1];
  const lowEstimate = estimates[0] < estimates[1] ? estimates[0] : estimates[1];
  if (highEstimate * 100n > lowEstimate * 105n) {
    throw new Error("Independent gas estimates differ by more than 5%");
  }
  const paddedGas =
    (highEstimate * STOCK_PAIRED_GAS_PADDING_BPS + 9_999n) / 10_000n;
  if (paddedGas > BigInt(transaction.reviewedGasLimit)) {
    throw new Error(`${transaction.label} exceeds its reviewed gas ceiling`);
  }
  const cost = stockPairedCostRequirement(plan, state);
  if (!cost.sufficient) {
    throw new Error(
      "The deployment wallet balance is below the six-step gas ceiling",
    );
  }
  const request = {
    from: plan.deployer,
    chainId: STOCK_PAIRED_CHAIN_ID_HEX,
    nonce: transaction.nonce,
    value: "0x0",
    data: transaction.data,
    gas: stockPairedQuantity(paddedGas),
    maxFeePerGas: cost.maxFeePerGas,
    maxPriorityFeePerGas: cost.maxPriorityFeePerGas,
    type: "0x2",
  };
  if (transaction.to) request.to = transaction.to;
  const preparedDigest = digest({
    planDigest: plan.planDigest,
    index: completed,
    request,
  });
  return {
    index: completed,
    field: transaction.field,
    label: transaction.label,
    address: transaction.address,
    calldataHash: transaction.calldataHash,
    liveEstimatedGas: stockPairedQuantity(highEstimate),
    gasLimit: request.gas,
    requiredBalance: cost.requiredBalance,
    preparedDigest,
    request,
  };
}

function normalizedTransaction(transaction) {
  if (!transaction) return null;
  return {
    hash: normalizeStockPairedHex(transaction.hash),
    from: normalizeStockPairedHex(transaction.from),
    to: transaction.to ? normalizeStockPairedHex(transaction.to) : null,
    nonce: stockPairedQuantity(transaction.nonce),
    value: stockPairedQuantity(transaction.value),
    input: normalizeStockPairedHex(transaction.input),
    chainId: transaction.chainId
      ? stockPairedQuantity(transaction.chainId)
      : null,
    gas: stockPairedQuantity(transaction.gas),
    maxFeePerGas: transaction.maxFeePerGas
      ? stockPairedQuantity(transaction.maxFeePerGas)
      : null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? stockPairedQuantity(transaction.maxPriorityFeePerGas)
      : null,
    blockNumber: transaction.blockNumber
      ? stockPairedQuantity(transaction.blockNumber)
      : null,
    blockHash: transaction.blockHash
      ? normalizeStockPairedHex(transaction.blockHash)
      : null,
  };
}

function normalizedReceipt(receipt) {
  if (!receipt) return null;
  return {
    transactionHash: normalizeStockPairedHex(receipt.transactionHash),
    status: stockPairedQuantity(receipt.status),
    from: normalizeStockPairedHex(receipt.from),
    to: receipt.to ? normalizeStockPairedHex(receipt.to) : null,
    contractAddress: receipt.contractAddress
      ? normalizeStockPairedHex(receipt.contractAddress)
      : null,
    blockNumber: stockPairedQuantity(receipt.blockNumber),
    blockHash: normalizeStockPairedHex(receipt.blockHash),
    transactionIndex: stockPairedQuantity(receipt.transactionIndex),
    gasUsed: stockPairedQuantity(receipt.gasUsed),
    effectiveGasPrice: receipt.effectiveGasPrice
      ? stockPairedQuantity(receipt.effectiveGasPrice)
      : null,
  };
}

export function validateStockPairedDeploymentTransactionRecord(
  plan,
  index,
  transaction,
  receipt,
) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= plan.transactions.length
  ) {
    throw new Error("The Stock-Paired transaction index is invalid");
  }
  const expected = plan.transactions[index];
  const actual = normalizedTransaction(transaction);
  if (!actual || !/^0x[0-9a-f]{64}$/.test(actual.hash)) {
    throw new Error("The transaction is not visible on both Mainnet RPCs");
  }
  if (
    actual.from !== normalizeStockPairedHex(plan.deployer) ||
    actual.to !== (expected.to ? normalizeStockPairedHex(expected.to) : null) ||
    actual.nonce !== expected.nonce ||
    actual.value !== "0x0" ||
    actual.input !== normalizeStockPairedHex(expected.data) ||
    actual.chainId !== STOCK_PAIRED_CHAIN_ID_HEX ||
    BigInt(actual.gas) > BigInt(expected.reviewedGasLimit) ||
    actual.maxFeePerGas === null ||
    BigInt(actual.maxFeePerGas) > STOCK_PAIRED_MAX_FEE_PER_GAS_WEI ||
    actual.maxPriorityFeePerGas === null ||
    BigInt(actual.maxPriorityFeePerGas) >
      STOCK_PAIRED_MAX_PRIORITY_FEE_PER_GAS_WEI
  ) {
    throw new Error(
      `${expected.label} does not match the reviewed transaction`,
    );
  }
  const actualReceipt = normalizedReceipt(receipt);
  if (!actualReceipt) {
    return { status: "pending", transaction: actual, receipt: null };
  }
  if (
    actualReceipt.transactionHash !== actual.hash ||
    actualReceipt.status !== "0x1" ||
    actualReceipt.from !== normalizeStockPairedHex(plan.deployer) ||
    actualReceipt.to !==
      (expected.to ? normalizeStockPairedHex(expected.to) : null) ||
    actualReceipt.blockNumber !== actual.blockNumber ||
    actualReceipt.blockHash !== actual.blockHash
  ) {
    throw new Error(`${expected.label} receipt does not match`);
  }
  const expectedContractAddress =
    expected.transactionType === "CREATE"
      ? normalizeStockPairedHex(expected.address)
      : null;
  if (actualReceipt.contractAddress !== expectedContractAddress) {
    throw new Error(`${expected.label} created an unexpected contract address`);
  }
  return {
    status: "confirmed",
    transaction: actual,
    receipt: actualReceipt,
  };
}

export function createStockPairedReleaseEvidence(plan, now = new Date()) {
  return {
    schemaVersion: 1,
    release: plan.release,
    chainId: plan.chainId,
    deployer: plan.deployer,
    treasury: plan.treasury,
    sourceCommitment: plan.sourceCommitment,
    releaseCommit: plan.releaseCommit,
    planDigest: plan.planDigest,
    simulationDigest: plan.simulationDigest,
    startingNonce: plan.startingNonce,
    endingNonce: plan.endingNonce,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    finalityConfirmations: STOCK_PAIRED_FINALITY_CONFIRMATIONS,
    transactions: plan.transactions.map((transaction, index) => ({
      index,
      field: transaction.field,
      address: transaction.address,
      nonce: transaction.nonce,
      calldataHash: transaction.calldataHash,
      reviewedGasLimit: transaction.reviewedGasLimit,
      txHash: null,
      status: "not-submitted",
      confirmations: 0,
      transaction: null,
      receipt: null,
      deploymentVerified: false,
      runtimeCodeHash: null,
    })),
    receiptEvidenceReady: false,
  };
}

export function mergeStockPairedEvidenceRecord(
  evidence,
  plan,
  index,
  record,
  latestBlock,
  deployment,
  now = new Date(),
) {
  if (
    evidence.planDigest !== plan.planDigest ||
    evidence.sourceCommitment !== plan.sourceCommitment
  ) {
    throw new Error("The release evidence belongs to another plan");
  }
  const current = evidence.transactions[index];
  if (
    !current ||
    current.calldataHash !== plan.transactions[index].calldataHash ||
    (current.txHash && current.txHash !== record.transaction.hash)
  ) {
    throw new Error("The release evidence transaction shape drifted");
  }
  let confirmations = 0;
  let status = record.status;
  if (record.receipt) {
    confirmations =
      Number(BigInt(latestBlock) - BigInt(record.receipt.blockNumber)) + 1;
    if (confirmations < 1) {
      throw new Error("The receipt is ahead of the reconciled Mainnet head");
    }
    if (
      confirmations >= STOCK_PAIRED_FINALITY_CONFIRMATIONS &&
      deployment?.verified
    ) {
      status = "finalized";
    }
  }
  evidence.transactions[index] = {
    ...current,
    txHash: record.transaction.hash,
    status,
    confirmations,
    transaction: record.transaction,
    receipt: record.receipt,
    deploymentVerified: Boolean(deployment?.verified),
    runtimeCodeHash: deployment?.runtimeCodeHash ?? null,
  };
  evidence.updatedAt = now.toISOString();
  evidence.receiptEvidenceReady = evidence.transactions.every(
    (entry) =>
      entry.status === "finalized" &&
      entry.deploymentVerified &&
      entry.receipt?.status === "0x1" &&
      /^0x[0-9a-f]{64}$/.test(entry.runtimeCodeHash ?? ""),
  );
  return evidence;
}

export async function readStockPairedReleaseEvidence(filePath, plan) {
  try {
    const evidence = JSON.parse(await readFile(filePath, "utf8"));
    if (
      evidence.schemaVersion !== 1 ||
      evidence.release !== plan.release ||
      evidence.planDigest !== plan.planDigest ||
      evidence.releaseCommit !== plan.releaseCommit ||
      evidence.sourceCommitment !== plan.sourceCommitment ||
      !Array.isArray(evidence.transactions) ||
      evidence.transactions.length !== plan.transactions.length
    ) {
      throw new Error("The local Stock-Paired evidence is for another plan");
    }
    return evidence;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return createStockPairedReleaseEvidence(plan);
    }
    throw error;
  }
}

export async function writeStockPairedReleaseEvidence(filePath, evidence) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, filePath);
}

export function publicStockPairedPlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    release: plan.release,
    network: plan.network,
    chainId: plan.chainId,
    explorer: plan.explorer,
    deployer: plan.deployer,
    treasury: plan.treasury,
    sourceCommitment: plan.sourceCommitment,
    releaseCommit: plan.releaseCommit,
    simulationCommit: plan.simulationCommit,
    simulationTimestamp: plan.simulationTimestamp,
    simulationDigest: plan.simulationDigest,
    planDigest: plan.planDigest,
    startingNonce: plan.startingNonce,
    endingNonce: plan.endingNonce,
    hookSalt: plan.hookSalt,
    reviewedGas: plan.reviewedGas,
    addresses: plan.addresses,
    transactions: plan.transactions.map((transaction) => ({
      index: plan.transactions.indexOf(transaction),
      field: transaction.field,
      label: transaction.label,
      transactionType: transaction.transactionType,
      address: transaction.address,
      to: transaction.to,
      nonce: transaction.nonce,
      value: transaction.value,
      calldataHash: transaction.calldataHash,
      reviewedGasLimit: transaction.reviewedGasLimit,
    })),
  };
}
