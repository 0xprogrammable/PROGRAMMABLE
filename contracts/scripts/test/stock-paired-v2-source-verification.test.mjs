import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  STOCK_PAIRED_V2_MANIFEST_PATH,
  loadStockPairedV2ReleasePlan,
} from "../../../scripts/stock-paired-v2-mainnet-operator-core.mjs";
import {
  STOCK_PAIRED_V2_IMMUTABLE_RELEASE_PATHS,
  assertStockPairedV2ReleasePaths,
  assertStockPairedV2ReleaseSnapshot,
  assertStockPairedV2StandardJson,
  stockPairedV2ForgeArguments,
  stockPairedV2PublicLifecycleVerified,
  stockPairedV2EtherscanReadable,
  stockPairedV2SourceRecords,
  stockPairedV2SourceVerificationComplete,
  stockPairedV2VerificationEnvironment,
} from "../stock-paired-v2-source-verification-core.mjs";
import {
  mergeStockPairedV2CaptureEvidence,
  stockPairedV2CaptureGates,
} from "../capture-stock-paired-v2-release.mjs";
import {
  assertStockPairedV2SourceInput,
  buildStockPairedV2EtherscanRecord,
  buildStockPairedV2SourceCapture,
  etherscanForSourcifyOnlyCapture,
} from "../verify-stock-paired-v2-sources.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const evidence = JSON.parse(
  await readFile(
    path.join(root, "tmp/stock-paired-v2-mainnet-release-evidence.json"),
    "utf8",
  ),
);
const plan = await loadStockPairedV2ReleasePlan(root, {
  releaseCommit: evidence.releaseCommit,
});

const EXPECTED_ARGUMENT_HASHES = Object.freeze({
  quoteRegistry:
    "0x4561929b32778cc3b1035c96cdbc088264a4231e600537f23a6f9e0f9a7f8a57",
  positionPlanner:
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  feeSplitVaultFactory:
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  hookFactory:
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  feeHook: "0xef7f7f31926498c98ea1ca1ba6e55f51a3e01c806394000ee9735ce63a4c253c",
  launcher:
    "0x0c95c7aed78c18a48fab138eb4c50fcda8f3352e382fcefa37f20111f09ca067",
  ethLaunchCoordinator:
    "0x053ca5ae6b82518d2c732789d3335967155b097c55d08fce77cdf176bf5afc40",
});

const SOURCE_FIELDS = Object.freeze([
  "quoteRegistry",
  "positionPlanner",
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
  "launcher",
  "ethLaunchCoordinator",
]);

function etherscanCodeUrl(address) {
  return `https://etherscan.io/address/${address}#code`;
}

function sourcifyContractUrl(address) {
  return `https://sourcify.dev/server/v2/contract/1/${address}`;
}

function similarMatchAddress(index) {
  return `0x${(index + 1).toString(16).padStart(40, "0")}`;
}

function completeSourceVerification({ allSimilar = false } = {}) {
  return {
    status: "verified",
    ...Object.fromEntries(
      SOURCE_FIELDS.map((field, index) => {
        const address = plan.addresses[field];
        const exact = index === 0 && !allSimilar;
        const matchedAddress = similarMatchAddress(index);
        return [
          field,
          {
            status: "verified",
            address,
            etherscan: exact
              ? {
                  status: "exact-match",
                  url: etherscanCodeUrl(address),
                }
              : {
                  status: "similar-match",
                  matchedAddress,
                  url: etherscanCodeUrl(address),
                  matchedUrl: etherscanCodeUrl(matchedAddress),
                },
            sourcify: {
              status: "match",
              creationMatch: "match",
              runtimeMatch: "match",
              url: sourcifyContractUrl(address),
            },
          },
        ];
      }),
    ),
  };
}

function completeLifecycleEvidence() {
  return {
    status: "verified-current-release",
    publicMainnetCanaryVerified: true,
    deploymentTransactionsVerified: true,
    runtimeBindingsVerified: true,
    ethCoordinatorDeploymentVerified: true,
    canaryLaunchTransaction: `0x${"33".repeat(32)}`,
    positionLockVerified: true,
    buyAndSellVerified: true,
    ethFirstLaunchVerified: true,
    ethBuyAndSellVerified: true,
    creatorClaimVerified: true,
    launcherClaimVerified: true,
  };
}

function standardJsonFixture(record) {
  const sources = {
    [record.fqcn.split(":")[0]]: { content: "contract Target {}" },
  };
  for (let index = 1; index < record.expectedSourceCount; index += 1) {
    sources[`lib/dependency-${index}.sol`] = {
      content: `contract Dependency${index} {}`,
    };
  }
  return {
    language: "Solidity",
    sources,
    settings: {
      remappings: ["dependency/=lib/dependency/"],
      optimizer: { enabled: true, runs: 1000 },
      metadata: {
        useLiteralContent: false,
        bytecodeHash: "none",
        appendCBOR: false,
      },
      outputSelection: {},
      evmVersion: "cancun",
      viaIR: false,
      libraries: {},
    },
  };
}

test("binds all seven V2 source records to exact constructor arguments", () => {
  const records = stockPairedV2SourceRecords(plan);
  assert.deepEqual(
    records.map((record) => record.field),
    [
      "quoteRegistry",
      "positionPlanner",
      "feeSplitVaultFactory",
      "hookFactory",
      "feeHook",
      "launcher",
      "ethLaunchCoordinator",
    ],
  );
  for (const record of records) {
    assert.equal(record.address, plan.addresses[record.field]);
    assert.equal(
      record.constructorArgumentHash,
      EXPECTED_ARGUMENT_HASHES[record.field],
    );
  }
  assert.deepEqual(
    records.map((record) => record.constructorArgumentBytes),
    [1056, 0, 0, 0, 128, 256, 992],
  );
});

test("builds fail-closed Etherscan and Sourcify commands", () => {
  const records = stockPairedV2SourceRecords(plan);
  const registry = records[0];
  const etherscan = stockPairedV2ForgeArguments(
    registry,
    "etherscan",
    "test-key",
  );
  assert(etherscan.includes("--constructor-args"));
  assert(etherscan.includes(registry.encodedConstructorArguments));
  assert(etherscan.includes("--etherscan-api-key"));
  assert(etherscan.includes("test-key"));
  assert(etherscan.includes("--skip-is-verified-check"));
  assert.throws(
    () => stockPairedV2ForgeArguments(registry, "etherscan"),
    /ETHERSCAN_API_KEY/,
  );

  const sourcify = stockPairedV2ForgeArguments(registry, "sourcify");
  assert(!sourcify.includes("--etherscan-api-key"));
  assert(!sourcify.includes("--skip-is-verified-check"));
  assert(sourcify.includes("--constructor-args"));
  assert(sourcify.includes(registry.encodedConstructorArguments));
  assert(sourcify.includes("sourcify"));
});

test("disables auto-discovery and uses only portable remappings", () => {
  const environment = stockPairedV2VerificationEnvironment(
    path.join(root, "contracts"),
    { SAFE_EXISTING_VALUE: "preserved" },
  );
  assert.equal(environment.SAFE_EXISTING_VALUE, "preserved");
  assert.equal(environment.FOUNDRY_AUTO_DETECT_REMAPPINGS, "false");
  assert(!environment.FOUNDRY_REMAPPINGS.includes("/Users/"));
  assert(!environment.FOUNDRY_REMAPPINGS.includes("/private/"));
  assert(environment.FOUNDRY_REMAPPINGS.includes("@uniswap/v4-core/="));
});

test("rejects incomplete or path-leaking standard-json inputs", () => {
  const record = stockPairedV2SourceRecords(plan)[0];
  const valid = standardJsonFixture(record);
  assert.equal(assertStockPairedV2StandardJson(record, valid), valid);

  const absolute = structuredClone(valid);
  absolute.sources["/Users/example/private.sol"] = {
    content: "contract Leak {}",
  };
  delete absolute.sources["lib/dependency-1.sol"];
  assert.throws(
    () => assertStockPairedV2StandardJson(record, absolute),
    /unsafe or empty source path/,
  );

  const parent = structuredClone(valid);
  parent.settings.remappings = ["dependency/=../../Users/example/dependency/"];
  assert.throws(
    () => assertStockPairedV2StandardJson(record, parent),
    /unsafe source remapping/,
  );

  const leakingPrefix = structuredClone(valid);
  leakingPrefix.settings.remappings = [
    "/Users/example/project/=lib/dependency/",
  ];
  assert.throws(
    () => assertStockPairedV2StandardJson(record, leakingPrefix),
    /unsafe source remapping/,
  );

  const incomplete = structuredClone(valid);
  delete incomplete.sources["lib/dependency-1.sol"];
  assert.throws(
    () => assertStockPairedV2StandardJson(record, incomplete),
    /source graph is incomplete/,
  );
});

test("accepts Etherscan output normalization without weakening source verification", () => {
  const record = stockPairedV2SourceRecords(plan)[0];
  const local = standardJsonFixture(record);
  local.settings.outputSelection = {
    "*": {
      "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"],
    },
  };
  const remote = structuredClone(local);
  remote.settings = {
    viaIR: remote.settings.viaIR,
    evmVersion: remote.settings.evmVersion,
    outputSelection: { "*": { "*": ["*"] } },
    metadata: remote.settings.metadata,
    optimizer: remote.settings.optimizer,
    remappings: remote.settings.remappings,
  };

  assert.doesNotThrow(() =>
    assertStockPairedV2SourceInput(record, local, JSON.stringify(remote)),
  );
});

test("rejects compilation-affecting Etherscan input drift", () => {
  const record = stockPairedV2SourceRecords(plan)[0];
  const local = standardJsonFixture(record);
  const cases = [
    [
      "optimizer enabled",
      (input) => (input.settings.optimizer.enabled = false),
    ],
    ["optimizer runs", (input) => (input.settings.optimizer.runs = 999)],
    [
      "metadata bytecode hash",
      (input) => (input.settings.metadata.bytecodeHash = "ipfs"),
    ],
    ["metadata CBOR", (input) => (input.settings.metadata.appendCBOR = true)],
    ["EVM version", (input) => (input.settings.evmVersion = "paris")],
    ["via IR", (input) => (input.settings.viaIR = true)],
    [
      "remappings",
      (input) =>
        (input.settings.remappings = ["dependency/=lib/other-dependency/"]),
    ],
    [
      "nonempty libraries",
      (input) =>
        (input.settings.libraries = {
          "lib/dependency-1.sol": {
            Dependency1: "0x0000000000000000000000000000000000000001",
          },
        }),
    ],
  ];

  for (const [name, mutate] of cases) {
    const remote = structuredClone(local);
    mutate(remote);
    assert.throws(
      () =>
        assertStockPairedV2SourceInput(record, local, JSON.stringify(remote)),
      /compiler (?:settings drifted|input settings differ)/,
      name,
    );
  }
});

test("rejects Etherscan source-content differences", () => {
  const record = stockPairedV2SourceRecords(plan)[0];
  const local = standardJsonFixture(record);
  const remote = structuredClone(local);
  remote.sources[record.fqcn.split(":")[0]].content =
    "contract Target { function changed() external {} }";

  assert.throws(
    () => assertStockPairedV2SourceInput(record, local, JSON.stringify(remote)),
    /source differs at/,
  );
});

test("keeps lifecycle ineligible without a separately captured public canary", () => {
  const base = {
    status: "verified-current-release",
    publicMainnetCanaryVerified: false,
    deploymentTransactionsVerified: true,
    runtimeBindingsVerified: true,
    ethCoordinatorDeploymentVerified: true,
    canaryLaunchTransaction: `0x${"11".repeat(32)}`,
    positionLockVerified: true,
    buyAndSellVerified: true,
    ethFirstLaunchVerified: true,
    ethBuyAndSellVerified: true,
    creatorClaimVerified: true,
    launcherClaimVerified: true,
  };
  assert.equal(
    stockPairedV2PublicLifecycleVerified({
      lifecycleEvidence: base,
    }),
    false,
  );
  assert.equal(
    stockPairedV2PublicLifecycleVerified({
      lifecycleEvidence: {
        ...base,
        publicMainnetCanaryVerified: true,
      },
    }),
    true,
  );
});

test("keeps Sourcify-only capture truthful and preserves lifecycle evidence", () => {
  const partial = {
    status: "deployed-runtime-verified-source-and-public-canary-pending",
    lifecycleEvidence: {
      status: "deployment-verified-public-canary-pending",
      releaseEligible: false,
      canaryLaunchTransaction: `0x${"22".repeat(32)}`,
    },
  };
  const sourceVerification = {
    status: "sourcify-verified-etherscan-pending",
  };
  const updated = buildStockPairedV2SourceCapture(partial, sourceVerification);
  assert.equal(
    updated.status,
    "deployed-sourcify-verified-etherscan-and-public-canary-pending",
  );
  assert.equal(updated.lifecycleEvidence.releaseEligible, false);
  assert.equal(
    updated.lifecycleEvidence.canaryLaunchTransaction,
    partial.lifecycleEvidence.canaryLaunchTransaction,
  );
});

test("Sourcify-only capture never downgrades exact Etherscan evidence", () => {
  const address = plan.addresses.quoteRegistry;
  const exact = {
    status: "exact-match",
    url: etherscanCodeUrl(address),
  };
  assert.equal(
    etherscanForSourcifyOnlyCapture({ address, etherscan: exact }),
    exact,
  );
  const matchedAddress = similarMatchAddress(1);
  const similar = {
    status: "similar-match",
    matchedAddress,
    url: etherscanCodeUrl(address),
    matchedUrl: etherscanCodeUrl(matchedAddress),
  };
  assert.equal(
    etherscanForSourcifyOnlyCapture({ address, etherscan: similar }),
    similar,
  );
  assert.deepEqual(etherscanForSourcifyOnlyCapture(null), {
    status: "pending",
    url: null,
  });

  const existing = completeSourceVerification();
  const updated = buildStockPairedV2SourceCapture(
    {
      addresses: plan.addresses,
      lifecycleEvidence: { status: "pending" },
    },
    existing,
  );
  assert.equal(updated.sourceVerification, existing);
  assert.equal(
    updated.status,
    "deployed-source-verified-public-canary-pending",
  );
});

test("requires both source and lifecycle gates and preserves partial evidence", () => {
  const neither = {
    addresses: plan.addresses,
    sourceVerification: { status: "pending", retainedSourceField: "source" },
    lifecycleEvidence: {
      status: "pending",
      retainedLifecycleField: "lifecycle",
    },
  };
  const neitherGates = stockPairedV2CaptureGates(neither);
  assert.deepEqual(neitherGates, {
    sourceVerified: false,
    publicLifecycleVerified: false,
    releaseEligible: false,
    status: "deployed-runtime-verified-source-and-public-canary-pending",
  });
  const merged = mergeStockPairedV2CaptureEvidence(neither, neitherGates);
  assert.equal(merged.sourceVerification.retainedSourceField, "source");
  assert.equal(merged.lifecycleEvidence.retainedLifecycleField, "lifecycle");
  assert.equal(merged.lifecycleEvidence.deploymentTransactionsVerified, true);

  const sourceOnly = stockPairedV2CaptureGates({
    ...neither,
    sourceVerification: completeSourceVerification(),
  });
  assert.equal(sourceOnly.sourceVerified, true);
  assert.equal(sourceOnly.releaseEligible, false);
  assert.equal(
    sourceOnly.status,
    "deployed-source-verified-public-canary-pending",
  );

  const lifecycleOnly = stockPairedV2CaptureGates({
    ...neither,
    lifecycleEvidence: completeLifecycleEvidence(),
  });
  assert.equal(lifecycleOnly.publicLifecycleVerified, true);
  assert.equal(lifecycleOnly.releaseEligible, false);
  assert.equal(
    lifecycleOnly.status,
    "deployed-lifecycle-verified-source-pending",
  );

  const complete = stockPairedV2CaptureGates({
    addresses: plan.addresses,
    sourceVerification: completeSourceVerification(),
    lifecycleEvidence: completeLifecycleEvidence(),
  });
  assert.equal(complete.releaseEligible, true);
  assert.equal(complete.status, "deployment-source-and-lifecycle-verified");
});

test("requires seven exact Sourcify matches and truthful readable Etherscan records", () => {
  const complete = completeSourceVerification();
  assert.equal(
    stockPairedV2SourceVerificationComplete(complete, plan.addresses),
    true,
  );
  assert.equal(
    SOURCE_FIELDS.filter(
      (field) => complete[field].etherscan.status === "exact-match",
    ).length,
    1,
  );
  assert.equal(
    SOURCE_FIELDS.filter(
      (field) => complete[field].etherscan.status === "similar-match",
    ).length,
    6,
  );
  for (const field of SOURCE_FIELDS) {
    assert.equal(
      stockPairedV2EtherscanReadable(
        complete[field].etherscan,
        plan.addresses[field],
      ),
      true,
    );
    assert.equal(complete[field].sourcify.creationMatch, "match");
    assert.equal(complete[field].sourcify.runtimeMatch, "match");
  }
});

test("rejects missing, invalid, self-referential, or mismatched similar-match evidence", () => {
  const cases = [
    [
      "missing matched address",
      (record) => delete record.etherscan.matchedAddress,
    ],
    [
      "invalid matched address",
      (record) => (record.etherscan.matchedAddress = "not-an-address"),
    ],
    [
      "self-referential matched address",
      (record) =>
        (record.etherscan.matchedAddress = plan.addresses.positionPlanner),
    ],
    [
      "wrong current URL",
      (record) =>
        (record.etherscan.url = etherscanCodeUrl(plan.addresses.quoteRegistry)),
    ],
    [
      "wrong matched URL",
      (record) =>
        (record.etherscan.matchedUrl = etherscanCodeUrl(
          similarMatchAddress(6),
        )),
    ],
  ];
  for (const [name, mutate] of cases) {
    const candidate = completeSourceVerification();
    mutate(candidate.positionPlanner);
    assert.equal(
      stockPairedV2SourceVerificationComplete(candidate, plan.addresses),
      false,
      name,
    );
  }
});

test("never treats similar evidence as exact and requires an actual exact Etherscan match", () => {
  const mislabeled = completeSourceVerification();
  mislabeled.positionPlanner.etherscan.status = "exact-match";
  assert.equal(
    stockPairedV2SourceVerificationComplete(mislabeled, plan.addresses),
    false,
  );

  assert.equal(
    stockPairedV2SourceVerificationComplete(
      completeSourceVerification({ allSimilar: true }),
      plan.addresses,
    ),
    false,
  );

  const twoExact = completeSourceVerification();
  twoExact.positionPlanner.etherscan = {
    status: "exact-match",
    url: etherscanCodeUrl(plan.addresses.positionPlanner),
  };
  assert.equal(
    stockPairedV2SourceVerificationComplete(twoExact, plan.addresses),
    false,
  );
});

test("rejects any missing Sourcify creation or runtime match", () => {
  for (const field of ["creationMatch", "runtimeMatch"]) {
    const candidate = completeSourceVerification();
    delete candidate.feeHook.sourcify[field];
    assert.equal(
      stockPairedV2SourceVerificationComplete(candidate, plan.addresses),
      false,
      field,
    );
  }

  const wrongUrl = completeSourceVerification();
  wrongUrl.feeHook.sourcify.url = sourcifyContractUrl(
    plan.addresses.quoteRegistry,
  );
  assert.equal(
    stockPairedV2SourceVerificationComplete(wrongUrl, plan.addresses),
    false,
  );
});

test("returns false for a missing or invalid deployed source address", () => {
  for (const address of [undefined, "not-an-address"]) {
    const addresses = {
      ...plan.addresses,
      positionPlanner: address,
    };
    assert.equal(
      stockPairedV2SourceVerificationComplete(
        completeSourceVerification(),
        addresses,
      ),
      false,
    );
  }
});

test("classifies Etherscan exact and similar records without conflating them", () => {
  const record = stockPairedV2SourceRecords(plan)[0];
  const local = standardJsonFixture(record);
  const base = {
    ContractName: record.contractName,
    CompilerVersion: "v0.8.26+commit.8a97fa7a",
    OptimizationUsed: "1",
    Runs: "1000",
    EVMVersion: "cancun",
    Proxy: "0",
    Implementation: "",
    ConstructorArguments: record.encodedConstructorArguments.slice(2),
    SourceCode: JSON.stringify(local),
    SimilarMatch: "",
  };

  assert.deepEqual(buildStockPairedV2EtherscanRecord(record, local, base), {
    status: "exact-match",
    url: etherscanCodeUrl(record.address),
  });

  const matchedAddress = similarMatchAddress(6);
  assert.deepEqual(
    buildStockPairedV2EtherscanRecord(record, local, {
      ...base,
      SimilarMatch: matchedAddress,
    }),
    {
      status: "similar-match",
      matchedAddress,
      url: etherscanCodeUrl(record.address),
      matchedUrl: etherscanCodeUrl(matchedAddress),
    },
  );
  assert.throws(
    () =>
      buildStockPairedV2EtherscanRecord(record, local, {
        ...base,
        SimilarMatch: record.address,
      }),
    /points to itself/,
  );
  assert.throws(
    () =>
      buildStockPairedV2EtherscanRecord(record, local, {
        ...base,
        SimilarMatch: "not-an-address",
      }),
    /similar match is invalid/,
  );
});

test("accepts workflow commits only when deployed release files still match", () => {
  assert(
    !STOCK_PAIRED_V2_IMMUTABLE_RELEASE_PATHS.includes(
      STOCK_PAIRED_V2_MANIFEST_PATH,
    ),
  );
  assert(!STOCK_PAIRED_V2_IMMUTABLE_RELEASE_PATHS.includes("package.json"));
  assert(
    STOCK_PAIRED_V2_IMMUTABLE_RELEASE_PATHS.includes(
      "contracts/src/StockPairedLaunchV1.sol",
    ),
  );
  assert.doesNotThrow(() =>
    assertStockPairedV2ReleaseSnapshot(root, evidence.releaseCommit),
  );
  assert.throws(
    () =>
      assertStockPairedV2ReleasePaths(root, evidence.releaseCommit, [
        STOCK_PAIRED_V2_MANIFEST_PATH,
      ]),
    /release file drifted/,
  );
});
