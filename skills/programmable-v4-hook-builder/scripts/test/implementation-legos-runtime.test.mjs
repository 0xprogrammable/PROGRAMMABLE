import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  loadTemplateCatalog,
  materializeTemplate
} from "../template-catalog-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const legoRoot = path.join(skillRoot, "assets", "starter-catalog", "implementation-legos", "templates");
const hasTypeStripping = process.features.typescript === "strip";

test("claim adapter binds currency id and exact ERC-6909 authority mode", {
  skip: hasTypeStripping ? false : "Node runtime has no erasable TypeScript support"
}, async () => {
  const { assertClaimAction } = await importTypeScript("v4-claim-frontend-adapter/claimAdapter.ts");
  const owner = address("11");
  const operator = address("22");
  const spender = address("33");
  const mintAuthority = address("44");
  const stranger = address("55");
  const snapshot = {
    owner,
    operator,
    mintAuthority,
    currencyId: 7n,
    balance: 10n,
    blockNumber: 100n,
    allowance: { spender, currencyId: 7n, amount: 4n }
  };
  const burn = { kind: "burn", owner, currencyId: 7n, amount: 4n };
  const confirmedBurn = structuredClone(burn);

  assert.equal(assertClaimAction(snapshot, burn, owner, confirmedBurn), "owner");
  assert.equal(assertClaimAction(snapshot, burn, operator, confirmedBurn), "operator");
  assert.equal(assertClaimAction(snapshot, burn, spender, confirmedBurn), "per-id-allowance");
  assert.throws(
    () => assertClaimAction(snapshot, { ...burn, currencyId: 8n }, spender, { ...burn, currencyId: 8n }),
    /currency id mismatch/u
  );
  assert.throws(
    () => assertClaimAction(
      { ...snapshot, allowance: { ...snapshot.allowance, currencyId: 8n } },
      burn,
      spender,
      confirmedBurn
    ),
    /allowance is bound to another currency id/u
  );
  assert.throws(
    () => assertClaimAction(
      { ...snapshot, allowance: { ...snapshot.allowance, amount: 3n } },
      burn,
      spender,
      confirmedBurn
    ),
    /lacks owner, operator or sufficient per-id allowance/u
  );
  assert.throws(() => assertClaimAction(snapshot, burn, stranger, confirmedBurn), /lacks owner, operator/u);
  const mint = { ...burn, kind: "mint" };
  assert.throws(
    () => assertClaimAction(snapshot, mint, spender, mint),
    /not the bound mint authority/u
  );
  assert.equal(
    assertClaimAction(snapshot, mint, mintAuthority, mint),
    "mint-authority"
  );
  assert.throws(
    () => assertClaimAction(snapshot, { ...burn, kind: "transfer" }, owner, { ...burn, kind: "transfer" }),
    /unsupported claim action/u
  );
  assert.throws(
    () => assertClaimAction(snapshot, burn, owner, { ...burn, amount: 3n }),
    /confirmed claim amount mismatch/u
  );
  assert.throws(
    () => assertClaimAction(snapshot, burn, owner, { ...burn, kind: "mint" }),
    /confirmed claim kind mismatch/u
  );
  assert.throws(
    () => assertClaimAction({ ...snapshot, currencyId: 1n << 160n }, burn, owner, confirmedBurn),
    /unsigned 160-bit currency id/u
  );
});

test("swap adapter rejects runtime exactness and every changed confirmed binding", {
  skip: hasTypeStripping ? false : "Node runtime has no erasable TypeScript support"
}, async () => {
  const { assertExecutableSwapIntent } = await importTypeScript("v4-swap-frontend-adapter/swapAdapter.ts");
  const intent = {
    chainId: 1,
    poolId: bytes32("11"),
    exactness: "exact-input",
    amount: 100n,
    limitAmount: 90n,
    deadline: 1_000n,
    hookData: "0x1234",
    routeHash: bytes32("22"),
    quoteBlockNumber: 500n,
    quoteBlockHash: bytes32("33")
  };
  assert.doesNotThrow(() => assertExecutableSwapIntent(intent, 999n, structuredClone(intent)));
  assert.throws(
    () => assertExecutableSwapIntent({ ...intent, exactness: "market" }, 999n, intent),
    /exactness is invalid/u
  );
  const mismatches = [
    ["chainId", 10],
    ["poolId", bytes32("44")],
    ["exactness", "exact-output"],
    ["amount", 101n],
    ["limitAmount", 89n],
    ["deadline", 1_001n],
    ["hookData", "0xabcd"],
    ["routeHash", bytes32("55")],
    ["quoteBlockNumber", 501n],
    ["quoteBlockHash", bytes32("66")]
  ];
  for (const [field, value] of mismatches) {
    assert.throws(
      () => assertExecutableSwapIntent(intent, 999n, { ...intent, [field]: value }),
      new RegExp(`${field} mismatch`, "u"),
      field
    );
  }
});

test("position adapter binds chain, PositionManager and same-height block hash", {
  skip: hasTypeStripping ? false : "Node runtime has no erasable TypeScript support"
}, async () => {
  const { reconcilePosition } = await importTypeScript("v4-position-frontend-adapter/positionAdapter.ts");
  const expected = {
    chainId: 1,
    positionManager: address("11"),
    tokenId: 9n,
    poolId: bytes32("22"),
    owner: address("33"),
    liquidity: 100n,
    blockNumber: 500n,
    blockHash: bytes32("44")
  };
  assert.doesNotThrow(() => reconcilePosition(expected, structuredClone(expected)));
  assert.throws(
    () => reconcilePosition(expected, { ...expected, liquidity: 101n }),
    /same-block position liquidity mismatch/u
  );
  assert.doesNotThrow(() => reconcilePosition(expected, {
    ...expected,
    liquidity: 101n,
    blockNumber: 501n,
    blockHash: bytes32("55")
  }));
  assert.throws(() => reconcilePosition(expected, { ...expected, chainId: 10 }), /chain mismatch/u);
  assert.throws(
    () => reconcilePosition(expected, { ...expected, positionManager: address("66") }),
    /manager mismatch/u
  );
  assert.throws(
    () => reconcilePosition(expected, { ...expected, blockHash: bytes32("77") }),
    /same-height position snapshot is from a different block/u
  );
});

test("canonical event buffer deep-copies records, prunes below one anchor and rejects finalized reorgs", {
  skip: hasTypeStripping ? false : "Node runtime has no erasable TypeScript support"
}, async () => {
  const { CanonicalEventBuffer } = await importTypeScript("reorg-safe-indexer/CanonicalEventBuffer.ts");
  assertControlledRecordFailure(
    () => new CanonicalEventBuffer(1, 0n),
    /confirmationDepth must be a positive bigint/u
  );
  assertControlledRecordFailure(
    () => new CanonicalEventBuffer(0n, 0n),
    /confirmationDepth must be a positive bigint/u
  );
  assertControlledRecordFailure(
    () => new CanonicalEventBuffer(1n, 0),
    /startBlock must be a nonnegative bigint/u
  );
  assertControlledRecordFailure(
    () => new CanonicalEventBuffer(1n, -1n),
    /startBlock must be a nonnegative bigint/u
  );
  const buffer = new CanonicalEventBuffer(1n, 10n);
  const first = block(10n, "10", "09", [{ nested: { value: 1 } }]);
  assert.deepEqual(buffer.ingest(first), []);
  first.records[0].nested.value = 999;
  const finalizedTen = buffer.ingest(block(11n, "11", "10", [{ value: 2 }]));
  assert.equal(finalizedTen[0].records[0].nested.value, 1);
  assert.equal(Object.isFrozen(finalizedTen), true);
  assert.equal(Object.isFrozen(finalizedTen[0].records[0].nested), true);
  assert.deepEqual(buffer.status(), {
    finalizedNumber: 10n,
    finalizedHash: bytes32("10"),
    bufferedBlockNumbers: [10n, 11n]
  });
  assert.deepEqual(
    buffer.ingest(block(11n, "11".toUpperCase(), "10".toUpperCase(), [{ value: 2 }])),
    []
  );
  assert.throws(
    () => buffer.ingest(block(11n, "11", "10", [{ value: 999 }])),
    /duplicate block snapshot mismatch/u
  );
  assert.throws(
    () => buffer.ingest(block(11n, "11", "ff", [{ value: 2 }])),
    /duplicate block snapshot mismatch/u
  );

  buffer.ingest(block(12n, "12", "11", [{ value: 3 }]));
  assert.deepEqual(buffer.status(), {
    finalizedNumber: 11n,
    finalizedHash: bytes32("11"),
    bufferedBlockNumbers: [11n, 12n]
  });
  assert.throws(
    () => buffer.ingest(block(12n, "aa", "ff", [])),
    /reorg crossed finalized checkpoint/u
  );

  const unfinalized = new CanonicalEventBuffer(2n, 20n);
  unfinalized.ingest(block(20n, "20", "19", []));
  unfinalized.ingest(block(21n, "21", "20", [{ branch: "old" }]));
  assert.doesNotThrow(() => unfinalized.ingest(block(21n, "ab", "20", [{ branch: "new" }])));
  assert.deepEqual(unfinalized.status().bufferedBlockNumbers, [20n, 21n]);

  const canonicalKeys = new CanonicalEventBuffer(2n, 30n);
  canonicalKeys.ingest(block(30n, "AA", "99", [{ first: 1, second: 2 }]));
  assert.deepEqual(
    canonicalKeys.ingest(block(30n, "aa", "99", [{ second: 2, first: 1 }])),
    []
  );
  assert.equal(canonicalKeys.status().finalizedHash, null);

  const invalidRecords = new CanonicalEventBuffer(2n, 40n);
  const cyclic = {};
  cyclic.self = cyclic;
  assertControlledRecordFailure(
    () => invalidRecords.ingest(block(40n, "40", "39", [cyclic])),
    /must not be cyclic/u
  );
  for (const unsupported of [new Map(), new Set(), new Uint8Array([1]), new Date(0)]) {
    assertControlledRecordFailure(
      () => invalidRecords.ingest(block(40n, "40", "39", [unsupported])),
      /only plain objects and arrays/u
    );
  }
  let tooDeep = { value: 1 };
  for (let depth = 0; depth < 40; depth += 1) tooDeep = { nested: tooDeep };
  assertControlledRecordFailure(
    () => invalidRecords.ingest(block(40n, "40", "39", [tooDeep])),
    /maximum depth/u
  );
  assertControlledRecordFailure(
    () => invalidRecords.ingest(block(40n, "40", "39", [new Array(10_001).fill(null)])),
    /maximum node count/u
  );
  assertControlledRecordFailure(
    () => invalidRecords.ingest(block(40n, "40", "39", [new Array(3)])),
    /must be dense and contain only canonical index properties/u
  );
  const extraProperty = [1];
  extraProperty.label = "unexpected";
  assertControlledRecordFailure(
    () => invalidRecords.ingest(block(40n, "40", "39", [extraProperty])),
    /must be dense and contain only canonical index properties/u
  );
});

const forgeAvailability = spawnSync("forge", ["--version"], { encoding: "utf8", shell: false });
test("async fee scaffold preserves remainder across batches and rejects fill replay", {
  skip: forgeAvailability.status === 0 ? false : "Foundry is unavailable"
}, () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-async-lego-"));
  const target = path.join(root, "materialized");
  try {
    materializeTemplate({
      catalog,
      starterId: "custom-hook",
      packIds: ["async-swap"],
      targetDirectory: target
    });
    const result = spawnSync("forge", [
      "test",
      "--offline",
      "--root",
      path.join(target, "implementation", "async-batch-fee-adapter")
    ], {
      encoding: "utf8",
      shell: false,
      timeout: 60_000,
      env: { PATH: process.env.PATH }
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /3 passed/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function importTypeScript(relativePath) {
  return import(pathToFileURL(path.join(legoRoot, relativePath)).href);
}

function address(byte) {
  return `0x${byte.repeat(20)}`;
}

function bytes32(byte) {
  return `0x${byte.repeat(32)}`;
}

function block(number, hashByte, parentHashByte, records) {
  return {
    number,
    hash: bytes32(hashByte),
    parentHash: bytes32(parentHashByte),
    records
  };
}

function assertControlledRecordFailure(action, pattern) {
  assert.throws(action, (error) => {
    assert.notEqual(error?.name, "RangeError");
    assert.match(error?.message ?? "", pattern);
    return true;
  });
}
