import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { encodeAbiParameters, getAddress, keccak256, stringToHex } from "viem";

import {
  STOCK_PAIRED_V2_ASSETS,
  STOCK_PAIRED_V2_DEPENDENCIES,
  STOCK_PAIRED_V2_ISSUER_RUNTIME,
  STOCK_PAIRED_V2_MANIFEST_PATH,
  STOCK_PAIRED_V2_RELEASE_PATHS,
  STOCK_PAIRED_V2_STOCK_POOL_FEES,
} from "../../scripts/stock-paired-v2-mainnet-operator-core.mjs";

export const STOCK_PAIRED_V2_COMPILER_VERSION = "v0.8.26+commit.8a97fa7a";

export const STOCK_PAIRED_V2_SOURCE_ARTIFACTS = Object.freeze({
  quoteRegistry: Object.freeze({
    fqcn: "src/StockQuoteRegistryV2.sol:StockQuoteRegistryV2",
    contractName: "StockQuoteRegistryV2",
    expectedSourceCount: 4,
  }),
  positionPlanner: Object.freeze({
    fqcn: "src/StockPairedPositionPlannerV1.sol:StockPairedPositionPlannerV1",
    contractName: "StockPairedPositionPlannerV1",
    expectedSourceCount: 32,
  }),
  feeSplitVaultFactory: Object.freeze({
    fqcn: "src/QuoteAssetFeeSplitVaultFactoryV1.sol:QuoteAssetFeeSplitVaultFactoryV1",
    contractName: "QuoteAssetFeeSplitVaultFactoryV1",
    expectedSourceCount: 29,
  }),
  hookFactory: Object.freeze({
    fqcn: "src/QuoteAssetCreatorFeeHookFactoryV1.sol:QuoteAssetCreatorFeeHookFactoryV1",
    contractName: "QuoteAssetCreatorFeeHookFactoryV1",
    expectedSourceCount: 43,
  }),
  feeHook: Object.freeze({
    fqcn: "src/QuoteAssetCreatorFeeHookV1.sol:QuoteAssetCreatorFeeHookV1",
    contractName: "QuoteAssetCreatorFeeHookV1",
    expectedSourceCount: 42,
  }),
  launcher: Object.freeze({
    fqcn: "src/StockPairedLaunchV1.sol:StockPairedLaunchV1",
    contractName: "StockPairedLaunchV1",
    expectedSourceCount: 98,
  }),
  ethLaunchCoordinator: Object.freeze({
    fqcn: "src/StockPairedEthLaunchCoordinatorV1.sol:StockPairedEthLaunchCoordinatorV1",
    contractName: "StockPairedEthLaunchCoordinatorV1",
    expectedSourceCount: 99,
  }),
});

export const STOCK_PAIRED_V2_SOURCE_FIELDS = Object.freeze(
  Object.keys(STOCK_PAIRED_V2_SOURCE_ARTIFACTS),
);

export const STOCK_PAIRED_V2_IMMUTABLE_RELEASE_PATHS = Object.freeze(
  STOCK_PAIRED_V2_RELEASE_PATHS.filter(
    (file) => file !== STOCK_PAIRED_V2_MANIFEST_PATH,
  ),
);

const DEPENDENCY_COMMITS = Object.freeze({
  "liquidity-launcher": "e4660afe4f820f4a39181c7ea1f9bce6c423499f",
  "continuous-clearing-auction": "6c9e559e63a7a141a4fe4bd5aa0f47fee1354b58",
  "openzeppelin-uniswap-hooks": "26dc8e53f812a1ca390d470342adb6cd8c3286ad",
  "v4-core": "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
  "v4-periphery": "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
  "openzeppelin-contracts": "21c8312b022f495ebe3621d5daeed20552b43ff9",
  "forge-std": "3b20d60d14b343ee4f908cb8079495c07f5e8981",
  permit2: "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219",
  solady: "33b4b98e350bbcba6aa85642957c313e98b5f911",
  "uerc20-factory": "6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68",
  blocknumberish: "38fe20bc0341d5bc2780d41f90dadb70e10f8cea",
  solmate: "4b47a19038b798b4a33d9749d25e570443520647",
});

function canonicalAddress(value) {
  return getAddress(value);
}

export function stockPairedV2ConstructorArguments(plan) {
  const assets = STOCK_PAIRED_V2_ASSETS.map(([, address]) =>
    canonicalAddress(address),
  );
  const symbols = STOCK_PAIRED_V2_ASSETS.map(([symbol]) =>
    keccak256(stringToHex(symbol)),
  );
  const issuer = STOCK_PAIRED_V2_ISSUER_RUNTIME;
  const dependencies = STOCK_PAIRED_V2_DEPENDENCIES;

  return {
    quoteRegistry: encodeAbiParameters(
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
        assets,
        symbols,
        canonicalAddress(issuer.beacon),
        canonicalAddress(issuer.implementation),
        canonicalAddress(issuer.gmTokenManager),
        issuer.tokenRuntimeCodeHash,
        issuer.beaconRuntimeCodeHash,
        issuer.implementationRuntimeCodeHash,
        issuer.gmTokenManagerRuntimeCodeHash,
      ],
    ),
    positionPlanner: "0x",
    feeSplitVaultFactory: "0x",
    hookFactory: "0x",
    feeHook: encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
      ],
      [
        canonicalAddress(dependencies.poolManager.address),
        canonicalAddress(plan.treasury),
        canonicalAddress(plan.addresses.quoteRegistry),
        canonicalAddress(plan.addresses.feeSplitVaultFactory),
      ],
    ),
    launcher: encodeAbiParameters(
      Array.from({ length: 8 }, () => ({ type: "address" })),
      [
        canonicalAddress(dependencies.poolManager.address),
        canonicalAddress(dependencies.positionManager.address),
        canonicalAddress(dependencies.uerc20Factory.address),
        canonicalAddress(plan.addresses.feeHook),
        canonicalAddress(plan.addresses.quoteRegistry),
        canonicalAddress(plan.addresses.positionPlanner),
        canonicalAddress(plan.addresses.feeSplitVaultFactory),
        canonicalAddress(dependencies.positionForwarderFactory.address),
      ],
    ),
    ethLaunchCoordinator: encodeAbiParameters(
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
        canonicalAddress(plan.addresses.launcher),
        canonicalAddress(dependencies.v3SwapRouter.address),
        canonicalAddress(dependencies.v3Factory.address),
        canonicalAddress(dependencies.weth.address),
        canonicalAddress(dependencies.usdc.address),
        assets,
        STOCK_PAIRED_V2_STOCK_POOL_FEES,
      ],
    ),
  };
}

export function stockPairedV2SourceRecords(plan) {
  const constructorArguments = stockPairedV2ConstructorArguments(plan);
  return STOCK_PAIRED_V2_SOURCE_FIELDS.map((field) => {
    const artifact = STOCK_PAIRED_V2_SOURCE_ARTIFACTS[field];
    const encodedConstructorArguments = constructorArguments[field];
    return {
      field,
      address: canonicalAddress(plan.addresses[field]),
      ...artifact,
      encodedConstructorArguments,
      constructorArgumentBytes: (encodedConstructorArguments.length - 2) / 2,
      constructorArgumentHash: keccak256(encodedConstructorArguments),
    };
  });
}

export function stockPairedV2SourceVerificationComplete(sourceVerification) {
  return (
    sourceVerification?.status === "verified" &&
    STOCK_PAIRED_V2_SOURCE_FIELDS.every(
      (field) =>
        sourceVerification?.[field]?.status === "verified" &&
        sourceVerification[field]?.etherscan?.status === "exact-match" &&
        sourceVerification[field]?.sourcify?.status === "match" &&
        sourceVerification[field]?.sourcify?.creationMatch === "match" &&
        sourceVerification[field]?.sourcify?.runtimeMatch === "match",
    )
  );
}

export function stockPairedV2ForgeArguments(
  record,
  verifier,
  etherscanApiKey = null,
) {
  if (!["etherscan", "sourcify"].includes(verifier)) {
    throw new Error("Unsupported source verifier");
  }
  const values = [
    "verify-contract",
    "--watch",
    "--chain",
    "1",
    "--compiler-version",
    "0.8.26",
    "--num-of-optimizations",
    "1000",
    "--evm-version",
    "cancun",
    "--verifier",
    verifier,
  ];
  if (record.encodedConstructorArguments !== "0x") {
    values.push("--constructor-args", record.encodedConstructorArguments);
  }
  if (verifier === "etherscan") {
    if (!etherscanApiKey?.trim()) {
      throw new Error("ETHERSCAN_API_KEY is required for Etherscan submission");
    }
    values.push(
      "--skip-is-verified-check",
      "--etherscan-api-key",
      etherscanApiKey.trim(),
    );
  }
  values.push(record.address, record.fqcn);
  return values;
}

function checkedGit(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

export function assertStockPairedV2ReleaseSnapshot(
  repositoryRoot,
  releaseCommit,
) {
  if (!/^[0-9a-f]{40}$/.test(releaseCommit ?? "")) {
    throw new Error("The Stock-Paired V2 release commit is invalid");
  }
  checkedGit(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${releaseCommit}^{commit}`,
  ]);
  assertStockPairedV2ReleasePaths(
    repositoryRoot,
    releaseCommit,
    STOCK_PAIRED_V2_IMMUTABLE_RELEASE_PATHS,
  );
}

export function assertStockPairedV2ReleasePaths(
  repositoryRoot,
  releaseCommit,
  releasePaths,
) {
  for (const file of releasePaths) {
    const expected = checkedGit(repositoryRoot, [
      "rev-parse",
      `${releaseCommit}:${file}`,
    ]);
    const actual = checkedGit(repositoryRoot, ["hash-object", file]);
    if (actual !== expected) {
      throw new Error(
        `The deployed Stock-Paired V2 release file drifted: ${file}`,
      );
    }
  }
}

export function assertStockPairedV2DependencyTree(contractsRoot) {
  const libRoot = path.join(contractsRoot, "lib");
  try {
    statSync(libRoot);
  } catch {
    throw new Error(
      "The pinned contract dependencies are absent. Run npm run contracts:bootstrap before source review.",
    );
  }
  for (const [name, expected] of Object.entries(DEPENDENCY_COMMITS)) {
    const dependencyRoot = path.join(libRoot, name);
    let actual;
    try {
      actual = checkedGit(dependencyRoot, ["rev-parse", "HEAD"]);
    } catch {
      throw new Error(`The pinned dependency is unavailable: ${name}`);
    }
    if (actual !== expected) {
      throw new Error(
        `${name} is at ${actual}; expected pinned commit ${expected}`,
      );
    }
    if (
      checkedGit(dependencyRoot, [
        "status",
        "--porcelain",
        "--untracked-files=no",
      ])
    ) {
      throw new Error(`The pinned dependency has tracked changes: ${name}`);
    }
  }
}

function unsafeSourcePath(sourcePath) {
  const normalized = sourcePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return (
    path.isAbsolute(sourcePath) ||
    segments.includes("..") ||
    normalized.toLowerCase().includes("/users/") ||
    normalized.toLowerCase().startsWith("users/") ||
    normalized.toLowerCase().includes("/private/") ||
    normalized.toLowerCase().startsWith("private/")
  );
}

export function stockPairedV2VerificationEnvironment(
  contractsRoot,
  environment = process.env,
) {
  const remappings = readFileSync(
    path.join(contractsRoot, "remappings.txt"),
    "utf8",
  )
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  for (const remapping of remappings) {
    const prefix = remapping.split("=")[0];
    const target = remapping.split("=").slice(1).join("=");
    if (
      !prefix ||
      unsafeSourcePath(prefix) ||
      !target ||
      unsafeSourcePath(target)
    ) {
      throw new Error("The verification remappings contain an unsafe path");
    }
  }
  return {
    ...environment,
    FOUNDRY_AUTO_DETECT_REMAPPINGS: "false",
    FOUNDRY_REMAPPINGS: remappings.join("\n"),
  };
}

export function assertStockPairedV2StandardJson(record, input) {
  if (
    input?.language !== "Solidity" ||
    input.settings?.optimizer?.enabled !== true ||
    input.settings?.optimizer?.runs !== 1000 ||
    input.settings?.evmVersion !== "cancun" ||
    input.settings?.metadata?.bytecodeHash !== "none" ||
    input.settings?.metadata?.appendCBOR !== false ||
    input.settings?.viaIR !== false
  ) {
    throw new Error(`${record.field} compiler settings drifted`);
  }
  const sources = input.sources;
  if (
    !sources ||
    Object.keys(sources).length !== record.expectedSourceCount ||
    !sources[record.fqcn.split(":")[0]]
  ) {
    throw new Error(`${record.field} source graph is incomplete`);
  }
  for (const [sourcePath, source] of Object.entries(sources)) {
    if (
      unsafeSourcePath(sourcePath) ||
      typeof source?.content !== "string" ||
      source.content.length === 0
    ) {
      throw new Error(
        `${record.field} contains an unsafe or empty source path: ${sourcePath}`,
      );
    }
  }
  for (const remapping of input.settings?.remappings ?? []) {
    const value = String(remapping);
    const prefix = value.split("=")[0];
    const target = value.split("=").slice(1).join("=");
    if (
      !prefix ||
      unsafeSourcePath(prefix) ||
      !target ||
      unsafeSourcePath(target)
    ) {
      throw new Error(`${record.field} contains an unsafe source remapping`);
    }
  }
  return input;
}

export function stockPairedV2PublicLifecycleVerified(manifest) {
  const lifecycle = manifest?.lifecycleEvidence;
  return (
    lifecycle?.status === "verified-current-release" &&
    lifecycle.publicMainnetCanaryVerified === true &&
    lifecycle.deploymentTransactionsVerified === true &&
    lifecycle.runtimeBindingsVerified === true &&
    lifecycle.ethCoordinatorDeploymentVerified === true &&
    /^0x[0-9a-f]{64}$/i.test(lifecycle.canaryLaunchTransaction ?? "") &&
    lifecycle.positionLockVerified === true &&
    lifecycle.buyAndSellVerified === true &&
    lifecycle.ethFirstLaunchVerified === true &&
    lifecycle.ethBuyAndSellVerified === true &&
    lifecycle.creatorClaimVerified === true &&
    lifecycle.launcherClaimVerified === true
  );
}
