import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { getContractAddress, keccak256 } from "viem";

import {
  STOCK_PAIRED_ETH_COORDINATOR_ASSETS,
  STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER,
  assertStockPairedEthCoordinatorRuntime,
  assertStockPairedEthCoordinatorRevalidation,
  loadStockPairedEthCoordinatorPlan,
  prepareStockPairedEthCoordinatorTransaction,
  validateStockPairedEthCoordinatorReceipt,
} from "../../../scripts/stock-paired-eth-coordinator-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const releaseCommit = "1".repeat(40);
const nonce = 52;
const transactionHash = `0x${"11".repeat(32)}`;
const blockHash = `0x${"22".repeat(32)}`;

function patchImmutableReferences(artifact) {
  let runtime = artifact.deployedBytecode.object.slice(2).toLowerCase();
  const references = Object.values(
    artifact.deployedBytecode.immutableReferences,
  ).flat();
  references.forEach((reference, index) => {
    const start = reference.start * 2;
    const end = start + reference.length * 2;
    const value = (index + 1).toString(16).padStart(64, "0");
    runtime = `${runtime.slice(0, start)}${value}${runtime.slice(end)}`;
  });
  return `0x${runtime}`;
}

function deploymentState(plan, overrides = {}) {
  return {
    confirmedNonce: `0x${plan.nonce.toString(16)}`,
    pendingNonce: `0x${plan.nonce.toString(16)}`,
    balance: "0x8ac7230489e80000",
    baseFeePerGas: "0x1dcd6500",
    priorityFeePerGas: "0x5f5e100",
    code: "0x",
    ...overrides,
  };
}

test("builds one exact Mainnet coordinator deployment plan", async () => {
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce,
  });
  assert.equal(plan.chainId, 1);
  assert.equal(plan.deployer, STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER);
  assert.equal(plan.nonce, nonce);
  assert.equal(
    plan.address,
    getContractAddress({
      from: STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER,
      nonce: BigInt(nonce),
    }),
  );
  assert.equal(plan.calldataHash, keccak256(plan.data));
  assert.equal(plan.sourceCommitment, keccak256(plan.data));
  assert.equal(
    plan.routeChecks.length,
    STOCK_PAIRED_ETH_COORDINATOR_ASSETS.length,
  );
  assert.ok(plan.routeChecks.every((route) => route.fee > 0));
  assert.ok(plan.constructorArguments.length > 2);
});

test("accepts only runtime differences at compiler-declared immutable slots", async () => {
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce,
  });
  const runtime = patchImmutableReferences(plan.artifact);
  const result = assertStockPairedEthCoordinatorRuntime(plan.artifact, runtime);
  assert.equal(result.runtimeCodeHash, keccak256(runtime));
  assert.ok(result.runtimeBytes > 0);

  const last = runtime.endsWith("00") ? "01" : "00";
  assert.throws(
    () =>
      assertStockPairedEthCoordinatorRuntime(
        plan.artifact,
        `${runtime.slice(0, -2)}${last}`,
      ),
    /differs/,
  );
});

test("prepares one capped transaction only when two RPC simulations agree", async () => {
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce,
  });
  const runtime = patchImmutableReferences(plan.artifact);
  const prepared = prepareStockPairedEthCoordinatorTransaction(
    plan,
    deploymentState(plan),
    [
      { callResult: runtime, estimatedGas: "0x1e8480" },
      { callResult: runtime, estimatedGas: "0x1fbd00" },
    ],
  );
  assert.equal(prepared.address, plan.address);
  assert.equal(prepared.request.from, plan.deployer);
  assert.equal(prepared.request.data, plan.data);
  assert.equal(prepared.request.nonce, "0x34");
  assert.equal(prepared.request.value, "0x0");
  assert.equal(prepared.request.chainId, "0x1");
  assert.equal(prepared.runtimeCodeHash, keccak256(runtime));
  assert.ok(BigInt(prepared.request.gas) > 2_080_000n);
  assert.ok(BigInt(prepared.requiredBalance) > 0n);

  assert.throws(
    () =>
      prepareStockPairedEthCoordinatorTransaction(
        plan,
        deploymentState(plan, { pendingNonce: "0x35" }),
        [
          { callResult: runtime, estimatedGas: "0x1e8480" },
          { callResult: runtime, estimatedGas: "0x1e8480" },
        ],
      ),
    /pending transaction/,
  );
  assert.throws(
    () =>
      prepareStockPairedEthCoordinatorTransaction(plan, deploymentState(plan), [
        { callResult: runtime, estimatedGas: "0x1e8480" },
        {
          callResult: `${runtime.slice(0, -2)}${
            runtime.endsWith("00") ? "01" : "00"
          }`,
          estimatedGas: "0x1e8480",
        },
      ]),
    /disagree/,
  );
  assert.throws(
    () =>
      prepareStockPairedEthCoordinatorTransaction(
        plan,
        deploymentState(plan, { code: "0x01" }),
        [
          { callResult: runtime, estimatedGas: "0x1e8480" },
          { callResult: runtime, estimatedGas: "0x1e8480" },
        ],
      ),
    /already occupied/,
  );
});

test("binds the confirmed receipt to the reviewed calldata and fee caps", async () => {
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce,
  });
  const runtime = patchImmutableReferences(plan.artifact);
  const prepared = prepareStockPairedEthCoordinatorTransaction(
    plan,
    deploymentState(plan),
    [
      { callResult: runtime, estimatedGas: "0x1e8480" },
      { callResult: runtime, estimatedGas: "0x1e8480" },
    ],
  );
  const transaction = {
    hash: transactionHash,
    from: plan.deployer,
    to: null,
    nonce: prepared.request.nonce,
    input: plan.data,
    value: "0x0",
    chainId: "0x1",
    gas: prepared.request.gas,
    maxFeePerGas: prepared.request.maxFeePerGas,
    maxPriorityFeePerGas: prepared.request.maxPriorityFeePerGas,
  };
  const receipt = {
    transactionHash,
    status: "0x1",
    from: plan.deployer,
    to: null,
    contractAddress: plan.address,
    blockNumber: "0x100",
    blockHash,
    transactionIndex: "0x0",
    gasUsed: "0x1d4c00",
    effectiveGasPrice: prepared.request.maxFeePerGas,
  };
  const evidence = validateStockPairedEthCoordinatorReceipt(
    plan,
    prepared,
    transaction,
    receipt,
  );
  assert.equal(evidence.address, plan.address);
  assert.equal(evidence.transactionHash, transactionHash);
  assert.equal(evidence.runtimeCodeHash, prepared.runtimeCodeHash);

  assert.throws(
    () =>
      validateStockPairedEthCoordinatorReceipt(
        plan,
        prepared,
        { ...transaction, input: "0x1234" },
        receipt,
      ),
    /does not match/,
  );
  assert.throws(
    () =>
      validateStockPairedEthCoordinatorReceipt(
        plan,
        prepared,
        {
          ...transaction,
          maxFeePerGas: `0x${(
            BigInt(prepared.request.maxFeePerGas) + 1n
          ).toString(16)}`,
        },
        receipt,
      ),
    /does not match/,
  );
});

test("revalidates the reviewed request without rebinding it to a later block", async () => {
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce,
  });
  const runtime = patchImmutableReferences(plan.artifact);
  const prepared = prepareStockPairedEthCoordinatorTransaction(
    plan,
    deploymentState(plan),
    [
      { callResult: runtime, estimatedGas: "0x1e8480" },
      { callResult: runtime, estimatedGas: "0x1e8480" },
    ],
  );
  const simulations = [
    { callResult: runtime, estimatedGas: "0x1f0000" },
    { callResult: runtime, estimatedGas: "0x1f1000" },
  ];

  assert.equal(
    assertStockPairedEthCoordinatorRevalidation(
      plan,
      prepared,
      deploymentState(plan, {
        baseFeePerGas: "0x1e000000",
        priorityFeePerGas: "0x77359400",
      }),
      simulations,
    ),
    true,
  );

  assert.throws(
    () =>
      assertStockPairedEthCoordinatorRevalidation(
        plan,
        prepared,
        deploymentState(plan, { pendingNonce: "0x35" }),
        simulations,
      ),
    /pending transaction/,
  );
  assert.throws(
    () =>
      assertStockPairedEthCoordinatorRevalidation(
        plan,
        prepared,
        deploymentState(plan, {
          baseFeePerGas: prepared.request.maxFeePerGas,
        }),
        simulations,
      ),
    /gas moved above/,
  );
  assert.throws(
    () =>
      assertStockPairedEthCoordinatorRevalidation(
        plan,
        prepared,
        deploymentState(plan),
        [
          simulations[0],
          {
            callResult: runtime,
            estimatedGas: `0x${(BigInt(prepared.request.gas) + 1n).toString(
              16,
            )}`,
          },
        ],
      ),
    /no longer passes/,
  );
});
