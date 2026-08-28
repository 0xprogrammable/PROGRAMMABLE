import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { keccak256, stringToHex } from "viem";

import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
  buildClassicV4LauncherUpgradePlan,
  buildClassicV4LauncherUpgradeReceiptEvidence,
  buildClassicV4LauncherUpgradeVerificationEvidence,
} from "../../../scripts/classic-v4-launcher-upgrade-core.mjs";
import {
  buildClassicV4LauncherPublicationBundle,
  buildClassicV4LauncherStandardJsonInput,
  computeClassicV4LauncherSourceEvidenceReviewDigest,
  parseClassicV4LauncherSourceVerificationArguments,
  submitSources,
  validateClassicV4LauncherFinalityEvidence,
  verifyClassicV4LauncherSourceProviders,
  writeAcknowledgedClassicV4LauncherSourceEvidence,
} from "../verify-classic-v4-launcher-upgrade-sources.mjs";
import {
  compileClassicV4LauncherUpgradeFreshArtifact,
  loadClassicV4LauncherUpgradeSealedBuild,
  resolveClassicV4LauncherReviewedReleaseWorktree,
} from "../prepare-classic-v4-launcher-upgrade.mjs";
import {
  assertExactEtherscanMatch,
  standardJsonCompilerInputSettings,
} from "../verify-classic-v4-mainnet-sources.mjs";

const testPath = fileURLToPath(import.meta.url);
const contractsRoot = path.resolve(path.dirname(testPath), "..", "..");

const launcherPath = "src/MemeLaunchV4.sol";
const launcherSource =
  "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26; contract MemeLaunchV4 {}\n";
const dependencyPath = "lib/v4-core/src/Dependency.sol";
const dependencySource =
  "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26; library Dependency {}\n";
const runtimeTemplate = "0x6000600055";
const runtimeCode = "0x60ff600055";
const transactionHash = `0x${"ab".repeat(32)}`;
const transactionBlockHash = `0x${"cd".repeat(32)}`;
let freshArtifactPromise;

function freshArtifact() {
  freshArtifactPromise ??= compileClassicV4LauncherUpgradeFreshArtifact();
  return freshArtifactPromise;
}

function compiledArtifactOutput(artifact) {
  return {
    evm: {
      bytecode: { object: artifact.bytecode.object.slice(2) },
      deployedBytecode: { object: artifact.deployedBytecode.object.slice(2) },
    },
  };
}

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
          SourceCode: JSON.stringify({
            language: "Solidity",
            sources,
            settings: standardJsonCompilerInputSettings(
              artifact.metadata.settings,
            ),
          }),
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

test("source verifier requires an explicit absolute reviewed release worktree", () => {
  const required = [
    "--plan",
    "/tmp/launcher-plan.json",
    "--receipt-evidence",
    "/tmp/launcher-receipt.json",
    "--finality-evidence",
    "/tmp/launcher-finality.json",
  ];
  assert.throws(
    () => parseClassicV4LauncherSourceVerificationArguments(required),
    /reviewed-release-worktree must be an absolute path/,
  );
  assert.throws(
    () =>
      parseClassicV4LauncherSourceVerificationArguments([
        ...required,
        "--reviewed-release-worktree",
        "relative/release",
      ]),
    /reviewed-release-worktree must be an absolute path/,
  );
  const parsed = parseClassicV4LauncherSourceVerificationArguments([
    ...required,
    "--reviewed-release-worktree",
    "/tmp/reviewed-release",
  ]);
  assert.equal(
    parsed.reviewedReleaseWorktree,
    "/tmp/reviewed-release",
  );
});

test("reviewed release worktree resolver rejects root and parent symlinks", async (t) => {
  const temporaryRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "classic-v4-reviewed-root-")),
  );
  t.after(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  const realParent = path.join(temporaryRoot, "real-parent");
  const reviewedRoot = path.join(realParent, "reviewed-release");
  await mkdir(reviewedRoot, { recursive: true });
  assert.equal(
    await resolveClassicV4LauncherReviewedReleaseWorktree(reviewedRoot),
    reviewedRoot,
  );

  const rootLink = path.join(temporaryRoot, "reviewed-link");
  await symlink(reviewedRoot, rootLink);
  await assert.rejects(
    resolveClassicV4LauncherReviewedReleaseWorktree(rootLink),
    /real non-symlink directory/,
  );

  const parentLink = path.join(temporaryRoot, "parent-link");
  await symlink(realParent, parentLink);
  await assert.rejects(
    resolveClassicV4LauncherReviewedReleaseWorktree(
      path.join(parentLink, "reviewed-release"),
    ),
    /real non-symlink directory/,
  );
});

test("sealed build uses only the exact clean registered detached release root", async (t) => {
  const values = fixture();
  const reviewedRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "classic-v4-sealed-root-")),
  );
  t.after(async () => {
    await rm(reviewedRoot, { recursive: true, force: true });
  });
  const rootStats = await stat(reviewedRoot);
  const identity = {
    repositoryTopLevel: reviewedRoot,
    repositoryRealpath: reviewedRoot,
    repositoryDevice: String(rootStats.dev),
    repositoryInode: String(rootStats.ino),
    repositoryIsDirectory: true,
    repositoryIsSymbolicLink: false,
    releaseCommit: values.plan.releaseCommit,
    releaseTree: values.plan.releaseTree,
    repositoryClean: true,
    detached: true,
    registeredDetachedWorktree: true,
  };
  const buildContexts = [];
  const sourcePinContexts = [];
  const artifact = await loadClassicV4LauncherUpgradeSealedBuild(
    values.plan,
    {
      reviewedReleaseWorktree: reviewedRoot,
      identityReader: async () => structuredClone(identity),
      sourcePinReader: async (_roots, context) => {
        sourcePinContexts.push(context);
        return { digest: values.plan.sourcePinsDigest };
      },
      artifactBuilder: async (context) => {
        buildContexts.push(context);
        return values.artifact;
      },
    },
  );
  const expectedContext = {
    repositoryDirectory: reviewedRoot,
    contractsDirectory: path.join(reviewedRoot, "contracts"),
  };
  assert.equal(artifact, values.artifact);
  assert.deepEqual(buildContexts, [expectedContext]);
  assert.deepEqual(sourcePinContexts, [
    expectedContext,
    expectedContext,
  ]);

  for (const mutate of [
    (changed) => {
      changed.detached = false;
    },
    (changed) => {
      changed.registeredDetachedWorktree = false;
    },
    (changed) => {
      changed.repositoryClean = false;
    },
    (changed) => {
      changed.releaseCommit = "9".repeat(40);
    },
    (changed) => {
      changed.releaseTree = "8".repeat(40);
    },
  ]) {
    const changed = structuredClone(identity);
    mutate(changed);
    await assert.rejects(
      loadClassicV4LauncherUpgradeSealedBuild(values.plan, {
        reviewedReleaseWorktree: reviewedRoot,
        identityReader: async () => structuredClone(changed),
        sourcePinReader: async () => ({
          digest: values.plan.sourcePinsDigest,
        }),
        artifactBuilder: async () => values.artifact,
      }),
      /Git identity differs/,
    );
  }

  let identityRead = 0;
  await assert.rejects(
    loadClassicV4LauncherUpgradeSealedBuild(values.plan, {
      reviewedReleaseWorktree: reviewedRoot,
      identityReader: async () => {
        identityRead += 1;
        return {
          ...structuredClone(identity),
          repositoryInode:
            identityRead === 1
              ? identity.repositoryInode
              : String(Number(identity.repositoryInode) + 1),
        };
      },
      sourcePinReader: async () => ({
        digest: values.plan.sourcePinsDigest,
      }),
      artifactBuilder: async () => values.artifact,
    }),
    /Git identity differs/,
  );
});

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

test("review digest survives only checkedAt refresh and writes fresh evidence once", async (t) => {
  const values = fixture();
  const calls = [];
  const verificationInput = {
    ...values,
    fetchJsonClient: providerFetch(values, calls),
    etherscanApiKey: null,
  };
  const reviewed = await verifyClassicV4LauncherSourceProviders({
    ...verificationInput,
    checkedAt: "2027-01-15T08:00:00.000Z",
  });
  const fresh = await verifyClassicV4LauncherSourceProviders({
    ...verificationInput,
    checkedAt: "2027-01-15T08:00:01.000Z",
  });
  const reviewDigest =
    computeClassicV4LauncherSourceEvidenceReviewDigest(reviewed);

  assert.notEqual(reviewed.evidenceDigest, fresh.evidenceDigest);
  assert.equal(
    computeClassicV4LauncherSourceEvidenceReviewDigest(fresh),
    reviewDigest,
  );
  assert.equal(calls.length, 2, "both captures perform a provider readback");

  const directory = await realpath(
    await mkdtemp(
      path.join(tmpdir(), "classic-v4-launcher-source-evidence-"),
    ),
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const output = path.join(directory, "source-evidence.json");
  const options = {
    output,
    wallet: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
    acknowledgement: null,
    reviewAcknowledgement: reviewDigest,
  };
  await writeAcknowledgedClassicV4LauncherSourceEvidence(fresh, options);

  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), fresh);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(
    writeAcknowledgedClassicV4LauncherSourceEvidence(fresh, options),
    /EEXIST/,
  );
});

test("review digest rejects material provider drift", async () => {
  const reviewedValues = fixture();
  const reviewed = await verifyClassicV4LauncherSourceProviders({
    ...reviewedValues,
    checkedAt: "2027-01-15T08:00:00.000Z",
    fetchJsonClient: providerFetch(reviewedValues, []),
    etherscanApiKey: null,
  });
  const freshValues = fixture();
  freshValues.sourcify.match = "exact_match";
  freshValues.sourcify.creationMatch = "exact_match";
  freshValues.sourcify.runtimeMatch = "exact_match";
  const fresh = await verifyClassicV4LauncherSourceProviders({
    ...freshValues,
    checkedAt: "2027-01-15T08:00:01.000Z",
    fetchJsonClient: providerFetch(freshValues, []),
    etherscanApiKey: null,
  });

  assert.notEqual(
    computeClassicV4LauncherSourceEvidenceReviewDigest(reviewed),
    computeClassicV4LauncherSourceEvidenceReviewDigest(fresh),
  );
});

test("uses Etherscan only when a key exists and never records it", async () => {
  const values = fixture();
  const calls = [];
  const evidence = await verifyClassicV4LauncherSourceProviders({
    ...values,
    checkedAt: "2027-01-15T08:00:00.000Z",
    fetchJsonClient: providerFetch(values, calls),
    etherscanApiKey: "test-only-key",
    compileEtherscanStandardJsonInput: async () =>
      compiledArtifactOutput(values.artifact),
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

test("rejects missing or contradictory Etherscan Standard JSON settings", async () => {
  for (const mutate of [
    (input) => {
      delete input.settings;
    },
    ...[
      "remappings",
      "optimizer",
      "metadata",
      "evmVersion",
      "viaIR",
      "libraries",
    ].map(
      (setting) => (input) => {
        delete input.settings[setting];
      },
    ),
    (input) => {
      input.settings.stopAfter = "parsing";
    },
    (input) => {
      input.settings = {
        ...input.settings,
        viaIR: true,
        remappings: ["forged/=lib/forged/"],
        debug: { revertStrings: "strip" },
      };
    },
  ]) {
    const values = fixture();
    const input = JSON.parse(values.etherscan.result[0].SourceCode);
    mutate(input);
    values.etherscan.result[0].SourceCode = JSON.stringify(input);
    await assert.rejects(
      verifyClassicV4LauncherSourceProviders({
        ...values,
        checkedAt: "2027-01-15T08:00:00.000Z",
        fetchJsonClient: providerFetch(values, []),
        etherscanApiKey: "test-only-key",
      }),
      /Etherscan metadata differs/,
    );
  }
});

test("accepts real Forge input only after exact sealed bytecode compilation", async () => {
  const artifact = await freshArtifact();
  const result = spawnSync(
    "forge",
    [
      "verify-contract",
      "--show-standard-json-input",
      "0x0000000000000000000000000000000000000001",
      "src/MemeLaunchV4.sol:MemeLaunchV4",
    ],
    {
      cwd: contractsRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const standardJsonInput = JSON.parse(result.stdout);
  assert(!Object.hasOwn(standardJsonInput.settings, "compilationTarget"));
  assert(Object.hasOwn(standardJsonInput.settings, "outputSelection"));
  assert.notDeepEqual(
    standardJsonInput.settings.remappings,
    artifact.metadata.settings.remappings,
  );
  const providerSource = {
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
    ConstructorArguments: "1234",
    SourceCode: JSON.stringify(standardJsonInput),
  };
  const providerSettings = {
    compilerVersion: "v0.8.26+commit.8a97fa7a",
    optimizationUsed: "1",
    optimizerRuns: "1000",
    evmVersion: "cancun",
  };
  await assert.doesNotReject(
    assertExactEtherscanMatch(
      { status: "1" },
      providerSource,
      { contractName: "MemeLaunchV4", fqcn: `${launcherPath}:MemeLaunchV4` },
      "0x1234",
      providerSettings,
      artifact,
    ),
  );
  await assert.rejects(
    assertExactEtherscanMatch(
      { status: "1" },
      providerSource,
      { contractName: "MemeLaunchV4", fqcn: `${launcherPath}:MemeLaunchV4` },
      "0x1234",
      providerSettings,
      artifact,
      async () => ({
        ...compiledArtifactOutput(artifact),
        evm: {
          ...compiledArtifactOutput(artifact).evm,
          bytecode: { object: "6000" },
        },
      }),
    ),
    /compiled bytecode differs from the sealed artifact/,
  );
});

test("frozen publication input compiles with pinned solc 0.8.26", async () => {
  const artifact = await freshArtifact();
  const { standardJsonInput } =
    await buildClassicV4LauncherStandardJsonInput({ artifact });
  assert(!Object.hasOwn(standardJsonInput.settings, "compilationTarget"));
  assert(Object.hasOwn(standardJsonInput.settings, "outputSelection"));
  const version = spawnSync("solc", ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /0\.8\.26\+commit\.8a97fa7a/);
  const compilation = spawnSync("solc", ["--standard-json"], {
    encoding: "utf8",
    input: JSON.stringify(standardJsonInput),
    maxBuffer: 256 * 1024 * 1024,
  });
  assert.equal(compilation.status, 0, compilation.stderr);
  const output = JSON.parse(compilation.stdout);
  assert.equal(
    output.errors?.filter(({ severity }) => severity === "error").length ?? 0,
    0,
    JSON.stringify(output.errors),
  );
  assert(output.contracts?.[launcherPath]?.MemeLaunchV4);
});

test("publication child receives frozen source bytes and the key only in env", async () => {
  const values = fixture();
  const liveSources = {
    [launcherPath]: launcherSource,
    [dependencyPath]: dependencySource,
  };
  const bundle = await buildClassicV4LauncherPublicationBundle({
    ...values,
    sourceReader: async (sourcePath) => liveSources[sourcePath],
  });
  liveSources[launcherPath] = `${launcherSource}// post-validation drift\n`;
  let writtenBundle;
  let child;
  let removed;
  await submitSources({
    verifier: "etherscan",
    bundle,
    environment: { ETHERSCAN_API_KEY: "test-only-secret" },
    temporaryParent: "/tmp",
    createTemporaryDirectory: async () => "/tmp/frozen-launcher-publication",
    writeBundle: async (_file, bytes) => {
      writtenBundle = JSON.parse(bytes);
    },
    execute: (command, args, options) => {
      child = { command, args, options };
      return { status: 0 };
    },
    removeTemporaryDirectory: async (directory) => {
      removed = directory;
    },
  });

  assert.equal(
    writtenBundle.standardJsonInput.sources[launcherPath].content,
    launcherSource,
  );
  assert(!JSON.stringify(writtenBundle).includes("post-validation drift"));
  assert(!JSON.stringify(child.args).includes("test-only-secret"));
  assert(!child.args.includes("--etherscan-api-key"));
  assert(child.args.includes(bundle.bundleDigest));
  assert.equal(child.options.env.ETHERSCAN_API_KEY, "test-only-secret");
  assert.equal(removed, "/tmp/frozen-launcher-publication");
});
