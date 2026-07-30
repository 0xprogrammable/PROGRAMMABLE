import assert from "node:assert/strict";
import test from "node:test";

import {
  activatedStockPairedV3Artifacts,
  assertStockPairedV3ActivationEvidence,
  STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE,
} from "../stock-paired-v3-public-activation-core.mjs";

const HASH = `0x${"11".repeat(32)}`;
const ADDRESS = `0x${"22".repeat(20)}`;
const sourceFields = [
  "quoteRegistry",
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
  "positionPlanner",
  "launcher",
  "ethLaunchCoordinator",
];
const newFields = [
  "positionPlanner",
  "launcher",
  "ethLaunchCoordinator",
];

function fixture() {
  const manifest = {
    schemaVersion: 3,
    model: "stock-paired",
    internalContractRelease: "stock-paired-v3",
    status: "deployment-source-and-lifecycle-verified",
    chainId: 1,
    releaseCommit: "a".repeat(40),
    sourceCommitment: HASH,
    addresses: Object.fromEntries(
      sourceFields.map((field) => [field, ADDRESS]),
    ),
    transactions: Object.fromEntries(
      newFields.map((field) => [field, HASH]),
    ),
    runtimeCodeHashes: Object.fromEntries(
      newFields.map((field) => [field, HASH]),
    ),
    sourceVerification: {
      status: "verified",
      ...Object.fromEntries(
        sourceFields.map((field) => [
          field,
          {
            status: "verified",
            address: ADDRESS,
            etherscan: newFields.includes(field)
              ? { status: "exact-match", similarMatch: null }
              : { status: "similar-match" },
            sourcify: {
              status: "match",
              creationMatch: "match",
              runtimeMatch: "match",
            },
          },
        ]),
      ),
    },
    lifecycleEvidence: {
      status: "verified-current-release",
      releaseEligible: true,
      independentRpcCount: 2,
      deploymentTransactionsVerified: true,
      runtimeBindingsVerified: true,
      ethCoordinatorDeploymentVerified: true,
      canaryLaunchTransaction: HASH,
      canaryQuoteAsset: ADDRESS,
      positionLockVerified: true,
      buyAndSellVerified: true,
      ethFirstLaunchVerified: true,
      ethBuyAndSellVerified: true,
      creatorClaimVerified: true,
      launcherClaimVerified: true,
      buyTransaction: HASH,
      sellTransaction: HASH,
      creatorClaimTransaction: HASH,
      launcherClaimTransaction: HASH,
    },
    activation: {
      publicLaunchesEnabled: false,
      reason: "Lifecycle pending",
    },
  };
  const deploymentEvidence = {
    schemaVersion: 1,
    internalContractRelease: "stock-paired-v3",
    releaseCommit: manifest.releaseCommit,
    sourceCommitment: manifest.sourceCommitment,
    independentRpcCount: 2,
    runtimeBindingsVerified: true,
    publicLaunchesEnabled: false,
    receipts: Object.fromEntries(
      newFields.map((field) => [
        field,
        {
          transactionHash: HASH,
          contractAddress: ADDRESS,
          runtimeCodeHash: HASH,
          blockNumber: 1,
        },
      ]),
    ),
  };
  return { manifest, deploymentEvidence };
}

test("builds only the reviewed local activation artifacts", () => {
  const input = fixture();
  assert.equal(assertStockPairedV3ActivationEvidence(input), true);
  const activated = activatedStockPairedV3Artifacts(input);
  assert.equal(activated.manifest.activation.publicLaunchesEnabled, true);
  assert.equal(activated.deploymentEvidence.publicLaunchesEnabled, true);
  assert.equal(input.manifest.activation.publicLaunchesEnabled, false);
  assert.deepEqual(Object.keys(activated), [
    "manifest",
    "deploymentEvidence",
  ]);
  assert.deepEqual(STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE, {
    path: "lib/stock-paired-access.ts",
    before: "export const STOCK_PAIRED_NEW_LAUNCHES_ENABLED = false;",
    after: "export const STOCK_PAIRED_NEW_LAUNCHES_ENABLED = true;",
  });
});

test("rejects lifecycle evidence that is not release-eligible", () => {
  const input = fixture();
  input.manifest.lifecycleEvidence.releaseEligible = false;
  assert.throws(
    () => assertStockPairedV3ActivationEvidence(input),
    /full two-RPC lifecycle is not release-eligible/,
  );
});

test("rejects a non-exact V3 source record", () => {
  const input = fixture();
  input.manifest.sourceVerification.launcher.etherscan.status =
    "similar-match";
  assert.throws(
    () => assertStockPairedV3ActivationEvidence(input),
    /launcher is not an exact Etherscan source match/,
  );
});

test("rejects mismatched deployment evidence", () => {
  const input = fixture();
  input.deploymentEvidence.receipts.launcher.runtimeCodeHash =
    `0x${"33".repeat(32)}`;
  assert.throws(
    () => assertStockPairedV3ActivationEvidence(input),
    /launcher deployment receipt does not match the manifest/,
  );
});

test("rejects an already enabled or partially enabled state", () => {
  const input = fixture();
  input.manifest.activation.publicLaunchesEnabled = true;
  assert.throws(
    () => assertStockPairedV3ActivationEvidence(input),
    /not in the reviewed disabled state/,
  );
});
