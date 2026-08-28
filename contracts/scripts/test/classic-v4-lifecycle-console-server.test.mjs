import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import { keccak256 } from "viem";

import {
  CLASSIC_V4_REVIEWED_EIP_7702_SIGNER_BINDING,
  assertClassicV4SignerRuntimeAtBlock,
  assertClassicV4PreparedArmTime,
  assertClassicV4FreshRpcHead,
  acquireClassicV4ExecutionLock,
  assertClassicV4ExecutionOutputPair,
  assertClassicV4ExternalExecutionPath,
  buildClassicV4LifecycleUiCheckFixture,
  validateClassicV4ArchivedArmBindings,
  classicV4FinalityConfirmations,
  classicV4LifecycleUiCheckHtml,
  classicV4MinedTransactionMatchesRequest,
  classicV4StablePreparationBlockNumber,
  classifyClassicV4SignerRuntime,
  commonBlock,
  createClassicV4LifecycleRequestMutex,
  parseClassicV4LifecycleConsoleArguments,
  parseClassicV4RpcOrigin,
  readClassicV4PrivateJson,
  refreshClassicV4Journal,
  unlinkOwnedPath,
  validateClassicV4PreparedAnchor,
  writeClassicV4FinalTransactionsOutput,
  writeClassicV4PrivateJson,
} from "../../../scripts/serve-classic-v4-lifecycle-canary.mjs";

const operator = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const digest = `0x${"11".repeat(32)}`;

test("Classic V4 lifecycle UI check needs no evidence, RPC or wallet", async () => {
  const port = 44_000 + (process.pid % 1_000);
  const parsed = parseClassicV4LifecycleConsoleArguments([
    "--ui-check",
    "--port",
    String(port),
  ]);
  assert.deepEqual(parsed, { uiCheck: true, port });
  const fixture = buildClassicV4LifecycleUiCheckFixture();
  assert.equal(fixture.plan.actions.length, 7);
  assert.equal(fixture.state.totalActions, 7);
  assert.equal(fixture.state.status, "review");
  assert.equal(fixture.state.nextAction, "buyExactOutput");
  const inertHtml = classicV4LifecycleUiCheckHtml(fixture, "test-nonce");
  assert.doesNotMatch(inertHtml, /<script|window\.ethereum|fetch\(|localStorage|eth_send/u);
  assert.match(inertHtml, /no RPC client, wallet bundle/iu);
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments(["--ui-check", "--write"]),
    /only an optional --port/u,
  );

  const child = spawn(
    process.execPath,
    [
      "scripts/serve-classic-v4-lifecycle-canary.mjs",
      "--ui-check",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLASSIC_V4_CANARY_RPC_A: "https://secret.invalid/path/credential",
        CLASSIC_V4_CANARY_RPC_B: "https://user:pass@secret.invalid/",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("UI check server did not start")),
        5_000,
      );
      child.once("error", reject);
      child.stdout.on("data", (chunk) => {
        if (!String(chunk).includes("lifecycle UI check")) return;
        clearTimeout(timer);
        resolve();
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(body, /seven exact actions/iu);
    assert.match(body, /UI check only/u);
    assert.doesNotMatch(body, /<script|window\.ethereum|fetch\(|localStorage|eth_send/u);
    assert.doesNotMatch(
      response.headers.get("content-security-policy"),
      /script-src/u,
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/state`)).status,
      404,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
  }
});

test("Classic V4 console rejects stale heads and secret-bearing RPC URLs", () => {
  assert.doesNotThrow(() => assertClassicV4FreshRpcHead(100n, 102n, 1_000n, 1_030n));
  assert.equal(
    parseClassicV4RpcOrigin("https://rpc-a.example").origin,
    "https://rpc-a.example",
  );
  assert.throws(
    () => assertClassicV4FreshRpcHead(100n, 103n, 1_000n, 1_030n),
    /two blocks/u,
  );
  assert.throws(
    () => assertClassicV4FreshRpcHead(100n, 100n, 900n, 1_000n),
    /stale/u,
  );
  const base = [
    "--plan", "/tmp/plan.json",
    "--deployment-evidence", "/tmp/deployment.json",
    "--source-evidence", "/tmp/source.json",
    "--canary-plan", "/tmp/canary.json",
    "--wallet", operator,
  ];
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments([
      ...base,
      "--rpc-a", "https://eth-mainnet.example/v2/SECRET",
      "--rpc-b", "https://rpc-b.example/",
    ]),
    /without user info, path, query or fragment/u,
  );
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments([
      ...base,
      "--rpc-a", "https://rpc-a.example/?apiKey=SECRET",
      "--rpc-b", "https://rpc-b.example/",
    ]),
    /without user info, path, query or fragment/u,
  );
  for (const endpoint of [
    "http://rpc-a.example/",
    "https://user@rpc-a.example/",
    "https://rpc-a.example/#",
    "https://rpc-a.example/?",
    "https://rpc-a.example/.",
    "https://rpc-a.example/%2e",
    "https://rpc-a.example/path/..",
    "https://rpc-a.example\\",
    "https://rpc-a.example\\.",
    "https://rpc-a.example\\%2e",
    "https://rpc-a.example\\path\\..",
  ]) {
    assert.throws(
      () => parseClassicV4RpcOrigin(endpoint),
      /credential-free HTTPS origin/u,
    );
  }
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments([
      ...base,
      "--rpc-a", "https://rpc-a.example/",
      "--rpc-b", "https://rpc-a.example:8545/",
    ]),
    /independent RPC hosts/u,
  );
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments([
      ...base,
      "--rpc-a", "https://rpc-a.example/",
      "--rpc-b", "https://rpc-a.example./",
    ]),
    /independent RPC hosts/u,
  );
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments([
      ...base,
      "--rpc-a", "https://rpc-a.example/",
      "--rpc-b", "https://rpc-a.example../",
    ]),
    /independent RPC hosts/u,
  );
  assert.throws(
    () => parseClassicV4LifecycleConsoleArguments([
      ...base,
      "--rpc-a", "https://rpc-a.example/",
      "--rpc-b", "https://rpc-b.example/",
      "--write",
      "--journal-output", "/tmp/journal.json",
      "--transactions-output", "/tmp/transactions.json",
      "--acknowledge-plan-digest", digest,
    ]),
    /requires RPC origins through/u,
  );
});

test("Classic V4 console fetches both providers' fresh independent heads", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const now = Math.floor(Date.now() / 1_000);
  const block = (number, hashByte) => ({
    number: `0x${number.toString(16)}`,
    hash: `0x${hashByte.repeat(32)}`,
    parentHash: `0x${"01".repeat(32)}`,
    timestamp: `0x${now.toString(16)}`,
    baseFeePerGas: "0x3b9aca00",
    gasLimit: "0x1c9c380",
  });
  globalThis.fetch = async (endpoint, options) => {
    const request = JSON.parse(options.body);
    calls.push({ endpoint, method: request.method, params: request.params });
    let result;
    if (request.method === "eth_chainId") result = "0x1";
    if (request.method === "eth_blockNumber") {
      result = endpoint.endsWith("a.example/") ? "0x64" : "0x66";
    }
    if (request.method === "eth_getBlockByNumber") {
      result = request.params[0] === "0x66"
        ? block(102, "66")
        : block(100, "64");
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  try {
    const common = await commonBlock([
      "https://rpc-a.example/",
      "https://rpc-b.example/",
    ]);
    assert.equal(common.number, 100);
    assert.equal(common.hash, `0x${"64".repeat(32)}`);
    assert(calls.some(({ endpoint, method, params }) =>
      endpoint.endsWith("b.example/") &&
      method === "eth_getBlockByNumber" &&
      params[0] === "0x66"
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Classic V4 signer runtime accepts only an EOA or canonical EIP-7702 designator", () => {
  const designator = `0xef0100${target.slice(2)}`;
  assert.deepEqual(classifyClassicV4SignerRuntime("0x"), {
    kind: "eoa",
    code: "0x",
  });
  assert.deepEqual(classifyClassicV4SignerRuntime(designator.toUpperCase()), {
    kind: "eip7702",
    code: designator,
    delegate: target,
  });
  for (const runtime of [
    "0x6000",
    `0xef0100${target.slice(2, -2)}`,
    `${designator}00`,
    "0xef0100zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  ]) {
    assert.throws(
      () => classifyClassicV4SignerRuntime(runtime),
      /canonical EIP-7702 delegation designator/u,
    );
  }
  assert.throws(
    () => classifyClassicV4SignerRuntime(`0xef0100${"00".repeat(20)}`),
    /delegate is zero/u,
  );
  assert.deepEqual(CLASSIC_V4_REVIEWED_EIP_7702_SIGNER_BINDING, {
    delegate: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",
    delegateRuntimeHash:
      "0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab",
  });
});

test("Classic V4 independently verifies the EIP-7702 delegate runtime at the exact block", async () => {
  const originalFetch = globalThis.fetch;
  const urls = ["https://rpc-a.example/", "https://rpc-b.example/"];
  const designator = `0xef0100${target.slice(2)}`;
  const delegateRuntime = "0x6001600055";
  const calls = [];
  globalThis.fetch = async (endpoint, options) => {
    const request = JSON.parse(options.body);
    calls.push({ endpoint, method: request.method, params: request.params });
    assert.equal(request.method, "eth_getCode");
    const result = request.params[0] === operator
      ? designator
      : delegateRuntime;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  try {
    assert.deepEqual(
      await assertClassicV4SignerRuntimeAtBlock(
        urls,
        operator,
        { tag: "0x64" },
        "launch",
        {
          delegate: target,
          delegateRuntimeHash: keccak256(delegateRuntime),
        },
      ),
      {
        kind: "eip7702",
        code: designator,
        delegate: target,
        delegateRuntimeHash: keccak256(delegateRuntime),
      },
    );
    assert.deepEqual(
      calls.map(({ endpoint, params }) => [endpoint, params]),
      [
        [urls[0], [operator, "0x64"]],
        [urls[1], [operator, "0x64"]],
        [urls[0], [target, "0x64"]],
        [urls[1], [target, "0x64"]],
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Classic V4 keeps the empty-code EOA path without delegate RPCs", async () => {
  const originalFetch = globalThis.fetch;
  const urls = ["https://rpc-a.example/", "https://rpc-b.example/"];
  const calls = [];
  globalThis.fetch = async (endpoint, options) => {
    const request = JSON.parse(options.body);
    calls.push({ endpoint, method: request.method, params: request.params });
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "0x",
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  try {
    assert.deepEqual(
      await assertClassicV4SignerRuntimeAtBlock(
        urls,
        operator,
        { tag: "0x64" },
        "launch",
      ),
      { kind: "eoa", code: "0x" },
    );
    assert.deepEqual(
      calls.map(({ endpoint, method, params }) => [endpoint, method, params]),
      [
        [urls[0], "eth_getCode", [operator, "0x64"]],
        [urls[1], "eth_getCode", [operator, "0x64"]],
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Classic V4 pins EIP-7702 to the independently reviewed delegate", async () => {
  const originalFetch = globalThis.fetch;
  const urls = ["https://rpc-a.example/", "https://rpc-b.example/"];
  const designator = `0xef0100${target.slice(2)}`;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: designator,
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  try {
    await assert.rejects(
      assertClassicV4SignerRuntimeAtBlock(
        urls,
        operator,
        { tag: "0x64" },
        "launch",
      ),
      /delegate is not the reviewed Classic V4 signer delegate/u,
    );
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Classic V4 fails closed on an unverified or chained EIP-7702 delegate", async () => {
  const originalFetch = globalThis.fetch;
  const urls = ["https://rpc-a.example/", "https://rpc-b.example/"];
  const designator = `0xef0100${target.slice(2)}`;
  const verify = (delegateCodes) => {
    globalThis.fetch = async (endpoint, options) => {
      const request = JSON.parse(options.body);
      const result = request.params[0] === operator
        ? designator
        : delegateCodes[endpoint === urls[0] ? 0 : 1];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    };
    return assertClassicV4SignerRuntimeAtBlock(
      urls,
      operator,
      { tag: "0x64" },
      "launch",
      {
        delegate: target,
        delegateRuntimeHash: keccak256("0x6000"),
      },
    );
  };
  try {
    await assert.rejects(
      verify(["0x6000", "0x6001"]),
      /Independent RPCs disagree on launch EIP-7702 delegate runtime/u,
    );
    await assert.rejects(
      verify(["0x", "0x"]),
      /delegate has no valid runtime code/u,
    );
    await assert.rejects(
      verify([designator, designator]),
      /delegate cannot itself be delegated/u,
    );
    await assert.rejects(
      verify(["0x6001", "0x6001"]),
      /delegate runtime differs from the reviewed hash/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Classic V4 validates every duplicate-digest archived arm timestamp", async () => {
  const preparedDigest = `0x${"ab".repeat(32)}`;
  const prepared = { preparedDigest };
  const timestamp = BigInt(Date.parse("2026-08-27T23:00:00.000Z") / 1_000);
  const history = [
    {
      kind: "armed",
      action: "launch",
      at: "2026-08-27T23:00:01.000Z",
      prepared,
    },
    { kind: "discarded" },
    {
      kind: "armed",
      action: "launch",
      at: "2026-08-27T23:00:30.000Z",
      prepared,
    },
  ];
  let resolutions = 0;
  const resolvePreparationBlock = async () => {
    resolutions += 1;
    return {
      preparationBlock: { timestamp: timestamp - 132n },
      finalityBlock: { timestamp },
    };
  };
  const blocks = await validateClassicV4ArchivedArmBindings(
    history,
    resolvePreparationBlock,
  );
  assert.equal(resolutions, 1);
  assert.equal(
    blocks.get(preparedDigest).finalityBlock.timestamp,
    timestamp,
  );

  const forgedLate = structuredClone(history);
  forgedLate[2].at = "2026-08-27T23:10:00.000Z";
  resolutions = 0;
  await assert.rejects(
    validateClassicV4ArchivedArmBindings(
      forgedLate,
      resolvePreparationBlock,
    ),
    /arm time differs from its preparation (?:finality )?block/u,
  );
  assert.equal(resolutions, 1);

  await assert.rejects(
    validateClassicV4ArchivedArmBindings(
      [history[0], { kind: "discarded" }],
      async () => {
        throw new Error("discarded preparation block is no longer canonical");
      },
    ),
    /discarded preparation block is no longer canonical/u,
  );
});

test("Classic V4 rechecks stable preparation anchors before irreversible handoff", async () => {
  assert.equal(classicV4StablePreparationBlockNumber(111), 100);
  assert.throws(
    () => classicV4StablePreparationBlockNumber(11),
    /too early/u,
  );
  const originalFetch = globalThis.fetch;
  const canonicalHash = `0x${"ca".repeat(32)}`;
  const reorgHash = `0x${"de".repeat(32)}`;
  let observedHash = canonicalHash;
  globalThis.fetch = async (_endpoint, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.method, "eth_getBlockByNumber");
    assert(["0x64", "0x6f"].includes(request.params[0]));
    const preparation = request.params[0] === "0x64";
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        number: request.params[0],
        hash: preparation
          ? observedHash
          : `0x${"fa".repeat(32)}`,
        parentHash: `0x${"01".repeat(32)}`,
        timestamp: preparation ? "0x64" : "0x3e8",
        baseFeePerGas: "0x3b9aca00",
        gasLimit: "0x1c9c380",
      },
    }), { status: 200 });
  };
  const prepared = {
    preparedAtBlock: 100,
    preparedAtBlockHash: canonicalHash,
  };
  const freshHead = { number: 111 };
  try {
    assert.equal(
      (await validateClassicV4PreparedAnchor(
        ["https://rpc-a.example/", "https://rpc-b.example/"],
        prepared,
        freshHead,
        "launch revalidation",
      )).preparationBlock.hash,
      canonicalHash,
    );
    assert.doesNotThrow(() => assertClassicV4PreparedArmTime(
      { timestamp: 1_000n },
      new Date(1_180_000),
      "stale-head slow preparation",
    ));
    assert.throws(
      () => assertClassicV4PreparedArmTime(
        { timestamp: 1_000n },
        new Date(1_301_000),
        "stale-head excessive preparation",
      ),
      /arm time differs from its preparation finality block/u,
    );
    observedHash = reorgHash;
    await assert.rejects(
      validateClassicV4PreparedAnchor(
        ["https://rpc-a.example/", "https://rpc-b.example/"],
        prepared,
        freshHead,
        "launch revalidation",
      ),
      /revalidation preparation block is no longer canonical/u,
    );
    await assert.rejects(
      validateClassicV4PreparedAnchor(
        ["https://rpc-a.example/", "https://rpc-b.example/"],
        prepared,
        freshHead,
        "launch recording",
      ),
      /recording preparation block is no longer canonical/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Classic V4 finality counts the inclusion block and requires twelve", () => {
  assert.equal(classicV4FinalityConfirmations(1_000, 999), 0);
  assert.equal(classicV4FinalityConfirmations(1_000, 1_010), 11);
  assert.equal(classicV4FinalityConfirmations(1_000, 1_011), 12);
});

test("Classic V4 mined envelopes allow only plain Mainnet type-2 transactions", () => {
  const request = {
    from: operator,
    to: target,
    data: "0x1234",
    value: "0x0",
    nonce: "0x7",
    gas: "0x186a0",
    maxFeePerGas: "0x14",
    maxPriorityFeePerGas: "0x2",
  };
  const transaction = {
    from: operator,
    to: target,
    input: "0x1234",
    value: "0x0",
    nonce: "0x7",
    gas: "0x186a0",
    maxFeePerGas: "0x14",
    maxPriorityFeePerGas: "0x2",
    chainId: "0x1",
    type: "0x2",
    accessList: [],
  };
  assert.equal(classicV4MinedTransactionMatchesRequest(request, transaction), true);
  assert.equal(
    classicV4MinedTransactionMatchesRequest(request, {
      ...transaction,
      type: "0x4",
      authorizationList: [{ chainId: "0x1" }],
    }),
    false,
  );
  assert.equal(
    classicV4MinedTransactionMatchesRequest(request, {
      ...transaction,
      accessList: [{ address: target, storageKeys: [] }],
    }),
    false,
  );
  assert.equal(
    classicV4MinedTransactionMatchesRequest(request, {
      ...transaction,
      blobVersionedHashes: [digest],
    }),
    false,
  );
  assert.equal(
    classicV4MinedTransactionMatchesRequest(request, {
      ...transaction,
      blobVersionedHashes: [],
    }),
    false,
  );
  assert.equal(
    classicV4MinedTransactionMatchesRequest(request, {
      ...transaction,
      authorizationList: [],
    }),
    false,
  );
  assert.equal(
    classicV4MinedTransactionMatchesRequest(request, {
      ...transaction,
      chainId: "0xaa36a7",
    }),
    false,
  );
});

test("Classic V4 outputs require private canonical single-link paths", async () => {
  const createdDirectory = await mkdtemp(
    path.join(os.tmpdir(), "classic-v4-console-"),
  );
  const directory = await realpath(createdDirectory);
  await chmod(directory, 0o700);
  const symbolicParent = `${createdDirectory}-symbolic-parent`;
  const publicParent = await mkdtemp(
    path.join(os.tmpdir(), "classic-v4-console-public-"),
  );
  await chmod(publicParent, 0o755);
  try {
    const journal = path.join(directory, "journal.json");
    const transactions = path.join(directory, "transactions.json");
    await writeClassicV4PrivateJson(journal, { sequence: 1 }, {
      createOnly: true,
      label: "Journal output",
    });
    await assertClassicV4ExternalExecutionPath(journal, {
      mayExist: true,
      label: "Journal output",
    });
    assert.equal((await stat(journal)).mode & 0o777, 0o600);
    assert.deepEqual(
      await readClassicV4PrivateJson(journal, "Journal output"),
      { sequence: 1 },
    );
    await assert.rejects(
      writeClassicV4PrivateJson(journal, { sequence: 99 }, {
        createOnly: true,
        label: "Journal output",
      }),
      (error) => error?.code === "EEXIST",
    );
    assert.deepEqual(
      await readClassicV4PrivateJson(journal, "Journal output"),
      { sequence: 1 },
    );
    await writeClassicV4PrivateJson(journal, { sequence: 2 }, {
      label: "Journal output",
    });
    assert.deepEqual(
      await readClassicV4PrivateJson(journal, "Journal output"),
      { sequence: 2 },
    );
    assert.deepEqual(
      assertClassicV4ExecutionOutputPair(journal, transactions),
      { journalPath: journal, transactionsPath: transactions },
    );
    const finalTransactions = { launch: digest };
    await writeClassicV4FinalTransactionsOutput(
      transactions,
      finalTransactions,
    );
    await writeClassicV4FinalTransactionsOutput(
      transactions,
      finalTransactions,
    );
    await assert.rejects(
      writeClassicV4FinalTransactionsOutput(
        transactions,
        { launch: `0x${"22".repeat(32)}` },
      ),
      /final lifecycle transaction file/u,
    );
    assert.deepEqual(
      await readClassicV4PrivateJson(
        transactions,
        "Transactions output",
      ),
      finalTransactions,
    );
    assert.throws(
      () => assertClassicV4ExecutionOutputPair(journal, `${journal}.lock`),
      /reserved lifecycle lock sidecar suffix/u,
    );
    assert.throws(
      () => assertClassicV4ExecutionOutputPair(journal, `${journal}.lock.guard`),
      /reserved lifecycle lock sidecar suffix/u,
    );
    for (const reserved of [
      path.join(directory, "legacy.lock"),
      path.join(directory, "legacy.LOCK"),
      path.join(directory, "legacy.LoCk.GuArD"),
    ]) {
      assert.throws(
        () => assertClassicV4ExecutionOutputPair(reserved, transactions),
        /reserved lifecycle lock sidecar suffix/u,
      );
      assert.throws(
        () => assertClassicV4ExecutionOutputPair(journal, reserved),
        /reserved lifecycle lock sidecar suffix/u,
      );
    }
    assert.throws(
      () => assertClassicV4ExecutionOutputPair(journal, journal),
      /exact private leaf name|distinct/u,
    );
    assert.throws(
      () => assertClassicV4ExecutionOutputPair(
        path.join(directory, "case-output.json"),
        path.join(directory, "CASE-OUTPUT.JSON"),
      ),
      /exact private leaf name/u,
    );
    assert.throws(
      () => assertClassicV4ExecutionOutputPair(
        path.join(directory, "évidence.json"),
        path.join(directory, "e\u0301vidence.json"),
      ),
      /exact private leaf name/u,
    );
    assert.throws(
      () => assertClassicV4ExecutionOutputPair(
        path.join(directory, "Journal.json"),
        transactions,
      ),
      /exact private leaf name journal\.json/u,
    );
    assert.throws(
      () => assertClassicV4ExecutionOutputPair(
        journal,
        path.join(directory, "TRANSACTIONS.JSON"),
      ),
      /exact private leaf name transactions\.json/u,
    );

    const symbolic = path.join(directory, "symbolic.json");
    await symlink(journal, symbolic);
    await assert.rejects(
      assertClassicV4ExternalExecutionPath(symbolic, {
        mayExist: true,
        label: "Symbolic output",
      }),
      /single-link regular file/u,
    );

    const linkedSource = path.join(directory, "linked-source.json");
    const linkedAlias = path.join(directory, "linked-alias.json");
    await writeFile(linkedSource, "{}\n", { mode: 0o600 });
    await chmod(linkedSource, 0o600);
    await link(linkedSource, linkedAlias);
    await assert.rejects(
      assertClassicV4ExternalExecutionPath(linkedAlias, {
        mayExist: true,
        label: "Hard-linked output",
      }),
      /single-link regular file/u,
    );

    await symlink(directory, symbolicParent);
    const redirected = path.join(symbolicParent, "redirected.json");
    await assert.rejects(
      writeClassicV4PrivateJson(redirected, { sequence: 3 }, {
        createOnly: true,
        label: "Redirected output",
      }),
      /real owner-private 0700 directory/u,
    );
    await assert.rejects(stat(path.join(directory, "redirected.json")), {
      code: "ENOENT",
    });

    await assert.rejects(
      writeClassicV4PrivateJson(
        path.join(publicParent, "public.json"),
        { sequence: 4 },
        { createOnly: true, label: "Public-parent output" },
      ),
      /real owner-private 0700 directory/u,
    );
    await assert.rejects(stat(path.join(publicParent, "public.json")), {
      code: "ENOENT",
    });

    const movedParent = `${createdDirectory}-moved-parent`;
    await rename(createdDirectory, movedParent);
    await mkdir(createdDirectory, { mode: 0o700 });
    await chmod(createdDirectory, 0o700);
    try {
      await assert.rejects(
        writeClassicV4PrivateJson(
          path.join(directory, "replacement.json"),
          { sequence: 5 },
          { createOnly: true, label: "Parent-swap output" },
        ),
        /pinned lifecycle directory/u,
      );
      await assert.rejects(
        stat(path.join(directory, "replacement.json")),
        { code: "ENOENT" },
      );
    } finally {
      await rm(createdDirectory, { recursive: true });
      await rename(movedParent, createdDirectory);
    }
  } finally {
    await rm(symbolicParent, { force: true });
    await rm(publicParent, { recursive: true });
    await rm(createdDirectory, { recursive: true });
  }
});

test("Classic V4 PID lock is exclusive, recovers partial state and owns release inode", async () => {
  const createdDirectory = await mkdtemp(
    path.join(os.tmpdir(), "classic-v4-lock-"),
  );
  const directory = await realpath(createdDirectory);
  await chmod(directory, 0o700);
  try {
    const journal = path.join(directory, "journal.json");
    const lockPath = `${journal}.lock`;
    const release = await acquireClassicV4ExecutionLock(journal);
    const active = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(active.pid, process.pid);
    assert.equal(typeof active.processStart, "string");
    assert(active.processStart.length > 0);
    assert.match(active.token, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal((await stat(lockPath)).mode & 0o777, 0o600);
    assert.equal((await stat(`${lockPath}.guard`)).mode & 0o777, 0o600);
    await assert.rejects(
      acquireClassicV4ExecutionLock(journal),
      /Another lifecycle console/u,
    );
    await release();
    await assert.rejects(stat(lockPath), { code: "ENOENT" });

    await writeFile(lockPath, "{", { mode: 0o600 });
    await chmod(lockPath, 0o600);
    const releaseRecoveredPartial = await acquireClassicV4ExecutionLock(journal);
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).pid, process.pid);
    await releaseRecoveredPartial();

    const reusedPidLock = {
      pid: process.pid,
      processStart: "Mon Jan 01 00:00:00 1990",
      token: "r".repeat(43),
    };
    await writeFile(lockPath, `${JSON.stringify(reusedPidLock)}\n`, {
      mode: 0o600,
    });
    await chmod(lockPath, 0o600);
    const releaseRecoveredReusedPid =
      await acquireClassicV4ExecutionLock(journal);
    const recoveredReusedPid = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(recoveredReusedPid.pid, process.pid);
    assert.notEqual(
      recoveredReusedPid.processStart,
      reusedPidLock.processStart,
    );
    await releaseRecoveredReusedPid();

    await writeFile(lockPath, `${JSON.stringify({
      pid: 999_999_999,
      token: "a".repeat(43),
    })}\n`, { mode: 0o600 });
    await chmod(lockPath, 0o600);
    const releaseRecoveredPid = await acquireClassicV4ExecutionLock(journal);
    const displaced = `${lockPath}.displaced`;
    await rename(lockPath, displaced);
    const replacement = {
      pid: process.pid,
      token: "b".repeat(43),
    };
    await writeFile(lockPath, `${JSON.stringify(replacement)}\n`, { mode: 0o600 });
    await chmod(lockPath, 0o600);
    await assert.rejects(
      releaseRecoveredPid(),
      /ownership changed/u,
    );
    assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), replacement);
  } finally {
    await rm(createdDirectory, { recursive: true });
  }
});

test("Classic V4 lock acquisition preserves reverse-collision journals", async () => {
  const createdDirectory = await mkdtemp(
    path.join(os.tmpdir(), "classic-v4-reverse-lock-"),
  );
  const directory = await realpath(createdDirectory);
  await chmod(directory, 0o700);
  try {
    for (const [fixture, journalValue] of [
      ["object", { owner: "console-b-journal" }],
      ["null", null],
    ]) {
      const fixtureDirectory = path.join(directory, fixture);
      await mkdir(fixtureDirectory, { mode: 0o700 });
      await chmod(fixtureDirectory, 0o700);
      const consoleAJournal = path.join(fixtureDirectory, "journal.json");
      const consoleBJournal = `${consoleAJournal}.lock`;
      const consoleBLock = `${consoleBJournal}.lock`;
      const lockValue = {
        pid: process.pid,
        token: "z".repeat(43),
      };
      await writeClassicV4PrivateJson(consoleBJournal, journalValue, {
        createOnly: true,
        label: "Legacy journal output",
      });
      await writeClassicV4PrivateJson(consoleBLock, lockValue, {
        createOnly: true,
        label: "Legacy lifecycle lock",
      });
      const journalBytes = await readFile(consoleBJournal, "utf8");
      const lockBytes = await readFile(consoleBLock, "utf8");

      await assert.rejects(
        acquireClassicV4ExecutionLock(consoleAJournal),
        /refusing a reserved output collision/u,
      );
      assert.equal(await readFile(consoleBJournal, "utf8"), journalBytes);
      assert.equal(await readFile(consoleBLock, "utf8"), lockBytes);
    }
  } finally {
    await rm(createdDirectory, { recursive: true });
  }
});

test("Classic V4 quarantine rename syncs destination before source", async () => {
  const createdDirectory = await mkdtemp(
    path.join(os.tmpdir(), "classic-v4-quarantine-sync-"),
  );
  const directory = await realpath(createdDirectory);
  await chmod(directory, 0o700);
  try {
    const owned = path.join(directory, "owned.json");
    await writeClassicV4PrivateJson(owned, { owner: "test" }, {
      createOnly: true,
      label: "Owned test file",
    });
    const ownedStats = await stat(owned);
    const events = [];
    let quarantineDirectory;
    await unlinkOwnedPath(
      owned,
      ownedStats,
      "Owned test file",
      null,
      {
        rename: async (source, destination) => {
          quarantineDirectory = path.dirname(destination);
          events.push(["rename", source, destination]);
          await rename(source, destination);
        },
        syncDirectory: async (targetDirectory) => {
          events.push(["sync", targetDirectory]);
        },
      },
    );
    const renameIndex = events.findIndex(([kind]) => kind === "rename");
    assert(renameIndex >= 0);
    assert.deepEqual(events[renameIndex + 1], [
      "sync",
      quarantineDirectory,
    ]);
    assert.deepEqual(events[renameIndex + 2], ["sync", directory]);
    await assert.rejects(stat(owned), { code: "ENOENT" });
  } finally {
    await rm(createdDirectory, { recursive: true });
  }
});

test("Classic V4 stale-lock recoverers admit exactly one live process", async () => {
  const createdDirectory = await mkdtemp(
    path.join(os.tmpdir(), "classic-v4-recoverers-"),
  );
  const directory = await realpath(createdDirectory);
  await chmod(directory, 0o700);
  try {
    const journal = path.join(directory, "journal.json");
    await writeFile(`${journal}.lock`, `${JSON.stringify({
      pid: 999_999_999,
      token: "c".repeat(43),
    })}\n`, { mode: 0o600 });
    await chmod(`${journal}.lock`, 0o600);
    const modulePath = path.resolve(
      "scripts/serve-classic-v4-lifecycle-canary.mjs",
    );
    const code = `import { acquireClassicV4ExecutionLock } from ${JSON.stringify(modulePath)};try{const release=await acquireClassicV4ExecutionLock(${JSON.stringify(journal)});process.stdout.write("LOCKED\\n");await new Promise(resolve=>setTimeout(resolve,2000));await release()}catch(error){process.stderr.write(error.message+"\\n");process.exitCode=2}`;
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", code],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.once("error", reject);
      child.stdout.on("data", (bytes) => { stdout += bytes; });
      child.stderr.on("data", (bytes) => { stderr += bytes; });
      child.once("close", (status) => resolve({ status, stdout, stderr }));
    });
    const results = await Promise.all([run(), run()]);
    assert.equal(results.filter(({ stdout }) => stdout.includes("LOCKED")).length, 1);
    assert.equal(results.filter(({ status }) => status === 0).length, 1);
    assert.match(
      results.find(({ status }) => status !== 0).stderr,
      /Another lifecycle console/u,
    );
  } finally {
    await rm(createdDirectory, { recursive: true });
  }
});

test("Classic V4 request mutex serializes concurrent lifecycle endpoints", async () => {
  const serialize = createClassicV4LifecycleRequestMutex();
  const events = [];
  let releasePrepare;
  const prepareGate = new Promise((resolve) => { releasePrepare = resolve; });
  let prepareStarted;
  const started = new Promise((resolve) => { prepareStarted = resolve; });
  let recordReceived;
  const received = new Promise((resolve) => { recordReceived = resolve; });
  const server = createServer(async (request, response) => {
    if (request.url === "/record") recordReceived();
    await serialize(async () => {
      events.push(`${request.url}:start`);
      if (request.url === "/prepare") {
        prepareStarted();
        await prepareGate;
      }
      events.push(`${request.url}:end`);
      response.writeHead(200);
      response.end("ok");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const prepare = fetch(`${origin}/prepare`);
    await started;
    const record = fetch(`${origin}/record`);
    await received;
    assert.deepEqual(events, ["/prepare:start"]);
    releasePrepare();
    const responses = await Promise.all([prepare, record]);
    assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
    assert.deepEqual(events, [
      "/prepare:start",
      "/prepare:end",
      "/record:start",
      "/record:end",
    ]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("Classic V4 blocked startup resumes without RPC reconciliation", async () => {
  const blockedJournal = { blocked: "launch reverted on Mainnet" };
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("Blocked startup must not fetch");
  };
  try {
    assert.deepEqual(
      await refreshClassicV4Journal(
        null,
        null,
        blockedJournal,
        [],
        null,
        null,
      ),
      { journal: blockedJournal, outputReady: false },
    );
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
