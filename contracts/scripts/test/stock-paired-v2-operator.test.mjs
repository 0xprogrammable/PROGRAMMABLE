import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  STOCK_PAIRED_DEPLOYER,
  assertStockPairedPreparedRefresh,
  assertStockPairedSequenceState,
  prepareStockPairedDeploymentTransaction,
} from "../../../scripts/stock-paired-mainnet-operator-core.mjs";
import {
  STOCK_PAIRED_V2_ASSETS,
  STOCK_PAIRED_V2_STOCK_POOL_FEES,
  loadStockPairedV2ReleasePlan,
} from "../../../scripts/stock-paired-v2-mainnet-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../../..");

function undeployedState(plan) {
  return {
    confirmedNonce: `0x${plan.startingNonce.toString(16)}`,
    pendingNonce: `0x${plan.startingNonce.toString(16)}`,
    balance: "0x8ac7230489e80000",
    gasPrice: "0x3b9aca00",
    baseFeePerGas: "0x1dcd6500",
    deployments: plan.transactions.map((transaction) => ({
      field: transaction.field,
      address: transaction.address,
      verified: false,
      runtimeCodeHash: null,
      runtimeBytes: 0,
    })),
  };
}

test("loads the exact seven-step Stock-Paired V2 Mainnet plan", async () => {
  const plan = await loadStockPairedV2ReleasePlan(root);
  assert.equal(plan.startingNonce, 102);
  assert.equal(plan.endingNonce, 109);
  assert.equal(plan.transactions.length, 7);
  assert.equal(plan.reviewedGas, "24062397");
  assert.equal(
    plan.sourceCommitment,
    "0x8514bb5b056fbb70d241c18f809dbfd8e99487d41f16ef5266df42150f2cf425",
  );
  assert.deepEqual(
    plan.transactions.map((transaction) => transaction.field),
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
  assert.equal(STOCK_PAIRED_V2_ASSETS.length, 11);
  assert.equal(STOCK_PAIRED_V2_STOCK_POOL_FEES.length, 11);
  assert.ok(
    plan.transactions.every(
      (transaction) =>
        transaction.value === "0x0" &&
        transaction.from.toLowerCase() === STOCK_PAIRED_DEPLOYER.toLowerCase(),
    ),
  );
});

test("prepares only nonce 102 from the reviewed V2 plan", async () => {
  const plan = await loadStockPairedV2ReleasePlan(root);
  const prepared = prepareStockPairedDeploymentTransaction(
    plan,
    undeployedState(plan),
    [
      { callResult: "0x", estimatedGas: "0x1b5900" },
      { callResult: "0x", estimatedGas: "0x1b5930" },
    ],
  );
  assert.equal(prepared.index, 0);
  assert.equal(prepared.field, "quoteRegistry");
  assert.equal(prepared.request.nonce, "0x66");
  assert.equal(prepared.request.value, "0x0");
  assert.equal(prepared.request.to, undefined);
  assert.equal(prepared.request.data, plan.transactions[0].data);
  assert.ok(
    BigInt(prepared.request.gas) <=
      BigInt(plan.transactions[0].reviewedGasLimit),
  );
});

test("blocks a pending nonce or a preoccupied V2 address", async () => {
  const plan = await loadStockPairedV2ReleasePlan(root);
  const pending = undeployedState(plan);
  pending.pendingNonce = "0x67";
  assert.throws(
    () =>
      prepareStockPairedDeploymentTransaction(plan, pending, [
        { callResult: "0x", estimatedGas: "0x1b5900" },
        { callResult: "0x", estimatedGas: "0x1b5900" },
      ]),
    /pending/,
  );

  const occupied = undeployedState(plan);
  occupied.deployments[6].verified = true;
  assert.throws(
    () => assertStockPairedSequenceState(plan, occupied),
    /before its reviewed nonce/,
  );
});

test("refreshes only the live fee envelope for the same reviewed transaction", async () => {
  const plan = await loadStockPairedV2ReleasePlan(root);
  const firstState = undeployedState(plan);
  const reviewed = prepareStockPairedDeploymentTransaction(plan, firstState, [
    { callResult: "0x", estimatedGas: "0x1b5900" },
    { callResult: "0x", estimatedGas: "0x1b5930" },
  ]);
  const laterState = undeployedState(plan);
  laterState.gasPrice = "0x4a817c80";
  laterState.baseFeePerGas = "0x2faf0800";
  const refreshed = prepareStockPairedDeploymentTransaction(plan, laterState, [
    { callResult: "0x", estimatedGas: "0x1b5920" },
    { callResult: "0x", estimatedGas: "0x1b5950" },
  ]);
  assert.notEqual(reviewed.preparedDigest, refreshed.preparedDigest);
  assert.equal(
    assertStockPairedPreparedRefresh(
      plan,
      {
        planDigest: plan.planDigest,
        index: reviewed.index,
        field: reviewed.field,
        address: reviewed.address,
        calldataHash: reviewed.calldataHash,
        nonce: reviewed.request.nonce,
        value: reviewed.request.value,
      },
      refreshed,
    ),
    refreshed,
  );
  assert.throws(
    () =>
      assertStockPairedPreparedRefresh(
        plan,
        {
          planDigest: plan.planDigest,
          index: reviewed.index,
          field: reviewed.field,
          address: reviewed.address,
          calldataHash: reviewed.calldataHash,
          nonce: "0x67",
          value: reviewed.request.value,
        },
        refreshed,
      ),
    /fields changed/,
  );
});
