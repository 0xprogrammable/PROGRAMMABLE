import assert from "node:assert/strict";
import test from "node:test";

import { keccak256, stringToHex } from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_NEW_CONTRACTS,
  CLASSIC_V4_OFFICIAL_DEPENDENCIES,
  CLASSIC_V4_SHARED_DEPENDENCIES,
  artifactRuntimeDescriptor,
  buildClassicV4LifecycleReleaseCandidate,
  digestJson,
} from "../../../scripts/classic-v4-release-core.mjs";
import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
  CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS,
  CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
  CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
  buildClassicV4LauncherUpgradePlan,
  buildClassicV4LauncherUpgradeReceiptEvidence,
  buildClassicV4LauncherUpgradeVerificationEvidence,
  classicV4LauncherUpgradeConstructorArguments,
  computeClassicV4LauncherUpgradeBuildCommitments,
} from "../../../scripts/classic-v4-launcher-upgrade-core.mjs";
import {
  CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS,
  CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS,
  validateClassicV4LauncherRollforwardArtifacts,
  validateClassicV4LauncherRollforwardDeploymentEvidence,
  validateClassicV4LauncherRollforwardPlan,
  validateClassicV4LauncherRollforwardSourceEvidence,
  validateClassicV4LauncherUpgradeVerificationEvidence,
} from "../../../scripts/classic-v4-launcher-rollforward-core.mjs";

const HASH = (label) => keccak256(stringToHex(`rollforward:${label}`));
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);

function artifact(label, { launcher = false } = {}) {
  const seed = HASH(`artifact:${label}`).slice(2);
  return {
    bytecode: { object: `0x60006000${seed}` },
    deployedBytecode: {
      object: `0x60016000${seed}`,
      immutableReferences: {},
    },
    metadata: {
      compiler: { version: "0.8.26+commit.8a97fa7a" },
      settings: {
        optimizer: { enabled: true, runs: 1_000 },
        evmVersion: "cancun",
        metadata: { bytecodeHash: "none", appendCBOR: false },
      },
      sources: {
        [`src/${launcher ? "MemeLaunchV4" : label}.sol`]: {
          keccak256: HASH(`source:${label}`),
        },
        "lib/v4-core/src/Test.sol": {
          keccak256: HASH(`dependency:${label}`),
        },
      },
    },
  };
}

function sourceClosure(artifactValue) {
  const sources = Object.entries(artifactValue.metadata.sources)
    .map(([sourcePath, source]) => ({
      sourcePath,
      sourceHash: source.keccak256,
    }))
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  return digestJson(
    sources,
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.artifactSourceClosure,
  );
}

function sourceRecord({ target, address, transactionHash, blockNumber, args }) {
  return {
    address,
    contractName: target.contractName,
    fqcn: target.fqcn,
    encodedConstructorArguments: args,
    deploymentTransaction: transactionHash,
    deploymentBlock: blockNumber,
    status: "match",
    providers: [
      {
        name: "Sourcify",
        status: "match",
        url: `https://sourcify.dev/server/v2/contract/1/${address}`,
      },
    ],
  };
}

function redigestPlan(plan) {
  plan.sourceCommitment = digestJson(
    {
      lineage: plan.lineage,
      predictedAddresses: plan.predictedAddresses,
      runtimeTemplates: plan.runtimeTemplates,
      artifactSourceClosures: plan.artifactSourceClosures,
      constructorArguments: plan.constructorArguments,
      launcherDependencies: plan.launcherDependencies,
      sourceTargets: plan.sourceTargets,
    },
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.sourceCommitment,
  );
  plan.planDigest = digestJson(
    Object.fromEntries(
      Object.entries(plan).filter(([key]) => key !== "planDigest"),
    ),
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.preparationPlan,
  );
  return plan;
}

function compositeFixture() {
  const artifacts = {
    hookFactory: artifact("EthCreatorFeeHookFactoryV4"),
    feeHook: artifact("EthCreatorFeeHookV4"),
    positionPlanner: artifact("ClassicPositionPlannerV1"),
    launcher: artifact("MemeLaunchV4", { launcher: true }),
  };
  const addresses = {
    hookFactory: "0x00000000000000000000000000000000000000A1",
    feeHook: CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES.feeHook.address,
    positionPlanner:
      CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES.positionPlanner.address,
    launcher: "0x00000000000000000000000000000000000000A4",
  };
  const constructorArguments = {
    hookFactory: "0x",
    feeHook: "0x",
    positionPlanner: "0x",
    launcher: classicV4LauncherUpgradeConstructorArguments(),
  };
  const transactionData = {
    hookFactory: "0x6001",
    feeHook: "0x6002",
    positionPlanner: "0x6003",
    launcher:
      artifacts.launcher.bytecode.object + constructorArguments.launcher.slice(2),
  };
  const nonces = [345, 346, 347, 351];
  const transactions = CLASSIC_V4_NEW_CONTRACTS.map((name, index) => ({
    name,
    transactionType: name === "feeHook" ? "CALL_CREATE2" : "CREATE",
    from: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
    to: name === "feeHook" ? addresses.hookFactory : null,
    nonce: nonces[index],
    value: "0",
    predictedAddress: addresses[name],
    data: transactionData[name],
    dataHash: keccak256(transactionData[name]),
  }));
  const runtimeTemplates = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name) => [
      name,
      artifactRuntimeDescriptor(artifacts[name], name),
    ]),
  );
  const deploymentRecords = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name, index) => {
      const blockNumber = index === 3 ? 150 : 100 + index;
      return [
        name,
        {
          transactionHash: HASH(`tx:${name}`),
          blockNumber,
          blockHash: HASH(`block:${name}`),
          confirmations: 200 - blockNumber + 1,
          address: addresses[name],
          nonce: nonces[index],
          from: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
          to: name === "feeHook" ? addresses.hookFactory : null,
          dataHash: keccak256(transactionData[name]),
          value: "0",
          runtimeCodeHash:
            name === "feeHook" || name === "positionPlanner"
              ? CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES[name].runtimeCodeHash
              : HASH(`runtime:${name}`),
          runtimeTemplateHash: runtimeTemplates[name].runtimeTemplateHash,
        },
      ];
    }),
  );
  const launcherSource = sourceRecord({
    name: "launcher",
    target: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
    address: addresses.launcher,
    transactionHash: deploymentRecords.launcher.transactionHash,
    blockNumber: deploymentRecords.launcher.blockNumber,
    args: constructorArguments.launcher,
  });
  const sourcePinsDigest = HASH("source-pins");
  const launcherBuild = computeClassicV4LauncherUpgradeBuildCommitments(
    artifacts.launcher,
  );
  const upgradeSourceCommitment = digestJson(
    {
      contract: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
      artifact: launcherBuild.artifact,
      sourceClosureDigest: launcherBuild.sourceClosureDigest,
      sourcePinsDigest,
      dependencies: CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
      router: CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
      constructorArguments: constructorArguments.launcher,
    },
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.sourceCommitment,
  );
  const plan = redigestPlan({
    schemaVersion: 1,
    status: "launcher-rollforward-composite",
    model: "classic",
    internalContractRelease: "classic-v4",
    chainId: 1,
    releaseCommit: COMMIT,
    releaseTree: TREE,
    sourceCommitment: HASH("placeholder"),
    deployer: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
    predictedAddresses: addresses,
    launcherFeeRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    officialDependencies: CLASSIC_V4_OFFICIAL_DEPENDENCIES,
    sharedDependencies: CLASSIC_V4_SHARED_DEPENDENCIES,
    runtimeTemplates,
    artifactSourceClosures: Object.fromEntries(
      CLASSIC_V4_NEW_CONTRACTS.map((name) => [
        name,
        sourceClosure(artifacts[name]),
      ]),
    ),
    constructorArguments,
    transactions,
    router: CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
    launcherDependencies: CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
    sourceTargets: CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS,
    lineage: {
      baseRelease: {
        releaseCommit: "3".repeat(40),
        releaseTree: "4".repeat(40),
        sourceCommitment: HASH("base-source"),
        planDigest: HASH("base-plan"),
        deploymentEvidenceDigest: HASH("base-deployment"),
        sourceEvidenceDigest: HASH("base-source-evidence"),
      },
      launcherUpgrade: {
        releaseCommit: COMMIT,
        releaseTree: TREE,
        sourceCommitment: upgradeSourceCommitment,
        planDigest: HASH("upgrade-plan"),
        receiptEvidenceDigest: HASH("upgrade-receipt"),
        verificationEvidenceDigest: HASH("upgrade-verification"),
        launcherSourceRecordDigest: digestJson(
          launcherSource,
          CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.launcherSourceRecord,
        ),
        sourceClosureDigest: launcherBuild.sourceClosureDigest,
        sourcePinsDigest,
      },
    },
  });
  const deploymentBase = {
    schemaVersion: 1,
    chainId: 1,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "finalized",
    checkedAt: "2026-08-28T10:00:00.000Z",
    verificationBlock: 200,
    verificationBlockHash: HASH("verification-block"),
    independentRpcCount: 2,
    deploymentLive: true,
    runtimeCodeVerified: true,
    constructorBindingsVerified: true,
    contracts: deploymentRecords,
  };
  const deploymentEvidence = {
    ...deploymentBase,
    evidenceDigest: digestJson(
      deploymentBase,
      CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
    ),
  };
  const sourceContracts = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name) => [
      name,
      name === "launcher"
        ? launcherSource
        : sourceRecord({
            name,
            target: CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS[name],
            address: addresses[name],
            transactionHash: deploymentRecords[name].transactionHash,
            blockNumber: deploymentRecords[name].blockNumber,
            args: constructorArguments[name],
          }),
    ]),
  );
  const sourceBase = {
    schemaVersion: 1,
    chainId: 1,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "verified",
    checkedAt: "2026-08-28T10:05:00.000Z",
    contracts: sourceContracts,
  };
  const sourceEvidence = {
    ...sourceBase,
    evidenceDigest: digestJson(
      sourceBase,
      CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
    ),
  };
  return { artifacts, plan, deploymentEvidence, sourceEvidence };
}

test("composite keeps the old three contracts, accepts a nonce gap and binds V4", () => {
  const fixture = compositeFixture();
  assert.equal(validateClassicV4LauncherRollforwardPlan(fixture.plan), fixture.plan);
  assert.equal(
    validateClassicV4LauncherRollforwardArtifacts(
      fixture.plan,
      fixture.artifacts,
    ),
    fixture.artifacts,
  );
  validateClassicV4LauncherRollforwardDeploymentEvidence(
    fixture.plan,
    fixture.deploymentEvidence,
  );
  assert.equal(
    validateClassicV4LauncherRollforwardSourceEvidence(
      fixture.plan,
      fixture.deploymentEvidence,
      fixture.sourceEvidence,
    ),
    fixture.sourceEvidence,
  );
  assert.equal(fixture.plan.transactions[2].nonce, 347);
  assert.equal(fixture.plan.transactions[3].nonce, 351);
  assert.equal(fixture.plan.sourceTargets.launcher.contractName, "MemeLaunchV4");

  const candidate = buildClassicV4LifecycleReleaseCandidate(
    fixture.plan,
    fixture.deploymentEvidence,
    fixture.sourceEvidence,
  );
  assert.equal(candidate.addresses.launcher, fixture.plan.predictedAddresses.launcher);
});

test("plan fails closed on canonical drift and its digest binds parent lineage", () => {
  const fixture = compositeFixture();
  for (const mutate of [
    (plan) => {
      plan.router.address = "0x0000000000000000000000000000000000000001";
    },
    (plan) => {
      plan.launcherDependencies.feeHook.address =
        "0x0000000000000000000000000000000000000001";
    },
    (plan) => {
      plan.sourceTargets.launcher.contractName = "MemeLaunchV3";
    },
  ]) {
    const changed = structuredClone(fixture.plan);
    mutate(changed);
    redigestPlan(changed);
    assert.throws(() => validateClassicV4LauncherRollforwardPlan(changed));
  }

  const staleLineage = structuredClone(fixture.plan);
  staleLineage.lineage.baseRelease.planDigest = HASH("other-base-plan");
  assert.throws(() => validateClassicV4LauncherRollforwardPlan(staleLineage));
  const reboundLineage = redigestPlan(staleLineage);
  assert.notEqual(reboundLineage.planDigest, fixture.plan.planDigest);
  assert.equal(
    validateClassicV4LauncherRollforwardPlan(reboundLineage),
    reboundLineage,
  );
});

test("artifact and deployment validators reject V4 bytecode or retained runtime drift", () => {
  const fixture = compositeFixture();
  const artifacts = structuredClone(fixture.artifacts);
  artifacts.launcher.deployedBytecode.object = "0x60026000";
  assert.throws(() =>
    validateClassicV4LauncherRollforwardArtifacts(fixture.plan, artifacts),
  );

  const deployment = structuredClone(fixture.deploymentEvidence);
  deployment.contracts.feeHook.runtimeCodeHash = HASH("wrong-hook-runtime");
  const unsignedDeployment = Object.fromEntries(
    Object.entries(deployment).filter(([key]) => key !== "evidenceDigest"),
  );
  deployment.evidenceDigest = digestJson(
    unsignedDeployment,
    CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
  );
  assert.throws(() =>
    validateClassicV4LauncherRollforwardDeploymentEvidence(
      fixture.plan,
      deployment,
    ),
  );
});

test("source evidence requires the V4 target and canonical provider evidence", () => {
  const fixture = compositeFixture();
  for (const mutate of [
    (source) => {
      source.contracts.launcher.contractName = "MemeLaunchV3";
      source.contracts.launcher.fqcn = "src/MemeLaunchV3.sol:MemeLaunchV3";
    },
    (source) => {
      source.contracts.launcher.providers[0].url =
        "https://sourcify.dev/server/v2/contract/1/0x0000000000000000000000000000000000000001";
    },
    (source) => {
      source.contracts.launcher.encodedConstructorArguments = "0x";
    },
  ]) {
    const changed = structuredClone(fixture.sourceEvidence);
    mutate(changed);
    const unsignedSource = Object.fromEntries(
      Object.entries(changed).filter(([key]) => key !== "evidenceDigest"),
    );
    changed.evidenceDigest = digestJson(
      unsignedSource,
      CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
    );
    assert.throws(() =>
      validateClassicV4LauncherRollforwardSourceEvidence(
        fixture.plan,
        fixture.deploymentEvidence,
        changed,
      ),
    );
  }
});

function launcherUpgradeFixture() {
  const launcherArtifact = artifact("MemeLaunchV4", { launcher: true });
  const plan = buildClassicV4LauncherUpgradePlan({
    artifact: launcherArtifact,
    releaseCommit: COMMIT,
    releaseTree: TREE,
    repositoryClean: true,
    startingNonce: 351,
    observedAtBlock: 25_900_000,
    observedAtBlockHash: HASH("upgrade-observed-block"),
    sourcePinsDigest: HASH("upgrade-source-pins"),
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
      estimatedGas: "1200000",
      reviewedGasLimit: "1500000",
      gasPriceWei: "20000000000",
      deployerBalanceWei: "100000000000000000",
      requiredBalanceWei: "30000000000000000",
    },
  });
  const transactionHash = HASH("upgrade-transaction");
  const blockHash = HASH("upgrade-block");
  const blockNumber = 25_900_010;
  const receipt = buildClassicV4LauncherUpgradeReceiptEvidence({
    plan,
    transactionHash,
    transaction: {
      hash: transactionHash,
      from: plan.deployer,
      to: null,
      nonce: "0x15f",
      value: "0x0",
      input: plan.transaction.data,
      blockNumber: `0x${blockNumber.toString(16)}`,
      blockHash,
    },
    receipt: {
      status: "0x1",
      transactionHash,
      from: plan.deployer,
      to: null,
      contractAddress: plan.predictedAddress,
      blockNumber: `0x${blockNumber.toString(16)}`,
      blockHash,
      gasUsed: "0x124f80",
      effectiveGasPrice: "0x4a817c800",
    },
  });
  const verification = buildClassicV4LauncherUpgradeVerificationEvidence({
    plan,
    receiptEvidence: receipt,
    verificationBlock: blockNumber + 11,
    verificationBlockHash: HASH("upgrade-verification-block"),
    verificationTimestamp: 1_788_000_000,
    runtimeCode: launcherArtifact.deployedBytecode.object,
    artifact: launcherArtifact,
  });
  return { plan, receipt, verification };
}

test("launcher final evidence validator binds receipt, runtime and all final checks", () => {
  const fixture = launcherUpgradeFixture();
  assert.equal(
    validateClassicV4LauncherUpgradeVerificationEvidence(
      fixture.plan,
      fixture.receipt,
      fixture.verification,
    ),
    fixture.verification,
  );
  for (const mutate of [
    (evidence) => {
      evidence.runtimeCodeHash = HASH("wrong-runtime");
    },
    (evidence) => {
      evidence.dependencyBindingsVerified = false;
    },
    (evidence) => {
      evidence.receiptEvidenceDigest = HASH("wrong-receipt");
    },
  ]) {
    const changed = structuredClone(fixture.verification);
    mutate(changed);
    assert.throws(() =>
      validateClassicV4LauncherUpgradeVerificationEvidence(
        fixture.plan,
        fixture.receipt,
        changed,
      ),
    );
  }
});
