#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEEP_V3_ARTIFACTS,
  DEEP_V3_MANIFEST_PATH,
  DEEP_V3_RUNTIME_FIELDS,
  assertDeepV3EtherscanBuildInput,
} from "./deep-full-range-release-v3-core.mjs";
import {
  assertDeepV3ReleaseSourcesMatchCommit,
} from "../../scripts/deep-v3-mainnet-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const contractsRoot = path.join(root, "contracts");
const manifestPath = path.join(root, DEEP_V3_MANIFEST_PATH);
const submit = process.argv.includes("--submit");
const capture = process.argv.includes("--capture");
const write = process.argv.includes("--write");
const compilerVersion = "v0.8.26+commit.8a97fa7a";

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
      throw new Error(
        "ETHERSCAN_API_KEY is required for Etherscan submission",
      );
    }
    values.push("--etherscan-api-key", key);
  }
  values.push(address, DEEP_V3_ARTIFACTS[field].fqcn);
  return values;
}

function standardJson(field) {
  return JSON.parse(
    execFileSync(
      "forge",
      [
        "verify-contract",
        "--show-standard-json-input",
        "0x1111111111111111111111111111111111111111",
        DEEP_V3_ARTIFACTS[field].fqcn,
      ],
      {
        cwd: contractsRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    ),
  );
}

async function etherscanRecord(field, address, record) {
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
    throw new Error(`${field} Etherscan returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  const source = payload?.result?.[0];
  const expectedContractName =
    DEEP_V3_ARTIFACTS[field].fqcn.split(":")[1];
  if (
    payload?.status !== "1" ||
    source?.ContractName !== expectedContractName ||
    source?.CompilerVersion !== compilerVersion ||
    source?.OptimizationUsed !== "1" ||
    source?.Runs !== "1000" ||
    source?.EVMVersion !== "cancun" ||
    source?.Proxy !== "0" ||
    source?.Implementation !== "" ||
    (source?.ConstructorArguments ?? "").toLowerCase() !==
      record.encodedConstructorArguments.slice(2).toLowerCase()
  ) {
    throw new Error(`${field} Etherscan metadata does not match`);
  }
  assertDeepV3EtherscanBuildInput(
    field,
    source.SourceCode,
    standardJson(field),
    root,
  );
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

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function main() {
  if ((submit && capture) || (write && !capture)) {
    throw new Error(
      "Use review mode, --submit, --capture, or --capture --write",
    );
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertDeepV3ReleaseSourcesMatchCommit(root, manifest.releaseCommit);
  if (
    !String(manifest.status ?? "").startsWith("deployed-") ||
    !manifest.deploymentEvidence ||
    !manifest.runtimeCodeHashes
  ) {
    throw new Error(
      "Capture the receipt-bound Deep V3 deployment before verification",
    );
  }

  const contracts = DEEP_V3_RUNTIME_FIELDS.map((field) => {
    const record = manifest.sourceVerification.contracts[field];
    return {
      field,
      address: manifest.addresses[field],
      fqcn: DEEP_V3_ARTIFACTS[field].fqcn,
      encodedConstructorArguments: record.encodedConstructorArguments,
    };
  });

  if (submit) {
    for (const contract of contracts) {
      for (const verifier of ["etherscan", "sourcify"]) {
        const verifierEnvironment = { ...process.env };
        if (verifier === "sourcify") {
          delete verifierEnvironment.ETHERSCAN_API_KEY;
        }
        const result = spawnSync(
          "forge",
          forgeArguments(
            contract.field,
            contract.address,
            contract.encodedConstructorArguments,
            verifier,
          ),
          {
            cwd: contractsRoot,
            encoding: "utf8",
            env: verifierEnvironment,
            stdio: "inherit",
          },
        );
        if (result.status !== 0) {
          throw new Error(
            `${contract.field} ${verifier} verification submission failed`,
          );
        }
      }
    }
    console.log(
      "All nine Deep source-verification submissions completed.",
    );
    return;
  }

  if (!capture) {
    console.log(
      JSON.stringify(
        {
          mode: "review",
          externalAction: false,
          releaseCommit: manifest.releaseCommit,
          contracts,
          next: "Use --submit, then --capture --write.",
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
    contracts: { ...manifest.sourceVerification.contracts },
  };
  for (const contract of contracts) {
    const current =
      sourceVerification.contracts[contract.field];
    const [etherscan, sourcify] = await Promise.all([
      etherscanRecord(
        contract.field,
        contract.address,
        current,
      ),
      sourcifyRecord(contract.field, contract.address),
    ]);
    sourceVerification.contracts[contract.field] = {
      ...current,
      status: "etherscan-exact-sourcify-match",
      etherscan,
      sourcify,
    };
  }

  const updated = {
    ...manifest,
    status: "deployed-source-verified-lifecycle-pending",
    releaseEligible: false,
    sourceVerification,
    blockers: manifest.blockers.filter(
      (blocker) =>
        !blocker.includes("Etherscan") &&
        !blocker.includes("Sourcify"),
    ),
  };
  if (write) {
    await writeJsonAtomic(manifestPath, updated);
  }
  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        externalAction: false,
        status: updated.status,
        sourceVerification,
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
