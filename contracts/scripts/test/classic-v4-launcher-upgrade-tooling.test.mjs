import assert from "node:assert/strict";
import test from "node:test";

import { getContractAddress, keccak256 } from "viem";

import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
  CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
  buildClassicV4LauncherUpgradePlan,
  buildClassicV4LauncherUpgradeReceiptEvidence,
  buildClassicV4LauncherUpgradeVerificationEvidence,
  classicV4LauncherUpgradeConstructorArguments,
  classicV4LauncherUpgradeRuntimeBindingChecks,
  computeClassicV4LauncherUpgradeBuildCommitments,
  validateClassicV4LauncherUpgradePlan,
  validateClassicV4LauncherUpgradeReceiptEvidence,
} from "../../../scripts/classic-v4-launcher-upgrade-core.mjs";
import { renderClassicV4LauncherUpgradeHtml } from "../../../scripts/serve-classic-v4-launcher-upgrade.mjs";
import {
  assertClassicV4LauncherUpgradePlanWriteAcknowledgement,
  assertClassicV4LauncherUpgradeRpcEndpoints,
  compileClassicV4LauncherUpgradeFreshArtifact,
} from "../prepare-classic-v4-launcher-upgrade.mjs";

const HASH = (byte) => `0x${byte.repeat(64)}`;
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const BLOCK_HASH = HASH("3");
const SOURCE_PINS_DIGEST = HASH("4");
const TRANSACTION_HASH = HASH("5");
const RECEIPT_BLOCK_HASH = HASH("6");

function artifactFixture() {
  return {
    bytecode: { object: "0x60006000556001600055" },
    deployedBytecode: {
      object: "0x6001600055",
      immutableReferences: {},
    },
    metadata: JSON.stringify({
      compiler: { version: "0.8.26+commit.8a97fa7a" },
      settings: {
        optimizer: { enabled: true, runs: 1_000 },
        evmVersion: "cancun",
        metadata: { bytecodeHash: "none", appendCBOR: false },
      },
      sources: {
        "src/MemeLaunchV4.sol": { keccak256: HASH("7") },
        "lib/v4-core/src/interfaces/IPoolManager.sol": {
          keccak256: HASH("8"),
        },
      },
    }),
  };
}

function snapshotFixture() {
  return {
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
  };
}

function planFixture() {
  return buildClassicV4LauncherUpgradePlan({
    artifact: artifactFixture(),
    releaseCommit: COMMIT,
    releaseTree: TREE,
    repositoryClean: true,
    startingNonce: 350,
    observedAtBlock: 25_900_000,
    observedAtBlockHash: BLOCK_HASH,
    sourcePinsDigest: SOURCE_PINS_DIGEST,
    snapshot: snapshotFixture(),
  });
}

function receiptFixture(plan) {
  const transaction = {
    hash: TRANSACTION_HASH,
    from: plan.deployer,
    to: null,
    nonce: "0x15e",
    value: "0x0",
    gas: `0x${BigInt(plan.transaction.gasLimit).toString(16)}`,
    input: plan.transaction.data,
    blockNumber: "0x18b8201",
    blockHash: RECEIPT_BLOCK_HASH,
  };
  const receipt = {
    status: "0x1",
    transactionHash: TRANSACTION_HASH,
    from: plan.deployer,
    to: null,
    contractAddress: plan.predictedAddress,
    blockNumber: "0x18b8201",
    blockHash: RECEIPT_BLOCK_HASH,
    gasUsed: "0x124f80",
    effectiveGasPrice: "0x4a817c800",
  };
  return { transaction, receipt };
}

test("launcher-only plan binds one direct CREATE from the exact dev-wallet nonce", () => {
  const artifact = artifactFixture();
  const plan = planFixture();
  const expectedAddress = getContractAddress({
    from: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
    nonce: 350n,
    opcode: "CREATE",
  });

  assert.equal(plan.transaction.transactionType, "CREATE");
  assert.equal(plan.transaction.to, null);
  assert.equal(plan.transaction.value, "0");
  assert.equal(plan.transaction.nonce, 350);
  assert.equal(plan.predictedAddress, expectedAddress);
  assert.equal(plan.transaction.predictedAddress, expectedAddress);
  assert.equal(plan.transaction.dataHash, keccak256(plan.transaction.data));
  assert.equal(
    plan.constructorArguments,
    classicV4LauncherUpgradeConstructorArguments(),
  );
  assert.deepEqual(plan.dependencies, CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES);
  assert.deepEqual(plan.router, CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER);
  assert.equal(plan.executionBoundary.signs, false);
  assert.equal(plan.executionBoundary.broadcasts, false);
  assert.equal(plan.executionBoundary.writes, false);
  assert.equal(validateClassicV4LauncherUpgradePlan(plan, artifact), plan);
});

test("plan validation fails closed on Router, dependency, calldata, gas or digest drift", () => {
  const artifact = artifactFixture();
  const plan = planFixture();
  for (const mutate of [
    (value) => {
      value.router.address = "0x0000000000000000000000000000000000000001";
    },
    (value) => {
      value.dependencies.feeHook.address =
        "0x0000000000000000000000000000000000000001";
    },
    (value) => {
      value.transaction.data = "0x6000";
    },
    (value) => {
      value.transaction.gasLimit = "8000001";
      value.preflight.reviewedGasLimit = "8000001";
    },
    (value) => {
      value.planDigest = HASH("9");
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert.throws(() => validateClassicV4LauncherUpgradePlan(changed, artifact));
  }
});

test("plan-file acknowledgement stays stable across volatile Mainnet snapshots", () => {
  const first = planFixture();
  const nextSnapshot = {
    ...snapshotFixture(),
    gasPriceWei: "21000000000",
    requiredBalanceWei: "31500000000000000",
  };
  const second = buildClassicV4LauncherUpgradePlan({
    artifact: artifactFixture(),
    releaseCommit: COMMIT,
    releaseTree: TREE,
    repositoryClean: true,
    startingNonce: 350,
    observedAtBlock: 25_900_001,
    observedAtBlockHash: HASH("a"),
    sourcePinsDigest: SOURCE_PINS_DIGEST,
    snapshot: nextSnapshot,
  });

  assert.notEqual(first.planDigest, second.planDigest);
  assert.equal(first.releaseSourceDigest, second.releaseSourceDigest);
  assert.doesNotThrow(() =>
    assertClassicV4LauncherUpgradePlanWriteAcknowledgement(second, {
      wallet: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
      acknowledgement: first.releaseSourceDigest,
    }),
  );
  assert.throws(
    () =>
      assertClassicV4LauncherUpgradePlanWriteAcknowledgement(second, {
        wallet: CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
        acknowledgement: first.planDigest,
      }),
    /acknowledge-release-source-digest/,
  );
});

test("fresh builder compiles only MemeLaunchV4 into disposable controlled output", async () => {
  const artifact = artifactFixture();
  const calls = [];
  let removed = null;
  const result = await compileClassicV4LauncherUpgradeFreshArtifact({
    environment: { PATH: "/usr/bin" },
    createTemporaryDirectory: async () => "/tmp/classic-v4-launcher-unit",
    removeTemporaryDirectory: async (directory, options) => {
      removed = { directory, options };
    },
    execute: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "", stderr: "" };
    },
    artifactLoader: async (outputDirectory) => {
      assert.equal(outputDirectory, "/tmp/classic-v4-launcher-unit/out");
      return artifact;
    },
    contractsDirectory: "/repo/contracts",
    temporaryParent: "/tmp",
  });

  assert.equal(result, artifact);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "forge");
  assert.ok(calls[0].args.includes("src/MemeLaunchV4.sol"));
  assert.ok(!calls[0].args.includes("src/MemeLaunchV3.sol"));
  assert.ok(!calls[0].args.includes("src/EthCreatorFeeHookV4.sol"));
  assert.deepEqual(Object.keys(calls[0].options.env).sort(), ["NO_COLOR", "PATH"]);
  assert.deepEqual(removed, {
    directory: "/tmp/classic-v4-launcher-unit",
    options: { recursive: true, force: true },
  });
});

test("artifact commitment is source-closure bound and enforces runtime budget", () => {
  const build = computeClassicV4LauncherUpgradeBuildCommitments(
    artifactFixture(),
  );
  assert.equal(build.artifact.bytes, 5);
  assert.deepEqual(build.dependencyRoots, ["v4-core"]);
  assert.match(build.sourceClosureDigest, /^0x[0-9a-f]{64}$/);

  const oversized = artifactFixture();
  oversized.deployedBytecode.object = `0x${"60".repeat(23_001)}`;
  assert.throws(
    () => computeClassicV4LauncherUpgradeBuildCommitments(oversized),
    /runtime budget/,
  );
});

test("receipt capture binds the exact transaction, CREATE address and block", () => {
  const plan = planFixture();
  const { transaction, receipt } = receiptFixture(plan);
  const evidence = buildClassicV4LauncherUpgradeReceiptEvidence({
    plan,
    transactionHash: TRANSACTION_HASH,
    transaction,
    receipt,
  });

  assert.equal(evidence.contractAddress, plan.predictedAddress);
  assert.equal(evidence.nonce, 350);
  assert.equal(evidence.dataHash, plan.transaction.dataHash);
  assert.equal(evidence.gasLimit, plan.transaction.gasLimit);
  assert.equal(
    validateClassicV4LauncherUpgradeReceiptEvidence(plan, evidence),
    evidence,
  );

  const wrong = structuredClone(transaction);
  wrong.input = "0x6000";
  assert.throws(
    () =>
      buildClassicV4LauncherUpgradeReceiptEvidence({
        plan,
        transactionHash: TRANSACTION_HASH,
        transaction: wrong,
        receipt,
      }),
    /differs/,
  );
});

test("receipt capture rejects a wallet-mutated gas limit", () => {
  const plan = planFixture();
  const { transaction, receipt } = receiptFixture(plan);
  transaction.gas = `0x${(BigInt(plan.transaction.gasLimit) + 1n).toString(16)}`;

  assert.throws(
    () =>
      buildClassicV4LauncherUpgradeReceiptEvidence({
        plan,
        transactionHash: TRANSACTION_HASH,
        transaction,
        receipt,
      }),
    /differs from the reviewed launcher deployment/,
  );
});

test("post-deploy evidence requires 12 confirmations and exact runtime template", () => {
  const artifact = artifactFixture();
  const plan = planFixture();
  const { transaction, receipt } = receiptFixture(plan);
  const receiptEvidence = buildClassicV4LauncherUpgradeReceiptEvidence({
    plan,
    transactionHash: TRANSACTION_HASH,
    transaction,
    receipt,
  });
  const verificationBlock = receiptEvidence.blockNumber + 11;
  const evidence = buildClassicV4LauncherUpgradeVerificationEvidence({
    plan,
    receiptEvidence,
    verificationBlock,
    verificationBlockHash: HASH("a"),
    verificationTimestamp: 1_787_900_000,
    runtimeCode: artifact.deployedBytecode.object,
    artifact,
  });
  assert.equal(evidence.status, "finalized");
  assert.equal(evidence.confirmations, 12);
  assert.equal(evidence.canonicalRouterVerified, true);

  assert.throws(
    () =>
      buildClassicV4LauncherUpgradeVerificationEvidence({
        plan,
        receiptEvidence,
        verificationBlock: verificationBlock - 1,
        verificationBlockHash: HASH("a"),
        verificationTimestamp: 1_787_900_000,
        runtimeCode: artifact.deployedBytecode.object,
        artifact,
      }),
    /12 confirmations/,
  );
  assert.throws(
    () =>
      buildClassicV4LauncherUpgradeVerificationEvidence({
        plan,
        receiptEvidence,
        verificationBlock,
        verificationBlockHash: HASH("a"),
        verificationTimestamp: 1_787_900_000,
        runtimeCode: "0x6002600055",
        artifact,
      }),
    /runtime differs/,
  );
});

test("runtime checks bind all nine constructor dependencies and the canonical Router", () => {
  const checks = classicV4LauncherUpgradeRuntimeBindingChecks(
    planFixture().predictedAddress,
  );
  assert.equal(checks.length, 15);
  assert.ok(checks.some((check) => check.label === "launcher canonical Router"));
  for (const dependency of Object.keys(CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES)) {
    const words = dependency.replace(/[A-Z]/g, (letter) => ` ${letter}`).toLowerCase();
    assert.ok(
      checks.some((check) =>
        check.label.toLowerCase().includes(words.split(" ").at(-1)),
      ),
      `missing runtime check for ${dependency}`,
    );
  }
});

test("local console exposes one owner-triggered MetaMask request and no signing primitive", () => {
  const html = renderClassicV4LauncherUpgradeHtml(
    planFixture(),
    "/session/test",
  );
  assert.equal((html.match(/eth_sendTransaction/g) ?? []).length, 1);
  for (const forbidden of [
    "eth_sendRawTransaction",
    "eth_signTransaction",
    "privateKey",
    "mnemonic",
    "wallet_sendCalls",
  ]) {
    assert.ok(!html.includes(forbidden), `console contains ${forbidden}`);
  }
  assert.ok(html.includes("MetaMask remains the only signer"));
  assert.ok(html.includes("0 ETH"));
});

test("RPC endpoint guard requires distinct credential-free HTTPS hosts", () => {
  assert.doesNotThrow(() =>
    assertClassicV4LauncherUpgradeRpcEndpoints([
      "https://rpc-a.example",
      "https://rpc-b.example",
    ]),
  );
  assert.throws(() =>
    assertClassicV4LauncherUpgradeRpcEndpoints([
      "https://rpc.example/a",
      "https://rpc.example/b",
    ]),
  );
  assert.throws(() =>
    assertClassicV4LauncherUpgradeRpcEndpoints([
      "http://rpc-a.example",
      "https://rpc-b.example",
    ]),
  );
  assert.throws(() =>
    assertClassicV4LauncherUpgradeRpcEndpoints([
      "https://user:secret@rpc-a.example",
      "https://rpc-b.example",
    ]),
  );
});
