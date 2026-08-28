import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { keccak256 } from "viem";

import {
  assertExactClassicV4PlanSequence,
  assertRpcEndpoints,
  assertTransactionMatchesPreparation,
  buildUiCheckInspection,
  evaluateClassicV4Sequence,
  main,
  parseArguments,
  prepareClassicV4Transaction,
  readTransactionHashes,
  reconcileRpcSnapshots,
  validateClassicV4TransactionRecord,
  validatePartialTransactionHashes,
  writeTransactionHashes,
} from "../../../scripts/serve-classic-v4-metamask-deployer.mjs";

const testPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(testPath), "../../..");
const consolePath = path.join(
  repositoryRoot,
  "scripts/serve-classic-v4-metamask-deployer.mjs",
);
const DEPLOYER = "0x1111111111111111111111111111111111111111";
const ADDRESSES = Object.freeze({
  hookFactory: "0x2222222222222222222222222222222222222222",
  feeHook: "0x3333333333333333333333333333333333333333",
  positionPlanner: "0x4444444444444444444444444444444444444444",
  launcher: "0x5555555555555555555555555555555555555555",
});
const NAMES = ["hookFactory", "feeHook", "positionPlanner", "launcher"];
const RUNTIME = "0x6001600055";
const OTHER_RUNTIME = "0x6002600055";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;

function bytes32(byte) {
  return `0x${byte.repeat(64)}`;
}

function fixtureArtifacts() {
  return Object.fromEntries(
    NAMES.map((name) => [
      name,
      {
        deployedBytecode: {
          object: RUNTIME,
          immutableReferences: {},
        },
      },
    ]),
  );
}

function fixturePlan() {
  const data = ["0x6000", "0x12345678", "0x6001", "0x6002"];
  const transactions = NAMES.map((name, index) => ({
    name,
    transactionType: index === 1 ? "CALL_CREATE2" : "CREATE",
    from: DEPLOYER,
    to: index === 1 ? ADDRESSES.hookFactory : null,
    nonce: 42 + index,
    value: "0",
    predictedAddress: ADDRESSES[name],
    data: data[index],
    dataHash: keccak256(data[index]),
  }));
  return {
    schemaVersion: 1,
    chainId: 1,
    deployer: DEPLOYER,
    startingNonce: 42,
    observedAtBlock: 1_000,
    observedAtBlockHash: bytes32("a"),
    planDigest: bytes32("b"),
    sourceCommitment: bytes32("c"),
    releaseCommit: "1".repeat(40),
    releaseTree: "2".repeat(40),
    predictedAddresses: ADDRESSES,
    runtimeTemplates: Object.fromEntries(
      NAMES.map((name) => [
        name,
        { runtimeTemplateHash: keccak256(RUNTIME) },
      ]),
    ),
    transactions,
  };
}

function fixtureSnapshot(overrides = {}) {
  return {
    chainId: "0x1",
    latestBlockNumber: 1_100,
    latestBlockHash: bytes32("d"),
    baseFeePerGas: "0x3b9aca00",
    observedBlockHash: bytes32("a"),
    confirmedNonce: 42,
    pendingNonce: 42,
    balance: "0x8ac7230489e80000",
    gasPrice: "0x77359400",
    dependencyCodes: [],
    predictedCodes: NAMES.map((name) => ({
      name,
      code: "0x",
      codeHash: null,
    })),
    ...overrides,
  };
}

function fixtureTransaction(plan, index, overrides = {}) {
  const expected = plan.transactions[index];
  return {
    hash: bytes32(String(index + 1)),
    from: expected.from,
    to: expected.to,
    nonce: `0x${expected.nonce.toString(16)}`,
    value: "0x0",
    input: expected.data,
    chainId: "0x1",
    type: "0x2",
    gas: "0x1e8480",
    maxFeePerGas: "0x4a817c800",
    maxPriorityFeePerGas: "0x3b9aca00",
    blockNumber: null,
    blockHash: null,
    ...overrides,
  };
}

function fixtureReceipt(plan, index, hash, overrides = {}) {
  const expected = plan.transactions[index];
  return {
    transactionHash: hash,
    status: "0x1",
    from: expected.from,
    to: expected.to,
    contractAddress: index === 1 ? null : expected.predictedAddress,
    blockNumber: "0x44c",
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    ...overrides,
  };
}

test("plan sequence is exactly CREATE, CALL_CREATE2, CREATE, CREATE with zero value", () => {
  const plan = fixturePlan();
  assert.equal(assertExactClassicV4PlanSequence(plan), true);
  assert.deepEqual(
    plan.transactions.map((transaction) => transaction.transactionType),
    ["CREATE", "CALL_CREATE2", "CREATE", "CREATE"],
  );
  assert.deepEqual(
    plan.transactions.map((transaction) => transaction.value),
    ["0", "0", "0", "0"],
  );

  const reordered = structuredClone(plan);
  [reordered.transactions[0], reordered.transactions[1]] = [
    reordered.transactions[1],
    reordered.transactions[0],
  ];
  assert.throws(
    () => assertExactClassicV4PlanSequence(reordered),
    /exact sequence/,
  );

  const valueDrift = structuredClone(plan);
  valueDrift.transactions[2].value = "1";
  assert.throws(
    () => assertExactClassicV4PlanSequence(valueDrift),
    /exact sequence/,
  );
});

test("CLI requires absolute external inputs and forbids secret or broadcast flags", () => {
  const parsed = parseArguments([
    "--plan",
    "/var/tmp/classic-v4-plan.json",
    "--transactions",
    "/var/tmp/classic-v4-transactions.json",
  ], {});
  assert.equal(parsed.plan, "/var/tmp/classic-v4-plan.json");
  assert.equal(parsed.transactions, "/var/tmp/classic-v4-transactions.json");
  assert.throws(
    () => parseArguments(["--plan", "/var/tmp/plan.json", "--private-key=x"], {}),
    /MetaMask is the only signer/,
  );
  assert.throws(
    () => parseArguments(["--plan", "/var/tmp/plan.json", "--mnemonic", "x"], {}),
    /MetaMask is the only signer/,
  );
  assert.throws(
    () => parseArguments(["--plan", "relative.json", "--ui-check"], {}),
    /absolute path/,
  );
  assert.equal(
    parseArguments(["--plan", "/var/tmp/plan.json", "--ui-check"], {}).uiCheck,
    true,
  );
});

test("RPC endpoints must be distinct credential free HTTPS origins", () => {
  assert.doesNotThrow(() =>
    assertRpcEndpoints(["https://one.example", "https://two.example"]),
  );
  assert.throws(
    () => assertRpcEndpoints(["http://one.example", "https://two.example"]),
    /credential free HTTPS origins/,
  );
  assert.throws(
    () => assertRpcEndpoints(["https://one.example/key", "https://two.example"]),
    /credential free HTTPS origins/,
  );
  assert.throws(
    () => assertRpcEndpoints(["https://one.example", "https://one.example"]),
    /distinct hostnames/,
  );
});

test("transaction hash record accepts only a unique contiguous prefix", () => {
  assert.deepEqual(
    validatePartialTransactionHashes({
      feeHook: bytes32("2"),
      hookFactory: bytes32("1"),
    }),
    {
      hookFactory: bytes32("1"),
      feeHook: bytes32("2"),
    },
  );
  assert.throws(
    () => validatePartialTransactionHashes({ feeHook: bytes32("2") }),
    /contiguous Classic V4 prefix/,
  );
  assert.throws(
    () =>
      validatePartialTransactionHashes({
        hookFactory: bytes32("1"),
        feeHook: bytes32("1"),
      }),
    /nonzero and unique/,
  );
});

test("external transaction journal is created atomically with owner only mode", async () => {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "programmable-classic-v4-journal-"),
  );
  const recordPath = path.join(await realpath(temporary), "transactions.json");
  try {
    assert.deepEqual(await readTransactionHashes(recordPath), {});
    await writeTransactionHashes(recordPath, {
      hookFactory: bytes32("1"),
    });
    assert.deepEqual(await readTransactionHashes(recordPath), {
      hookFactory: bytes32("1"),
    });
    assert.equal((await stat(recordPath)).mode & 0o777, 0o600);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("dual RPC reconciliation rejects wrong chain, nonce drift and head divergence", () => {
  const plan = fixturePlan();
  const left = fixtureSnapshot();
  const right = fixtureSnapshot({ latestBlockNumber: 1_102 });
  const reconciled = reconcileRpcSnapshots(plan, [left, right]);
  assert.equal(reconciled.confirmedNonce, 42);
  assert.equal(reconciled.latestBlockNumber, 1_100);

  assert.throws(
    () =>
      reconcileRpcSnapshots(plan, [
        left,
        fixtureSnapshot({ chainId: "0xaa36a7" }),
      ]),
    /not Ethereum Mainnet/,
  );
  assert.throws(
    () =>
      reconcileRpcSnapshots(plan, [
        left,
        fixtureSnapshot({ pendingNonce: 43 }),
      ]),
    /disagree on the deployer nonce/,
  );
  assert.throws(
    () =>
      reconcileRpcSnapshots(plan, [
        left,
        fixtureSnapshot({ latestBlockNumber: 1_105 }),
      ]),
    /more than four blocks/,
  );
});

test("sequence gate blocks an occupied future address and unrecorded pending nonce", () => {
  const plan = fixturePlan();
  const occupied = fixtureSnapshot();
  occupied.predictedCodes[2] = {
    name: "positionPlanner",
    code: RUNTIME,
    codeHash: keccak256(RUNTIME),
  };
  assert.throws(
    () =>
      evaluateClassicV4Sequence({
        plan,
        state: occupied,
        hashes: {},
        records: [],
      }),
    /address is occupied/,
  );
  assert.throws(
    () =>
      evaluateClassicV4Sequence({
        plan,
        state: fixtureSnapshot({ pendingNonce: 43 }),
        hashes: {},
        records: [],
      }),
    /nonce differs/,
  );
});

test("record validation binds transaction, receipt, canonical block and runtime", () => {
  const plan = fixturePlan();
  const artifacts = fixtureArtifacts();
  const index = 0;
  const hash = bytes32("1");
  const transaction = fixtureTransaction(plan, index, {
    blockNumber: "0x44c",
    blockHash: BLOCK_HASH,
  });
  const receipt = fixtureReceipt(plan, index, hash);
  const canonicalBlock = { number: "0x44c", hash: BLOCK_HASH };
  const record = validateClassicV4TransactionRecord({
    plan,
    artifacts,
    index,
    hash,
    transaction,
    receipt,
    canonicalBlock,
    runtimeCode: RUNTIME,
  });
  assert.equal(record.status, "confirmed");
  assert.equal(record.runtime.runtimeTemplateHash, keccak256(RUNTIME));

  assert.throws(
    () =>
      validateClassicV4TransactionRecord({
        plan,
        artifacts,
        index,
        hash,
        transaction: { ...transaction, input: "0x6001" },
        receipt,
        canonicalBlock,
        runtimeCode: RUNTIME,
      }),
    /transaction differs from the reviewed plan/,
  );
  assert.throws(
    () =>
      validateClassicV4TransactionRecord({
        plan,
        artifacts,
        index,
        hash,
        transaction,
        receipt: { ...receipt, status: "0x0" },
        canonicalBlock,
        runtimeCode: RUNTIME,
      }),
    /receipt or canonical block differs/,
  );
  assert.throws(
    () =>
      validateClassicV4TransactionRecord({
        plan,
        artifacts,
        index,
        hash,
        transaction,
        receipt,
        canonicalBlock,
        runtimeCode: OTHER_RUNTIME,
      }),
    /runtime differs from reviewed source/,
  );
});

test("pending record cannot have runtime code", () => {
  const plan = fixturePlan();
  const artifacts = fixtureArtifacts();
  const transaction = fixtureTransaction(plan, 0);
  const pending = validateClassicV4TransactionRecord({
    plan,
    artifacts,
    index: 0,
    hash: transaction.hash,
    transaction,
    receipt: null,
    canonicalBlock: null,
    runtimeCode: "0x",
  });
  assert.equal(pending.status, "pending");
  assert.throws(
    () =>
      validateClassicV4TransactionRecord({
        plan,
        artifacts,
        index: 0,
        hash: transaction.hash,
        transaction,
        receipt: null,
        canonicalBlock: null,
        runtimeCode: RUNTIME,
      }),
    /runtime exists without a canonical receipt/,
  );
});

test("preparation requires two matching simulations, bounded gas and sufficient balance", () => {
  const plan = fixturePlan();
  const state = fixtureSnapshot();
  const prepared = prepareClassicV4Transaction({
    plan,
    state,
    index: 0,
    simulations: [
      { callResult: "0x", estimatedGas: "0x186a0" },
      { callResult: "0x", estimatedGas: "0x19640" },
    ],
  });
  assert.equal(prepared.request.value, "0x0");
  assert.equal(prepared.request.nonce, "0x2a");
  assert.equal(prepared.request.to, undefined);
  assert.equal(prepared.dataHash, plan.transactions[0].dataHash);
  assert.equal(prepared.gasLimit, "0x1e780");
  assert.equal(
    assertTransactionMatchesPreparation(
      {
        transaction: {
          gas: prepared.request.gas,
          maxFeePerGas: prepared.request.maxFeePerGas,
          maxPriorityFeePerGas: prepared.request.maxPriorityFeePerGas,
        },
      },
      prepared,
    ),
    true,
  );
  assert.throws(
    () =>
      assertTransactionMatchesPreparation(
        {
          transaction: {
            gas: "0x1",
            maxFeePerGas: prepared.request.maxFeePerGas,
            maxPriorityFeePerGas: prepared.request.maxPriorityFeePerGas,
          },
        },
        prepared,
      ),
    /gas fields differ/,
  );

  assert.throws(
    () =>
      prepareClassicV4Transaction({
        plan,
        state,
        index: 0,
        simulations: [
          { callResult: "0x", estimatedGas: "0x186a0" },
          { callResult: "0x01", estimatedGas: "0x186a0" },
        ],
      }),
    /simulations disagree/,
  );
  assert.throws(
    () =>
      prepareClassicV4Transaction({
        plan,
        state,
        index: 0,
        simulations: [
          { callResult: "0x", estimatedGas: "0xa7d8c0" },
          { callResult: "0x", estimatedGas: "0xa7d8c0" },
        ],
      }),
    /12 million gas operator cap/,
  );
  assert.throws(
    () =>
      prepareClassicV4Transaction({
        plan,
        state: fixtureSnapshot({ balance: "0x1" }),
        index: 0,
        simulations: [
          { callResult: "0x", estimatedGas: "0x186a0" },
          { callResult: "0x", estimatedGas: "0x186a0" },
        ],
      }),
    /balance is below/,
  );
});

test("UI check is seeded only from the supplied exact plan and cannot sign", () => {
  const plan = fixturePlan();
  const inspection = buildUiCheckInspection(plan);
  assert.equal(inspection.status, "ui-check");
  assert.equal(inspection.prepared.calldata, plan.transactions[0].data);
  assert.equal(inspection.prepared.request.value, "0x0");
  assert.equal(inspection.prepared.request.gas, "UI check only");
  assert.match(inspection.blockingReason, /Signing and RPC actions are disabled/);
});

test("seeded UI check serves the real supplied plan with signing disabled", async () => {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "programmable-classic-v4-ui-check-"),
  );
  const planPath = path.join(temporary, "plan.json");
  const port = 41_790 + (process.pid % 10_000);
  await writeFile(planPath, `${JSON.stringify(fixturePlan(), null, 2)}\n`);
  let server;
  try {
    server = await main(
      ["--plan", planPath, "--ui-check"],
      { PROGRAMMABLE_CLASSIC_V4_DEPLOY_PORT: String(port) },
    );
    if (!server.listening) await once(server, "listening");
    const response = await fetch(`http://127.0.0.1:${port}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(
      response.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.match(html, /UI check mode/);
    assert.match(html, new RegExp(ADDRESSES.hookFactory, "i"));
    assert.match(html, /Wallet, RPC, recording and signing are disabled|Signing disabled in UI check/);
    const favicon = await fetch(`http://127.0.0.1:${port}/favicon.png`);
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get("content-type"), "image/png");
  } finally {
    if (server?.listening) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await rm(temporary, { recursive: true, force: true });
  }
});

test("browser console has one explicit send call and hardened local response policy", async () => {
  const source = await readFile(consolePath, "utf8");
  assert.equal((source.match(/eth_sendTransaction/g) ?? []).length, 1);
  assert.doesNotMatch(source, /process\.env\.(?:PRIVATE_KEY|MNEMONIC)/);
  assert.doesNotMatch(source, /eth_signTransaction|personal_sign|Wallet\s*\(/);
  assert.match(source, /const HOST = "127\.0\.0\.1"/);
  assert.match(source, /"cache-control": "no-store, max-age=0"/);
  assert.match(source, /frame-ancestors 'none'/);
  assert.match(source, /operatorToken/);
});
