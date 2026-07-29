import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import {
  DEEP_V2_MANIFEST_PATH,
  assessDeepV2LiveManifest,
  buildDeepV2DeploymentPlan,
  computeDeepV2SourceCommitment,
} from "../contracts/scripts/deep-full-range-release-v2-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, DEEP_V2_MANIFEST_PATH);
const schemaPath = path.join(
  root,
  "contracts/deployments/schema/deep-full-range-release-v2.schema.json",
);
const verifierPath = path.join(
  root,
  "contracts/scripts/verify-deep-full-range-release-v2-manifest.mjs",
);

function readJson(file: string) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function finalFixture() {
  const manifest = structuredClone(readJson(manifestPath));
  const hash = (byte: string) => `0x${byte.repeat(64)}`;
  const address = (byte: string) => `0x${byte.repeat(40)}`;
  const deployer = address("1");
  const plan = buildDeepV2DeploymentPlan(deployer, 7, root);

  manifest.status = "deployment-source-and-lifecycle-verified";
  manifest.releaseEligible = true;
  manifest.releaseCommit = "1".repeat(40);
  manifest.startBlock = 100;
  manifest.startingNonce = 7;
  manifest.blockers = [];
  manifest.candidatePlan = {
    ...manifest.candidatePlan,
    status: "reviewed-at-signing",
    observedAtBlock: 99,
    deployer,
    startingNonce: 7,
    growthVaultFactory: plan.growthVaultFactory,
    growthVaultImplementation: plan.growthVaultImplementation,
    launcher: plan.launcher,
    automation: plan.automation,
    positionPlanner: plan.positionPlanner,
  };
  manifest.addresses = {
    ...manifest.addresses,
    deployer,
    growthVaultFactory: plan.growthVaultFactory,
    growthVaultImplementation: plan.growthVaultImplementation,
    launcher: plan.launcher,
    automation: plan.automation,
    positionPlanner: plan.positionPlanner,
  };
  manifest.transactions = {
    growthVaultFactory: hash("a"),
    growthVaultImplementation: hash("a"),
    launcher: hash("b"),
    automation: hash("b"),
    positionPlanner: hash("b"),
  };
  manifest.deploymentBlocks = {
    growthVaultFactory: 100,
    growthVaultImplementation: 100,
    launcher: 101,
    automation: 101,
    positionPlanner: 101,
  };
  manifest.deploymentEvidence = {
    growthVaultFactory: {
      transactionHash: hash("a"),
      blockNumber: 100,
      blockHash: hash("c"),
      receiptStatus: "success",
      nonce: 7,
      valueWei: "0",
      from: deployer,
      to: null,
      transactionInputHash: hash("d"),
    },
    growthVaultImplementation: {
      transactionHash: hash("a"),
      blockNumber: 100,
      blockHash: hash("c"),
      receiptStatus: "success",
    },
    launcher: {
      transactionHash: hash("b"),
      blockNumber: 101,
      blockHash: hash("e"),
      receiptStatus: "success",
      nonce: 8,
      valueWei: "0",
      from: deployer,
      to: null,
      transactionInputHash: hash("f"),
    },
    automation: {
      transactionHash: hash("b"),
      blockNumber: 101,
      blockHash: hash("e"),
      receiptStatus: "success",
    },
    positionPlanner: {
      transactionHash: hash("b"),
      blockNumber: 101,
      blockHash: hash("e"),
      receiptStatus: "success",
    },
  };
  for (const field of [
    "growthVaultFactory",
    "growthVaultImplementation",
    "launcher",
    "automation",
    "positionPlanner",
  ]) {
    manifest.runtimeCodeHashes[field] = hash("9");
    manifest.sourceVerification.contracts[field] = {
      ...manifest.sourceVerification.contracts[field],
      status: "exact-match",
      encodedConstructorArguments: "0x",
      etherscan: {
        status: "exact-match",
        url: `https://etherscan.io/address/${manifest.addresses[field]}#code`,
      },
      sourcify: {
        status: "exact-match",
        url: `https://repo.sourcify.dev/contracts/full_match/1/${manifest.addresses[field]}/`,
      },
    };
  }
  manifest.lifecycleEvidence = {
    ...manifest.lifecycleEvidence,
    status: "verified-current-release",
    releaseEligible: true,
    independentRpcCount: 2,
    canaryToken: address("7"),
    launchTransaction: hash("1"),
    oracleTransaction: hash("2"),
    feeProcessCompoundTransaction: hash("3"),
    keeperExecutor: address("8"),
    keeperExecutorRuntimeCodeHash: hash("8"),
    keeperExecutorDeploymentTransaction: hash("4"),
    keeperExecutorDeploymentBlock: 102,
    evidenceHash: hash("5"),
    noActionKeeperCycle: {
      status: "verified-no-transaction",
      outcome: "idle",
      readyVaults: 0,
      submittedTransaction: false,
      observedAtBlock: 110,
      evidenceHash: hash("6"),
    },
    actionableKeeperCycle: {
      status: "verified-compound-confirmed",
      outcome: "confirmed-productive",
      readyVaults: 1,
      successfulCandidates: 1,
      transactionHash: hash("3"),
      blockNumber: 109,
      evidenceHash: hash("7"),
    },
  };
  manifest.sourceVerification.contracts.keeperExecutor = {
    ...manifest.sourceVerification.contracts.keeperExecutor,
    status: "exact-match",
    encodedConstructorArguments: "0x",
    etherscan: {
      status: "exact-match",
      url: `https://etherscan.io/address/${manifest.lifecycleEvidence.keeperExecutor}#code`,
    },
    sourcify: {
      status: "exact-match",
      url: `https://repo.sourcify.dev/contracts/full_match/1/${manifest.lifecycleEvidence.keeperExecutor}/`,
    },
  };
  manifest.sourceVerification.status = "verified";
  manifest.keeperPolicy = {
    ...manifest.keeperPolicy,
    status: "verified-ready-disabled-by-default",
    coordinator: address("8"),
    coordinatorRuntimeCodeHash: hash("8"),
    coordinatorSourceCommitment: hash("9"),
    automation: manifest.addresses.automation,
    automationRuntimeCodeHash: manifest.runtimeCodeHashes.automation,
    signerAddress: address("9"),
  };
  manifest.activation = {
    appStatus: "ready",
    keeperStatus: "ready",
    requiresExactManifestMatch: true,
  };
  return manifest;
}

describe("Deep V2 release toolchain", () => {
  it("keeps the checked-in not-deployed manifest schema-valid and source-bound", () => {
    const manifest = readJson(manifestPath);
    const schema = readJson(schemaPath);
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);

    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.status).toBe("not-deployed");
    expect(manifest.releaseEligible).toBe(false);
    expect(manifest.transactionCount).toBe(2);
    expect(manifest.sourceCommitment).toBe(
      computeDeepV2SourceCommitment(root),
    );
  });

  it("plans exactly two broadcaster CREATE transactions around the pinned shared stack", () => {
    const plan = buildDeepV2DeploymentPlan(
      "0xdeef000000000000000000000000000000000002",
      17,
      root,
    );

    expect(plan.transactionCount).toBe(2);
    expect(plan.feeSplitVaultFactory).toBe(
      "0xF15D4528Db481732Cdb94FC2558d04ce4D85Cb54",
    );
    expect(plan.feeHook).toBe(
      "0x48dC3009eC1d3298BBA31f718A9A29d02fC9B0cC",
    );
    expect(plan.growthVaultFactory).not.toBe(plan.launcher);
    expect(plan.sourceCommitment).toBe(
      computeDeepV2SourceCommitment(root),
    );
  });

  it("fails closed until deployment, exact source records, and lifecycle evidence all exist", () => {
    const pending = assessDeepV2LiveManifest(readJson(manifestPath));
    expect(pending.ready).toBe(false);
    expect(pending.reasons).toContain("final deployment status");
    expect(pending.reasons).toContain("two deployment receipts");
    expect(pending.reasons).toContain("exact source verification");
    expect(pending.reasons).toContain("current-release lifecycle evidence");

    const complete = finalFixture();
    expect(assessDeepV2LiveManifest(complete)).toEqual({
      ready: true,
      reasons: [],
    });

    complete.deploymentEvidence.launcher = null;
    const missingReceipt = assessDeepV2LiveManifest(complete);
    expect(missingReceipt.ready).toBe(false);
    expect(missingReceipt.reasons).toContain("two deployment receipts");
  });

  it("validates the pending manifest offline without making a live claim", () => {
    const output = execFileSync(process.execPath, [verifierPath, "--offline"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain(
      "Deep V2 manifest is structurally valid and source-bound (offline)",
    );
  });

  it("requires two explicit RPCs before any --require-live claim", () => {
    const env = { ...process.env };
    delete env.ETHEREUM_RPC_URL;
    delete env.ETHEREUM_RPC_URL_SECONDARY;
    delete env.ETHEREUM_RPC_URL_B;
    delete env.ETHERSCAN_API_KEY;
    const result = spawnSync(
      process.execPath,
      [verifierPath, "--require-live"],
      { cwd: root, encoding: "utf8", env },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "--require-live requires two distinct explicit RPCs",
    );
  });
});
