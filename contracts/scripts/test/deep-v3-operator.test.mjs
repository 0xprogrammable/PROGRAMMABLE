import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeFunctionData,
} from "viem";

import {
  DEEP_V3_MIN_PRIORITY_FEE_PER_GAS_WEI,
  DEEP_V3_OPERATOR_RELEASE_PATHS,
  assertDeepV3OperatorCheckoutClean,
  buildDeepV3CanaryIdentity,
  buildDeepV3DeploymentFeePolicy,
  buildDeepV3OperatorPlan,
  decideDeepV3CanaryAction,
  deepV3OracleRepeatCount,
  encodeDeepV3CanaryLaunch,
  encodeDeepV3Compound,
  encodeDeepV3OracleGrowth,
  prepareDeepV3DeploymentTransaction,
  publicDeepV3DeploymentPlan,
  readDeepV3Manifest,
  validateDeepV3DeploymentTransactionRecord,
} from "../../../scripts/deep-v3-mainnet-operator-core.mjs";
import {
  DEEP_V3_RUNTIME_FIELDS,
} from "../deep-full-range-release-v3-core.mjs";
import {
  writeDeepV3LifecycleFiles,
} from "../deep-v3-lifecycle-write.mjs";
import {
  DEEP_V3_TRADE_MAX_NATIVE_VOLUME_WEI,
  assertDeepV3CanaryRequote,
  buildDeepV3CanaryTradePoolKey,
  deepV3GrowthFeeForGross,
  deepV3MinimumGrossVolumeForGrowth,
  deepV3TradePermit2Abi,
  deepV3TradeTokenAbi,
  getDeepV3CanaryTradePoolId,
  prepareDeepV3CanaryTradeCandidate,
  reconcileDeepV3CanaryTradeSnapshots,
} from "../../../scripts/deep-v3-canary-trade-core.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const deployer = "0x1111111111111111111111111111111111111111";
const startingNonce = 30;
const hookSalt =
  "0x000000000000000000000000000000000000000000000000000000000000253c";
const releaseCommit = "11".repeat(20);
const manifest = readDeepV3Manifest(root);
const tradeToken = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tradeVault = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const tradeRuntimeHash = `0x${"44".repeat(32)}`;
const tradeManifest = {
  addresses: {
    feeHook: "0x2222222222222222222222222222222222222222",
    launcher: "0x3333333333333333333333333333333333333333",
  },
  runtimeCodeHashes: {
    feeHook: tradeRuntimeHash,
    launcher: tradeRuntimeHash,
  },
  officialDependencies: {
    poolManager: {
      address: "0x4444444444444444444444444444444444444444",
      runtimeCodeHash: tradeRuntimeHash,
    },
    stateView: {
      address: "0x5555555555555555555555555555555555555555",
      runtimeCodeHash: tradeRuntimeHash,
    },
    v4Quoter: {
      address: "0x6666666666666666666666666666666666666666",
      runtimeCodeHash: tradeRuntimeHash,
    },
    universalRouter: {
      address: "0x7777777777777777777777777777777777777777",
      runtimeCodeHash: tradeRuntimeHash,
    },
    permit2: {
      address: "0x8888888888888888888888888888888888888888",
      runtimeCodeHash: tradeRuntimeHash,
    },
  },
};
const tradePoolKey = buildDeepV3CanaryTradePoolKey(
  tradeToken,
  tradeManifest.addresses.feeHook,
);
const tradePoolId = getDeepV3CanaryTradePoolId(tradePoolKey);

function tradeSnapshot(overrides = {}) {
  const runtimes = Object.fromEntries(
    [
      "poolManager",
      "stateView",
      "v4Quoter",
      "universalRouter",
      "permit2",
      "feeHook",
      "launcher",
    ].map((field) => {
      const binding =
        field === "feeHook" || field === "launcher"
          ? {
              address: tradeManifest.addresses[field],
              runtimeCodeHash:
                tradeManifest.runtimeCodeHashes[field],
            }
          : tradeManifest.officialDependencies[field];
      return [
        field,
        {
          address: binding.address,
          codeHash: binding.runtimeCodeHash,
        },
      ];
    }),
  );
  return {
    chainId: 1,
    account: deployer,
    blockNumber: 100,
    blockHash: `0x${"55".repeat(32)}`,
    timestamp: 10_000,
    confirmedNonce: 50,
    pendingNonce: 50,
    balance: (10n ** 18n).toString(),
    token: tradeToken,
    vault: tradeVault,
    poolId: tradePoolId,
    sqrtPriceX96: (1n << 96n).toString(),
    cardinalityNext: 192,
    oracleGrowthTimestamp: 8_000,
    hookGrowthFees: "0",
    pendingNative: "0",
    action: 0,
    compounded: false,
    tokenCodePresent: true,
    vaultCodePresent: true,
    vaultPoolId: tradePoolId,
    vaultToken: tradeToken,
    vaultHook: tradeManifest.addresses.feeHook,
    hookVault: tradeVault,
    hookRegistrar: tradeManifest.addresses.launcher,
    hookLifecycle: 5,
    totalHookFeeBps: 100,
    growthFeeBps: 90,
    programmableFeeBps: 10,
    transferTaxBps: 0,
    lpFeePips: 0,
    runtimes,
    ...overrides,
    ...(overrides.runtimes
      ? { runtimes: { ...runtimes, ...overrides.runtimes } }
      : {}),
  };
}

function tradeState(overrides = {}) {
  const snapshot = tradeSnapshot(overrides);
  return reconcileDeepV3CanaryTradeSnapshots({
    manifest: tradeManifest,
    expectedAccount: deployer,
    snapshots: [structuredClone(snapshot), structuredClone(snapshot)],
  });
}

function plan() {
  return buildDeepV3OperatorPlan({
    root,
    manifest,
    deployer,
    startingNonce,
    hookSalt,
    releaseCommit,
  });
}

function snapshots(completed, overrides = {}) {
  const value = plan();
  const deployed = new Map();
  for (const transaction of value.transactions) {
    for (const runtime of transaction.runtimes) {
      deployed.set(runtime.field, transaction.index < completed);
    }
  }
  const base = {
    chainId: 1,
    confirmedNonce: startingNonce + completed,
    pendingNonce: startingNonce + completed,
    balance: (10n ** 20n).toString(),
    runtimes: DEEP_V3_RUNTIME_FIELDS.map((field) => ({
      field,
      deployed: deployed.get(field),
    })),
    ...overrides,
  };
  return [structuredClone(base), structuredClone(base)];
}

test("builds exactly six zero-value V3 transactions and nine runtimes", () => {
  const value = plan();
  assert.equal(value.transactions.length, 6);
  assert.deepEqual(
    value.transactions.map((transaction) => transaction.nonce),
    [30, 31, 32, 33, 34, 35],
  );
  assert.ok(
    value.transactions.every(
      (transaction) =>
        transaction.value === 0n &&
        transaction.from.toLowerCase() === deployer &&
        /^0x[0-9a-f]{64}$/.test(transaction.calldataHash),
    ),
  );
  assert.equal(value.transactions[3].to, value.addresses.hookFactory);
  assert.equal(
    new Set(
      value.transactions.flatMap((transaction) =>
        transaction.runtimes.map((runtime) => runtime.field),
      ),
    ).size,
    9,
  );
  const publicPlan = publicDeepV3DeploymentPlan(value);
  assert.equal(publicPlan.transactions[0].valueWei, "0");
  assert.equal(publicPlan.sourceCommitment, manifest.sourceCommitment);
});

test("prepares only the exact next V3 transaction after dual simulations", () => {
  const value = plan();
  const prepared = prepareDeepV3DeploymentTransaction({
    plan: value,
    snapshots: snapshots(2),
    simulations: [
      { callResult: "0x", estimatedGas: "1000000" },
      { callResult: "0x", estimatedGas: "1100000" },
    ],
    feePolicy: {
      maxFeePerGas: 10_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
    },
  });
  assert.equal(prepared.index, 2);
  assert.equal(prepared.request.value, "0x0");
  assert.equal(prepared.request.nonce, "0x20");
  assert.equal(prepared.request.data, value.transactions[2].data);
  assert.equal(prepared.calldataHash, value.transactions[2].calldataHash);
});

test("derives a bounded fee envelope from both Mainnet RPCs", () => {
  const policy = buildDeepV3DeploymentFeePolicy([
    {
      baseFeePerGas: "60392420",
      maxPriorityFeePerGas: "0",
      gasPricePerGas: "61690483",
    },
    {
      baseFeePerGas: "60392420",
      maxPriorityFeePerGas: "49000",
      gasPricePerGas: "60441420",
    },
  ]);
  assert.equal(
    policy.maxPriorityFeePerGas,
    DEEP_V3_MIN_PRIORITY_FEE_PER_GAS_WEI,
  );
  assert.equal(policy.maxFeePerGas, 130_784_840n);

  const fallback = buildDeepV3DeploymentFeePolicy([
    {
      baseFeePerGas: "100",
      maxPriorityFeePerGas: null,
      gasPricePerGas: "110",
    },
    {
      baseFeePerGas: "120",
      maxPriorityFeePerGas: null,
      gasPricePerGas: "140",
    },
  ]);
  assert.equal(
    fallback.maxPriorityFeePerGas,
    DEEP_V3_MIN_PRIORITY_FEE_PER_GAS_WEI,
  );
  assert.equal(
    fallback.maxFeePerGas,
    240n + DEEP_V3_MIN_PRIORITY_FEE_PER_GAS_WEI,
  );

  assert.throws(
    () =>
      buildDeepV3DeploymentFeePolicy([
        {
          baseFeePerGas: "100",
          maxPriorityFeePerGas: null,
          gasPricePerGas: null,
        },
        {
          baseFeePerGas: "100",
          maxPriorityFeePerGas: null,
          gasPricePerGas: null,
        },
      ]),
    /priority-fee estimate/,
  );
  assert.throws(
    () =>
      buildDeepV3DeploymentFeePolicy([
        {
          baseFeePerGas: "100",
          maxPriorityFeePerGas: "5000000001",
          gasPricePerGas: "100",
        },
        {
          baseFeePerGas: "100",
          maxPriorityFeePerGas: "1",
          gasPricePerGas: "101",
        },
      ]),
    /priority fee exceeds/,
  );
});

test("operator signing paths must be tracked and clean", () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "deep-v3-operator-checkout-"),
  );
  try {
    execFileSync("git", ["init", "-q"], { cwd: temporaryRoot });
    for (const relativePath of DEEP_V3_OPERATOR_RELEASE_PATHS) {
      const target = path.join(temporaryRoot, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `${relativePath}\n`);
    }
    writeFileSync(path.join(temporaryRoot, "unrelated.txt"), "reviewed\n");
    execFileSync(
      "git",
      ["add", "--", ...DEEP_V3_OPERATOR_RELEASE_PATHS, "unrelated.txt"],
      {
        cwd: temporaryRoot,
      },
    );
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Programmable",
        "-c",
        "user.email=release@programmable.family",
        "commit",
        "-qm",
        "Bind Deep operator",
      ],
      { cwd: temporaryRoot },
    );
    assert.doesNotThrow(() =>
      assertDeepV3OperatorCheckoutClean(temporaryRoot),
    );

    execFileSync(
      "git",
      [
        "update-index",
        "--assume-unchanged",
        DEEP_V3_OPERATOR_RELEASE_PATHS[0],
      ],
      { cwd: temporaryRoot },
    );
    writeFileSync(
      path.join(temporaryRoot, DEEP_V3_OPERATOR_RELEASE_PATHS[0]),
      "modified\n",
    );
    assert.throws(
      () => assertDeepV3OperatorCheckoutClean(temporaryRoot),
      /differ from the current commit/,
    );
    execFileSync(
      "git",
      [
        "update-index",
        "--no-assume-unchanged",
        DEEP_V3_OPERATOR_RELEASE_PATHS[0],
      ],
      { cwd: temporaryRoot },
    );

    execFileSync("git", ["reset", "--hard", "-q", "HEAD"], {
      cwd: temporaryRoot,
    });
    execFileSync(
      "git",
      ["update-index", "--assume-unchanged", "unrelated.txt"],
      { cwd: temporaryRoot },
    );
    writeFileSync(path.join(temporaryRoot, "unrelated.txt"), "hidden\n");
    assert.throws(
      () => assertDeepV3OperatorCheckoutClean(temporaryRoot),
      /rejects assume-unchanged/,
    );
    execFileSync(
      "git",
      ["update-index", "--no-assume-unchanged", "unrelated.txt"],
      { cwd: temporaryRoot },
    );
    execFileSync("git", ["reset", "--hard", "-q", "HEAD"], {
      cwd: temporaryRoot,
    });

    writeFileSync(path.join(temporaryRoot, "untracked.txt"), "untracked\n");
    assert.throws(
      () => assertDeepV3OperatorCheckoutClean(temporaryRoot),
      /completely clean release worktree/,
    );
    rmSync(path.join(temporaryRoot, "untracked.txt"));

    rmSync(
      path.join(
        temporaryRoot,
        DEEP_V3_OPERATOR_RELEASE_PATHS.at(-1),
      ),
    );
    assert.throws(
      () => assertDeepV3OperatorCheckoutClean(temporaryRoot),
      /are missing/,
    );

    execFileSync("git", ["reset", "--hard", "-q", "HEAD"], {
      cwd: temporaryRoot,
    });
    const symlinkPath = DEEP_V3_OPERATOR_RELEASE_PATHS.at(-1);
    const symlinkTarget = DEEP_V3_OPERATOR_RELEASE_PATHS[0];
    rmSync(path.join(temporaryRoot, symlinkPath));
    symlinkSync(
      path.relative(path.dirname(symlinkPath), symlinkTarget),
      path.join(temporaryRoot, symlinkPath),
    );
    execFileSync("git", ["add", "--", symlinkPath], {
      cwd: temporaryRoot,
    });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Programmable",
        "-c",
        "user.email=release@programmable.family",
        "commit",
        "-qm",
        "Reject operator symlinks",
      ],
      { cwd: temporaryRoot },
    );
    assert.throws(
      () => assertDeepV3OperatorCheckoutClean(temporaryRoot),
      /must be regular files/,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("fails closed on pending nonce, occupied target, RPC drift, gas, or balance", () => {
  const value = plan();
  const pending = snapshots(0);
  pending[1].pendingNonce += 1;
  assert.throws(
    () =>
      prepareDeepV3DeploymentTransaction({
        plan: value,
        snapshots: pending,
        simulations: [
          { callResult: "0x", estimatedGas: "1" },
          { callResult: "0x", estimatedGas: "1" },
        ],
        feePolicy: {
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 0n,
        },
      }),
    /snapshot|pending|disagree/i,
  );

  const occupied = snapshots(0);
  occupied[0].runtimes[0].deployed = true;
  occupied[1].runtimes[0].deployed = true;
  assert.throws(
    () =>
      prepareDeepV3DeploymentTransaction({
        plan: value,
        snapshots: occupied,
        simulations: [
          { callResult: "0x", estimatedGas: "1" },
          { callResult: "0x", estimatedGas: "1" },
        ],
        feePolicy: {
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 0n,
        },
      }),
    /exists before/,
  );

  assert.throws(
    () =>
      prepareDeepV3DeploymentTransaction({
        plan: value,
        snapshots: snapshots(0),
        simulations: [
          { callResult: "0x01", estimatedGas: "1" },
          { callResult: "0x02", estimatedGas: "1" },
        ],
        feePolicy: {
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 0n,
        },
      }),
    /simulations disagree/,
  );

  assert.throws(
    () =>
      prepareDeepV3DeploymentTransaction({
        plan: value,
        snapshots: snapshots(0),
        simulations: [
          { callResult: "0x", estimatedGas: "5000001" },
          { callResult: "0x", estimatedGas: "5000001" },
        ],
        feePolicy: {
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 0n,
        },
      }),
    /gas ceiling/,
  );

  assert.throws(
    () =>
      prepareDeepV3DeploymentTransaction({
        plan: value,
        snapshots: snapshots(0, { balance: "1" }),
        simulations: [
          { callResult: "0x", estimatedGas: "1000000" },
          { callResult: "0x", estimatedGas: "1000000" },
        ],
        feePolicy: {
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 0n,
        },
      }),
    /balance/,
  );
});

test("validates one exact mined deployment envelope", () => {
  const value = plan();
  const expected = value.transactions[0];
  const hash = `0x${"22".repeat(32)}`;
  const blockHash = `0x${"33".repeat(32)}`;
  const transaction = {
    hash,
    from: expected.from,
    to: null,
    nonce: expected.nonce,
    value: 0n,
    input: expected.data,
    blockHash,
  };
  assert.deepEqual(
    validateDeepV3DeploymentTransactionRecord({
      plan: value,
      index: 0,
      transaction,
      receipt: {
        status: "0x1",
        transactionHash: hash,
        blockNumber: 100n,
        blockHash,
      },
    }),
    {
      status: "confirmed",
      hash,
      blockNumber: 100,
      blockHash,
    },
  );
  assert.throws(
    () =>
      validateDeepV3DeploymentTransactionRecord({
        plan: value,
        index: 0,
        transaction: { ...transaction, value: 1n },
        receipt: null,
      }),
    /reviewed/,
  );
});

test("keeps the canary flow bounded and requires fees after oracle maturity", () => {
  assert.equal(deepV3OracleRepeatCount(18), 11);
  assert.equal(deepV3OracleRepeatCount(178), 1);
  assert.throws(() => deepV3OracleRepeatCount(193), /invalid/);
  const vault = "0x2222222222222222222222222222222222222222";
  assert.match(encodeDeepV3OracleGrowth(vault, 18), /^0x[0-9a-f]+$/);
  assert.match(encodeDeepV3Compound(vault), /^0x[0-9a-f]+$/);

  const base = {
    launched: true,
    token: "0x3333333333333333333333333333333333333333",
    vault,
    cardinalityNext: 192,
    oracleGrowthTimestamp: 1_000,
    timestamp: 2_800,
    action: 0,
    compounded: false,
  };
  assert.equal(decideDeepV3CanaryAction(base), "waitFees");
  assert.equal(
    decideDeepV3CanaryAction({ ...base, action: 1 }),
    "compound",
  );
  assert.equal(
    decideDeepV3CanaryAction({ ...base, compounded: true }),
    "complete",
  );
  assert.equal(
    decideDeepV3CanaryAction({ ...base, timestamp: 2_799 }),
    "waitOracle",
  );
});

test("binds canary metadata and calldata to commit, signer, nonce, and protections", () => {
  const identity = buildDeepV3CanaryIdentity({
    releaseCommit,
    account: deployer,
    nonce: 50,
  });
  assert.equal(identity.name, "Deep Canary");
  assert.match(identity.creatorSalt, /^0x[0-9a-f]{64}$/);
  const data = encodeDeepV3CanaryLaunch({
    identity,
    minimumInitialTokenOut: 100n,
    initialBuySqrtPriceLimitX96: 200n,
    deadline: 300n,
  });
  assert.match(data, /^0x[0-9a-f]+$/);
  assert.throws(
    () =>
      encodeDeepV3CanaryLaunch({
        identity,
        minimumInitialTokenOut: 1n,
        initialBuySqrtPriceLimitX96: 200n,
        deadline: 300n,
      }),
    /protections/,
  );
});

test("canary trades reject the wrong account, PoolId, or runtime", () => {
  const wrongAccount = tradeSnapshot({
    account: "0x9999999999999999999999999999999999999999",
  });
  assert.throws(
    () =>
      reconcileDeepV3CanaryTradeSnapshots({
        manifest: tradeManifest,
        expectedAccount: deployer,
        snapshots: [
          structuredClone(wrongAccount),
          structuredClone(wrongAccount),
        ],
      }),
    /account state/,
  );

  const wrongPool = tradeSnapshot({
    poolId: `0x${"66".repeat(32)}`,
    vaultPoolId: `0x${"66".repeat(32)}`,
  });
  assert.throws(
    () =>
      reconcileDeepV3CanaryTradeSnapshots({
        manifest: tradeManifest,
        expectedAccount: deployer,
        snapshots: [
          structuredClone(wrongPool),
          structuredClone(wrongPool),
        ],
      }),
    /original PoolId/,
  );

  const wrongRuntime = tradeSnapshot({
    runtimes: {
      universalRouter: {
        address:
          tradeManifest.officialDependencies.universalRouter.address,
        codeHash: `0x${"77".repeat(32)}`,
      },
    },
  });
  assert.throws(
    () =>
      reconcileDeepV3CanaryTradeSnapshots({
        manifest: tradeManifest,
        expectedAccount: deployer,
        snapshots: [
          structuredClone(wrongRuntime),
          structuredClone(wrongRuntime),
        ],
      }),
    /universalRouter runtime drifted/,
  );
});

test("canary trades enforce bounded volume and reject stale quotes", () => {
  const requiredGross = deepV3MinimumGrossVolumeForGrowth(
    2_000_000_000_000_000n,
  );
  assert.ok(
    deepV3GrowthFeeForGross(requiredGross).growthFee >=
      2_000_000_000_000_000n,
  );
  assert.ok(
    deepV3GrowthFeeForGross(requiredGross - 1n).growthFee <
      2_000_000_000_000_000n,
  );
  const state = tradeState();
  const common = {
    manifest: tradeManifest,
    state,
    side: "buy",
    amountIn: 1_000_000_000_000_000n,
    quotedAmountOut: 980_000_000_000_000n,
    quoterGasEstimate: 200_000n,
    capturedAtMs: 1_000_000,
    nowMs: 1_000_010,
  };
  const prepared = prepareDeepV3CanaryTradeCandidate(common);
  const refreshed = prepareDeepV3CanaryTradeCandidate({
    ...common,
    capturedAtMs: 1_000_020,
    nowMs: 1_000_030,
  });
  assert.throws(
    () =>
      assertDeepV3CanaryRequote({
        prepared,
        refreshed,
        nowMs: 1_046_000,
      }),
    /stale/,
  );
  assert.throws(
    () =>
      prepareDeepV3CanaryTradeCandidate({
        ...common,
        amountIn: DEEP_V3_TRADE_MAX_NATIVE_VOLUME_WEI + 1n,
        quotedAmountOut:
          ((DEEP_V3_TRADE_MAX_NATIVE_VOLUME_WEI + 1n) * 98n) /
          100n,
      }),
    /volume bounds/,
  );
  assert.throws(
    () =>
      prepareDeepV3CanaryTradeCandidate({
        ...common,
        side: "sell",
        amountIn: 30_000_000_000_000_000n,
        quotedAmountOut: 29_000_000_000_000_000n,
      }),
    /volume bounds/,
  );
});

test("canary sells require exact token and Permit2 approvals before swap", () => {
  const state = tradeState();
  const common = {
    manifest: tradeManifest,
    state,
    side: "sell",
    amountIn: 1_000_000_000_000_000n,
    quotedAmountOut: 980_000_000_000_000n,
    quoterGasEstimate: 200_000n,
    capturedAtMs: 1_000_000,
    nowMs: 1_000_010,
  };
  const tokenApproval = prepareDeepV3CanaryTradeCandidate(common);
  assert.equal(tokenApproval.approvalState, "token-to-permit2");
  assert.equal(tokenApproval.transaction.kind, "token-to-permit2");
  const tokenCall = decodeFunctionData({
    abi: deepV3TradeTokenAbi,
    data: tokenApproval.transaction.data,
  });
  assert.equal(tokenCall.functionName, "approve");
  assert.equal(
    tokenCall.args[0].toLowerCase(),
    tradeManifest.officialDependencies.permit2.address.toLowerCase(),
  );
  assert.equal(tokenCall.args[1], common.amountIn);

  const permit2Approval = prepareDeepV3CanaryTradeCandidate({
    ...common,
    tokenAllowance: common.amountIn,
  });
  assert.equal(
    permit2Approval.approvalState,
    "permit2-to-router",
  );
  assert.equal(
    permit2Approval.transaction.kind,
    "permit2-to-router",
  );
  const permit2Call = decodeFunctionData({
    abi: deepV3TradePermit2Abi,
    data: permit2Approval.transaction.data,
  });
  assert.equal(permit2Call.functionName, "approve");
  assert.equal(permit2Call.args[0].toLowerCase(), tradeToken);
  assert.equal(
    permit2Call.args[1].toLowerCase(),
    tradeManifest.officialDependencies.universalRouter.address.toLowerCase(),
  );
  assert.equal(permit2Call.args[2], common.amountIn);

  const swap = prepareDeepV3CanaryTradeCandidate({
    ...common,
    tokenAllowance: common.amountIn,
    permit2Allowance: common.amountIn,
    permit2Expiration: 20_000n,
  });
  assert.equal(swap.approvalState, "ready");
  assert.equal(swap.transaction.kind, "swap");
  assert.equal(swap.transaction.value, 0n);
  assert.equal(
    swap.transaction.to.toLowerCase(),
    tradeManifest.officialDependencies.universalRouter.address.toLowerCase(),
  );
});

test("operator entrypoints are localhost-only, explicit, and V3-only", () => {
  const files = [
    "scripts/serve-deep-v3-mainnet-operator.mjs",
    "scripts/serve-deep-v3-mainnet-canary.mjs",
    "scripts/serve-deep-v3-mainnet-canary-trades.mjs",
    "contracts/scripts/capture-deep-full-range-v3-lifecycle.mjs",
  ].map((file) => readFileSync(path.join(root, file), "utf8"));
  assert.ok(files[0].includes('const HOST = "127.0.0.1"'));
  assert.ok(files[1].includes('const HOST = "127.0.0.1"'));
  assert.ok(files[2].includes('const HOST = "127.0.0.1"'));
  assert.ok(files[0].includes("callResultHash"));
  assert.ok(files[0].includes("callResultBytes"));
  assert.ok(files[0].includes("includeTransactionData: false"));
  assert.ok(files[0].includes("calldataBytes"));
  assert.ok(
    files.slice(0, 3).every(
      (source) =>
        source.includes("window.ethereum?.providers") &&
        source.includes("item?.isMetaMask") &&
        source.includes("MetaMask is unavailable"),
    ),
  );
  assert.ok(
    files.slice(0, 3).every(
      (source) => !source.includes("ethereum.request("),
    ),
  );
  assert.ok(files.every((source) => source.includes("--write")));
  assert.ok(
    files.every(
      (source) =>
        !source.includes("DeployMainnetDeepFullRangeInfrastructureV1") &&
        !source.includes("mainnet-deep-full-range-v1.json") &&
        !source.includes("deep-full-range-mainnet-canary-v1.json"),
    ),
  );
  assert.ok(
    files.every(
      (source) =>
        !/PRIVATE_KEY|MNEMONIC|wallet_addEthereumChain/.test(source),
    ),
  );
  assert.ok(
    files[3].includes(
      "contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json",
    ) ||
      files[3].includes("DEEP_V3_LIFECYCLE_EVIDENCE_PATH"),
  );
  assert.ok(files[3].includes("DEEP_V3_CONFIRMATIONS"));
  assert.ok(files[3].includes("verified-no-transaction"));
  assert.ok(files[3].includes("verified-compound-confirmed"));
  assert.ok(!files[2].includes("writeDeepV3LifecycleFiles"));
  assert.ok(!files[2].includes("writeFile"));
  assert.ok(!files[2].includes("eth_sendRawTransaction"));
  assert.ok(
    files[3].indexOf(
      "The keeper receipt is not one productive Deep V3 compound",
    ) <
      files[3].indexOf("await writeDeepV3LifecycleFiles"),
  );

  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["contracts:deep-v3:operator:deploy"],
    "node scripts/serve-deep-v3-mainnet-operator.mjs",
  );
  assert.equal(
    packageJson.scripts["contracts:deep-v3:operator:canary"],
    "node scripts/serve-deep-v3-mainnet-canary.mjs",
  );
  assert.equal(
    packageJson.scripts[
      "contracts:deep-v3:operator:canary-trades"
    ],
    "node scripts/serve-deep-v3-mainnet-canary-trades.mjs",
  );
  assert.ok(
    !packageJson.scripts[
      "contracts:deep-v3:operator:deploy"
    ].includes("--write"),
  );
  assert.ok(
    !packageJson.scripts[
      "contracts:deep-v3:operator:canary"
    ].includes("--write"),
  );
  assert.ok(
    !packageJson.scripts[
      "contracts:deep-v3:operator:canary-trades"
    ].includes("--write"),
  );
  assert.ok(
    !packageJson.scripts[
      "contracts:deep-v3:lifecycle:capture"
    ].includes("--write"),
  );
  assert.ok(
    packageJson.scripts[
      "contracts:deep-v3:lifecycle:capture:write"
    ].includes("--write"),
  );
});

test("operator commands fail closed without Mainnet inputs and never create evidence", () => {
  const evidencePath = path.join(
    root,
    "contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json",
  );
  const existedBefore = existsSync(evidencePath);
  for (const script of [
    "scripts/serve-deep-v3-mainnet-operator.mjs",
    "scripts/serve-deep-v3-mainnet-canary.mjs",
    "scripts/serve-deep-v3-mainnet-canary-trades.mjs",
    "contracts/scripts/capture-deep-full-range-v3-lifecycle.mjs",
  ]) {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) =>
            !key.startsWith("DEEP_V3_") &&
            !key.startsWith("ETHEREUM_RPC_URL"),
        ),
      ),
    });
    assert.notEqual(result.status, 0, script);
  }
  assert.equal(existsSync(evidencePath), existedBefore);
});

function memoryFileSystem(initial = {}, failRenameTarget = null) {
  const files = new Map(Object.entries(initial));
  const writes = [];
  return {
    files,
    writes,
    api: {
      async access(target) {
        if (files.has(target)) return;
        const error = new Error(`ENOENT: ${target}`);
        error.code = "ENOENT";
        throw error;
      },
      async writeFile(target, contents, options) {
        files.set(target, contents);
        writes.push({ target, options });
      },
      async rename(from, to) {
        if (to === failRenameTarget) {
          throw new Error(`forced rename failure: ${to}`);
        }
        if (!files.has(from)) {
          const error = new Error(`ENOENT: ${from}`);
          error.code = "ENOENT";
          throw error;
        }
        files.set(to, files.get(from));
        files.delete(from);
      },
    },
  };
}

test("lifecycle writer atomically binds evidence and manifest without overwrite", async () => {
  const evidencePath = "/evidence/deep-v3.json";
  const manifestPath = "/deployments/deep-v3.json";
  const memory = memoryFileSystem({
    [manifestPath]: "old manifest",
  });

  await writeDeepV3LifecycleFiles({
    evidencePath,
    manifestPath,
    evidenceOutput: "new evidence",
    manifestOutput: "new manifest",
    fs: memory.api,
  });

  assert.equal(memory.files.get(evidencePath), "new evidence");
  assert.equal(memory.files.get(manifestPath), "new manifest");
  assert.equal(memory.files.has(`${evidencePath}.tmp`), false);
  assert.equal(memory.files.has(`${manifestPath}.tmp`), false);
  assert.ok(
    memory.writes.every((write) => write.options?.mode === 0o600),
  );

  await assert.rejects(
    writeDeepV3LifecycleFiles({
      evidencePath,
      manifestPath,
      evidenceOutput: "replacement evidence",
      manifestOutput: "replacement manifest",
      fs: memory.api,
    }),
    /already exists/,
  );
  assert.equal(memory.files.get(evidencePath), "new evidence");
  assert.equal(memory.files.get(manifestPath), "new manifest");
});

test("lifecycle writer preserves failed evidence as uncommitted", async () => {
  const evidencePath = "/evidence/deep-v3.json";
  const manifestPath = "/deployments/deep-v3.json";
  const memory = memoryFileSystem(
    {
      [manifestPath]: "old manifest",
    },
    manifestPath,
  );

  await assert.rejects(
    writeDeepV3LifecycleFiles({
      evidencePath,
      manifestPath,
      evidenceOutput: "new evidence",
      manifestOutput: "new manifest",
      fs: memory.api,
    }),
    /evidence was preserved.*uncommitted/,
  );

  assert.equal(memory.files.has(evidencePath), false);
  assert.equal(
    memory.files.get(`${evidencePath}.uncommitted`),
    "new evidence",
  );
  assert.equal(memory.files.get(manifestPath), "old manifest");
});
