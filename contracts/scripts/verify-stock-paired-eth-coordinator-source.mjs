#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  STOCK_PAIRED_ETH_COORDINATOR_MANIFEST,
  assertStockPairedEthCoordinatorCheckout,
  loadStockPairedEthCoordinatorPlan,
} from "../../scripts/stock-paired-eth-coordinator-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const contractsRoot = path.join(root, "contracts");
const manifestPath = path.join(
  root,
  STOCK_PAIRED_ETH_COORDINATOR_MANIFEST,
);
const releaseCommit =
  process.env.STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT?.trim() ||
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
const submit = process.argv.includes("--submit");
const capture = process.argv.includes("--capture");
const write = process.argv.includes("--write");
const fqcn =
  "src/StockPairedEthLaunchCoordinatorV1.sol:StockPairedEthLaunchCoordinatorV1";
const contractName = "StockPairedEthLaunchCoordinatorV1";
const compilerVersion = "v0.8.26+commit.8a97fa7a";

function forgeArguments(address, constructorArguments, verifier) {
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
    "--constructor-args",
    constructorArguments,
  ];
  if (verifier === "etherscan") {
    const key = process.env.ETHERSCAN_API_KEY?.trim();
    if (!key) {
      throw new Error("ETHERSCAN_API_KEY is required for Etherscan submission");
    }
    values.push("--etherscan-api-key", key);
  }
  values.push(address, fqcn);
  return values;
}

function standardJson() {
  const output = execFileSync(
    "forge",
    [
      "verify-contract",
      "--show-standard-json-input",
      "0x1111111111111111111111111111111111111111",
      fqcn,
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

function assertSourceInput(remoteSource) {
  const local = standardJson();
  const remote = parseEtherscanSource(remoteSource);
  if (
    remote.language !== local.language ||
    remote.settings?.optimizer?.enabled !== true ||
    remote.settings?.optimizer?.runs !== 1000 ||
    remote.settings?.evmVersion !== "cancun" ||
    remote.settings?.metadata?.bytecodeHash !== "none" ||
    remote.settings?.metadata?.appendCBOR !== false
  ) {
    throw new Error("The coordinator compiler settings do not match");
  }
  for (const [sourcePath, source] of Object.entries(local.sources)) {
    if (
      typeof source?.content !== "string" ||
      remote.sources?.[sourcePath]?.content !== source.content
    ) {
      throw new Error(`The coordinator source differs at ${sourcePath}`);
    }
  }
}

async function etherscanRecord(address, constructorArguments) {
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
    source?.ContractName !== contractName ||
    source?.CompilerVersion !== compilerVersion ||
    source?.OptimizationUsed !== "1" ||
    source?.Runs !== "1000" ||
    source?.EVMVersion !== "cancun" ||
    source?.Proxy !== "0" ||
    source?.Implementation !== "" ||
    (source?.ConstructorArguments ?? "").toLowerCase() !==
      constructorArguments.slice(2).toLowerCase()
  ) {
    throw new Error("The coordinator Etherscan metadata does not match");
  }
  assertSourceInput(source.SourceCode);
  return {
    status: "exact-match",
    url: `https://etherscan.io/address/${address}#code`,
  };
}

async function sourcifyRecord(address) {
  const url = `https://sourcify.dev/server/v2/contract/1/${address}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Sourcify returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.match !== "match") {
    throw new Error("The coordinator is not a Sourcify match");
  }
  return { status: "match", url };
}

function lifecycleVerified(manifest) {
  const lifecycle = manifest.lifecycleEvidence;
  return (
    lifecycle?.status === "verified-current-release" &&
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

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function main() {
  if (submit && capture) {
    throw new Error("Choose either --submit or --capture");
  }
  assertStockPairedEthCoordinatorCheckout(root, releaseCommit);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest?.ethCoordinatorReleaseCommit !== releaseCommit ||
    !Number.isSafeInteger(manifest?.ethCoordinatorNonce) ||
    !/^0x[0-9a-f]{40}$/i.test(
      manifest?.addresses?.ethLaunchCoordinator ?? "",
    ) ||
    !/^0x[0-9a-f]{64}$/i.test(
      manifest?.transactions?.ethLaunchCoordinator ?? "",
    )
  ) {
    throw new Error("Capture the deployed ETH coordinator before verification");
  }
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce: manifest.ethCoordinatorNonce,
  });
  if (
    plan.address.toLowerCase() !==
      manifest.addresses.ethLaunchCoordinator.toLowerCase() ||
    plan.sourceCommitment.toLowerCase() !==
      manifest.ethCoordinatorSourceCommitment?.toLowerCase()
  ) {
    throw new Error("The manifest is not bound to this coordinator release");
  }
  if (submit) {
    for (const verifier of ["etherscan", "sourcify"]) {
      const result = spawnSync(
        "forge",
        forgeArguments(
          plan.address,
          plan.constructorArguments,
          verifier,
        ),
        {
          cwd: contractsRoot,
          encoding: "utf8",
          stdio: "inherit",
        },
      );
      if (result.status !== 0) {
        throw new Error(`Coordinator ${verifier} submission failed`);
      }
    }
    console.log("Coordinator source-verification submissions completed.");
    return;
  }
  if (!capture) {
    console.log(
      JSON.stringify(
        {
          mode: "review",
          externalAction: false,
          releaseCommit,
          contract: {
            field: "ethLaunchCoordinator",
            address: plan.address,
            fqcn,
            encodedConstructorArguments: plan.constructorArguments,
          },
          next:
            "Use --submit only after explicit approval, then --capture --write.",
        },
        null,
        2,
      ),
    );
    return;
  }
  const [etherscan, sourcify] = await Promise.all([
    etherscanRecord(plan.address, plan.constructorArguments),
    sourcifyRecord(plan.address),
  ]);
  const baseFields = [
    "quoteRegistry",
    "positionPlanner",
    "feeSplitVaultFactory",
    "hookFactory",
    "feeHook",
    "launcher",
  ];
  if (
    baseFields.some(
      (field) => manifest.sourceVerification?.[field]?.status !== "verified",
    )
  ) {
    throw new Error("A base Stock-Paired source is not verified");
  }
  const releaseEligible = lifecycleVerified(manifest);
  const updated = {
    ...manifest,
    status: releaseEligible
      ? "deployment-source-and-lifecycle-verified"
      : "deployed-source-verified-lifecycle-pending",
    sourceVerification: {
      ...manifest.sourceVerification,
      status: "verified",
      ethLaunchCoordinator: {
        status: "verified",
        encodedConstructorArguments: plan.constructorArguments,
        etherscan,
        sourcify,
      },
    },
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
        address: plan.address,
        sourceVerification: updated.sourceVerification.ethLaunchCoordinator,
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
