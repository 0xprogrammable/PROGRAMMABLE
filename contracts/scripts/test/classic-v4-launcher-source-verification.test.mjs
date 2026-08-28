import assert from "node:assert/strict";
import test from "node:test";

import { keccak256, stringToHex } from "viem";

import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
  buildClassicV4LauncherUpgradePlan,
  buildClassicV4LauncherUpgradeReceiptEvidence,
  buildClassicV4LauncherUpgradeVerificationEvidence,
} from "../../../scripts/classic-v4-launcher-upgrade-core.mjs";
import {
  validateClassicV4LauncherFinalityEvidence,
  verifyClassicV4LauncherSourceProviders,
} from "../verify-classic-v4-launcher-upgrade-sources.mjs";

const launcherPath = "src/MemeLaunchV4.sol";
const launcherSource =
  "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26; contract MemeLaunchV4 {}\n";
const dependencyPath = "lib/example/src/Dependency.sol";
const dependencySource =
  "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26; library Dependency {}\n";
const runtimeTemplate = "0x6000600055";
const runtimeCode = "0x60ff600055";
const transactionHash = `0x${"ab".repeat(32)}`;
const transactionBlockHash = `0x${"cd".repeat(32)}`;

function fixtureArtifact() {
  return {
    bytecode: { object: "0x60006000" },
    deployedBytecode: {
      object: runtimeTemplate,
      immutableReferences: { 1: [{ start: 1, length: 1 }] },
    },
    metadata: {
      compiler: { version: "0.8.26+commit.8a97fa7a" },
      language: "Solidity",
      settings: {
        remappings: [],
        optimizer: { enabled: true, runs: 1_000 },
        metadata: { bytecodeHash: "none", appendCBOR: false },
        compilationTarget: { [launcherPath]: "MemeLaunchV4" },
        evmVersion: "cancun",
        libraries: {},
      },
      sources: {
        [launcherPath]: { keccak256: keccak256(stringToHex(launcherSource)) },
        [dependencyPath]: {
          keccak256: keccak256(stringToHex(dependencySource)),
        },
      },
    },
  };
}

function fixturePlan(artifact) {
  return buildClassicV4LauncherUpgradePlan({
    artifact,
    releaseCommit: "11".repeat(20),
    releaseTree: "22".repeat(20),
    repositoryClean: true,
    startingNonce: 7,
    observedAtBlock: 20_000_000,
    observedAtBlockHash: `0x${"33".repeat(32)}`,
    sourcePinsDigest: `0x${"44".repeat(32)}`,
    snapshot: {
      independentRpcCount: 2,
      freshDeterministicBuild: true,
      sourcePinsVerified: true,
      dependencyRuntimeVerified: true,
      dependencyBindingsVerified: true,
      canonicalRouterVerified: true,
      constructorSimulationVerified: true,
      predictedAddressVacant: true,
      deployerNonceReconciled: true,
      deployerBalanceVerified: true,
      estimatedGas: "1500000",
      reviewedGasLimit: "2000000",
      gasPriceWei: "1000000000",
      deployerBalanceWei: "3000000000000000",
      requiredBalanceWei: "2000000000000000",
    },
  });
}

function fixtureEvidence(plan, artifact) {
  const receiptEvidence = buildClassicV4LauncherUpgradeReceiptEvidence({
    plan,
    transactionHash,
    transaction: {
      hash: transactionHash,
      from: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
      to: null,
      nonce: "0x7",
      value: "0x0",
      gas: "0x1e8480",
      input: plan.transaction.data,
      blockHash: transactionBlockHash,
      blockNumber: "0x1312d00",
    },
    receipt: {
      status: "0x1",
      transactionHash,
      from: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
      to: null,
      contractAddress: plan.predictedAddress,
      blockHash: transactionBlockHash,
      blockNumber: "0x1312d00",
      gasUsed: "0x16e360",
      effectiveGasPrice: "0x3b9aca00",
    },
  });
  const finalityEvidence = buildClassicV4LauncherUpgradeVerificationEvidence({
    plan,
    receiptEvidence,
    verificationBlock: receiptEvidence.blockNumber + 11,
    verificationBlockHash: `0x${"ef".repeat(32)}`,
    verificationTimestamp: 1_800_000_000,
    runtimeCode,
    artifact,
  });
  return { receiptEvidence, finalityEvidence };
}

function fixture() {
  const artifact = fixtureArtifact();
  const plan = fixturePlan(artifact);
  const evidence = fixtureEvidence(plan, artifact);
  const sources = {
    [launcherPath]: { content: launcherSource },
    [dependencyPath]: { content: dependencySource },
  };
  return {
    artifact,
    plan,
    ...evidence,
    sourcify: {
      chainId: "1",
      address: plan.predictedAddress,
      match: "match",
      creationMatch: "exact_match",
      runtimeMatch: "match",
      sources,
    },
    etherscan: {
      status: "1",
      result: [
        {
          ContractName: "MemeLaunchV4",
          ContractFileName: launcherPath,
          CompilerType: "solc",
          CompilerVersion: "v0.8.26+commit.8a97fa7a",
          OptimizationUsed: "1",
          Runs: "1000",
          EVMVersion: "cancun",
          Proxy: "0",
          Implementation: "",
          SimilarMatch: "",
          ConstructorArguments: plan.constructorArguments.slice(2),
          SourceCode: JSON.stringify({ language: "Solidity", sources }),
        },
      ],
    },
  };
}

function providerFetch(values, calls) {
  return async (url) => {
    calls.push(url.toString());
    return structuredClone(
      url.hostname === "sourcify.dev" ? values.sourcify : values.etherscan,
    );
  };
}

test("requires Sourcify and emits deterministic launcher-only evidence", async () => {
  const values = fixture();
  const calls = [];
  const input = {
    ...values,
    checkedAt: "2027-01-15T08:00:00.000Z",
    fetchJsonClient: providerFetch(values, calls),
    etherscanApiKey: null,
  };
  const first = await verifyClassicV4LauncherSourceProviders(input);
  const second = await verifyClassicV4LauncherSourceProviders(input);

  assert.deepEqual(first, second);
  assert.equal(first.status, "sourcify-verified");
  assert.equal(first.contract.contractName, "MemeLaunchV4");
  assert.equal(first.providers.sourcify.sourceClosure, "exact");
  assert.equal(
    first.providers.sourcify.matchFields.creationMatch,
    "exact_match",
  );
  assert.equal(first.providers.etherscan, null);
  assert.equal(Object.hasOwn(first, "contracts"), false);
  assert.match(first.evidenceDigest, /^0x[0-9a-f]{64}$/);
  assert(calls.every((url) => url.endsWith("?fields=sources")));
});

test("uses Etherscan only when a key exists and never records it", async () => {
  const values = fixture();
  const calls = [];
  const evidence = await verifyClassicV4LauncherSourceProviders({
    ...values,
    checkedAt: "2027-01-15T08:00:00.000Z",
    fetchJsonClient: providerFetch(values, calls),
    etherscanApiKey: "test-only-key",
  });

  assert.equal(evidence.status, "sourcify-and-etherscan-verified");
  assert.equal(evidence.providers.etherscan.status, "exact-match");
  assert(calls.some((url) => url.includes("apikey=test-only-key")));
  assert(!JSON.stringify(evidence).includes("test-only-key"));
});

test("fails closed when Sourcify source bytes differ", async () => {
  const values = fixture();
  values.sourcify.sources[launcherPath].content += "// drift\n";
  await assert.rejects(
    verifyClassicV4LauncherSourceProviders({
      ...values,
      checkedAt: "2027-01-15T08:00:00.000Z",
      fetchJsonClient: providerFetch(values, []),
      etherscanApiKey: null,
    }),
    /Sourcify source bytes differ/,
  );
});

test("fails closed on altered receipt or finality binding", () => {
  const values = fixture();
  const altered = {
    ...values.finalityEvidence,
    receiptEvidenceDigest: `0x${"99".repeat(32)}`,
  };
  assert.throws(
    () =>
      validateClassicV4LauncherFinalityEvidence({
        plan: values.plan,
        receiptEvidence: values.receiptEvidence,
        finalityEvidence: altered,
      }),
    /finality evidence identity differs/,
  );
});

test("rejects an Etherscan SimilarMatch", async () => {
  const values = fixture();
  values.etherscan.result[0].SimilarMatch =
    "0x1111111111111111111111111111111111111111";
  await assert.rejects(
    verifyClassicV4LauncherSourceProviders({
      ...values,
      checkedAt: "2027-01-15T08:00:00.000Z",
      fetchJsonClient: providerFetch(values, []),
      etherscanApiKey: "test-only-key",
    }),
    /Etherscan metadata differs/,
  );
});
