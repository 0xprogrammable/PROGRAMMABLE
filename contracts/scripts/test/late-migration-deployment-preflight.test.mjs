import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult, keccak256 } from "viem";
import {
  EXPECTED,
  TOKEN_ABI,
  assertLateMigrationActivationIsInert,
  assertLateMigrationDeploymentAddressesSafe,
  createReadonlyJsonRpcProvider,
  prepareLateMigrationOwnerHandoff,
  runLateMigrationDeploymentPreflight,
  sourceArtifactBytes,
  verifyFrozenLateMigrationInputs,
} from "../late-migration-deployment-preflight-core.mjs";
import { runLateMigrationDeploymentCli } from "../prepare-late-migration-deployment.mjs";
import { updateLateMigrationArtifactFixtures } from "../update-late-migration-artifact-fixtures.mjs";
import { fixture, inputs } from "./fixtures/late-migration-tooling-fixture.mjs";
const preflight = (f, extra = {}) =>
  runLateMigrationDeploymentPreflight({
    ...f,
    sourceProviders: f.providers,
    ...extra,
  });
const handoff = (f, receipt, extra = {}) =>
  prepareLateMigrationOwnerHandoff({
    ...f,
    sourceProviders: f.providers,
    preflightReceipt: receipt,
    ...extra,
  });

test("frozen 1499-row Merkle root preserves exact per-wallet 80% rounding", () => {
  const actual = verifyFrozenLateMigrationInputs(inputs());
  assert.equal(actual.eligibleOfferCount, 1499);
  assert.equal(
    (BigInt(actual.aggregateGrossAmountRaw) * 8000n) / 10000n -
      BigInt(actual.aggregateManualPayoutAmountRaw),
    594n,
  );
});
test("source artifact fixtures reproduce the reviewed compiler and patched runtime", async () => {
  const result = await updateLateMigrationArtifactFixtures();
  assert.equal(
    result.sourceRuntimeCodehash,
    "0xecdf575038f4a7c3b839c7de527389187d8408e13b0e5b2344b9b30135f2cb70",
  );
});
for (const [name, mutate] of [
  [
    "root",
    (f) => {
      f.preflight.frozenRound.eligibilityRoot = `0x${"11".repeat(32)}`;
    },
  ],
  [
    "gross raw integer",
    (f) => {
      f.eligibility.rows[0].requiredGrossDepositRaw = "01";
    },
  ],
  [
    "per-wallet payout",
    (f) => {
      f.eligibility.rows[0].targetPayout80Raw = "1";
    },
  ],
  [
    "source duplication",
    (f) => {
      f.eligibility.rows[1].sourceAddress = f.eligibility.rows[0].sourceAddress;
    },
  ],
  [
    "obsolete target chain stage",
    (f) => {
      f.preflight.targetChain = { chainId: 4663 };
    },
  ],
  [
    "recipient",
    (f) => {
      f.activation.oldTokenRecipient = EXPECTED.owner;
    },
  ],
  [
    "activation authority",
    (f) => {
      f.preflight.ownerHandoff.activationAuthority = EXPECTED.oldTokenRecipient;
    },
  ],
  [
    "activation enable flag",
    (f) => {
      f.activation.enabled = true;
    },
  ],
])
  test(`rejects commitment drift: ${name}`, () => {
    const f = inputs();
    mutate(f);
    assert.throws(() => verifyFrozenLateMigrationInputs(f));
  });

test("predeployment activation requires every deployment/sponsor field null", () => {
  const f = inputs();
  assert.equal(assertLateMigrationActivationIsInert(f.activation), true);
  f.activation.relayerWalletOwnerId = "unreviewed";
  assert.throws(
    () => assertLateMigrationActivationIsInert(f.activation),
    /must be null/,
  );
});
test("predicted intake cannot collide with source holders or pinned roles", () => {
  const f = fixture();
  for (const sourceAddress of [
    EXPECTED.oldToken,
    EXPECTED.oldTokenRecipient,
    EXPECTED.owner,
    f.eligibility.rows[0].sourceAddress,
  ])
    assert.throws(
      () => assertLateMigrationDeploymentAddressesSafe({ ...f, sourceAddress }),
      /collides/,
    );
  assert.equal(
    assertLateMigrationDeploymentAddressesSafe({
      ...f,
      sourceAddress: f.sourceAddress,
    }),
    true,
  );
});
test("preflight observes two Ethereum providers and literal finalized without target calls", async () => {
  const f = fixture();
  const result = await preflight(f);
  assert.equal(result.state, "checked-not-deployed");
  assert.equal(result.sourceAnchor.blockNumber, "1000");
  assert.equal(result.sourceNonce, null);
  assert.equal(result.signingAllowed, false);
  assert(
    f.trace.some(
      (read) =>
        read.method === "eth_getBlockByNumber" &&
        read.params[0] === "finalized",
    ),
  );
  assert(!f.trace.some((read) => /send|sign/iu.test(read.method)));
});
for (const [name, mutate] of [
  ["wrong chain", (v, m) => (m === "eth_chainId" ? "0x1237" : v)],
  [
    "missing finalized",
    (v, m, p) =>
      m === "eth_getBlockByNumber" && p[0] === "finalized" ? null : v,
  ],
  [
    "provider head lag",
    (v, m, p, i) => (m === "eth_blockNumber" && i === 1 ? "0x500" : v),
  ],
  [
    "provider disagreement",
    (v, m, p, i) => (m === "eth_getCode" && i === 1 ? "0x00" : v),
  ],
  ["runtime mismatch", (v, m) => (m === "eth_getCode" ? "0x00" : v)],
  [
    "stale anchor",
    (v, m) => (m === "eth_getBlockByNumber" ? { ...v, timestamp: "0x1" } : v),
  ],
  [
    "wrong native permit domain",
    (v, m, p) =>
      m === "eth_call" &&
      decodeFunctionData({ abi: TOKEN_ABI, data: p[0].data }).functionName ===
        "DOMAIN_SEPARATOR"
        ? encodeFunctionResult({
            abi: TOKEN_ABI,
            functionName: "DOMAIN_SEPARATOR",
            result: `0x${"11".repeat(32)}`,
          })
        : v,
  ],
  [
    "owner pending transaction",
    (v, m, p) =>
      m === "eth_getTransactionCount" && p[1] === "pending" ? "0xc" : v,
  ],
])
  test(`preflight rejects ${name}`, async () => {
    const f = fixture({ mutate });
    await assert.rejects(preflight(f, { includePendingNonces: true }));
  });

test("unsigned source deployment binds fresh owner nonce, exact constructor, runtime and gas cap", async () => {
  const f = fixture();
  const receipt = await preflight(f, { includePendingNonces: true });
  const result = await handoff(f, receipt);
  assert.equal(result.stage, "source-deployment-only");
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].chainId, 1);
  assert.equal(result.transactions[0].value, "0");
  assert.equal(result.transactions[0].to, null);
  assert.equal(result.transactions[0].nonce, "11");
  assert.equal(result.transactions[0].gasLimit, "2400000");
  assert.equal(result.transactions[0].data, f.bytes.initcode);
  assert.equal(result.sourceRuntimeCodehash, keccak256(f.bytes.runtimeCode));
  assert.equal(result.signingAllowed, false);
  assert.equal(result.broadcastAllowed, false);
  assert.equal(result.expiresAt - result.generatedAt, 300);
});
test("handoff rejects serialized/forged receipt, changed inputs and stale nonce observation", async () => {
  const f = fixture();
  const receipt = await preflight(f, { includePendingNonces: true });
  await assert.rejects(
    handoff(f, structuredClone(receipt)),
    /fresh in-process/,
  );
  await assert.rejects(
    handoff(f, receipt, { nowSeconds: f.nowSeconds + 301 }),
    /stale/,
  );
  const changed = structuredClone(f.preflight);
  changed.ownerHandoff.maximumDeploymentGas = "9999999";
  await assert.rejects(
    handoff(f, receipt, { preflight: changed }),
    /unmodified preflight inputs/,
  );
});
test("artifact creation and immutable runtime pins must both match", () => {
  const f = fixture();
  const corrupt = structuredClone(f.artifacts.source);
  corrupt.bytecode.object = "0x00";
  assert.throws(
    () => sourceArtifactBytes(corrupt, f.preflight),
    /creation commitment/,
  );
  const refs = structuredClone(f.artifacts.source);
  refs.deployedBytecode.immutableReferences = {};
  assert.throws(
    () => sourceArtifactBytes(refs, f.preflight),
    /one oldToken immutable/,
  );
});
test("RPC adapter rejects all write methods before fetch and sanitizes network errors", async () => {
  let requests = 0;
  const provider = createReadonlyJsonRpcProvider({
    id: "test",
    trustDomain: "example.com",
    url: "https://example.com/private-api-key",
    fetchImpl: async () => {
      requests++;
      throw new Error("https://example.com/private-api-key");
    },
  });
  for (const method of [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "personal_sign",
    "eth_signTypedData_v4",
  ])
    await assert.rejects(provider.request(method, []), /forbidden/);
  assert.equal(requests, 0);
  await assert.rejects(
    provider.request("eth_chainId", []),
    (error) =>
      /request failed/u.test(error.message) &&
      !error.message.includes("private-api-key"),
  );
});
test("RPC adapter bounds response and enforces request identity", async () => {
  const provider = createReadonlyJsonRpcProvider({
    id: "test",
    trustDomain: "example.com",
    url: "https://example.com",
    fetchImpl: async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 999, result: "0x1" }), {
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    provider.request("eth_chainId", []),
    /invalid RPC response/,
  );
  const oversized = createReadonlyJsonRpcProvider({
    id: "test",
    trustDomain: "example.com",
    url: "https://example.com",
    fetchImpl: async () =>
      new Response("", { headers: { "content-length": "2000001" } }),
  });
  await assert.rejects(
    oversized.request("eth_chainId", []),
    /invalid bounded JSON/,
  );
});
test("deployment CLI cannot accept write/sign/fund commands or options", async () => {
  for (const option of [
    "--broadcast",
    "--send",
    "--fund",
    "--private-key=secret",
    "--sign",
  ])
    await assert.rejects(
      runLateMigrationDeploymentCli({ argv: ["prepare", option] }),
      /forbidden/,
    );
});


test("fixture immutable references bind byte offsets independently of compiler AST IDs", async () => {
  const { normalizedIntakeImmutableReferences } = await import("../update-late-migration-artifact-fixtures.mjs");
  const offsets = [{ start: 1673, length: 32 }, { start: 2120, length: 32 }];
  assert.deepEqual(normalizedIntakeImmutableReferences({ 5735: offsets }), normalizedIntakeImmutableReferences({ 44806: [...offsets].reverse() }));
  assert.notDeepEqual(normalizedIntakeImmutableReferences({ 5735: offsets }), normalizedIntakeImmutableReferences({ 5735: [{ start: 1674, length: 32 }] }));
  assert.throws(() => normalizedIntakeImmutableReferences({ 1: offsets, 2: offsets }));
});
