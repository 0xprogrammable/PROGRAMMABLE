import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";

import {
  STOCK_PAIRED_ETH_CANARY_ASSET,
  STOCK_PAIRED_ETH_CANARY_INITIAL_BUY,
  assertStockPairedEthCanaryRouteSafety,
  assertStockPairedEthCanaryRevalidation,
  buildStockPairedEthCanaryIdentity,
  buildStockPairedEthCanaryLaunch,
  buildStockPairedEthCanarySwap,
  parseStockPairedEthCanaryRecoveredBuy,
  parseStockPairedEthCanaryRecoveredCreatorClaim,
  parseStockPairedEthCanaryRecoveredLauncherClaim,
  parseStockPairedEthCanaryRecoveredSell,
  parseStockPairedEthCanaryLaunchReceipt,
  stockPairedEthCanaryCoordinatorEvent,
  stockPairedEthCanaryInitialBuyEvent,
  stockPairedEthCanaryLaunchEvent,
  stockPairedEthCanaryTransferEvent,
  stockPairedEthCanaryV3Path,
} from "../../../scripts/stock-paired-eth-canary-core.mjs";
import {
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_TREASURY,
} from "../../../scripts/stock-paired-mainnet-operator-core.mjs";

const releaseCommit = "1".repeat(40);
const coordinator = "0x7a737107E748717b7D9e3b98ab908b5AEC775A37";
const launcher = "0x195750f33caD5eF2DF857a53226B421297A1e79e";
const hook = "0x7773D183fe7B60d4F1885047fa42b815a62Fe0Cc";
const token = "0x1234567890123456789012345678901234567890";
const rewardVault = "0x2234567890123456789012345678901234567890";
const positionRecipient = "0x3234567890123456789012345678901234567890";
const poolId = `0x${"44".repeat(32)}`;
const launchHash = `0x${"55".repeat(32)}`;

test("builds a deterministic ETH-first launch without a stock approval", () => {
  const identity = buildStockPairedEthCanaryIdentity({ releaseCommit });
  assert.deepEqual(
    identity,
    buildStockPairedEthCanaryIdentity({ releaseCommit }),
  );
  assert.match(identity.metadata.description, /not equity/);
  const launch = buildStockPairedEthCanaryLaunch({
    coordinator,
    identity,
    minimumQuoteAmountOut: 1n,
    minimumInitialTokenOut: 1n,
    deadline: 2_000_000_000n,
  });
  assert.equal(launch.from, STOCK_PAIRED_DEPLOYER);
  assert.equal(launch.to, coordinator);
  assert.equal(BigInt(launch.value), STOCK_PAIRED_ETH_CANARY_INITIAL_BUY);
  assert.equal(launch.parameters.launch.initialBuyQuoteAmount, 0n);
  assert.deepEqual(launch.parameters.launch.rewardBeneficiaries, [
    STOCK_PAIRED_DEPLOYER,
  ]);
});

test("uses exact WETH USDC stock paths in both directions", () => {
  const buy = stockPairedEthCanaryV3Path("buy").toLowerCase();
  const sell = stockPairedEthCanaryV3Path("sell").toLowerCase();
  assert.ok(buy.startsWith("0xc02aaa39"));
  assert.ok(
    buy.endsWith(STOCK_PAIRED_ETH_CANARY_ASSET.address.slice(2).toLowerCase()),
  );
  assert.ok(
    sell.startsWith(STOCK_PAIRED_ETH_CANARY_ASSET.address.toLowerCase()),
  );
  assert.ok(sell.endsWith("c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"));
});

test("encodes atomic ETH buy and token sell through Universal Router 2.1.1", () => {
  const buy = buildStockPairedEthCanarySwap({
    token,
    hook,
    side: "buy",
    amountIn: 100_000_000_000_000n,
    quotedAmountOut: 1_000_000_000_000_000n,
    deadline: 2_000_000_000n,
  });
  const sell = buildStockPairedEthCanarySwap({
    token,
    hook,
    side: "sell",
    amountIn: 1_000_000_000_000_000n,
    quotedAmountOut: 90_000_000_000_000n,
    deadline: 2_000_000_000n,
  });
  assert.equal(buy.to, STOCK_PAIRED_DEPENDENCIES.universalRouter.address);
  assert.equal(sell.to, STOCK_PAIRED_DEPENDENCIES.universalRouter.address);
  assert.equal(BigInt(buy.value), 100_000_000_000_000n);
  assert.equal(BigInt(sell.value), 0n);
  assert.notEqual(buy.data, sell.data);
});

test("rejects an external route below the reviewed round-trip floor", () => {
  assert.equal(assertStockPairedEthCanaryRouteSafety(1_000n, 900n), true);
  assert.throws(
    () => assertStockPairedEthCanaryRouteSafety(1_000n, 899n),
    /too thin/,
  );
});

test("revalidates the exact reviewed request without rebuilding its deadline", () => {
  const prepared = {
    maximumDebit: "1100000",
    request: {
      nonce: "0x4",
      value: "0x186a0",
      gas: "0x186a0",
      maxFeePerGas: "0xa",
      maxPriorityFeePerGas: "0x1",
    },
  };
  const nonceStates = [
    { confirmed: "0x4", pending: "0x4", balance: "0x200000" },
    { confirmed: "0x4", pending: "0x4", balance: "0x200000" },
  ];
  const simulations = [
    { callResult: "0x01", estimatedGas: "0x15f90" },
    { callResult: "0x01", estimatedGas: "0x16120" },
  ];
  assert.equal(
    assertStockPairedEthCanaryRevalidation({
      prepared,
      nonceStates,
      simulations,
      baseFeePerGas: 8n,
    }),
    true,
  );
  assert.throws(
    () =>
      assertStockPairedEthCanaryRevalidation({
        prepared,
        nonceStates,
        simulations,
        baseFeePerGas: 10n,
      }),
    /fee cap/,
  );
  assert.throws(
    () =>
      assertStockPairedEthCanaryRevalidation({
        prepared,
        nonceStates: [nonceStates[0], { ...nonceStates[1], pending: "0x5" }],
        simulations,
        baseFeePerGas: 8n,
      }),
    /nonce/,
  );
});

test("correlates coordinator and base-launcher receipt events", () => {
  const launchedLog = {
    address: launcher,
    topics: encodeEventTopics({
      abi: [stockPairedEthCanaryLaunchEvent],
      eventName: "StockPairedTokenLaunched",
      args: {
        deployer: coordinator,
        token,
        quoteAsset: STOCK_PAIRED_ETH_CANARY_ASSET.address,
      },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("bytes32,address,address,uint256,bytes32"),
      [poolId, rewardVault, positionRecipient, 7n, launchHash],
    ),
  };
  const initialBuyLog = {
    address: launcher,
    topics: encodeEventTopics({
      abi: [stockPairedEthCanaryInitialBuyEvent],
      eventName: "StockPairedCreatorInitialBuy",
      args: {
        deployer: coordinator,
        token,
        quoteAsset: STOCK_PAIRED_ETH_CANARY_ASSET.address,
      },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("bytes32,uint256,uint256,bytes32"),
      [poolId, 20n, 30n, launchHash],
    ),
  };
  const coordinatorLog = {
    address: coordinator,
    topics: encodeEventTopics({
      abi: [stockPairedEthCanaryCoordinatorEvent],
      eventName: "StockPairedEthTokenLaunched",
      args: {
        creator: STOCK_PAIRED_DEPLOYER,
        token,
        quoteAsset: STOCK_PAIRED_ETH_CANARY_ASSET.address,
      },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("uint256,uint256,uint256,bytes32"),
      [STOCK_PAIRED_ETH_CANARY_INITIAL_BUY, 20n, 30n, launchHash],
    ),
  };
  const parsed = parseStockPairedEthCanaryLaunchReceipt(
    {
      status: "0x1",
      logs: [launchedLog, initialBuyLog, coordinatorLog],
    },
    { coordinator, launcher },
  );
  assert.equal(parsed.token, token);
  assert.equal(
    parsed.initialBuyEthAmount,
    STOCK_PAIRED_ETH_CANARY_INITIAL_BUY.toString(),
  );
  assert.equal(parsed.initialBuyQuoteAmount, "20");
  assert.equal(parsed.initialBuyTokenAmount, "30");
});

test("recovers only a successful Universal Router buy into the canary token", () => {
  const input =
    `0x3593564c${token.slice(2)}${hook.slice(2)}` +
    STOCK_PAIRED_ETH_CANARY_ASSET.address.slice(2);
  const blockHash = `0x${"66".repeat(32)}`;
  const transaction = {
    from: STOCK_PAIRED_DEPLOYER,
    to: STOCK_PAIRED_DEPENDENCIES.universalRouter.address,
    value: "0x5af3107a4000",
    input,
    blockHash,
  };
  const receipt = {
    status: "0x1",
    blockHash,
    logs: [
      {
        address: token,
        topics: encodeEventTopics({
          abi: [stockPairedEthCanaryTransferEvent],
          eventName: "Transfer",
          args: {
            from: STOCK_PAIRED_DEPENDENCIES.universalRouter.address,
            to: STOCK_PAIRED_DEPLOYER,
          },
        }),
        data: encodeAbiParameters(parseAbiParameters("uint256"), [123n]),
      },
    ],
  };
  assert.deepEqual(
    parseStockPairedEthCanaryRecoveredBuy(transaction, receipt, {
      token,
      hook,
    }),
    {
      receivedToken: "123",
      spentEth: "100000000000000",
    },
  );
  assert.throws(
    () =>
      parseStockPairedEthCanaryRecoveredBuy(
        { ...transaction, to: coordinator },
        receipt,
        { token, hook },
      ),
    /inconsistent/,
  );
});

test("recovers only the exact reviewed canary sell amount", () => {
  const input =
    `0x3593564c${token.slice(2)}${hook.slice(2)}` +
    STOCK_PAIRED_ETH_CANARY_ASSET.address.slice(2);
  const blockHash = `0x${"77".repeat(32)}`;
  const expectedAmount = 456n;
  const transaction = {
    from: STOCK_PAIRED_DEPLOYER,
    to: STOCK_PAIRED_DEPENDENCIES.universalRouter.address,
    value: "0x0",
    input,
    blockHash,
  };
  const receipt = {
    status: "0x1",
    blockHash,
    logs: [
      {
        address: token,
        topics: encodeEventTopics({
          abi: [stockPairedEthCanaryTransferEvent],
          eventName: "Transfer",
          args: {
            from: STOCK_PAIRED_DEPLOYER,
            to: STOCK_PAIRED_DEPENDENCIES.universalRouter.address,
          },
        }),
        data: encodeAbiParameters(parseAbiParameters("uint256"), [
          expectedAmount,
        ]),
      },
    ],
  };
  assert.deepEqual(
    parseStockPairedEthCanaryRecoveredSell(transaction, receipt, {
      token,
      hook,
      expectedAmount,
    }),
    { spentToken: expectedAmount.toString() },
  );
  assert.throws(
    () =>
      parseStockPairedEthCanaryRecoveredSell(transaction, receipt, {
        token,
        hook,
        expectedAmount: expectedAmount + 1n,
      }),
    /transfer is inconsistent/,
  );
});

test("recovers only a creator claim paid by the canary reward vault", () => {
  const blockHash = `0x${"88".repeat(32)}`;
  const transaction = {
    from: STOCK_PAIRED_DEPLOYER,
    to: rewardVault,
    value: "0x0",
    input: "0x4e71d92d",
    blockHash,
  };
  const receipt = {
    status: "0x1",
    blockHash,
    logs: [
      {
        address: STOCK_PAIRED_ETH_CANARY_ASSET.address,
        topics: encodeEventTopics({
          abi: [stockPairedEthCanaryTransferEvent],
          eventName: "Transfer",
          args: {
            from: rewardVault,
            to: STOCK_PAIRED_DEPLOYER,
          },
        }),
        data: encodeAbiParameters(parseAbiParameters("uint256"), [789n]),
      },
    ],
  };
  assert.deepEqual(
    parseStockPairedEthCanaryRecoveredCreatorClaim(transaction, receipt, {
      rewardVault,
    }),
    { receivedQuote: "789" },
  );
  assert.throws(
    () =>
      parseStockPairedEthCanaryRecoveredCreatorClaim(
        { ...transaction, input: "0x12345678" },
        receipt,
        { rewardVault },
      ),
    /inconsistent/,
  );
});

test("recovers only a launcher claim paid by the canonical PoolManager", () => {
  const blockHash = `0x${"99".repeat(32)}`;
  const transaction = {
    from: STOCK_PAIRED_TREASURY,
    to: hook,
    value: "0x0",
    input:
      "0xaee8cd6f000000000000000000000000" +
      STOCK_PAIRED_ETH_CANARY_ASSET.address.slice(2).toLowerCase(),
    blockHash,
  };
  const receipt = {
    status: "0x1",
    blockHash,
    logs: [
      {
        address: STOCK_PAIRED_ETH_CANARY_ASSET.address,
        topics: encodeEventTopics({
          abi: [stockPairedEthCanaryTransferEvent],
          eventName: "Transfer",
          args: {
            from: STOCK_PAIRED_DEPENDENCIES.poolManager.address,
            to: STOCK_PAIRED_TREASURY,
          },
        }),
        data: encodeAbiParameters(parseAbiParameters("uint256"), [987n]),
      },
    ],
  };
  assert.deepEqual(
    parseStockPairedEthCanaryRecoveredLauncherClaim(transaction, receipt, {
      feeHook: hook,
    }),
    { receivedQuote: "987" },
  );
  assert.throws(
    () =>
      parseStockPairedEthCanaryRecoveredLauncherClaim(
        { ...transaction, from: STOCK_PAIRED_DEPLOYER },
        receipt,
        { feeHook: hook },
      ),
    /inconsistent/,
  );
});
