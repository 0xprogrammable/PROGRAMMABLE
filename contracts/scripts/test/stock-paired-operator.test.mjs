import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_FINALITY_CONFIRMATIONS,
  STOCK_PAIRED_MAX_INITCODE_BYTES,
  STOCK_PAIRED_MAX_RUNTIME_BYTES,
  assertStockPairedArtifactSizeLimits,
  assertStockPairedSequenceState,
  createStockPairedReleaseEvidence,
  loadStockPairedReleasePlan,
  mergeStockPairedEvidenceRecord,
  prepareStockPairedDeploymentTransaction,
  validateStockPairedDeploymentTransactionRecord,
} from "../../../scripts/stock-paired-mainnet-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const transactionHash =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const blockHash =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const runtimeCodeHash =
  "0x3333333333333333333333333333333333333333333333333333333333333333";

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

test("loads the exact six-step Stock-Paired Mainnet plan", async () => {
  const plan = await loadStockPairedReleasePlan(root);
  assert.equal(plan.startingNonce, 46);
  assert.equal(plan.endingNonce, 52);
  assert.equal(plan.transactions.length, 6);
  assert.equal(
    plan.sourceCommitment,
    "0xa38eb2fead47e2dbfda7589ddeb235dd66c5dc26a604e49898a8bf51494b7693",
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
    ],
  );
  assert.ok(
    plan.transactions.every(
      (transaction) =>
        transaction.value === "0x0" &&
        transaction.from.toLowerCase() === STOCK_PAIRED_DEPLOYER.toLowerCase(),
    ),
  );
});

test("rejects artifacts above the Mainnet bytecode limits", () => {
  assert.throws(
    () =>
      assertStockPairedArtifactSizeLimits({
        oversizedRuntime: {
          contractName: "OversizedRuntime",
          bytecode: { object: "0x00" },
          deployedBytecode: {
            object: `0x${"00".repeat(STOCK_PAIRED_MAX_RUNTIME_BYTES + 1)}`,
          },
        },
      }),
    /EIP-170/,
  );
  assert.throws(
    () =>
      assertStockPairedArtifactSizeLimits({
        oversizedInitcode: {
          contractName: "OversizedInitcode",
          bytecode: {
            object: `0x${"00".repeat(STOCK_PAIRED_MAX_INITCODE_BYTES + 1)}`,
          },
          deployedBytecode: { object: "0x00" },
        },
      }),
    /EIP-3860/,
  );
});

test("prepares only the exact next transaction from two simulations", async () => {
  const plan = await loadStockPairedReleasePlan(root);
  const state = undeployedState(plan);
  const simulations = [
    { callResult: "0x", estimatedGas: "0x140000" },
    { callResult: "0x", estimatedGas: "0x142000" },
  ];
  const prepared = prepareStockPairedDeploymentTransaction(
    plan,
    state,
    simulations,
  );
  assert.equal(prepared.index, 0);
  assert.equal(prepared.field, "quoteRegistry");
  assert.equal(prepared.request.value, "0x0");
  assert.equal(prepared.request.nonce, "0x2e");
  assert.equal(prepared.request.to, undefined);
  assert.equal(prepared.request.data, plan.transactions[0].data);
  assert.ok(
    BigInt(prepared.request.gas) <=
      BigInt(plan.transactions[0].reviewedGasLimit),
  );
});

test("blocks pending nonces, disagreement and occupied future addresses", async () => {
  const plan = await loadStockPairedReleasePlan(root);
  const pending = undeployedState(plan);
  pending.pendingNonce = "0x2f";
  assert.throws(
    () =>
      prepareStockPairedDeploymentTransaction(plan, pending, [
        { callResult: "0x", estimatedGas: "0x140000" },
        { callResult: "0x", estimatedGas: "0x140000" },
      ]),
    /pending/,
  );

  const disagreement = undeployedState(plan);
  assert.throws(
    () =>
      prepareStockPairedDeploymentTransaction(plan, disagreement, [
        { callResult: "0x", estimatedGas: "0x140000" },
        { callResult: "0x01", estimatedGas: "0x140000" },
      ]),
    /disagree/,
  );

  const occupied = undeployedState(plan);
  occupied.deployments[4].verified = true;
  assert.throws(
    () => assertStockPairedSequenceState(plan, occupied),
    /before its reviewed nonce/,
  );
});

test("binds submitted transactions and receipts to the reviewed plan", async () => {
  const plan = await loadStockPairedReleasePlan(root);
  const expected = plan.transactions[0];
  const transaction = {
    hash: transactionHash,
    from: plan.deployer,
    to: null,
    nonce: expected.nonce,
    value: "0x0",
    input: expected.data,
    chainId: "0x1",
    gas: expected.reviewedGasLimit,
    maxFeePerGas: "0x3b9aca00",
    maxPriorityFeePerGas: "0x5f5e100",
    blockNumber: "0x100",
    blockHash,
  };
  const receipt = {
    transactionHash,
    status: "0x1",
    from: plan.deployer,
    to: null,
    contractAddress: expected.address,
    blockNumber: "0x100",
    blockHash,
    transactionIndex: "0x0",
    gasUsed: "0x100000",
    effectiveGasPrice: "0x3b9aca00",
  };
  const record = validateStockPairedDeploymentTransactionRecord(
    plan,
    0,
    transaction,
    receipt,
  );
  assert.equal(record.status, "confirmed");
  assert.equal(record.receipt.contractAddress, expected.address.toLowerCase());

  assert.throws(
    () =>
      validateStockPairedDeploymentTransactionRecord(
        plan,
        0,
        { ...transaction, input: "0x1234" },
        receipt,
      ),
    /does not match/,
  );
});

test("marks release evidence ready only after all six finalized runtimes", async () => {
  const plan = await loadStockPairedReleasePlan(root);
  const evidence = createStockPairedReleaseEvidence(plan);
  for (const [index, expected] of plan.transactions.entries()) {
    const blockNumber = 100 + index;
    const hash = `0x${String(index + 1).padStart(64, "0")}`;
    mergeStockPairedEvidenceRecord(
      evidence,
      plan,
      index,
      {
        status: "confirmed",
        transaction: { hash },
        receipt: {
          status: "0x1",
          blockNumber: `0x${blockNumber.toString(16)}`,
        },
      },
      `0x${(blockNumber + STOCK_PAIRED_FINALITY_CONFIRMATIONS - 1).toString(
        16,
      )}`,
      {
        verified: true,
        runtimeCodeHash,
        field: expected.field,
      },
    );
  }
  assert.equal(evidence.receiptEvidenceReady, true);
  assert.ok(
    evidence.transactions.every(
      (transaction) => transaction.status === "finalized",
    ),
  );
});
