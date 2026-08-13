import assert from "node:assert/strict";
import test from "node:test";

import {
  assessDeploymentCost,
  requireDistinctRpcOrigins,
} from "../custom-registry-v2-deployment-guards.mjs";

test("requires genuinely distinct RPC origins", () => {
  assert.throws(
    () => requireDistinctRpcOrigins("https://rpc.example/a", "https://rpc.example/b"),
    /origins must be distinct/,
  );
  assert.deepEqual(
    requireDistinctRpcOrigins("https://rpc-a.example/path", "https://rpc-b.example/path"),
    ["https://rpc-a.example", "https://rpc-b.example"],
  );
});

test("fails closed on block gas, fee, cost and balance ceilings", () => {
  const valid = {
    gasLimit: 1_000_000n,
    blockGasLimit: 36_000_000n,
    observedFeePerGas: 2n,
    maxFeePerGas: 3n,
    maxTotalCostWei: 3_000_000n,
    deployerBalance: 3_000_000n,
  };
  assert.equal(assessDeploymentCost(valid), 3_000_000n);
  assert.throws(() => assessDeploymentCost({ ...valid, blockGasLimit: valid.gasLimit }), /block gas/);
  assert.throws(() => assessDeploymentCost({ ...valid, observedFeePerGas: 4n }), /fee per gas/);
  assert.throws(() => assessDeploymentCost({ ...valid, maxTotalCostWei: 2_999_999n }), /maximum cost/);
  assert.throws(() => assessDeploymentCost({ ...valid, deployerBalance: 2_999_999n }), /balance is insufficient/);
});
