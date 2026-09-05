import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeFunctionResult,
  numberToHex, parseAbi, parseAbiParameters } from "viem";
import { ACTIVATION_TRACE_OPTIONS, METAMASK_ACTIVATION_PROFILE, decodeMetaMaskActivationEnvelope,
  normalizeActivationTrace, verifyMetaMaskActivationEnvelope } from "../late-migration-activation-envelope.mjs";
import { EXPECTED, agreedRead, createReadonlyJsonRpcProvider } from "../late-migration-deployment-preflight-core.mjs";
import { SOURCE_ABI, appendLateMigrationStageTransaction, createLateMigrationStageJournal,
  deriveDisabledLateMigrationActivationManifest, lateMigrationEndpointCommitment, productionProvidersFromEnvironment,
  verifyLateMigrationStageContext } from "../late-migration-deployment-stages-core.mjs";
import { fixture as stageFixture, deploymentHash, activationHash as directActivationHash, blockHash } from "./fixtures/late-migration-tooling-fixture.mjs";

const recorded = JSON.parse(await readFile(new URL("./fixtures/late-migration-activation-envelope.v1.json", import.meta.url), "utf8"));
const source = recorded.receipt.logs[0].address;
const txHash = recorded.transaction.hash;
const blockNumber = BigInt(recorded.transaction.blockNumber);
const outerAbi = parseAbi(["function redeemDelegations(bytes[] contexts,bytes32[] modes,bytes[] executions)"]);
const contextAbi = parseAbiParameters("(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]");
const clone = () => structuredClone(recorded);
function mutateInput(tx, mutate) {
  const { args } = decodeFunctionData({ abi: outerAbi, data: tx.input });
  mutate(args);
  tx.input = encodeFunctionData({ abi: outerAbi, functionName: "redeemDelegations", args });
}
function mutateDelegation(tx, mutate) {
  mutateInput(tx, (args) => {
    const [delegations] = decodeAbiParameters(contextAbi, args[0][0]);
    mutate(delegations);
    args[0][0] = encodeAbiParameters(contextAbi, [delegations]);
  });
}
function providersFor(data, mutate = (v) => v) {
  return ["alpha", "beta"].map((id, index) => ({ id, trustDomain: `${id}.test`, request: async (method, params) => {
    let value;
    if (method === "eth_getTransactionByHash") value = data.transaction;
    else if (method === "eth_getTransactionReceipt") value = data.receipt;
    else if (method === "debug_traceTransaction") {
      assert.deepEqual(params, [txHash, ACTIVATION_TRACE_OPTIONS]);
      value = data.trace;
    } else if (method === "eth_getCode") value = data.code[params[0].toLowerCase()] ?? "0x";
    else throw Error(`Unexpected RPC ${method}`);
    return mutate(structuredClone(value), method, params, index);
  } }));
}
async function runEnvelope(data = clone(), mutate) {
  const canonicalProviders = providersFor(recorded);
  return verifyMetaMaskActivationEnvelope({ providers: providersFor(data, mutate), transactionHash: txHash,
    canonicalTransaction: await agreedRead(canonicalProviders, "eth_getTransactionByHash", [txHash]),
    canonicalReceipt: await agreedRead(canonicalProviders, "eth_getTransactionReceipt", [txHash]),
    sourceAddress: source, sourceRuntimeCode: recorded.code[source], maximumActivationGas: "200000" });
}

test("complete actual signed type-4 transaction, nine frames and historical runtimes verify", async () => {
  const evidence = await runEnvelope();
  assert.equal(evidence.signedTransactionKeccak256, txHash);
  assert.equal(evidence.delegationDigest, "0x3513379bfa41dc94e86b22ae8befea334ff3431b997fe6e407cbba5fecbf045d");
  assert.equal(evidence.authorizationDigest, "0xd065a792abeb6fcd098b432fb8100658514342992bbcb59e1289b9b2fa991238");
  assert.equal(evidence.actualFeeWei, "7598049377444");
  assert.equal(evidence.persistentDelegationApplied, true);
  assert.equal(evidence.matchesPreparedDirectTransaction, false);
  assert(Object.isFrozen(evidence));
});

for (const [name, mutate, reason] of [
  ["wrong transaction type", (t) => t.type = "0x2", /transaction type/],
  ["wrong manager", (t) => t.to = EXPECTED.oldToken, /wrapped manager/],
  ["nonzero outer ETH", (t) => t.value = "0x1", /zero value/],
  ["over-limit gas", (t) => t.gas = "0x30d41", /gas or fee/],
  ["over-limit fee", (t) => t.maxFeePerGas = "0xbebc201", /gas or fee/],
  ["over-limit priority", (t) => t.maxPriorityFeePerGas = "0x186a1", /gas or fee/],
  ["extra access-list effect", (t) => t.accessList = [{ address: source, storageKeys: [] }], /access list/],
  ["missing authorization", (t) => t.authorizationList = [], /one authorization/],
  ["extra authorization", (t) => t.authorizationList.push(t.authorizationList[0]), /one authorization/],
  ["cross-chain authorization", (t) => t.authorizationList[0].chainId = "0x0", /chain-bound/],
  ["wrong implementation", (t) => t.authorizationList[0].address = EXPECTED.oldToken, /authorization implementation/],
  ["stale authorization nonce", (t) => t.authorizationList[0].nonce = "0x5", /authorization nonce/],
  ["wrong authorization signer", (t) => t.authorizationList[0].r = `0x${"01".repeat(32)}`, /authorization signer/],
  ["noncanonical signature", (t) => t.s = `0x${"ff".repeat(32)}`, /canonical signature/],
  ["missing outer signature", (t) => delete t.r, /bytes32/],
  ["claimed transaction hash drift", (t) => t.hash = `0x${"02".repeat(32)}`, /reconstructed signed/],
  ["changed signed gas with same hash", (t) => t.gas = "0x2e24a", /reconstructed signed/],
  ["trailing outer calldata", (t) => t.input += "00", /calldata size/],
  ["batch execution", (t) => mutateInput(t, (a) => a[1][0] = `0x01${"00".repeat(31)}`), /default execution/],
  ["try execution", (t) => mutateInput(t, (a) => a[1][0] = `0x0001${"00".repeat(30)}`), /default execution/],
  ["unused mode bits", (t) => mutateInput(t, (a) => a[1][0] = `0x${"00".repeat(31)}01`), /default execution/],
  ["extra execution", (t) => mutateInput(t, (a) => a[2].push(a[2][0])), /calldata size|single activation/],
  ["inner target drift", (t) => mutateInput(t, (a) => a[2][0] = EXPECTED.oldToken.toLowerCase() + a[2][0].slice(42)), /packed activation/],
  ["inner calldata drift", (t) => mutateInput(t, (a) => a[2][0] = a[2][0].slice(0, -8) + "00000000"), /packed activation/],
  ["inner nonzero ETH", (t) => mutateInput(t, (a) => a[2][0] = a[2][0].slice(0, 104) + "01" + a[2][0].slice(106)), /packed activation/],
  ["extra packed bytes", (t) => mutateInput(t, (a) => a[2][0] += "00"), /packed activation/],
  ["second delegation", (t) => mutateDelegation(t, (d) => d.push(d[0])), /calldata size|one self delegation/],
  ["different delegator", (t) => mutateDelegation(t, (d) => d[0].delegator = EXPECTED.oldToken), /delegator/],
  ["different delegate", (t) => mutateDelegation(t, (d) => d[0].delegate = EXPECTED.oldToken), /delegate/],
  ["non-root authority", (t) => mutateDelegation(t, (d) => d[0].authority = `0x${"00".repeat(32)}`), /authority/],
  ["extra caveat", (t) => mutateDelegation(t, (d) => d[0].caveats.push(d[0].caveats[0])), /calldata size|one native/],
  ["different enforcer", (t) => mutateDelegation(t, (d) => d[0].caveats[0].enforcer = EXPECTED.oldToken), /native balance caveat/],
  ["changed terms", (t) => mutateDelegation(t, (d) => d[0].caveats[0].terms = d[0].caveats[0].terms.slice(0, -2) + "01"), /native balance caveat/],
  ["unsigned caveat args", (t) => mutateDelegation(t, (d) => d[0].caveats[0].args = "0x00"), /calldata size|native balance caveat/],
  ["invalid delegation signer", (t) => mutateDelegation(t, (d) => d[0].salt += 1n), /delegation signer/],
  ["dirty outer ABI padding", (t) => t.input = t.input.slice(0, -2) + "01", /canonical outer/],
  ["dirty nested ABI padding", (t) => mutateInput(t, (a) => a[0][0] = a[0][0].slice(0, -2) + "01"), /canonical permission/],
]) test(`signed envelope rejects ${name}`, async () => {
  const data = clone(); mutate(data.transaction);
  await assert.rejects(decodeMetaMaskActivationEnvelope(data.transaction, source, "200000"), reason);
});

for (const [name, mutate] of [
  ["only successful source subtrace", (t) => Object.assign(t, t.calls[3].calls[0])],
  ["missing child", (t) => t.calls.pop()],
  ["extra child", (t) => t.calls.push(t.calls[1])],
  ["reordered hooks", (t) => [t.calls[1], t.calls[2]] = [t.calls[2], t.calls[1]]],
  ["unexpected target", (t) => t.calls[1].to = EXPECTED.oldToken],
  ["delegatecall", (t) => t.calls[3].type = "DELEGATECALL"],
  ["additional ETH transfer", (t) => t.calls[3].calls[0].value = "0x1"],
  ["changed hook arguments", (t) => t.calls[1].input = t.calls[1].input.slice(0, -2) + "01"],
  ["wrong executor calldata", (t) => t.calls[3].input = t.calls[3].input.slice(0, -2) + "01"],
  ["different source selector", (t) => t.calls[3].calls[0].input = "0x00000000"],
  ["caught source failure", (t) => t.calls[3].calls[0].error = "execution reverted"],
  ["caught enforcer failure", (t) => t.calls[4].revertReason = "balance violation"],
  ["failed signature magic", (t) => t.calls[0].output = "0xffffffff"],
  ["wrong recovered owner", (t) => t.calls[0].calls[0].output = "0x"],
  ["wrong executor result", (t) => t.calls[3].output = "0x"],
  ["extra source log", (t) => t.calls[3].calls[0].logs.push(t.logs[0])],
  ["absent manager log", (t) => delete t.logs],
  ["wrong source log", (t) => t.calls[3].calls[0].logs[0].address = EXPECTED.oldToken],
  ["wrong log position", (t) => t.logs[0].position = "0x0"],
  ["wrong trace gas used", (t) => t.gasUsed = "0x1"],
]) test(`complete trace rejects ${name}`, async () => {
  const data = clone(); mutate(data.trace);
  await assert.rejects(runEnvelope(data));
});

test("documented empty-output and STATICCALL-value presentation differences are equivalent", async () => {
  const data = clone();
  function change(n) { if (n.output === undefined) n.output = "0x"; if (n.type === "STATICCALL") n.value = "0x0"; for (const c of n.calls ?? []) change(c); }
  change(data.trace);
  assert.deepEqual(normalizeActivationTrace(data.trace), normalizeActivationTrace(recorded.trace));
  await runEnvelope(data);
});
test("provider disagreement or unavailable trace fails closed", async () => {
  await assert.rejects(runEnvelope(clone(), (v, method, _p, index) => {
    if (index === 1 && method === "debug_traceTransaction") v.calls[3].calls[0].input = "0x00000000";
    return v;
  }));
  await assert.rejects(runEnvelope(clone(), (v, method) => { if (method === "debug_traceTransaction") throw Error("trace unavailable"); return v; }), /trace unavailable/);
});
for (const name of ["manager", "implementation", "enforcer"])
  test(`historical ${name} runtime is required before and at execution`, async () => {
    for (const tag of [numberToHex(blockNumber - 1n), numberToHex(blockNumber)])
      await assert.rejects(runEnvelope(clone(), (v, method, params) =>
        method === "eth_getCode" && params[0] === METAMASK_ACTIVATION_PROFILE[name] && params[1] === tag ? "0x00" : v), /runtime/);
  });
test("owner delegation code and exact source runtime are required at execution", async () => {
  for (const account of [EXPECTED.owner.toLowerCase(), source]) {
    const data = clone(); data.code[account] = "0x00";
    await assert.rejects(runEnvelope(data));
  }
});
for (const [name, mutate] of [
  ["extra receipt log", (r) => r.logs.push(r.logs[0])],
  ["wrong log transaction", (r) => r.logs[1].transactionHash = deploymentHash],
  ["removed wrapper log", (r) => r.logs[1].removed = true],
  ["reordered receipt logs", (r) => r.logs.reverse()],
  ["failed receipt", (r) => r.status = "0x0"],
  ["receipt type drift", (r) => r.type = "0x2"],
]) test(`fresh receipt rejects ${name}`, async () => {
  const data = clone(); mutate(data.receipt); await assert.rejects(runEnvelope(data));
});

function fullStage({ production = true, mutate = (v) => v } = {}) {
  const f = stageFixture({ activated: true });
  const reads = [];
  async function request(method, params, index) {
    reads.push({ method, params, index });
    let v;
    if (method === "debug_traceTransaction") v = recorded.trace;
    else if (method === "eth_blockNumber") v = numberToHex(blockNumber + 120n);
    else if (method === "eth_getBlockByNumber") {
      const n = params[0] === "finalized" ? blockNumber + 100n : BigInt(params[0]);
      const transactions = n === blockNumber ? Array(360).fill(deploymentHash) : n === 900n ? [deploymentHash] : [];
      if (n === blockNumber) transactions[359] = txHash;
      v = { number: numberToHex(n), hash: n === blockNumber ? recorded.transaction.blockHash : blockHash(n),
        timestamp: numberToHex(BigInt(f.nowSeconds - 60)), transactions };
    } else if (method === "eth_getTransactionByHash" && params[0] === txHash) v = recorded.transaction;
    else if (method === "eth_getTransactionReceipt" && params[0] === txHash) v = recorded.receipt;
    else if (method === "eth_getCode" && recorded.code[params[0].toLowerCase()]) v = recorded.code[params[0].toLowerCase()];
    else {
      v = await f.providers[index].request(method, params);
      if (method === "eth_getTransactionByHash") v.nonce = "0x4";
      if (method === "eth_getTransactionReceipt") v.contractAddress = source;
      if (method === "eth_call" && params[0].to.toLowerCase() === source && decodeFunctionData({ abi: SOURCE_ABI, data: params[0].data }).functionName === "activatedAtBlock")
        v = encodeFunctionResult({ abi: SOURCE_ABI, functionName: "activatedAtBlock", result: blockNumber });
    }
    return mutate(structuredClone(v), method, params, index);
  }
  const entries = ["alpha", "beta"].map(id => ({ id, trustDomain: `${id}.test`, url: `https://rpc.${id}.test`, headers: { authorization: "Bearer local-test-only" } }));
  for (const e of entries) e.endpointCommitmentSha256 = lateMigrationEndpointCommitment(e);
  const set = production ? productionProvidersFromEnvironment({
    env: { LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON: JSON.stringify(entries) },
    policy: f.preflight.activationProviderPolicy,
    fetchImpl: async (url, options) => {
      const b = JSON.parse(options.body);
      const result = await request(b.method, b.params, url.includes("alpha") ? 0 : 1);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result }));
    },
  }) : null;
  const providers = set?.providers ?? entries.map((e, index) => ({ ...e, request: (m, p) => request(m, p, index) }));
  const args = { ...f, sourceProviders: providers, productionProviderSets: set ? { source: set } : null,
    // Intentionally omit the generic production flag: the wrapped branch must
    // independently demand the unforgeable authenticated set.
    journal: appendLateMigrationStageTransaction(createLateMigrationStageJournal(deploymentHash), "depositActivation", txHash) };
  return { f, args, reads, set };
}
test("stage integration retains canonical finality/state guards and records wrapped evidence", async () => {
  const { args, reads } = fullStage();
  const context = await verifyLateMigrationStageContext({ ...args, requireProductionActivationProviders: true });
  assert.equal(context.state, "activation-finalized");
  assert.equal(context.activation.envelope.transactionHash, txHash);
  assert.equal(context.activation.envelope.matchesPreparedDirectTransaction, false);
  assert.equal(reads.filter(r => r.method === "debug_traceTransaction").length, 2);
  assert(!reads.some(r => r.method === "eth_getTransactionCount"));
  const manifest = deriveDisabledLateMigrationActivationManifest({ activation: args.activation, context });
  assert.equal(manifest.enabled, false);
  assert.equal(manifest.activatedAtBlock, blockNumber.toString());
});
for (const [name, change] of [
  ["type-4 direct", (v) => ({ ...v, type: "0x4", authorizationList: recorded.transaction.authorizationList })],
  ["type-4 without authorizations", (v) => ({ ...v, type: "0x4" })],
  ["plain type with hidden authorizations", (v) => ({ ...v, authorizationList: recorded.transaction.authorizationList })],
  ["missing transaction type", (v) => { delete v.type; return v; }],
]) test(`direct destination cannot bypass envelope checks: ${name}`, async () => {
  const f = stageFixture({ activated: true, mutate: (v, m, p) => m === "eth_getTransactionByHash" && p[0] === directActivationHash ? change(v) : v });
  await assert.rejects(verifyLateMigrationStageContext({ ...f, sourceProviders: f.providers,
    journal: appendLateMigrationStageTransaction(createLateMigrationStageJournal(deploymentHash), "depositActivation", directActivationHash) }));
});
for (const type of ["0x0", "0x1", "0x2"])
  test(`direct activation preserves ordinary transaction ${type}`, async () => {
    const f = stageFixture({ activated: true, mutate: (v, m) => m === "eth_getTransactionByHash" ? { ...v, type, authorizationList: [] } : v });
    const context = await verifyLateMigrationStageContext({ ...f, sourceProviders: f.providers,
      journal: appendLateMigrationStageTransaction(createLateMigrationStageJournal(deploymentHash), "depositActivation", directActivationHash) });
    assert.equal(context.state, "activation-finalized");
    assert.equal(context.activation.envelope, undefined);
  });
test("wrapped stage cannot use public, serialized, or swapped authenticated providers", async () => {
  await assert.rejects(verifyLateMigrationStageContext(fullStage({ production: false }).args), /authenticated production/);
  const one = fullStage();
  await assert.rejects(verifyLateMigrationStageContext({ ...one.args, sourceProviders: [...one.args.sourceProviders] }), /authenticated production/);
  await assert.rejects(verifyLateMigrationStageContext({ ...one.args, productionProviderSets: { source: { ...one.set } } }), /authenticated production/);
});
for (const [name, mutate] of [
  ["not finalized", (v, m, p) => m === "eth_getBlockByNumber" && p[0] === "finalized" ? { ...v, number: numberToHex(blockNumber - 1n), hash: blockHash(blockNumber - 1n) } : v],
  ["reorged activation", (v, m, p) => m === "eth_getBlockByNumber" && p[0] === numberToHex(blockNumber) ? { ...v, hash: blockHash(blockNumber) } : v],
  ["missing canonical position", (v, m, p) => m === "eth_getBlockByNumber" && p[0] === numberToHex(blockNumber) ? { ...v, transactions: [] } : v],
  ["authority retained", (v, m, p) => m === "eth_call" && p[0].to.toLowerCase() === source && decodeFunctionData({ abi: SOURCE_ABI, data: p[0].data }).functionName === "activationAuthority" ? encodeFunctionResult({ abi: SOURCE_ABI, functionName: "activationAuthority", result: EXPECTED.owner }) : v],
]) test(`wrapped stage still rejects ${name}`, async () => {
  await assert.rejects(verifyLateMigrationStageContext(fullStage({ mutate }).args));
});
test("readonly provider permits only the fixed bounded callTracer request", async () => {
  let calls = 0;
  const p = createReadonlyJsonRpcProvider({ id: "alpha", trustDomain: "alpha.test", url: "https://rpc.alpha.test",
    fetchImpl: async (_url, opts) => { calls++; const b = JSON.parse(opts.body); return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: recorded.trace })); } });
  await p.request("debug_traceTransaction", [txHash, ACTIVATION_TRACE_OPTIONS]);
  for (const options of [{}, { ...ACTIVATION_TRACE_OPTIONS, timeout: "60s" }, { ...ACTIVATION_TRACE_OPTIONS, tracer: "prestateTracer" }, { ...ACTIVATION_TRACE_OPTIONS, tracerConfig: { onlyTopCall: true } }])
    await assert.rejects(p.request("debug_traceTransaction", [txHash, options]), /trace options/);
  await assert.rejects(p.request("debug_traceCall", []), /forbidden/);
  await assert.rejects(p.request("eth_sendRawTransaction", []), /forbidden/);
  assert.equal(calls, 1);
});
test("direct raw reread cannot substitute a transaction after canonical verification", async () => {
  let reads = 0;
  const f = stageFixture({ activated: true, mutate: (v, m, p) => {
    if (m === "eth_getTransactionByHash" && p[0] === directActivationHash && ++reads > 2)
      return { ...v, nonce: "0xc" };
    return v;
  } });
  await assert.rejects(verifyLateMigrationStageContext({ ...f, sourceProviders: f.providers,
    journal: appendLateMigrationStageTransaction(createLateMigrationStageJournal(deploymentHash), "depositActivation", directActivationHash) }), /fresh direct\/canonical/);
});
