import assert from "node:assert/strict";
import test from "node:test";

import {
  STOCK_PAIRED_CANARY_INITIAL_BUY,
  buildStockPairedCanaryIdentity,
  buildStockPairedCanaryLaunch,
  buildStockPairedCanaryLauncherClaim,
  buildStockPairedCanaryPermit2Approval,
  buildStockPairedCanarySwap,
  buildStockPairedCanaryTokenApproval,
  stockPairedCanaryPoolKey,
} from "../../../scripts/stock-paired-mainnet-canary-core.mjs";
import {
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_TREASURY,
} from "../../../scripts/stock-paired-mainnet-operator-core.mjs";

const releaseCommit = "1".repeat(40);
const launcher = "0x195750f33caD5eF2DF857a53226B421297A1e79e";
const hook = "0x7773D183fe7B60d4F1885047fa42b815a62Fe0Cc";
const quoteAsset = "0x0e397938C1Aa0680954093495B70A9F5e2249aBa";
const token = "0x1234567890123456789012345678901234567890";

test("builds a deterministic, factual Stock-Paired canary launch", () => {
  const identity = buildStockPairedCanaryIdentity({
    releaseCommit,
    quoteSymbol: "QQQon",
  });
  const again = buildStockPairedCanaryIdentity({
    releaseCommit,
    quoteSymbol: "QQQon",
  });
  assert.deepEqual(identity, again);
  assert.equal(identity.symbol, "SPQQQON");
  assert.match(identity.metadata.description, /not equity/);
  const launch = buildStockPairedCanaryLaunch({
    launcher,
    quoteAsset,
    identity,
  });
  assert.equal(
    launch.parameters.initialBuyQuoteAmount,
    STOCK_PAIRED_CANARY_INITIAL_BUY,
  );
  assert.deepEqual(launch.parameters.rewardBeneficiaries, [
    STOCK_PAIRED_DEPLOYER,
  ]);
  assert.deepEqual(launch.parameters.rewardSharesBps, [10_000]);
  assert.equal(launch.approval.to, quoteAsset);
  assert.equal(launch.launch.to, launcher);
  assert.equal(launch.launch.value, "0x0");
});

test("uses the official V4 and Universal Router 2.1.1 swap path", () => {
  const poolKey = stockPairedCanaryPoolKey({
    token,
    quoteAsset,
    hook,
  });
  assert.equal(poolKey.fee, 0);
  assert.equal(poolKey.tickSpacing, 200);
  assert.equal(poolKey.hooks, hook);
  const swap = buildStockPairedCanarySwap({
    token,
    quoteAsset,
    hook,
    side: "buy",
    amountIn: 1_000n,
    quotedAmountOut: 100n,
    deadline: 2_000_000_000n,
  });
  assert.equal(swap.to, STOCK_PAIRED_DEPENDENCIES.universalRouter.address);
  assert.equal(swap.value, "0x0");
  assert.equal(swap.amountOutMinimum, "95");
  assert.equal(swap.inputAsset, quoteAsset);
  assert.equal(swap.outputAsset, token);
});

test("scopes exact token and Permit2 approvals to the reviewed router", () => {
  const tokenApproval = buildStockPairedCanaryTokenApproval({
    token: quoteAsset,
    amount: 1_000n,
  });
  const permit2Approval = buildStockPairedCanaryPermit2Approval({
    token: quoteAsset,
    amount: 1_000n,
    expiration: 2_000_000_000n,
  });
  assert.equal(tokenApproval.to, quoteAsset);
  assert.equal(permit2Approval.to, STOCK_PAIRED_DEPENDENCIES.permit2.address);
  assert.equal(tokenApproval.from, STOCK_PAIRED_DEPLOYER);
  assert.equal(permit2Approval.from, STOCK_PAIRED_DEPLOYER);
});

test("launcher fee claims require the immutable treasury account", () => {
  const claim = buildStockPairedCanaryLauncherClaim({
    feeHook: hook,
    quoteAsset,
  });
  assert.equal(claim.from, STOCK_PAIRED_TREASURY);
  assert.equal(claim.to, hook);
  assert.equal(claim.value, "0x0");
});
