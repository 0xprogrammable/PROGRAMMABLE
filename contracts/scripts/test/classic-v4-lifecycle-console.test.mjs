import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbi,
} from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_LIFECYCLE_ACTIONS,
  digestJson,
} from
  "../../../scripts/classic-v4-release-core.mjs";
import {
  armClassicV4ExecutionJournal,
  blockClassicV4ExecutionJournal,
  buildClassicV4CreatorClaimPrepared,
  buildClassicV4LauncherClaimPrepared,
  buildClassicV4Permit2ApprovalPrepared,
  buildClassicV4QuoteCall,
  buildClassicV4SwapPrepared,
  buildClassicV4TokenApprovalPrepared,
  buildClassicV4TransactionOutput,
  classicV4QuoteBound,
  confirmClassicV4JournalTransaction,
  createClassicV4ExecutionJournal,
  deriveClassicV4RealizedLaunchIdentity,
  discardClassicV4ArmedAction,
  nextClassicV4LifecycleAction,
  recordClassicV4SubmittedTransaction,
  sealClassicV4PreparedAction,
  validateClassicV4PreparedAction,
  validateClassicV4ExecutionJournal,
  classicV4ExecutionLauncherAbi,
} from "../../../scripts/classic-v4-lifecycle-console-core.mjs";
import {
  classicV4SimulationRequest,
  parseClassicV4LifecycleConsoleArguments,
} from
  "../../../scripts/serve-classic-v4-lifecycle-canary.mjs";

const address = (digit) => `0x${digit.repeat(40)}`;
const hash = (digit) => `0x${digit.repeat(64)}`;
const operator = address("1");
const treasury = address("2");
const token = address("3");
const rewardVault = address("4");
const feeHook = address("5");
const permit2 = address("6");
const universalRouter = address("7");
const v4Quoter = address("8");
const launchRouter = address("9");
const positionRecipient = getAddress(address("a"));
const launcher = address("b");
const poolId = hash("c");
const launchHash = hash("d");
const launchCalldata = "0x12345678";

const plan = Object.freeze({
  planDigest: hash("1"),
  launchAuthorizationDigest: hash("2"),
  releaseBindingDigest: hash("3"),
  operatorWallet: operator,
  treasury,
  feeHook,
  dependencies: {
    permit2,
    universalRouter,
    v4Quoter,
  },
  launchAuthorization: {
    validAfter: "1787871540",
    deadline: "1787871870",
    transaction: {
      from: operator,
      to: launchRouter,
      valueWei: "0",
      calldata: launchCalldata,
      gasLimit: "100000",
    },
  },
  swapFixture: {
    quotePolicy: "canonical-v4-quoter-at-parent-block",
    slippageBps: 100,
    deadlineSeconds: 300,
    buyExactInput: { amountIn: "1000" },
    buyExactOutput: {
      amountOut: "2000",
      hardMaximumAmountIn: "100000",
    },
    sellExactInput: { amountIn: "3000" },
    sellExactOutput: {
      amountOut: "4000",
      hardMaximumAmountIn: "100000",
    },
  },
  actions: CLASSIC_V4_LIFECYCLE_ACTIONS.map((key) => ({
    key,
    requiredSigner: key === "launcherClaim" ? treasury : operator,
    requiresWalletSignature: true,
  })),
});

const identity = Object.freeze({ token, rewardVault });
const realizedLaunchIdentity = Object.freeze({
  token,
  rewardVault,
  positionRecipient,
  positionTokenId: "386160",
  poolId,
  launchHash,
  rewardConfigurationHash: hash("1"),
  eventLogIndex: 17,
});
const universalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);

function prepareSwap(action, quotedAmount = 10_000n) {
  return buildClassicV4SwapPrepared({
    canaryPlan: plan,
    identity,
    action,
    quotedAmount,
    quoteGasEstimate: 123_456n,
    quoteBlockNumber: 123,
    quoteBlockHash: hash("a"),
    quoteBlockTimestamp: 2_000_000_000n,
  });
}

function preparedForAction(action) {
  let prepared;
  if (action === "launch") {
    prepared = {
      action,
      requiredAction: action,
      label: "Launch the Router stamped canary",
      requiredAccount: operator,
      request: {
        from: operator,
        to: launchRouter,
        value: "0x0",
        data: launchCalldata,
      },
      authorization: {
        digest: plan.launchAuthorizationDigest,
        validAfter: plan.launchAuthorization.validAfter,
        deadline: plan.launchAuthorization.deadline,
        gasLimit: plan.launchAuthorization.transaction.gasLimit,
      },
    };
  } else if (action.includes("Exact")) {
    prepared = prepareSwap(action);
  } else if (action === "creatorClaim") {
    prepared = buildClassicV4CreatorClaimPrepared(plan, identity);
  } else {
    prepared = buildClassicV4LauncherClaimPrepared(plan);
  }
  const quoteBound = action.includes("Exact");
  return sealClassicV4PreparedAction(
    plan,
    prepared,
    {
      nonce: 7,
      gasLimit: action === "launch" ? 100_000 : 120_000,
      maxFeePerGas: 20,
      maxPriorityFeePerGas: 2,
      preparedAtBlock: quoteBound ? 123 : 99,
      preparedAtBlockHash: quoteBound ? hash("a") : hash("b"),
    },
  );
}

function testJournalState(requiredCount = 0) {
  let milliseconds = Date.parse("2026-08-27T23:00:00.000Z");
  const now = () => new Date(milliseconds += 1_000);
  let journal = createClassicV4ExecutionJournal(
    plan,
    new Date(milliseconds),
  );
  let blockNumber = 200;
  for (const action of CLASSIC_V4_LIFECYCLE_ACTIONS.slice(0, requiredCount)) {
    const prepared = preparedForAction(action);
    journal = armClassicV4ExecutionJournal(plan, journal, prepared, now());
    journal = recordClassicV4SubmittedTransaction(plan, journal, {
      action,
      preparedDigest: prepared.preparedDigest,
      transactionHash: `0x${(blockNumber - 199).toString(16).padStart(64, "0")}`,
    }, now());
    journal = confirmClassicV4JournalTransaction(plan, journal, {
      action,
      blockNumber,
      blockHash: hash("a"),
      ...(action === "launch"
        ? { launchIdentity: realizedLaunchIdentity }
        : {}),
    }, now());
    blockNumber += 1;
  }
  return {
    get journal() {
      return journal;
    },
    set journal(value) {
      journal = value;
    },
    now,
    nextBlock: () => blockNumber++,
  };
}

function reboundPrepared(prepared, mutate) {
  const candidate = structuredClone(prepared);
  delete candidate.preparedDigest;
  mutate(candidate);
  return {
    ...candidate,
    preparedDigest: digestJson(
      candidate,
      CLASSIC_V4_DIGEST_DOMAINS.generic,
    ),
  };
}

function clone(value) {
  return structuredClone(value);
}

function eventDigest(event) {
  const { eventDigest: ignored, ...value } = event;
  void ignored;
  return digestJson(value, CLASSIC_V4_DIGEST_DOMAINS.generic);
}

function genesisDigest(journal) {
  return digestJson({
    kind: "programmable.classic-v4.lifecycle-execution-journal-genesis.v2",
    schemaVersion: journal.schemaVersion,
    planDigest: journal.planDigest,
    launchAuthorizationDigest: journal.launchAuthorizationDigest,
    releaseBindingDigest: journal.releaseBindingDigest,
    operatorWallet: journal.operatorWallet,
    treasury: journal.treasury,
    createdAt: journal.createdAt,
  }, CLASSIC_V4_DIGEST_DOMAINS.generic);
}

test("Classic V4 console binds all four dynamic quote quadrants", () => {
  assert.equal(classicV4QuoteBound("exact-input", 10_001n), 9_900n);
  assert.equal(classicV4QuoteBound("exact-output", 10_001n), 10_102n);

  const expected = {
    buyExactInput: ["quoteExactInputSingle", "0x10", 1_000n, 9_900n],
    buyExactOutput: ["quoteExactOutputSingle", "0x1004", 10_100n, 2_000n],
    sellExactInput: ["quoteExactInputSingle", "0x10", 3_000n, 9_900n],
    sellExactOutput: ["quoteExactOutputSingle", "0x10", 10_100n, 4_000n],
  };
  for (const [action, [quoteFunction, commands, inputBound, outputBound]] of
    Object.entries(expected)) {
    const call = buildClassicV4QuoteCall(plan, identity, action);
    assert.equal(call.functionName, quoteFunction);
    assert.equal(call.to, v4Quoter);
    const prepared = prepareSwap(action);
    assert.equal(BigInt(prepared.swap.inputBound), inputBound);
    assert.equal(BigInt(prepared.swap.outputBound), outputBound);
    assert.equal(
      BigInt(prepared.request.value),
      action.startsWith("buy") ? inputBound : 0n,
    );
    const decoded = decodeFunctionData({
      abi: universalRouterAbi,
      data: prepared.request.data,
    });
    assert.equal(decoded.functionName, "execute");
    assert.equal(decoded.args[0], commands);
    assert.equal(decoded.args[2], 2_000_000_300n);
  }

  const oversizedExactOutput = {
    canaryPlan: plan,
    identity,
    action: "buyExactOutput",
    quotedAmount: 100_000n,
    quoteGasEstimate: 123_456n,
    quoteBlockNumber: 123,
    quoteBlockHash: hash("a"),
    quoteBlockTimestamp: 2_000_000_000n,
  };
  assert.throws(
    () => buildClassicV4SwapPrepared(oversizedExactOutput),
    /exceeds its hard maximum input/u,
  );
  assert.equal(
    buildClassicV4SwapPrepared({
      ...oversizedExactOutput,
      enforceHardMaximum: false,
    }).swap.inputBound,
    "101000",
  );
});

test("Classic V4 revalidation sanitizes only the eth_call request", () => {
  const exactRequest = Object.freeze({
    from: operator,
    to: launchRouter,
    value: "0x1",
    data: launchCalldata,
    nonce: "0x7",
    gas: "0x186a0",
    maxFeePerGas: "0x14",
    maxPriorityFeePerGas: "0x2",
  });
  const unchangedExactRequest = structuredClone(exactRequest);

  assert.deepEqual(classicV4SimulationRequest(exactRequest), {
    from: operator,
    to: launchRouter,
    value: "0x1",
    data: launchCalldata,
    gas: "0x186a0",
  });
  assert.deepEqual(exactRequest, unchangedExactRequest);
});

test("Classic V4 console creates bounded sell approvals and exact claim calls", () => {
  const tokenApproval = buildClassicV4TokenApprovalPrepared({
    canaryPlan: plan,
    identity,
    requiredAction: "sellExactInput",
    amount: 3_000n,
  });
  assert.equal(tokenApproval.request.to, token);
  assert.equal(tokenApproval.allowance.requiredAmount, "3000");
  assert.deepEqual(
    decodeFunctionData({
      abi: parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]),
      data: tokenApproval.request.data,
    }).args,
    [permit2, 3_000n],
  );

  const permitApproval = buildClassicV4Permit2ApprovalPrepared({
    canaryPlan: plan,
    identity,
    requiredAction: "sellExactOutput",
    amount: 4_000n,
    blockTimestamp: 2_000_000_000n,
  });
  assert.equal(permitApproval.request.to, permit2);
  assert.deepEqual(
    decodeFunctionData({
      abi: parseAbi([
        "function approve(address token,address spender,uint160 amount,uint48 expiration)",
      ]),
      data: permitApproval.request.data,
    }).args,
    [token, universalRouter, 4_000n, 2_000_000_900],
  );

  const creator = buildClassicV4CreatorClaimPrepared(plan, identity);
  const launcher = buildClassicV4LauncherClaimPrepared(plan);
  assert.equal(creator.requiredAccount, operator);
  assert.equal(creator.request.to, rewardVault);
  assert.equal(launcher.requiredAccount, treasury);
  assert.equal(launcher.request.to, feeHook);
});

test("Classic V4 console derives a positive realized LP NFT ID only from the launch event", () => {
  const transactionHash = hash("e");
  const blockHash = hash("f");
  const topics = encodeEventTopics({
    abi: classicV4ExecutionLauncherAbi,
    eventName: "MemeTokenLaunchedV2",
    args: { deployer: operator, token, poolId },
  });
  const eventData = (positionTokenId) => encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [
      feeHook,
      rewardVault,
      positionRecipient,
      positionTokenId,
      100,
      200,
      hash("1"),
      launchHash,
    ],
  );
  const receipt = {
    transactionHash,
    blockHash,
    blockNumber: "0x64",
    logs: [{
      address: launcher,
      data: eventData(386_160n),
      topics,
      transactionHash,
      blockHash,
      blockNumber: "0x64",
      logIndex: "0x11",
    }],
  };
  const context = {
    launcher,
    operatorWallet: operator,
    feeHook,
    expectedIdentity: {
      token,
      rewardVault,
      positionRecipient,
      poolId,
      launchHash,
    },
    buySwapFeeBps: 100,
    sellSwapFeeBps: 200,
  };
  assert.deepEqual(
    deriveClassicV4RealizedLaunchIdentity(receipt, context),
    realizedLaunchIdentity,
  );
  assert.throws(
    () => deriveClassicV4RealizedLaunchIdentity({
      ...receipt,
      logs: [{ ...receipt.logs[0], data: eventData(0n) }],
    }, context),
    /position token ID.*zero/iu,
  );
});

test("Classic V4 persisted requests rederive exact identity, role and inner calldata", () => {
  for (const action of CLASSIC_V4_LIFECYCLE_ACTIONS) {
    assert.equal(
      validateClassicV4PreparedAction(
        plan,
        preparedForAction(action),
        identity,
      ).action,
      action,
    );
  }

  const wrongIdentity = {
    token: address("a"),
    rewardVault: address("b"),
  };
  const envelope = {
    nonce: 9,
    gasLimit: 120_000,
    maxFeePerGas: 20,
    maxPriorityFeePerGas: 2,
    preparedAtBlock: 123,
    preparedAtBlockHash: hash("a"),
  };
  const wrongSwap = sealClassicV4PreparedAction(
    plan,
    buildClassicV4SwapPrepared({
      canaryPlan: plan,
      identity: wrongIdentity,
      action: "buyExactInput",
      quotedAmount: 10_000n,
      quoteGasEstimate: 123_456n,
      quoteBlockNumber: 123,
      quoteBlockHash: hash("a"),
      quoteBlockTimestamp: 2_000_000_000n,
    }),
    envelope,
  );
  assert.throws(
    () => validateClassicV4PreparedAction(plan, wrongSwap, identity),
    /swap calldata differs/u,
  );

  const wrongTokenApproval = sealClassicV4PreparedAction(
    plan,
    buildClassicV4TokenApprovalPrepared({
      canaryPlan: plan,
      identity: wrongIdentity,
      requiredAction: "sellExactInput",
      amount: 3_000n,
    }),
    envelope,
  );
  assert.throws(
    () => validateClassicV4PreparedAction(plan, wrongTokenApproval, identity),
    /approval target differs/u,
  );

  const wrongPermit2Approval = sealClassicV4PreparedAction(
    plan,
    buildClassicV4Permit2ApprovalPrepared({
      canaryPlan: plan,
      identity: wrongIdentity,
      requiredAction: "sellExactOutput",
      amount: 4_000n,
      blockTimestamp: 2_000_000_000n,
    }),
    envelope,
  );
  assert.throws(
    () => validateClassicV4PreparedAction(plan, wrongPermit2Approval, identity),
    /Permit2 token differs/u,
  );

  const wrongCreatorClaim = sealClassicV4PreparedAction(
    plan,
    buildClassicV4CreatorClaimPrepared(plan, wrongIdentity),
    envelope,
  );
  assert.throws(
    () => validateClassicV4PreparedAction(plan, wrongCreatorClaim, identity),
    /reward vault/u,
  );

  const reboundRole = reboundPrepared(preparedForAction("launcherClaim"), (value) => {
    value.requiredAccount = operator;
    value.request.from = operator;
  });
  assert.throws(
    () => validateClassicV4PreparedAction(plan, reboundRole, identity),
    /account differs|role differs/u,
  );
});

test("Classic V4 journal replays an integrity-bound monotonic history", () => {
  const state = testJournalState(2);
  const journal = state.journal;
  assert.equal(journal.history.length, 6);
  assert.equal(
    validateClassicV4ExecutionJournal(
      plan,
      journal,
      new Date("2026-08-27T23:01:00.000Z"),
    ),
    journal,
  );

  const changedHash = clone(journal);
  changedHash.requiredTransactions.launch.hash = hash("e");
  assert.throws(
    () => validateClassicV4ExecutionJournal(plan, changedHash),
    /record differs from its history/u,
  );

  const changedPositionTokenId = clone(journal);
  changedPositionTokenId.requiredTransactions.launch.launchIdentity.positionTokenId =
    "386161";
  assert.throws(
    () => validateClassicV4ExecutionJournal(plan, changedPositionTokenId),
    /record differs from its history|history digest differs/u,
  );

  const changedTimestamp = clone(journal);
  changedTimestamp.requiredTransactions.launch.submittedAt =
    changedTimestamp.requiredTransactions.launch.confirmedAt;
  assert.throws(
    () => validateClassicV4ExecutionJournal(plan, changedTimestamp),
    /record differs from its history|chronology differs/u,
  );

  const shortenedHistory = clone(journal);
  shortenedHistory.history.pop();
  assert.throws(
    () => validateClassicV4ExecutionJournal(plan, shortenedHistory),
    /update time differs|history/u,
  );

  const forged = createClassicV4ExecutionJournal(
    plan,
    new Date("2026-08-27T23:00:00.000Z"),
  );
  const prepared = preparedForAction("launch");
  const armed = {
    sequence: 0,
    kind: "armed",
    at: "2026-08-27T23:00:01.000Z",
    previousDigest: forged.genesisDigest,
    action: "launch",
    requiredAction: "launch",
    auxiliary: false,
    preparedDigest: hash("e"),
    prepared,
  };
  armed.eventDigest = eventDigest(armed);
  const discarded = {
    sequence: 1,
    kind: "discarded",
    at: "2026-08-27T23:00:02.000Z",
    previousDigest: armed.eventDigest,
    action: "launch",
    requiredAction: "launch",
    auxiliary: false,
    preparedDigest: hash("e"),
    armEventDigest: armed.eventDigest,
  };
  discarded.eventDigest = eventDigest(discarded);
  forged.history = [armed, discarded];
  forged.updatedAt = discarded.at;
  assert.throws(
    () => validateClassicV4ExecutionJournal(
      plan,
      forged,
      new Date("2026-08-27T23:01:00.000Z"),
    ),
    /prepared request/u,
  );

  const ancient = createClassicV4ExecutionJournal(
    plan,
    new Date("2026-08-27T23:00:00.000Z"),
  );
  ancient.createdAt = "1970-01-01T00:00:00.000Z";
  ancient.updatedAt = ancient.createdAt;
  ancient.genesisDigest = genesisDigest(ancient);
  assert.throws(
    () => validateClassicV4ExecutionJournal(
      plan,
      ancient,
      new Date("2026-08-27T23:01:00.000Z"),
    ),
    /authorization window/u,
  );

  assert.throws(
    () => createClassicV4ExecutionJournal(
      plan,
      new Date("2030-01-01T00:00:00.000Z"),
    ),
    /authorization window/u,
  );
});

test("Classic V4 journal is resumable, immutable and emits only seven ordered hashes", () => {
  let milliseconds = Date.parse("2026-08-27T23:00:00.000Z");
  const now = () => new Date(milliseconds += 1_000);
  let journal = createClassicV4ExecutionJournal(
    plan,
    new Date(milliseconds),
  );
  assert.deepEqual(nextClassicV4LifecycleAction(journal), {
    status: "ready",
    action: "launch",
  });

  const first = preparedForAction("launch");
  journal = armClassicV4ExecutionJournal(plan, journal, first, now());
  assert.deepEqual(nextClassicV4LifecycleAction(journal), {
    status: "review",
    action: "launch",
  });
  journal = discardClassicV4ArmedAction(
    plan,
    journal,
    first.preparedDigest,
    now(),
  );
  assert.equal(journal.armed, null);

  let blockNumber = 200;
  for (const action of CLASSIC_V4_LIFECYCLE_ACTIONS) {
    if (action === "sellExactInput") {
      const approval = sealClassicV4PreparedAction(
        plan,
        buildClassicV4TokenApprovalPrepared({
          canaryPlan: plan,
          identity,
          requiredAction: action,
          amount: 3_000n,
        }),
        {
          nonce: 10,
          gasLimit: 80_000,
          maxFeePerGas: 20,
          maxPriorityFeePerGas: 2,
          preparedAtBlock: blockNumber,
          preparedAtBlockHash: hash("c"),
        },
      );
      journal = armClassicV4ExecutionJournal(plan, journal, approval, now());
      const approvalHash = hash("d");
      journal = recordClassicV4SubmittedTransaction(plan, journal, {
        action: approval.action,
        preparedDigest: approval.preparedDigest,
        transactionHash: approvalHash,
      }, now());
      assert.throws(
        () => recordClassicV4SubmittedTransaction(plan, journal, {
          action: approval.action,
          preparedDigest: approval.preparedDigest,
          transactionHash: hash("e"),
        }, now()),
        /immutable/u,
      );
      journal = confirmClassicV4JournalTransaction(plan, journal, {
        action: approval.action,
        blockNumber: blockNumber++,
        blockHash: hash("f"),
      }, now());
      assert.equal(nextClassicV4LifecycleAction(journal).action, action);
    }

    const prepared = preparedForAction(action);
    journal = armClassicV4ExecutionJournal(plan, journal, prepared, now());
    const actionHash = `0x${(CLASSIC_V4_LIFECYCLE_ACTIONS.indexOf(action) + 1)
      .toString(16).padStart(64, "0")}`;
    journal = recordClassicV4SubmittedTransaction(plan, journal, {
      action,
      preparedDigest: prepared.preparedDigest,
      transactionHash: actionHash,
    }, now());
    journal = confirmClassicV4JournalTransaction(plan, journal, {
      action,
      blockNumber: blockNumber++,
      blockHash: hash("a"),
      ...(action === "launch"
        ? { launchIdentity: realizedLaunchIdentity }
        : {}),
    }, now());
  }

  assert.deepEqual(nextClassicV4LifecycleAction(journal), { status: "complete" });
  const output = buildClassicV4TransactionOutput(plan, journal);
  assert.deepEqual(Object.keys(output), [...CLASSIC_V4_LIFECYCLE_ACTIONS]);
  assert.equal(Object.keys(output).length, 7);
  assert.equal(Object.hasOwn(output, "tokenApproval:sellExactInput"), false);
});

test("Classic V4 blocked journals remain safely resumable at startup", () => {
  let milliseconds = Date.parse("2026-08-27T23:00:00.000Z");
  const now = () => new Date(milliseconds += 1_000);
  let journal = createClassicV4ExecutionJournal(
    plan,
    new Date(milliseconds),
  );
  const prepared = preparedForAction("launch");
  journal = armClassicV4ExecutionJournal(plan, journal, prepared, now());
  journal = recordClassicV4SubmittedTransaction(plan, journal, {
    action: "launch",
    preparedDigest: prepared.preparedDigest,
    transactionHash: hash("9"),
  }, now());
  journal = blockClassicV4ExecutionJournal(
    plan,
    journal,
    "launch reverted on Mainnet",
    now(),
  );
  const resumed = blockClassicV4ExecutionJournal(
    plan,
    journal,
    "launch reverted on Mainnet",
    now(),
  );
  assert.deepEqual(resumed, journal);
  assert.deepEqual(nextClassicV4LifecycleAction(resumed), {
    status: "blocked",
    reason: "launch reverted on Mainnet",
  });
});

test("Classic V4 console CLI is dry by default and rejects signing material", () => {
  const parsed = parseClassicV4LifecycleConsoleArguments([
    "--plan", "/tmp/plan.json",
    "--deployment-evidence", "/tmp/deployment.json",
    "--source-evidence", "/tmp/source.json",
    "--canary-plan", "/tmp/canary.json",
    "--rpc-a", "https://rpc-a.example",
    "--rpc-b", "https://rpc-b.example",
    "--wallet", operator,
  ]);
  assert.equal(parsed.write, false);
  assert.equal(parsed.journalOutput, null);
  assert.equal(parsed.reviewedReleaseWorktree, null);
  const reviewed = parseClassicV4LifecycleConsoleArguments([
    "--plan", "/tmp/plan.json",
    "--deployment-evidence", "/tmp/deployment.json",
    "--source-evidence", "/tmp/source.json",
    "--canary-plan", "/tmp/canary.json",
    "--reviewed-release-worktree", "/tmp/reviewed-release",
    "--rpc-a", "https://rpc-a.example",
    "--rpc-b", "https://rpc-b.example",
    "--wallet", operator,
  ]);
  assert.equal(
    reviewed.reviewedReleaseWorktree,
    "/tmp/reviewed-release",
  );
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments(["--private-key", hash("1")]),
    /forbidden/u,
  );
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments([
      "--plan", "relative.json",
    ]),
    /absolute/u,
  );
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments([
      "--plan", "/tmp/plan.json",
      "--deployment-evidence", "/tmp/deployment.json",
      "--source-evidence", "/tmp/source.json",
      "--canary-plan", "/tmp/canary.json",
      "--reviewed-release-worktree", "relative/release",
      "--rpc-a", "https://rpc-a.example",
      "--rpc-b", "https://rpc-b.example",
      "--wallet", operator,
    ]),
    /reviewed release worktree path must be absolute/u,
  );
});
