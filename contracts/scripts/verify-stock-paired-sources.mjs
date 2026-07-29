#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { encodeAbiParameters, getAddress, keccak256, stringToHex } from "viem";

import {
  STOCK_PAIRED_ASSETS,
  STOCK_PAIRED_ISSUER_RUNTIME,
  STOCK_PAIRED_MANIFEST_PATH,
  assertStockPairedReleaseCheckout,
  loadStockPairedReleasePlan,
} from "../../scripts/stock-paired-mainnet-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const contractsRoot = path.join(root, "contracts");
const manifestPath = path.join(root, STOCK_PAIRED_MANIFEST_PATH);
const releaseCommit = process.env.STOCK_PAIRED_RELEASE_COMMIT?.trim() || null;
const submit = process.argv.includes("--submit");
const capture = process.argv.includes("--capture");
const write = process.argv.includes("--write");
const compilerVersion = "v0.8.26+commit.8a97fa7a";
const fields = [
  "quoteRegistry",
  "positionPlanner",
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
  "launcher",
];
const artifacts = {
  quoteRegistry: {
    fqcn: "src/StockQuoteRegistryV1.sol:StockQuoteRegistryV1",
    contractName: "StockQuoteRegistryV1",
  },
  positionPlanner: {
    fqcn: "src/StockPairedPositionPlannerV1.sol:StockPairedPositionPlannerV1",
    contractName: "StockPairedPositionPlannerV1",
  },
  feeSplitVaultFactory: {
    fqcn: "src/QuoteAssetFeeSplitVaultFactoryV1.sol:QuoteAssetFeeSplitVaultFactoryV1",
    contractName: "QuoteAssetFeeSplitVaultFactoryV1",
  },
  hookFactory: {
    fqcn: "src/QuoteAssetCreatorFeeHookFactoryV1.sol:QuoteAssetCreatorFeeHookFactoryV1",
    contractName: "QuoteAssetCreatorFeeHookFactoryV1",
  },
  feeHook: {
    fqcn: "src/QuoteAssetCreatorFeeHookV1.sol:QuoteAssetCreatorFeeHookV1",
    contractName: "QuoteAssetCreatorFeeHookV1",
  },
  launcher: {
    fqcn: "src/StockPairedLaunchV1.sol:StockPairedLaunchV1",
    contractName: "StockPairedLaunchV1",
  },
};

function constructorArguments(plan) {
  const assets = STOCK_PAIRED_ASSETS.map(([, address]) => getAddress(address));
  const symbols = STOCK_PAIRED_ASSETS.map(([symbol]) =>
    keccak256(stringToHex(symbol)),
  );
  return {
    quoteRegistry: encodeAbiParameters(
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
        assets,
        symbols,
        getAddress(STOCK_PAIRED_ISSUER_RUNTIME.beacon),
        getAddress(STOCK_PAIRED_ISSUER_RUNTIME.implementation),
        STOCK_PAIRED_ISSUER_RUNTIME.tokenRuntimeCodeHash,
        STOCK_PAIRED_ISSUER_RUNTIME.beaconRuntimeCodeHash,
        STOCK_PAIRED_ISSUER_RUNTIME.implementationRuntimeCodeHash,
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
        getAddress("0x000000000004444c5dc75cB358380D2e3dE08A90"),
        getAddress(plan.treasury),
        getAddress(plan.addresses.quoteRegistry),
        getAddress(plan.addresses.feeSplitVaultFactory),
      ],
    ),
    launcher: encodeAbiParameters(
      Array.from({ length: 8 }, () => ({ type: "address" })),
      [
        getAddress("0x000000000004444c5dc75cB358380D2e3dE08A90"),
        getAddress("0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e"),
        getAddress("0x000000e200088D55C39a11F609E5F667729ad49b"),
        getAddress(plan.addresses.feeHook),
        getAddress(plan.addresses.quoteRegistry),
        getAddress(plan.addresses.positionPlanner),
        getAddress(plan.addresses.feeSplitVaultFactory),
        getAddress("0x291a9ff1059d225d02B1659430804486404dB507"),
      ],
    ),
  };
}

function forgeArguments(field, address, encodedArguments, verifier) {
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
  if (encodedArguments !== "0x") {
    values.push("--constructor-args", encodedArguments);
  }
  if (verifier === "etherscan") {
    const key = process.env.ETHERSCAN_API_KEY?.trim();
    if (!key) {
      throw new Error("ETHERSCAN_API_KEY is required for Etherscan submission");
    }
    values.push("--etherscan-api-key", key);
  }
  values.push(address, artifacts[field].fqcn);
  return values;
}

function standardJson(field) {
  const output = execFileSync(
    "forge",
    [
      "verify-contract",
      "--show-standard-json-input",
      "0x1111111111111111111111111111111111111111",
      artifacts[field].fqcn,
    ],
    {
      cwd: contractsRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return JSON.parse(output);
}

function parseEtherscanSource(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Etherscan returned no source");
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    return JSON.parse(trimmed.slice(1, -1));
  }
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (parsed.language && parsed.sources) return parsed;
  }
  throw new Error("Etherscan did not return standard-json source");
}

function assertSourceInput(field, remoteSource) {
  const local = standardJson(field);
  const remote = parseEtherscanSource(remoteSource);
  if (
    remote.language !== local.language ||
    remote.settings?.optimizer?.enabled !== true ||
    remote.settings?.optimizer?.runs !== 1000 ||
    remote.settings?.evmVersion !== "cancun" ||
    remote.settings?.metadata?.bytecodeHash !== "none" ||
    remote.settings?.metadata?.appendCBOR !== false
  ) {
    throw new Error(`${field} compiler settings do not match`);
  }
  for (const [sourcePath, source] of Object.entries(local.sources)) {
    if (
      typeof source?.content !== "string" ||
      remote.sources?.[sourcePath]?.content !== source.content
    ) {
      throw new Error(`${field} source differs at ${sourcePath}`);
    }
  }
}

async function etherscanRecord(field, address, encodedArguments) {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (!key) {
    throw new Error("ETHERSCAN_API_KEY is required for source capture");
  }
  const query = new URL("https://api.etherscan.io/v2/api");
  query.searchParams.set("chainid", "1");
  query.searchParams.set("module", "contract");
  query.searchParams.set("action", "getsourcecode");
  query.searchParams.set("address", address);
  query.searchParams.set("apikey", key);
  const response = await fetch(query, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Etherscan returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  const source = payload?.result?.[0];
  if (
    payload?.status !== "1" ||
    source?.ContractName !== artifacts[field].contractName ||
    source?.CompilerVersion !== compilerVersion ||
    source?.OptimizationUsed !== "1" ||
    source?.Runs !== "1000" ||
    source?.EVMVersion !== "cancun" ||
    source?.Proxy !== "0" ||
    source?.Implementation !== "" ||
    (source?.ConstructorArguments ?? "").toLowerCase() !==
      encodedArguments.slice(2).toLowerCase()
  ) {
    throw new Error(`${field} Etherscan metadata does not match`);
  }
  assertSourceInput(field, source.SourceCode);
  return {
    status: "exact-match",
    url: `https://etherscan.io/address/${address}#code`,
  };
}

async function sourcifyRecord(field, address) {
  const url = `https://sourcify.dev/server/v2/contract/1/${address}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${field} Sourcify returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.match !== "match") {
    throw new Error(`${field} is not a Sourcify match`);
  }
  return { status: "match", url };
}

function lifecycleVerified(manifest) {
  const lifecycle = manifest.lifecycleEvidence;
  return (
    lifecycle?.status === "verified-current-release" &&
    lifecycle.deploymentTransactionsVerified === true &&
    lifecycle.runtimeBindingsVerified === true &&
    /^0x[0-9a-f]{64}$/i.test(lifecycle.canaryLaunchTransaction ?? "") &&
    lifecycle.positionLockVerified === true &&
    lifecycle.buyAndSellVerified === true &&
    lifecycle.creatorClaimVerified === true &&
    lifecycle.launcherClaimVerified === true
  );
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function main() {
  if (submit && capture) {
    throw new Error("Choose either --submit or --capture");
  }
  assertStockPairedReleaseCheckout(root, releaseCommit);
  const plan = await loadStockPairedReleasePlan(root, { releaseCommit });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.releaseCommit !== releaseCommit ||
    manifest.sourceCommitment !== plan.sourceCommitment ||
    !String(manifest.status ?? "").startsWith("deployed-")
  ) {
    throw new Error("Capture the deployed infrastructure before verification");
  }
  const constructorArgs = constructorArguments(plan);
  if (submit) {
    for (const field of fields) {
      const address = manifest.addresses[field];
      for (const verifier of ["etherscan", "sourcify"]) {
        const result = spawnSync(
          "forge",
          forgeArguments(field, address, constructorArgs[field], verifier),
          {
            cwd: contractsRoot,
            encoding: "utf8",
            stdio: "inherit",
          },
        );
        if (result.status !== 0) {
          throw new Error(
            `${field} ${verifier} verification submission failed`,
          );
        }
      }
    }
    console.log("All six source-verification submissions completed.");
    return;
  }
  if (!capture) {
    console.log(
      JSON.stringify(
        {
          mode: "review",
          externalAction: false,
          releaseCommit,
          contracts: fields.map((field) => ({
            field,
            address: manifest.addresses[field],
            fqcn: artifacts[field].fqcn,
            encodedConstructorArguments: constructorArgs[field],
          })),
          next: "Use --submit only after explicit approval, then --capture --write.",
        },
        null,
        2,
      ),
    );
    return;
  }
  const sourceVerification = {
    ...manifest.sourceVerification,
    status: "verified",
  };
  for (const field of fields) {
    const address = manifest.addresses[field];
    const [etherscan, sourcify] = await Promise.all([
      etherscanRecord(field, address, constructorArgs[field]),
      sourcifyRecord(field, address),
    ]);
    sourceVerification[field] = {
      status: "verified",
      encodedConstructorArguments: constructorArgs[field],
      etherscan,
      sourcify,
    };
  }
  const releaseEligible = lifecycleVerified(manifest);
  const updated = {
    ...manifest,
    status: releaseEligible
      ? "deployment-source-and-lifecycle-verified"
      : "deployed-source-verified-lifecycle-pending",
    sourceVerification,
    lifecycleEvidence: {
      ...manifest.lifecycleEvidence,
      releaseEligible,
    },
  };
  if (write) {
    await writeJsonAtomic(manifestPath, updated);
  }
  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        externalAction: false,
        sourceVerification,
        releaseEligible,
        status: updated.status,
      },
      null,
      2,
    ),
  );
  if (!write) {
    console.error("Dry run only. Add --write after reviewing the evidence.");
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
