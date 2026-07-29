import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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

import {
  STOCK_PAIRED_CHAIN_ID,
  STOCK_PAIRED_CHAIN_ID_HEX,
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_HOOK_ADDRESS_MASK,
  STOCK_PAIRED_MAX_INITCODE_BYTES,
  STOCK_PAIRED_MAX_RUNTIME_BYTES,
  STOCK_PAIRED_REQUIRED_HOOK_FLAGS,
  STOCK_PAIRED_TREASURY,
  normalizeStockPairedHex,
  stockPairedQuantity,
} from "./stock-paired-mainnet-operator-core.mjs";

export const STOCK_PAIRED_V2_DEPENDENCIES = Object.freeze({
  ...STOCK_PAIRED_DEPENDENCIES,
  v3Factory: {
    address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    runtimeCodeHash:
      "0x4d7b8525cd5d14343fa67a732fba5b24cddba11620ca88392f4ec6c52f91fd69",
  },
  v3SwapRouter: {
    address: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    runtimeCodeHash:
      "0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea",
  },
  weth: {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    runtimeCodeHash:
      "0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23",
  },
  usdc: {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    runtimeCodeHash:
      "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505",
  },
});

export const STOCK_PAIRED_V2_ISSUER_RUNTIME = Object.freeze({
  tokenRuntimeCodeHash:
    "0x9806c8207a455c012b2799be651ac0146d54866f92db90b502e5e2efa283bee9",
  beacon: "0x985462C9aA4D6c3Ad59Ae6e1e9c0C11347ED1598",
  beaconRuntimeCodeHash:
    "0xfeff50d5e739b863fc9e0db874d5558375a3e2c81bc20c24923a685263d639bd",
  implementation: "0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250",
  implementationRuntimeCodeHash:
    "0x7480293a8fad3f98f01f39aa59cd4e4c30d7fc4e7019e8f6e691eb5a9be53d11",
  gmTokenManager: "0x2c158BC456e027b2AfFCCadF1BDBD9f5fC4c5C8c",
  gmTokenManagerRuntimeCodeHash:
    "0x6d111c0eae4517448b28f089392aef41d2b865ea8420f504e5d57d238fb8e821",
});

export const STOCK_PAIRED_V2_ASSETS = Object.freeze([
  ["NVDAon", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"],
  ["SPYon", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08"],
  ["GOOGLon", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc"],
  ["SLVon", "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4"],
  ["TSLAon", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f"],
  ["AAPLon", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c"],
  ["BABAon", "0x41765F0FCddC276309195166C7A62AE522FA09ef"],
  ["COPXon", "0x423A63dfE8d82CD9C6568C92210AA537d8Ef6885"],
  ["CRCLon", "0x3632DEa96A953C11dac2f00b4A05a32CD1063fAE"],
  ["TLTon", "0x992651BFeB9A0DCC4457610E284ba66D86489d4d"],
  ["USOon", "0x1F5fc5c3c8B0F15c7E21AF623936FF2b210b6415"],
]);

export const STOCK_PAIRED_V2_STOCK_POOL_FEES = Object.freeze([
  10_000, 3_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
  10_000,
]);

export const STOCK_PAIRED_V2_MANIFEST_PATH =
  "contracts/deployments/mainnet-stock-paired-v2.json";
export const STOCK_PAIRED_V2_DRY_RUN_PATH =
  "contracts/broadcast/DeployMainnetStockPairedInfrastructureV2.s.sol/1/dry-run/run-latest.json";

export const STOCK_PAIRED_V2_RELEASE_PATHS = Object.freeze([
  "config/stock-paired-assets.v1.json",
  "contracts/src/interfaces/IQuoteAssetCreatorFeeHookV1.sol",
  "contracts/src/StockQuoteRegistryV1.sol",
  "contracts/src/StockQuoteRegistryV2.sol",
  "contracts/src/StockPairedPositionPlannerV1.sol",
  "contracts/src/QuoteAssetFeeSplitVaultV1.sol",
  "contracts/src/QuoteAssetFeeSplitVaultFactoryV1.sol",
  "contracts/src/QuoteAssetCreatorFeeHookV1.sol",
  "contracts/src/QuoteAssetCreatorFeeHookFactoryV1.sol",
  "contracts/src/StockPairedLaunchV1.sol",
  "contracts/src/StockPairedEthLaunchCoordinatorV1.sol",
  "contracts/script/DeployMainnetStockPairedInfrastructureV2.s.sol",
  "contracts/test/DeployMainnetStockPairedInfrastructureV2.t.sol",
  "contracts/test/StockQuoteRegistryV2.t.sol",
  "contracts/scripts/test/stock-paired-v2-operator.test.mjs",
  "contracts/deployments/mainnet-stock-paired-v2.json",
  "scripts/stock-paired-mainnet-operator-core.mjs",
  "scripts/stock-paired-v2-mainnet-operator-core.mjs",
  "scripts/serve-stock-paired-mainnet-operator.mjs",
  "package.json",
]);

const artifactPaths = Object.freeze({
  quoteRegistry:
    "contracts/out/StockQuoteRegistryV2.sol/StockQuoteRegistryV2.json",
  positionPlanner:
    "contracts/out/StockPairedPositionPlannerV1.sol/StockPairedPositionPlannerV1.json",
  feeSplitVaultFactory:
    "contracts/out/QuoteAssetFeeSplitVaultFactoryV1.sol/QuoteAssetFeeSplitVaultFactoryV1.json",
  hookFactory:
    "contracts/out/QuoteAssetCreatorFeeHookFactoryV1.sol/QuoteAssetCreatorFeeHookFactoryV1.json",
  feeHook:
    "contracts/out/QuoteAssetCreatorFeeHookV1.sol/QuoteAssetCreatorFeeHookV1.json",
  launcher: "contracts/out/StockPairedLaunchV1.sol/StockPairedLaunchV1.json",
  ethLaunchCoordinator:
    "contracts/out/StockPairedEthLaunchCoordinatorV1.sol/StockPairedEthLaunchCoordinatorV1.json",
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
  "function gmTokenManager() view returns (address)",
  "function expectedTokenCodeHash() view returns (bytes32)",
  "function expectedBeaconCodeHash() view returns (bytes32)",
  "function expectedImplementationCodeHash() view returns (bytes32)",
  "function expectedGMTokenManagerCodeHash() view returns (bytes32)",
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
const coordinatorAbi = parseAbi([
  "function launcher() view returns (address)",
  "function v3SwapRouter() view returns (address)",
  "function v3Factory() view returns (address)",
  "function weth() view returns (address)",
  "function usdc() view returns (address)",
  "function stockPoolFee(address quoteAsset) view returns (uint24)",
]);

function canonicalAddress(value) {
  return getAddress(String(value).toLowerCase());
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "blockTimestamp")
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

function assertArtifactSizeLimits(artifacts) {
  for (const [field, artifact] of Object.entries(artifacts)) {
    const label = String(artifact?.contractName ?? field);
    const creationBytes = (artifactBytecode(artifact, label).length - 2) / 2;
    const runtimeBytes = (artifactRuntime(artifact, label).length - 2) / 2;
    if (creationBytes > STOCK_PAIRED_MAX_INITCODE_BYTES) {
      throw new Error(`${label} creation bytecode exceeds the EIP-3860 limit`);
    }
    if (runtimeBytes > STOCK_PAIRED_MAX_RUNTIME_BYTES) {
      throw new Error(`${label} runtime bytecode exceeds the EIP-170 limit`);
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

function runtimeDescriptor(artifact, label, immutable) {
  const runtime = artifactRuntime(artifact, label);
  return {
    runtimeBytes: (runtime.length - 2) / 2,
    runtimeCodeHash: immutable ? null : keccak256(runtime),
  };
}

export function computeStockPairedV2SourceCommitment(artifacts) {
  const bytecodeCommitment = encodeHashTuple([
    keccak256(
      artifactBytecode(artifacts.quoteRegistry, "StockQuoteRegistryV2"),
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
    keccak256(
      artifactBytecode(
        artifacts.ethLaunchCoordinator,
        "StockPairedEthLaunchCoordinatorV1",
      ),
    ),
  ]);
  const dependency = STOCK_PAIRED_V2_DEPENDENCIES;
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
  const v4RoutingDependencyCommitment = keccak256(
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
  const v3RoutingDependencyCommitment = keccak256(
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
        canonicalAddress(dependency.v3Factory.address),
        dependency.v3Factory.runtimeCodeHash,
        canonicalAddress(dependency.v3SwapRouter.address),
        dependency.v3SwapRouter.runtimeCodeHash,
        canonicalAddress(dependency.weth.address),
        dependency.weth.runtimeCodeHash,
        canonicalAddress(dependency.usdc.address),
        dependency.usdc.runtimeCodeHash,
      ],
    ),
  );
  const routingDependencyCommitment = encodeHashTuple([
    v4RoutingDependencyCommitment,
    v3RoutingDependencyCommitment,
  ]);
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
  const assetAddresses = STOCK_PAIRED_V2_ASSETS.map(([, address]) =>
    canonicalAddress(address),
  );
  const symbolHashes = STOCK_PAIRED_V2_ASSETS.map(([symbol]) =>
    keccak256(stringToHex(symbol)),
  );
  const issuer = STOCK_PAIRED_V2_ISSUER_RUNTIME;
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
        { type: "address" },
        { type: "bytes32" },
      ],
      [
        assetAddresses,
        symbolHashes,
        issuer.tokenRuntimeCodeHash,
        canonicalAddress(issuer.beacon),
        issuer.beaconRuntimeCodeHash,
        canonicalAddress(issuer.implementation),
        issuer.implementationRuntimeCodeHash,
        canonicalAddress(issuer.gmTokenManager),
        issuer.gmTokenManagerRuntimeCodeHash,
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
      stringToHex("programmable.stock-paired.infrastructure.v2.ethereum"),
    ),
    bytecodeCommitment,
    dependencyCommitment,
    assetCommitment,
    economicsCommitment,
  ]);
}

function assertManifestPins(manifest) {
  if (
    manifest?.schemaVersion !== 2 ||
    manifest?.model !== "stock-paired" ||
    manifest?.internalContractRelease !== "stock-paired-v2" ||
    manifest?.chainId !== STOCK_PAIRED_CHAIN_ID ||
    manifest?.candidatePlan?.transactionCount !== 7
  ) {
    throw new Error("The Stock-Paired V2 manifest identity is invalid");
  }
  if (
    normalizeStockPairedHex(manifest.addresses?.treasury) !==
    normalizeStockPairedHex(STOCK_PAIRED_TREASURY)
  ) {
    throw new Error("The Stock-Paired V2 treasury pin drifted");
  }
  for (const [name, expected] of Object.entries(STOCK_PAIRED_V2_DEPENDENCIES)) {
    const actual = manifest.officialDependencies?.[name];
    if (
      normalizeStockPairedHex(actual?.address) !==
        normalizeStockPairedHex(expected.address) ||
      normalizeStockPairedHex(actual?.runtimeCodeHash) !==
        normalizeStockPairedHex(expected.runtimeCodeHash)
    ) {
      throw new Error(`The Stock-Paired V2 dependency pin drifted at ${name}`);
    }
  }
  for (const [field, expected] of Object.entries(
    STOCK_PAIRED_V2_ISSUER_RUNTIME,
  )) {
    if (
      normalizeStockPairedHex(manifest.issuerRuntime?.[field]) !==
      normalizeStockPairedHex(expected)
    ) {
      throw new Error(`The Stock-Paired V2 issuer pin drifted at ${field}`);
    }
  }
  if (
    !Array.isArray(manifest.quoteAssets) ||
    manifest.quoteAssets.length !== STOCK_PAIRED_V2_ASSETS.length ||
    manifest.quoteAssets.some(
      (asset, index) =>
        asset?.symbol !== STOCK_PAIRED_V2_ASSETS[index][0] ||
        normalizeStockPairedHex(asset?.address) !==
          normalizeStockPairedHex(STOCK_PAIRED_V2_ASSETS[index][1]),
    )
  ) {
    throw new Error("The Stock-Paired V2 quote-asset allowlist drifted");
  }
}

function assertCandidateAddress(candidate, field, expected) {
  if (
    normalizeStockPairedHex(candidate?.[field]) !==
    normalizeStockPairedHex(expected)
  ) {
    throw new Error(`The Stock-Paired V2 candidate drifted at ${field}`);
  }
}

export function assertStockPairedV2ReleaseCheckout(root, releaseCommit) {
  if (
    typeof releaseCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(releaseCommit)
  ) {
    throw new Error(
      "A full 40-character Stock-Paired V2 release commit is required",
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
      "The operator checkout is not at the exact Stock-Paired V2 release commit",
    );
  }
  const dirty = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ...STOCK_PAIRED_V2_RELEASE_PATHS,
    ],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (dirty) {
    throw new Error(
      "The Stock-Paired V2 release files have uncommitted changes",
    );
  }
}

export async function loadStockPairedV2ReleasePlan(
  repositoryRoot,
  { releaseCommit = null } = {},
) {
  const root = path.resolve(repositoryRoot);
  if (
    releaseCommit !== null &&
    (typeof releaseCommit !== "string" || !/^[0-9a-f]{40}$/.test(releaseCommit))
  ) {
    throw new Error("The Stock-Paired V2 release commit is invalid");
  }
  const [manifest, dryRun, ...artifactValues] = await Promise.all([
    readFile(path.join(root, STOCK_PAIRED_V2_MANIFEST_PATH), "utf8").then(
      JSON.parse,
    ),
    readFile(path.join(root, STOCK_PAIRED_V2_DRY_RUN_PATH), "utf8").then(
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
  assertArtifactSizeLimits(artifacts);
  assertManifestPins(manifest);
  const sourceCommitment = computeStockPairedV2SourceCommitment(artifacts);
  if (normalizeStockPairedHex(manifest.sourceCommitment) !== sourceCommitment) {
    throw new Error(
      "The Stock-Paired V2 artifacts do not match the manifest source commitment",
    );
  }
  if (
    dryRun.chain !== STOCK_PAIRED_CHAIN_ID ||
    !Array.isArray(dryRun.transactions) ||
    dryRun.transactions.length !== 7 ||
    !Array.isArray(dryRun.receipts) ||
    dryRun.receipts.length !== 0 ||
    !Array.isArray(dryRun.pending) ||
    dryRun.pending.length !== 0 ||
    dryRun.transactions.some((entry) => entry.hash !== null)
  ) {
    throw new Error(
      "The Stock-Paired V2 plan must be a seven-step, unbroadcast Mainnet simulation",
    );
  }
  if (
    releaseCommit !== null &&
    String(dryRun.commit ?? "") !== releaseCommit.slice(0, 7)
  ) {
    throw new Error(
      "The Stock-Paired V2 simulation is not bound to the release commit",
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
    "CREATE",
  ];
  const expectedContracts = [
    "StockQuoteRegistryV2",
    "StockPairedPositionPlannerV1",
    "QuoteAssetFeeSplitVaultFactoryV1",
    "QuoteAssetCreatorFeeHookFactoryV1",
    "QuoteAssetCreatorFeeHookFactoryV1",
    "StockPairedLaunchV1",
    "StockPairedEthLaunchCoordinatorV1",
  ];
  const startingNonce = Number(BigInt(entries[0]?.transaction?.nonce));
  if (!Number.isSafeInteger(startingNonce) || startingNonce < 0) {
    throw new Error("The Stock-Paired V2 starting nonce is invalid");
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
        `The Stock-Paired V2 simulation drifted at step ${index + 1}`,
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
    coordinatorEntry,
  ] = entries;
  const quoteRegistry = canonicalAddress(registryEntry.contractAddress);
  const positionPlanner = canonicalAddress(plannerEntry.contractAddress);
  const feeSplitVaultFactory = canonicalAddress(
    vaultFactoryEntry.contractAddress,
  );
  const hookFactory = canonicalAddress(hookFactoryEntry.contractAddress);
  const feeHook = canonicalAddress(hookEntry.additionalContracts?.[0]?.address);
  const launcher = canonicalAddress(launcherEntry.contractAddress);
  const ethLaunchCoordinator = canonicalAddress(
    coordinatorEntry.contractAddress,
  );
  const createOffsets = [0, 1, 2, 3, 5, 6];
  const createAddresses = createOffsets.map((offset) =>
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
    ethLaunchCoordinator,
  ].forEach((actual, index) => {
    if (
      normalizeStockPairedHex(actual) !==
      normalizeStockPairedHex(createAddresses[index])
    ) {
      throw new Error("A Stock-Paired V2 CREATE address prediction drifted");
    }
  });

  const candidate = manifest.candidatePlan;
  if (candidate?.startingNonce !== startingNonce) {
    throw new Error("The Stock-Paired V2 candidate nonce drifted");
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
  assertCandidateAddress(
    candidate,
    "ethLaunchCoordinator",
    ethLaunchCoordinator,
  );
  const hookSalt = String(candidate.hookSalt ?? "");
  if (!/^0x[0-9a-f]{64}$/i.test(hookSalt) || BigInt(hookSalt) === 0n) {
    throw new Error("The Stock-Paired V2 hook salt is invalid");
  }

  const assetAddresses = STOCK_PAIRED_V2_ASSETS.map(([, address]) =>
    canonicalAddress(address),
  );
  const symbolHashes = STOCK_PAIRED_V2_ASSETS.map(([symbol]) =>
    keccak256(stringToHex(symbol)),
  );
  const issuer = STOCK_PAIRED_V2_ISSUER_RUNTIME;
  const registryConstructor = encodeAbiParameters(
    [
      { type: "address[]" },
      { type: "bytes32[]" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [
      assetAddresses,
      symbolHashes,
      canonicalAddress(issuer.beacon),
      canonicalAddress(issuer.implementation),
      canonicalAddress(issuer.gmTokenManager),
      issuer.tokenRuntimeCodeHash,
      issuer.beaconRuntimeCodeHash,
      issuer.implementationRuntimeCodeHash,
      issuer.gmTokenManagerRuntimeCodeHash,
    ],
  );
  const expectedRegistryInput =
    artifactBytecode(artifacts.quoteRegistry, "StockQuoteRegistryV2") +
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
          `Stock-Paired V2 creation bytecode drifted at step ${index + 1}`,
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
    throw new Error("The Stock-Paired V2 CREATE2 hook shape drifted");
  }
  const expectedHookCall = encodeFunctionData({
    abi: hookFactoryAbi,
    functionName: "deploy",
    args: [
      hookSalt,
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.poolManager.address),
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
    throw new Error("The Stock-Paired V2 hook deployment calldata drifted");
  }
  const hookConstructor = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
    [
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.poolManager.address),
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
    throw new Error("The Stock-Paired V2 hook CREATE2 commitment drifted");
  }

  const launcherConstructor = encodeAbiParameters(
    Array.from({ length: 8 }, () => ({ type: "address" })),
    [
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.poolManager.address),
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.positionManager.address),
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.uerc20Factory.address),
      feeHook,
      quoteRegistry,
      positionPlanner,
      feeSplitVaultFactory,
      canonicalAddress(
        STOCK_PAIRED_V2_DEPENDENCIES.positionForwarderFactory.address,
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
      "The Stock-Paired V2 launcher bytecode or constructor arguments drifted",
    );
  }

  const coordinatorConstructor = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address[]" },
      { type: "uint24[]" },
    ],
    [
      launcher,
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.v3SwapRouter.address),
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.v3Factory.address),
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.weth.address),
      canonicalAddress(STOCK_PAIRED_V2_DEPENDENCIES.usdc.address),
      assetAddresses,
      STOCK_PAIRED_V2_STOCK_POOL_FEES,
    ],
  );
  const expectedCoordinatorInput =
    artifactBytecode(
      artifacts.ethLaunchCoordinator,
      "StockPairedEthLaunchCoordinatorV1",
    ) + coordinatorConstructor.slice(2);
  if (
    normalizeStockPairedHex(coordinatorEntry.transaction.input) !==
    normalizeStockPairedHex(expectedCoordinatorInput)
  ) {
    throw new Error(
      "The Stock-Paired V2 coordinator bytecode or constructor arguments drifted",
    );
  }

  const returnValue = String(dryRun?.returns?.result?.value ?? "");
  if (
    !returnValue.toLowerCase().includes(sourceCommitment.slice(2)) ||
    !returnValue.toLowerCase().includes(hookSalt.slice(2).toLowerCase())
  ) {
    throw new Error(
      "The Stock-Paired V2 simulation result omits its reviewed commitments",
    );
  }

  const runtime = {
    quoteRegistry: runtimeDescriptor(
      artifacts.quoteRegistry,
      "StockQuoteRegistryV2",
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
    ethLaunchCoordinator: runtimeDescriptor(
      artifacts.ethLaunchCoordinator,
      "StockPairedEthLaunchCoordinatorV1",
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
        "Eleven-asset quote registry",
        quoteRegistry,
      ),
      checks: [
        callCheck(
          "asset count",
          quoteRegistry,
          registryAbi,
          "assetCount",
          uintResult(11),
        ),
        callCheck(
          "issuer beacon",
          quoteRegistry,
          registryAbi,
          "beacon",
          addressResult(issuer.beacon),
        ),
        callCheck(
          "issuer implementation",
          quoteRegistry,
          registryAbi,
          "reviewedImplementation",
          addressResult(issuer.implementation),
        ),
        callCheck(
          "issuer manager",
          quoteRegistry,
          registryAbi,
          "gmTokenManager",
          addressResult(issuer.gmTokenManager),
        ),
        callCheck(
          "quote token runtime",
          quoteRegistry,
          registryAbi,
          "expectedTokenCodeHash",
          bytes32Result(issuer.tokenRuntimeCodeHash),
        ),
        callCheck(
          "issuer beacon runtime",
          quoteRegistry,
          registryAbi,
          "expectedBeaconCodeHash",
          bytes32Result(issuer.beaconRuntimeCodeHash),
        ),
        callCheck(
          "issuer implementation runtime",
          quoteRegistry,
          registryAbi,
          "expectedImplementationCodeHash",
          bytes32Result(issuer.implementationRuntimeCodeHash),
        ),
        callCheck(
          "issuer manager runtime",
          quoteRegistry,
          registryAbi,
          "expectedGMTokenManagerCodeHash",
          bytes32Result(issuer.gmTokenManagerRuntimeCodeHash),
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
          addressResult(STOCK_PAIRED_V2_DEPENDENCIES.poolManager.address),
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
          addressResult(STOCK_PAIRED_V2_DEPENDENCIES.poolManager.address),
        ),
        callCheck(
          "PositionManager",
          launcher,
          launcherAbi,
          "positionManager",
          addressResult(STOCK_PAIRED_V2_DEPENDENCIES.positionManager.address),
        ),
        callCheck(
          "UERC20 factory",
          launcher,
          launcherAbi,
          "tokenFactory",
          addressResult(STOCK_PAIRED_V2_DEPENDENCIES.uerc20Factory.address),
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
            STOCK_PAIRED_V2_DEPENDENCIES.positionForwarderFactory.address,
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
    {
      ...baseTransaction(
        coordinatorEntry,
        "ethLaunchCoordinator",
        "ETH launch coordinator",
        ethLaunchCoordinator,
      ),
      checks: [
        callCheck(
          "launcher",
          ethLaunchCoordinator,
          coordinatorAbi,
          "launcher",
          addressResult(launcher),
        ),
        callCheck(
          "V3 SwapRouter",
          ethLaunchCoordinator,
          coordinatorAbi,
          "v3SwapRouter",
          addressResult(STOCK_PAIRED_V2_DEPENDENCIES.v3SwapRouter.address),
        ),
        callCheck(
          "V3 factory",
          ethLaunchCoordinator,
          coordinatorAbi,
          "v3Factory",
          addressResult(STOCK_PAIRED_V2_DEPENDENCIES.v3Factory.address),
        ),
        callCheck(
          "WETH",
          ethLaunchCoordinator,
          coordinatorAbi,
          "weth",
          addressResult(STOCK_PAIRED_V2_DEPENDENCIES.weth.address),
        ),
        callCheck(
          "USDC",
          ethLaunchCoordinator,
          coordinatorAbi,
          "usdc",
          addressResult(STOCK_PAIRED_V2_DEPENDENCIES.usdc.address),
        ),
        ...assetAddresses.map((asset, index) =>
          callCheck(
            `asset ${index + 1} route fee`,
            ethLaunchCoordinator,
            coordinatorAbi,
            "stockPoolFee",
            uintResult(STOCK_PAIRED_V2_STOCK_POOL_FEES[index], "uint24"),
            [asset],
          ),
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
    throw new Error("The Stock-Paired V2 reviewed gas commitment drifted");
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
      runtimeBytes: transaction.runtimeBytes,
      runtimeCodeHash: transaction.runtimeCodeHash,
      checks: transaction.checks,
    })),
  };
  return {
    schemaVersion: 2,
    release: "stock-paired-v2",
    network: "Ethereum Mainnet",
    chainId: STOCK_PAIRED_CHAIN_ID,
    explorer: "https://etherscan.io",
    deployer: canonicalAddress(STOCK_PAIRED_DEPLOYER),
    treasury: canonicalAddress(STOCK_PAIRED_TREASURY),
    sourceCommitment,
    releaseCommit,
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
      ethLaunchCoordinator,
    },
    transactions,
  };
}
