#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  encodeAbiParameters,
  getAddress,
} from "viem";

import {
  loadClassicV3ReleasePlan,
  readClassicV3Evidence,
} from "../../scripts/classic-v3-release-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const contractsRoot = path.join(root, "contracts");
const releaseEvidencePath = path.resolve(
  process.env.CLASSIC_V3_RELEASE_EVIDENCE_PATH ??
    path.join(root, "tmp/classic-v3-mainnet-release-evidence.json"),
);
const sourceEvidencePath = path.resolve(
  process.env.CLASSIC_V3_SOURCE_EVIDENCE_PATH ??
    path.join(root, "tmp/classic-v3-mainnet-source-evidence.json"),
);
const submit = process.argv.includes("--submit");
const submitEtherscan =
  process.argv.includes("--submit-etherscan");
const submitSourcify =
  process.argv.includes("--submit-sourcify");
const capture = process.argv.includes("--capture");
const write = process.argv.includes("--write");
const compilerVersion = "v0.8.26+commit.8a97fa7a";

const targets = {
  ctoAuthority: {
    contractName: "ClassicCtoAuthorityV1",
    fqcn: "src/ClassicCtoAuthorityV1.sol:ClassicCtoAuthorityV1",
    artifact:
      "out/ClassicCtoAuthorityV1.sol/ClassicCtoAuthorityV1.json",
  },
  rewardVaultFactory: {
    contractName: "ClassicRewardVaultFactoryV1",
    fqcn:
      "src/ClassicRewardVaultFactoryV1.sol:ClassicRewardVaultFactoryV1",
    artifact:
      "out/ClassicRewardVaultFactoryV1.sol/ClassicRewardVaultFactoryV1.json",
  },
  initialBuyVestingWalletFactory: {
    contractName: "ClassicInitialBuyVestingWalletFactoryV1",
    fqcn:
      "src/ClassicInitialBuyVestingWalletFactoryV1.sol:ClassicInitialBuyVestingWalletFactoryV1",
    artifact:
      "out/ClassicInitialBuyVestingWalletFactoryV1.sol/ClassicInitialBuyVestingWalletFactoryV1.json",
  },
  launchPolicy: {
    contractName: "ClassicLaunchPolicyV1",
    fqcn: "src/ClassicLaunchPolicyV1.sol:ClassicLaunchPolicyV1",
    artifact:
      "out/ClassicLaunchPolicyV1.sol/ClassicLaunchPolicyV1.json",
  },
  hookFactory: {
    contractName: "EthCreatorFeeHookFactoryV3",
    fqcn:
      "src/EthCreatorFeeHookFactoryV3.sol:EthCreatorFeeHookFactoryV3",
    artifact:
      "out/EthCreatorFeeHookFactoryV3.sol/EthCreatorFeeHookFactoryV3.json",
  },
  feeHook: {
    contractName: "EthCreatorFeeHookV3",
    fqcn: "src/EthCreatorFeeHookV3.sol:EthCreatorFeeHookV3",
    artifact:
      "out/EthCreatorFeeHookV3.sol/EthCreatorFeeHookV3.json",
  },
  launcher: {
    contractName: "MemeLaunchV2",
    fqcn: "src/MemeLaunchV2.sol:MemeLaunchV2",
    artifact: "out/MemeLaunchV2.sol/MemeLaunchV2.json",
  },
};

const fieldByContractName = Object.fromEntries(
  Object.entries(targets).map(([field, target]) => [
    target.contractName,
    field,
  ]),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJsonAtomic(file, value) {
  const temporaryPath = `${file}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, file);
}

function creationCode(artifact, field) {
  const value = artifact?.bytecode?.object;
  assert(
    typeof value === "string" && /^0x[0-9a-f]+$/i.test(value),
    `${field} creation bytecode is missing`,
  );
  return value;
}

function constructorArguments(transaction, bytecode, field) {
  assert(
    transaction.data
      .toLowerCase()
      .startsWith(bytecode.toLowerCase()),
    `${field} deployment input differs from its artifact`,
  );
  return `0x${transaction.data.slice(bytecode.length)}`;
}

function forgeArguments(contract, verifier) {
  const values = [
    "verify-contract",
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
  if (verifier === "sourcify") {
    values.splice(1, 0, "--watch");
  }
  if (contract.encodedConstructorArguments !== "0x") {
    values.push(
      "--constructor-args",
      contract.encodedConstructorArguments,
    );
  }
  if (verifier === "etherscan") {
    const key = process.env.ETHERSCAN_API_KEY?.trim();
    assert(key, "ETHERSCAN_API_KEY is required");
    values.push("--etherscan-api-key", key);
  }
  values.push(contract.address, contract.fqcn);
  return values;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function captureSourcify(contract) {
  const url =
    `https://sourcify.dev/server/v2/contract/1/${contract.address}`;
  const payload = await fetchJson(url);
  assert(
    payload?.match === "match",
    `${contract.field} is not a Sourcify match`,
  );
  return { status: "match", url };
}

async function captureEtherscan(contract) {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  assert(key, "ETHERSCAN_API_KEY is required for Etherscan capture");
  const query = new URL("https://api.etherscan.io/v2/api");
  query.searchParams.set("chainid", "1");
  query.searchParams.set("module", "contract");
  query.searchParams.set("action", "getsourcecode");
  query.searchParams.set("address", contract.address);
  query.searchParams.set("apikey", key);
  const payload = await fetchJson(query);
  const source = payload?.result?.[0];
  assert(
    payload?.status === "1" &&
      source?.ContractName === contract.contractName &&
      source?.CompilerVersion === compilerVersion &&
      source?.OptimizationUsed === "1" &&
      source?.Runs === "1000" &&
      source?.EVMVersion === "cancun" &&
      source?.Proxy === "0" &&
      source?.Implementation === "" &&
      (source?.ConstructorArguments ?? "").toLowerCase() ===
        contract.encodedConstructorArguments
          .slice(2)
          .toLowerCase() &&
      typeof source?.SourceCode === "string" &&
      source.SourceCode.length > 0,
    `${contract.field} Etherscan metadata does not match`,
  );
  return {
    status: "exact-match",
    url: `https://etherscan.io/address/${contract.address}#code`,
  };
}

async function main() {
  assert(
    !((submit || submitEtherscan || submitSourcify) && capture) &&
      !(write && !capture) &&
      [submit, submitEtherscan, submitSourcify].filter(Boolean)
        .length <= 1,
    "Use review, --submit-sourcify, --submit-etherscan, --submit, or --capture --write",
  );
  const plan = await loadClassicV3ReleasePlan(root, "mainnet");
  const deploymentEvidence = await readClassicV3Evidence(
    releaseEvidencePath,
    plan,
  );
  assert(
    deploymentEvidence.receiptEvidenceReady === true,
    "Deployment receipts have not reached finality",
  );

  const artifacts = Object.fromEntries(
    await Promise.all(
      Object.entries(targets).map(async ([field, target]) => [
        field,
        await readJson(path.join(contractsRoot, target.artifact)),
      ]),
    ),
  );
  const transactionByField = Object.fromEntries(
    plan.transactions.map((transaction) => [
      fieldByContractName[transaction.name],
      transaction,
    ]),
  );
  const evidenceByField = Object.fromEntries(
    deploymentEvidence.transactions.map((record) => [
      fieldByContractName[record.name],
      record,
    ]),
  );
  const contracts = Object.entries(targets).map(
    ([field, target]) => {
      const transaction = transactionByField[field];
      const record = evidenceByField[field];
      assert(transaction && record, `${field} release evidence is missing`);
      assert(
        record.status === "finalized" &&
          record.deploymentVerified === true &&
          record.address.toLowerCase() ===
            transaction.address.toLowerCase(),
        `${field} is not a finalized reviewed deployment`,
      );
      const encodedConstructorArguments =
        field === "feeHook"
          ? encodeAbiParameters(
              [
                { type: "address" },
                { type: "address" },
                { type: "address" },
              ],
              [
                getAddress(plan.dependencies.poolManager.address),
                getAddress(plan.launcherFeeRecipient),
                getAddress(
                  transactionByField.rewardVaultFactory.address,
                ),
              ],
            )
          : constructorArguments(
              transaction,
              creationCode(artifacts[field], field),
              field,
            );
      return {
        field,
        address: getAddress(transaction.address),
        contractName: target.contractName,
        fqcn: target.fqcn,
        encodedConstructorArguments,
        deploymentTransaction: record.txHash,
        deploymentBlock: Number(BigInt(record.receipt.blockNumber)),
        runtimeCodeHash: record.runtimeCodeHash,
      };
    },
  );

  if (submit || submitEtherscan || submitSourcify) {
    const verifiers = submit
      ? ["etherscan", "sourcify"]
      : submitEtherscan
        ? ["etherscan"]
        : ["sourcify"];
    for (const contract of contracts) {
      for (const verifier of verifiers) {
        const environment = { ...process.env };
        if (verifier === "sourcify") {
          delete environment.ETHERSCAN_API_KEY;
        }
        const result = spawnSync(
          "forge",
          forgeArguments(contract, verifier),
          {
            cwd: contractsRoot,
            encoding: "utf8",
            env: environment,
            stdio: "inherit",
          },
        );
        assert(
          result.status === 0,
          `${contract.field} ${verifier} submission failed`,
        );
      }
    }
    console.log(
      `Submitted ${contracts.length} Classic contracts to ${verifiers.join(" and ")}.`,
    );
    return;
  }

  if (!capture) {
    console.log(
      JSON.stringify(
        {
          mode: "review",
          externalAction: false,
          planDigest: plan.planDigest,
          releaseCommit: plan.simulationCommit,
          contracts,
          next:
            "Use --submit-sourcify and --submit-etherscan, then --capture --write.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const verifiedContracts = {};
  for (const contract of contracts) {
    const [etherscan, sourcify] = await Promise.all([
      captureEtherscan(contract),
      captureSourcify(contract),
    ]);
    verifiedContracts[contract.field] = {
      ...contract,
      status: "etherscan-exact-sourcify-match",
      etherscan,
      sourcify,
    };
  }
  const evidence = {
    schemaVersion: 1,
    status: "verified",
    network: "mainnet",
    chainId: 1,
    releaseCommit: plan.simulationCommit,
    infrastructurePlanDigest: plan.planDigest,
    checkedAt: new Date().toISOString(),
    contracts: verifiedContracts,
  };
  if (write) await writeJsonAtomic(sourceEvidencePath, evidence);
  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        status: evidence.status,
        evidencePath: sourceEvidencePath,
        contracts: Object.keys(verifiedContracts).length,
      },
      null,
      2,
    ),
  );
  if (!write) {
    console.error("Dry run only. Add --write after review.");
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
