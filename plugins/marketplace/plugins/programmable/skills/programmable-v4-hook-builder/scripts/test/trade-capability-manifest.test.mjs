import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2 } from "../canonical-json-core.mjs";
import { hashV4PoolKey, keccak256Hex } from "../evm-encoding-core.mjs";
import { createStandardV4ModeFeeBindingV1 } from "../open-world-v2-primitives.mjs";
import { createStandardV4TradeArtifactsV1 } from "../open-world-v2-draft-core.mjs";
import { bindQuoteDiscovery, exactForgeTestPattern, grossQuoteFromLogs, renderStandardV4TradeEvidenceRunnerV1 } from "../template-catalog-materializer.mjs";
import {
  PROGRAMMABLE_TRADE_EXECUTION_ABI_DESCRIPTOR_V1,
  PROGRAMMABLE_TRADE_EXECUTION_ABI_SHA256_V1,
  PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_SHA256_V1,
  PROGRAMMABLE_TRADE_EXECUTION_V1_SCHEMA_ID,
  ZERO_ADDRESS,
  encodeProgrammableTradeExecutionAbiV1,
  inspectTradeCapabilityManifestV1,
  tradeCapabilityManifestSha256V1,
  tradeTestResultSha256V1,
  validateProgrammableTradeExecutionEnvelopeV1,
  validateTradeCapabilityManifestV1,
  validateTradeResultPairV1,
  validateTradeTestResultV1
} from "../trade-capability-manifest-core.mjs";
import {
  createStandardTradeCapabilityManifestFixtureV1,
  createTradeTestResultFixturesV1
} from "./open-world-v2-prototype-fixture.mjs";

const clone = (value) => structuredClone(value);
const sha = (value) => `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
const bytes32 = (value) => `0x${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
const address = (byte) => `0x${byte.repeat(40)}`;
const repeatedSha = (nibble) => `sha256:${nibble.repeat(64)}`;
const repeatedBytes32 = (nibble) => `0x${nibble.repeat(64)}`;
const encodedSha = (encoded) => `sha256:${crypto.createHash("sha256").update(Buffer.from(encoded.slice(2), "hex")).digest("hex")}`;
const fixture = () => createStandardTradeCapabilityManifestFixtureV1({ applicationId: "trade-app", marketRef: "primary-market" });
const codes = (findings) => new Set(findings.map(({ code }) => code));
const reseal = (result) => {
  result.contentSha256 = tradeTestResultSha256V1(result);
  return result;
};

test("Forge test matcher escapes every regular-expression metacharacter", () => {
  const signature = String.raw`test.all\\meta.^$*+?()[]{}|`;
  const matcher = new RegExp(exactForgeTestPattern(signature), "u");
  assert.equal(matcher.test(signature), true);
  assert.equal(matcher.test(`${signature}suffix`), false);
  assert.equal(matcher.test(signature.replaceAll("\\", "x")), false);
});

test("productive gross quote evidence decodes one positive hook event and rejects absent, zero, or conflicting values", () => {
  const hook = address("c"), topic = keccak256Hex(Buffer.from("QuoteFeesAccrued(bytes32,address,address,bool,uint32,uint32,uint256,uint256,uint256,uint256,uint256)"));
  const log = (grossValue) => {
    const gross = BigInt(grossValue), projectFee = gross * 29_000n / 1_000_000n, programmableFee = gross * 1_000n / 1_000_000n;
    return { address: hook, raw_log: { topics: [topic], data: `0x${[0n, 30_000n, 30_000n, gross, projectFee, programmableFee, 0n, 0n].map((word) => word.toString(16).padStart(64, "0")).join("")}` } };
  };
  assert.equal(grossQuoteFromLogs([log(1_000_000), log(1_000_000)], hook), "1000000");
  assert.throws(() => grossQuoteFromLogs([], hook), /gross amount/u);
  assert.throws(() => grossQuoteFromLogs([log(0)], hook), /gross amount/u);
  assert.throws(() => grossQuoteFromLogs([log(1), log(2)], hook), /gross amount/u);
});

test("exact-output discovery binds the final quote after one deterministic warmup", () => {
  const target = address("d"), data = `0x58733073${"00".repeat(32)}`;
  const output = (gas) => `0x${(1_000_000n).toString(16).padStart(64, "0")}${BigInt(gas).toString(16).padStart(64, "0")}`;
  const calls = [185_771, 166_771].map((gas) => ({ address: target, kind: "CALL", success: true, data, output: output(gas) }));
  const run = (values) => ({ stdout: JSON.stringify({ "test/Runner.t.sol:Runner": { test_results: { "test()": { status: "Success", kind: { Unit: { gas: 1 } }, traces: [["Execution", { arena: values.map((trace) => ({ trace })) }]] } } } }) });
  const bound = bindQuoteDiscovery(run(calls), { amountQuoted: "1000000" }, { quoter: target }, { id: "zero-for-one-exact-output", exactInput: false });
  assert.equal(bound.call.outputSha256, encodedSha(calls[1].output));
  assert.throws(() => bindQuoteDiscovery(run(calls.slice(1)), { amountQuoted: "1000000" }, { quoter: target }, { id: "zero-for-one-exact-output", exactInput: false }), /cardinality/u);
});

test("negative runner fixture names equal their declared command identifiers", () => {
  const runner = renderStandardV4TradeEvidenceRunnerV1();
  for (const id of ["expired-deadline-revert", "slippage-bound-revert", "funding-requirement-revert"]) assert.match(runner, new RegExp(`\\("${id}\\.json"\\)`));
  assert.doesNotMatch(runner, /"reject-(?:expired|slippage|funding)/u);
});

export function createCanonicalAdapterTradeCapabilityManifestFixtureV1() {
  const manifest = fixture();
  const adapter = address("a");
  const runtimeCodeKeccak256 = bytes32("adapter-runtime");
  const endpoint = {
    address: adapter,
    runtimeCodeKeccak256,
    sourceDependencyRef: "trade-integration",
    deploymentEvidenceRef: "evidence/deployments/programmable-trade-adapter.json"
  };
  manifest.source.routeImplementationPath = "src/ProgrammableTradeAdapter.sol";
  manifest.source.routeImplementationSha256 = sha("adapter-source");
  manifest.source.routeImplementationClosurePath = "evidence/trade/adapter-closure.v1.json";
  manifest.source.routeImplementationClosureSha256 = sha("adapter-closure");
  manifest.dependencies.entries.push({
    id: "adapter-interface",
    role: "adapter-interface",
    sourceUri: "https://github.com/example/programmable-trade-interface",
    resolvedIdentity: "programmable-trade-execution-v1",
    contentSha256: PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_SHA256_V1
  });
  const conformanceArtifact = { path: "test/ProgrammableTradeAdapter.t.sol", sha256: sha("adapter-test"), byteLength: 8192 };
  manifest.route = {
    type: "canonical-programmable-adapter",
    routeShape: "single-market-adapter",
    generationIdentitySha256: sha("adapter-generation"),
    canonicalInterface: {
      id: "programmable-trade-execution-v1",
      version: "1.0.0",
      schemaId: PROGRAMMABLE_TRADE_EXECUTION_V1_SCHEMA_ID,
      schemaPath: "references/programmable-trade-execution-v1.schema.json",
      schemaSha256: PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_SHA256_V1,
      abiSha256: PROGRAMMABLE_TRADE_EXECUTION_ABI_SHA256_V1,
      requestEnvelope: "programmable-trade-request-v1",
      quoteEntrypoint: {
        signature: "quote(bytes)",
        selector: "0xedfa3568",
        inputEnvelope: "programmable-trade-request-v1",
        outputEnvelope: "programmable-trade-quote-v1",
        semantics: "read-only-quote-no-state-change"
      },
      buildExecutionEntrypoint: {
        signature: "buildExecution(bytes)",
        selector: "0x21be7c85",
        inputEnvelope: "programmable-trade-request-v1",
        outputEnvelope: "programmable-trade-execution-envelope-v1",
        semantics: "returns-target-value-calldata-deadline"
      },
      conformanceArtifact
    },
    adapter: clone(endpoint),
    router: clone(endpoint),
    quoter: clone(endpoint),
    transport: null,
    fundingProfiles: [{
      id: "adapter-request",
      type: "adapter-defined",
      owner: "request-envelope",
      token: "request-envelope",
      amount: "request-envelope",
      nonce: "adapter-contract",
      expiration: "adapter-contract",
      signatureDeadline: "adapter-contract",
      recipient: "adapter",
      permit2: { mode: "not-used", reason: "The direct adapter owns its declared funding contract." }
    }],
    hookData: { ...manifest.route.hookData, consumer: "adapter" }
  };
  for (const mode of manifest.capabilities.modeMatrix) {
    mode.fundingProfileRef = "adapter-request";
    mode.quoteEntrypoint = "quote(bytes)";
    mode.executionEntrypoint = "buildExecution(bytes)->execute-returned-envelope";
  }
  for (const record of [...manifest.testEvidence.quoteTests, ...manifest.testEvidence.executionTests]) {
    record.targetAddress = adapter;
    record.testSourceArtifact = clone(conformanceArtifact);
    record.command.argv[6] = conformanceArtifact.path;
    if (record.resultContract === "trade-execution-test-result-v1") record.resultBindings.push("adapter-build-and-envelope-execution");
  }
  manifest.feeBehavior.programmableFeeV2 = {
    applicability: "not-applicable",
    executionClass: "noncanonical",
    reason: "The custom market adapter is outside the canonical Fee V2 execution scope."
  };
  manifest.feeBehavior.components = [{
    id: "adapter-fee",
    kind: "adapter",
    chargedOn: "route-defined",
    currencyRole: "route-defined",
    routeDefinedCurrency: manifest.poolKey.currency0,
    chargeBase: "route-defined",
    calculation: "adapter-defined",
    ratePips: null,
    maximumBps: 200,
    quoteInclusion: "included",
    recipientBehavior: "adapter-defined",
    policySha256: sha("adapter-fee-policy")
  }];
  return manifest;
}

export function createProgrammableTradeRequestEnvelopeFixtureV1(manifest = createCanonicalAdapterTradeCapabilityManifestFixtureV1()) {
  const mode = manifest.capabilities.modeMatrix[0];
  return {
    $schema: PROGRAMMABLE_TRADE_EXECUTION_V1_SCHEMA_ID,
    header: {
      schemaVersion: "1.0.0",
      interfaceId: "programmable-trade-execution-v1",
      interfaceVersion: "1.0.0",
      encoding: "abi-v2",
      mappingProfile: "canonical-json-to-abi-v1",
      tupleWrapping: "field-sequence-no-outer-offset"
    },
    contract: { id: "programmable-trade-request-v1", entrypointSignature: "quote(bytes)", selector: "0xedfa3568" },
    abiType: PROGRAMMABLE_TRADE_EXECUTION_ABI_DESCRIPTOR_V1.entrypoints[0].requestAbiType,
    payload: {
      manifestSha256: tradeCapabilityManifestSha256V1(manifest),
      modeId: mode.id,
      chainId: manifest.chain.chainId,
      poolKeySha256: canonicalJsonSha256V2(manifest.poolKey),
      hookDataSha256: sha("hook-data"),
      sender: address("7"),
      recipient: address("8"),
      direction: mode.direction,
      amountMode: mode.amountMode,
      amountSpecified: "1000",
      slippageBps: manifest.slippage.defaultBps,
      deadline: "2",
      fundingProfileId: mode.fundingProfileRef,
      feeBehaviorSha256: canonicalJsonSha256V2(manifest.feeBehavior)
    }
  };
}

function createProgrammableTradeAbiVectorEnvelopesV1() {
  const header = {
    schemaVersion: "1.0.0",
    interfaceId: "programmable-trade-execution-v1",
    interfaceVersion: "1.0.0",
    encoding: "abi-v2",
    mappingProfile: "canonical-json-to-abi-v1",
    tupleWrapping: "field-sequence-no-outer-offset"
  };
  const request = {
    $schema: PROGRAMMABLE_TRADE_EXECUTION_V1_SCHEMA_ID,
    header,
    contract: { id: "programmable-trade-request-v1", entrypointSignature: "quote(bytes)", selector: "0xedfa3568" },
    abiType: PROGRAMMABLE_TRADE_EXECUTION_ABI_DESCRIPTOR_V1.entrypoints[0].requestAbiType,
    payload: {
      manifestSha256: repeatedSha("1"),
      modeId: "zero-for-one-exact-input",
      chainId: "1",
      poolKeySha256: repeatedSha("2"),
      hookDataSha256: repeatedSha("3"),
      sender: address("4"),
      recipient: address("5"),
      direction: "zero-for-one",
      amountMode: "exact-input",
      amountSpecified: "1000",
      slippageBps: 50,
      deadline: "1801",
      fundingProfileId: "permit2-allowance-transfer",
      feeBehaviorSha256: repeatedSha("6")
    }
  };
  const quote = {
    $schema: PROGRAMMABLE_TRADE_EXECUTION_V1_SCHEMA_ID,
    header,
    contract: { id: "programmable-trade-quote-v1", entrypointSignature: "quote(bytes)", selector: "0xedfa3568" },
    abiType: PROGRAMMABLE_TRADE_EXECUTION_ABI_DESCRIPTOR_V1.entrypoints[0].responseAbiType,
    payload: {
      requestSha256: repeatedSha("7"),
      manifestSha256: repeatedSha("1"),
      blockNumber: "123",
      blockHash: repeatedBytes32("a"),
      amountSpecified: "1000",
      amountQuoted: "990",
      callDataSha256: repeatedSha("8"),
      feeBehaviorSha256: repeatedSha("6")
    }
  };
  const execution = {
    $schema: PROGRAMMABLE_TRADE_EXECUTION_V1_SCHEMA_ID,
    header,
    contract: { id: "programmable-trade-execution-envelope-v1", entrypointSignature: "buildExecution(bytes)", selector: "0x21be7c85" },
    abiType: PROGRAMMABLE_TRADE_EXECUTION_ABI_DESCRIPTOR_V1.entrypoints[1].responseAbiType,
    payload: {
      requestSha256: repeatedSha("7"),
      quoteSha256: repeatedSha("9"),
      target: address("a"),
      value: "0",
      calldata: "0x1234abcd",
      deadline: "1801",
      actionPlanSha256: repeatedSha("b"),
      fundingWitnessSha256: repeatedSha("c")
    }
  };
  return { request, quote, execution };
}

function makeUnhookedManifest() {
  const manifest = fixture();
  manifest.poolKey.hooks = ZERO_ADDRESS;
  manifest.poolKey.poolId = hashV4PoolKey(manifest.poolKey);
  manifest.feeBehavior.programmableFeeV2.poolId = manifest.poolKey.poolId;
  manifest.route.hookData = { mode: "none", required: false, encoding: "empty-bytes", maximumBytes: 0, example: "0x" };
  return manifest;
}

function makeNestedAdapterManifest() {
  const manifest = createCanonicalAdapterTradeCapabilityManifestFixtureV1();
  const standard = fixture();
  manifest.route.router = clone(standard.route.router);
  manifest.route.quoter = clone(standard.route.quoter);
  manifest.route.transport = {
    type: "uniswap-v4-universal-router",
    router: clone(standard.route.router),
    quoter: clone(standard.route.quoter)
  };
  manifest.route.fundingProfiles = clone(standard.route.fundingProfiles);
  for (const mode of manifest.capabilities.modeMatrix) {
    const standardMode = standard.capabilities.modeMatrix.find(({ direction, amountMode }) => direction === mode.direction && amountMode === mode.amountMode);
    mode.fundingProfileRef = standardMode.fundingProfileRef;
  }
  for (const record of manifest.testEvidence.quoteTests) record.targetAddress = manifest.route.adapter.address;
  for (const record of manifest.testEvidence.executionTests) record.targetAddress = manifest.route.router.address;
  return manifest;
}

function findPair(manifest, modeId) {
  const results = createTradeTestResultFixturesV1(manifest);
  const quoteTest = manifest.testEvidence.quoteTests.find(({ modeRef }) => modeRef === modeId);
  const executionTest = manifest.testEvidence.executionTests.find(({ modeRef, scenario }) => modeRef === modeId && scenario === "successful-swap");
  return {
    results,
    quoteTest,
    executionTest,
    quoteResult: results.get(quoteTest.resultArtifactPath),
    executionResult: results.get(executionTest.resultArtifactPath)
  };
}

function productiveConstructorInput() {
  const zero = `0x${"00".repeat(20)}`;
  const poolKey = { currency0: zero, currency1: address("1"), fee: 3000, tickSpacing: 60, hooks: address("3") };
  const state = (changed = false) => ({
    approvalBeforeSha256: sha("approval"), approvalAfterSha256: sha("approval"),
    fundingBeforeSha256: sha("funding"), fundingAfterSha256: sha("funding"),
    walletBeforeSha256: sha("wallet-before"), walletAfterSha256: sha(changed ? "wallet-after" : "wallet-before"),
    lockBeforeSha256: sha("lock"), lockAfterSha256: sha("lock"),
    applicationBeforeSha256: sha("application"), applicationAfterSha256: sha("application")
  });
  const successful = (modeId) => {
    const exactInput = modeId.endsWith("exact-input");
    const zeroForOne = modeId.startsWith("zero-for-one");
    const amountSpecified = exactInput ? "1000000" : "990000";
    const amountQuoted = exactInput ? "990000" : modeId === "one-for-zero-exact-output" ? "1003011" : "1000000";
    const amountIn = exactInput ? amountSpecified : amountQuoted;
    const amountOut = exactInput ? amountQuoted : amountSpecified;
    const input = zeroForOne ? poolKey.currency0 : poolKey.currency1;
    const output = zeroForOne ? poolKey.currency1 : poolKey.currency0;
    const guard = exactInput ? "985050" : ((BigInt(amountQuoted) * 10_050n + 9_999n) / 10_000n).toString();
    return {
      sender: address("7"), recipient: address("8"), amountSpecified, amountQuoted, slippageBps: 50, deadline: "1100",
      quote: { calldataSha256: sha(`quote-${modeId}`), returnDataSha256: sha(`return-${modeId}`), stateBeforeSha256: sha("quote-state"), stateAfterSha256: sha("quote-state") },
      execution: {
        executionKind: "foundry-call", executionDigestSha256: sha(`execution-${modeId}`), actionPlanSha256: sha(`plan-${modeId}`),
        calldataSha256: sha(`calldata-${modeId}`), fundingWitnessSha256: sha(`funding-${modeId}`), stateWitness: state(true),
        transactionHash: null, gasUsed: "100000", amountIn, amountOut, slippageGuardAmount: guard,
        walletBalances: [
          { account: address("7"), currency: input, before: amountIn, after: "0" },
          { account: address("8"), currency: output, before: "0", after: amountOut }
        ],
        refundAmount: input === zero && !exactInput ? (BigInt(guard) - BigInt(amountIn)).toString() : "0", dustAmount: "0",
        approvalChanged: false, fundsChangedBeforeExecution: false, lockStateChanged: false, applicationStateChanged: false
      }
    };
  };
  const modeIds = ["zero-for-one-exact-input", "zero-for-one-exact-output", "one-for-zero-exact-input", "one-for-zero-exact-output"];
  const modes = Object.fromEntries(modeIds.map((id) => [id, successful(id)]));
  const modeFeeEvidence = Object.fromEntries(modeIds.map((id) => {
    const evidence = modes[id], inputQuote = id.startsWith("one-for-zero");
    const amountIn = id.endsWith("exact-input") ? evidence.amountSpecified : evidence.amountQuoted;
    const gross = inputQuote ? BigInt(amountIn) : 990_990n;
    return [id, { evidenceRef: `evidence/fee/${id}.json`, evidenceSha256: sha(`fee-${id}`), grossQuoteAmount: gross.toString(), hookFeeAmount: (gross / 1_000n).toString(), selectedRateHundredthsOfBip: "1000" }];
  }));
  const negative = Object.fromEntries([
    ["expired-deadline-revert", "zero-for-one-exact-input", "999"],
    ["slippage-bound-revert", "zero-for-one-exact-output", "1100"],
    ["funding-requirement-revert", "one-for-zero-exact-input", "1100"]
  ].map(([scenario, modeRef, deadline], index) => {
    const basis = modes[modeRef];
    const input = modeRef.startsWith("zero-for-one") ? poolKey.currency0 : poolKey.currency1;
    const output = modeRef.startsWith("zero-for-one") ? poolKey.currency1 : poolKey.currency0;
    return [scenario, {
      modeRef, expectedRevertDataSha256: sha(`revert-${index}`), sender: basis.sender, recipient: basis.recipient,
      amountSpecified: basis.amountSpecified, amountQuoted: basis.amountQuoted, slippageBps: 50, deadline,
      execution: {
        executionKind: "foundry-call", executionDigestSha256: sha(`negative-${scenario}`), actionPlanSha256: sha(`negative-plan-${scenario}`),
        calldataSha256: sha(`negative-calldata-${scenario}`), fundingWitnessSha256: sha(`negative-funding-${scenario}`),
        stateWitness: state(false), transactionHash: null, gasUsed: "50000", slippageGuardAmount: "0",
        walletBalances: [
          { account: basis.sender, currency: input, before: "1000000", after: "1000000" },
          { account: basis.recipient, currency: output, before: "0", after: "0" }
        ],
        refundAmount: "0", dustAmount: "0", approvalChanged: false, fundsChangedBeforeExecution: false,
        lockStateChanged: false, applicationStateChanged: false
      }
    }];
  }));
  const dependencies = [
    ["v4-core", "v4-core", "https://github.com/Uniswap/v4-core"],
    ["v4-periphery", "v4-periphery", "https://github.com/Uniswap/v4-periphery"],
    ["universal-router", "universal-router", "https://github.com/Uniswap/universal-router"],
    ["v4-quoter", "v4-quoter", "https://github.com/Uniswap/v4-periphery"],
    ["permit2", "permit2", "https://github.com/Uniswap/permit2"],
    ["trade-integration", "trade-integration", "https://example.invalid/blind-hook"]
  ].map(([id, role, sourceUri]) => ({ id, role, sourceUri, resolvedIdentity: `${id}-pinned-test-revision`, contentSha256: sha(id) }));
  return {
    applicationId: "blind-volume-hook", marketRef: "primary-market", manifestId: "primary-market-trade-capability",
    chain: { chainId: "31337", networkRef: "anvil-local", deploymentProfileSha256: sha("deployment-profile"), referenceBlock: { number: "1", hash: bytes32("block"), timestamp: "1000" } },
    source: { repositoryUri: "https://example.invalid/blind-hook", identityKind: "content-addressed-route-implementation-closure", routeImplementationPath: "src/ProgrammableVolumeFeeHookV2.sol", routeImplementationSha256: sha("route-source"), routeImplementationClosurePath: "evidence/trade/route-closure.v1.json", routeImplementationClosureSha256: sha("route-closure") },
    dependencies: { lockfilePath: "package-lock.json", lockfileSha256: sha("lockfile"), entries: dependencies }, poolKey,
    runtimeDiscovery: {
      router: { address: address("4"), runtimeCodeKeccak256: bytes32("router-runtime"), sourceDependencyRef: "universal-router", deploymentEvidenceRef: "evidence/deployments/universal-router.json" },
      quoter: { address: address("5"), runtimeCodeKeccak256: bytes32("quoter-runtime"), sourceDependencyRef: "v4-quoter", deploymentEvidenceRef: "evidence/deployments/v4-quoter.json" },
      permit2: { address: address("6"), runtimeCodeKeccak256: bytes32("permit2-runtime"), sourceDependencyRef: "permit2", deploymentEvidenceRef: "evidence/deployments/permit2.json" }
    },
    generationIdentitySha256: sha("generation"), routeInterface: { id: "uniswap-v4-universal-router", version: "2.0.0", abiSha256: sha("router-abi") },
    hookData: { mode: "bound", contractId: "gross-quote-witness", contractVersion: "1.0.0", contractSha256: sha("hook-data-contract"), consumer: "hook", encoding: "abi-v2", solidityType: "uint256", required: true, maximumBytes: 32, example: `0x${(1_000_000n).toString(16).padStart(64, "0")}` },
    testContract: { sourceArtifact: { path: "test/TradeCapabilityEvidence.t.sol", sha256: sha("test-source"), byteLength: 8192 }, environment: "local-v4-integration", environmentSha256: sha("test-environment"), workingDirectory: "." },
    feeConformanceReceipt: { artifactId: "fee-conformance-primary-market", path: "evidence/fee-conformance-primary-market.receipt.v1.json", sha256: sha("fee-receipt"), feeScopeId: "primary-market-scope", chainId: "31337", quoteCurrency: poolKey.currency1, collectionProfile: "standard-amm", selectedRateHundredthsOfBip: 1000, maximumHookFeeBps: 20, lpFeePolicySha256: sha("lp-fee-policy"), hookFeePolicySha256: sha("hook-fee-policy") },
    policy: { defaultSlippageBps: 50, maximumSlippageBps: 500, maximumDeadlineWindowSeconds: 1800 }, evidence: { modes, negative }, modeFeeEvidence
  };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  test("standard v4 trade manifest binds PoolKey, router, quoter, Permit2, hookData, four modes, limits, fees, and real test contracts", () => {
    const manifest = fixture();
    assert.deepEqual(validateTradeCapabilityManifestV1(manifest), []);
    const inspection = inspectTradeCapabilityManifestV1(manifest, {
      applicationId: manifest.applicationId,
      marketRef: manifest.marketRef,
      routeType: "standard-uniswap-v4",
      manifestSha256: tradeCapabilityManifestSha256V1(manifest)
    });
    assert.equal(inspection.valid, true);
    assert.equal(inspection.status, "NOT_APPROVED");
    assert.deepEqual(inspection.supportedModeIds, manifest.capabilities.modeMatrix.map(({ id }) => id).sort());
    assert.deepEqual(inspection.uncoveredQuoteModeIds, []);
    assert.deepEqual(inspection.uncoveredExecutionModeIds, []);
  });

  test("productive standard-v4 constructor seals four route pairs and three negative receipts without approval", () => {
    const output = createStandardV4TradeArtifactsV1(productiveConstructorInput());
    assert.equal(output.manifest.status, "NOT_APPROVED");
    assert.equal(output.manifest.assurance, "SOURCE_TEST_CONTRACTS_ONLY_NOT_EXECUTION_PROOF");
    assert.deepEqual(validateTradeCapabilityManifestV1(output.manifest), []);
    assert.equal(output.manifest.capabilities.modeMatrix.length, 4);
    assert.equal(output.manifest.testEvidence.quoteTests.length, 4);
    assert.equal(output.manifest.testEvidence.executionTests.length, 7);
    assert.equal(Object.keys(output.resultsByPath).length, 11);
    for (const declaration of [...output.manifest.testEvidence.quoteTests, ...output.manifest.testEvidence.executionTests]) {
      assert.equal(declaration.resultArtifactPath, `.programmable/trade-test-results/${declaration.commandId}.v1.json`);
      assert.deepEqual(validateTradeTestResultV1(output.resultsByPath[declaration.resultArtifactPath], { manifest: output.manifest, test: declaration }), [], declaration.id);
    }
    const nativeExactOutput = output.manifest.testEvidence.executionTests.find(({ id }) => id === "execute-zero-for-one-exact-output");
    assert.equal(output.resultsByPath[nativeExactOutput.resultArtifactPath].observation.refundAmount, "5000");
    assert.equal(output.resultsByPath[nativeExactOutput.resultArtifactPath].observation.dustAmount, "0");
    const outputQuoteTest = output.manifest.testEvidence.quoteTests.find(({ id }) => id === "quote-zero-for-one-exact-input");
    const outputExecutionTest = output.manifest.testEvidence.executionTests.find(({ id }) => id === "execute-zero-for-one-exact-input");
    const wrongRateQuote = clone(output.resultsByPath[outputQuoteTest.resultArtifactPath]);
    const wrongRateExecution = clone(output.resultsByPath[outputExecutionTest.resultArtifactPath]);
    for (const result of [wrongRateQuote, wrongRateExecution]) {
      const hookRow = result.context.fee.amounts.components.find(({ componentRef }) => componentRef === "programmable-fee-v2-hook-charge");
      hookRow.amount = "20203"; hookRow.baseAmount = "1010203"; // self-consistent 200 bps against the observed 990000 net output
      result.context.fee.amounts.totalsByCurrency.find(({ currency }) => currency === hookRow.currency).amount = hookRow.amount;
      result.context.fee.quotedFeesSha256 = canonicalJsonSha256V2(result.context.fee.amounts);
      if (result.contract === "trade-execution-test-result-v1") result.observation.executedFeesSha256 = result.context.fee.quotedFeesSha256;
      reseal(result);
    }
    assert.ok(codes(validateTradeTestResultV1(wrongRateQuote, { manifest: output.manifest, test: outputQuoteTest })).has("TRADE_FEE_RECONCILIATION_FAILED"));
    assert.ok(codes(validateTradeResultPairV1(wrongRateQuote, wrongRateExecution, { manifest: output.manifest, quoteTest: outputQuoteTest, executionTest: outputExecutionTest })).has("TRADE_FEE_RECONCILIATION_FAILED"));
    const roundedQuoteTest = output.manifest.testEvidence.quoteTests.find(({ id }) => id === "quote-one-for-zero-exact-output");
    const roundedExecutionTest = output.manifest.testEvidence.executionTests.find(({ id }) => id === "execute-one-for-zero-exact-output");
    const roundedQuote = output.resultsByPath[roundedQuoteTest.resultArtifactPath], roundedExecution = output.resultsByPath[roundedExecutionTest.resultArtifactPath];
    assert.equal(roundedQuote.context.fee.amounts.components.find(({ componentRef }) => componentRef === "v4-lp-fee").amount, "3010");
    const overCeilQuote = clone(roundedQuote), overCeilExecution = clone(roundedExecution);
    for (const result of [overCeilQuote, overCeilExecution]) {
      const lpRow = result.context.fee.amounts.components.find(({ componentRef }) => componentRef === "v4-lp-fee"); lpRow.amount = "3011";
      result.context.fee.amounts.totalsByCurrency.find(({ currency }) => currency === lpRow.currency).amount = (BigInt(lpRow.amount) + BigInt(result.context.fee.amounts.components.find(({ componentRef }) => componentRef === "programmable-fee-v2-hook-charge").amount)).toString();
      result.context.fee.quotedFeesSha256 = canonicalJsonSha256V2(result.context.fee.amounts);
      if (result.contract === "trade-execution-test-result-v1") result.observation.executedFeesSha256 = result.context.fee.quotedFeesSha256;
      reseal(result);
    }
    assert.ok(codes(validateTradeResultPairV1(overCeilQuote, overCeilExecution, { manifest: output.manifest, quoteTest: roundedQuoteTest, executionTest: roundedExecutionTest })).has("TRADE_FEE_RECONCILIATION_FAILED"));
  });

  test("standard-v4 per-mode fee binding rejects net-as-gross, shared hookData examples, wrong fees, and broken conservation", () => {
    const valid = { inputCurrency: address("1"), quoteCurrency: address("2"), amountIn: "10000000000000000", amountOut: "9670803582088287", grossQuoteAmount: "9969900600091017", hookFeeAmount: "299097018002730", selectedRateHundredthsOfBip: "30000" };
    assert.deepEqual(createStandardV4ModeFeeBindingV1(valid), { grossQuoteAmount: "9969900600091017", hookFeeAmount: "299097018002730", selectedRateHundredthsOfBip: "30000" });
    assert.throws(() => createStandardV4ModeFeeBindingV1({ ...valid, grossQuoteAmount: valid.amountOut }), /exact isolated trace fee|conservation/);
    assert.throws(() => createStandardV4ModeFeeBindingV1({ ...valid, grossQuoteAmount: "1000000" }), /exact isolated trace fee|conservation/);
    assert.throws(() => createStandardV4ModeFeeBindingV1({ ...valid, hookFeeAmount: "299097018002731" }), /exact isolated trace fee/);
    assert.throws(() => createStandardV4ModeFeeBindingV1({ ...valid, amountOut: "9670803582088286" }), /conservation/);
    assert.throws(() => createStandardV4ModeFeeBindingV1({ ...valid, inputCurrency: address("2"), grossQuoteAmount: "9969900600091017" }), /observed amountIn/);
  });

  test("unhooked pools are valid only with explicit empty hookData", () => {
    const manifest = makeUnhookedManifest();
    assert.deepEqual(validateTradeCapabilityManifestV1(manifest), []);
    manifest.route.hookData = fixture().route.hookData;
    assert.ok(codes(validateTradeCapabilityManifestV1(manifest)).has("TRADE_HOOK_DATA_PROFILE_MISMATCH"));
  });

  test("canonical adapter manifest binds the exact schema, ABI, endpoints, funding profile, and NOT_APPROVED boundary", () => {
    const manifest = createCanonicalAdapterTradeCapabilityManifestFixtureV1();
    assert.deepEqual(validateTradeCapabilityManifestV1(manifest), []);
    const wrongAbi = clone(manifest);
    wrongAbi.route.canonicalInterface.abiSha256 = sha("wrong-abi");
    assert.ok(codes(validateTradeCapabilityManifestV1(wrongAbi)).has("TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID"));
    const wrongEndpoint = clone(manifest);
    wrongEndpoint.route.router.address = address("b");
    assert.ok(codes(validateTradeCapabilityManifestV1(wrongEndpoint)).has("ADAPTER_TRANSPORT_PROFILE_MISMATCH"));
  });

  test("canonical adapter request envelope rejects selector and uint256 mutations", () => {
    const envelope = createProgrammableTradeRequestEnvelopeFixtureV1();
    assert.deepEqual(validateProgrammableTradeExecutionEnvelopeV1(envelope), []);
    const wrongSelector = clone(envelope);
    wrongSelector.contract.selector = "0x21be7c85";
    assert.ok(codes(validateProgrammableTradeExecutionEnvelopeV1(wrongSelector)).has("PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_INVALID"));
    const overflow = clone(envelope);
    overflow.payload.amountSpecified = (2n ** 256n).toString();
    assert.ok(codes(validateProgrammableTradeExecutionEnvelopeV1(overflow)).has("TRADE_UINT256_OUT_OF_RANGE"));
  });

  test("canonical adapter ABI bytes match independent cast vectors for request, quote, and execution envelopes", () => {
    const envelopes = createProgrammableTradeAbiVectorEnvelopesV1();
    const expected = {
      request: { byteLength: 448, sha256: "sha256:3d945b0f64b7709fe602b4ca096662f5ed5d90d261b9b4069edc76c1bb5b894b" },
      quote: { byteLength: 256, sha256: "sha256:d7817def5640270520dbab6808866cb13763121d8cb9dfae05bf4a272727ba14" },
      execution: { byteLength: 320, sha256: "sha256:312a1fbbd18b84db003bcae4e3a11b09cff291a454c3d437e40327010a38bb51" }
    };
    assert.equal(keccak256Hex(Buffer.from("quote(bytes)")).slice(0, 10), "0xedfa3568");
    assert.equal(keccak256Hex(Buffer.from("buildExecution(bytes)")).slice(0, 10), "0x21be7c85");
    for (const [name, envelope] of Object.entries(envelopes)) {
      assert.deepEqual(validateProgrammableTradeExecutionEnvelopeV1(envelope), []);
      const encoded = encodeProgrammableTradeExecutionAbiV1(envelope);
      assert.equal((encoded.length - 2) / 2, expected[name].byteLength, name);
      assert.equal(encodedSha(encoded), expected[name].sha256, name);
    }
    const changedDirection = clone(envelopes.request);
    changedDirection.payload.direction = "one-for-zero";
    assert.notEqual(encodedSha(encodeProgrammableTradeExecutionAbiV1(changedDirection)), expected.request.sha256);
    const changedCalldata = clone(envelopes.execution);
    changedCalldata.payload.calldata = "0x1234abce";
    assert.notEqual(encodedSha(encodeProgrammableTradeExecutionAbiV1(changedCalldata)), expected.execution.sha256);
  });

  test("all declared standard quote and execution results bind their source test and fresh quote pair", () => {
    const manifest = fixture();
    const results = createTradeTestResultFixturesV1(manifest);
    for (const declaration of [...manifest.testEvidence.quoteTests, ...manifest.testEvidence.executionTests]) {
      assert.deepEqual(validateTradeTestResultV1(results.get(declaration.resultArtifactPath), { manifest, test: declaration }), []);
    }
    for (const mode of manifest.capabilities.modeMatrix) {
      const pair = findPair(manifest, mode.id);
      assert.deepEqual(validateTradeResultPairV1(pair.quoteResult, pair.executionResult, {
        manifest,
        quoteTest: pair.quoteTest,
        executionTest: pair.executionTest
      }), []);
    }
  });

  test("canonical adapter results build an envelope and execute its returned target, including nested Universal Router transport", () => {
    const manifest = makeNestedAdapterManifest();
    assert.deepEqual(validateTradeCapabilityManifestV1(manifest), []);
    const results = createTradeTestResultFixturesV1(manifest);
    for (const declaration of [...manifest.testEvidence.quoteTests, ...manifest.testEvidence.executionTests]) {
      assert.deepEqual(validateTradeTestResultV1(results.get(declaration.resultArtifactPath), { manifest, test: declaration }), [], declaration.id);
    }
    for (const mode of manifest.capabilities.modeMatrix) {
      const pair = findPair(manifest, mode.id);
      assert.deepEqual(validateTradeResultPairV1(pair.quoteResult, pair.executionResult, {
        manifest,
        quoteTest: pair.quoteTest,
        executionTest: pair.executionTest
      }), [], mode.id);
      assert.equal(pair.executionResult.observation.callBinding.target, manifest.route.router.address);
      assert.equal(pair.executionResult.observation.callBinding.adapterExecution.buildTarget, manifest.route.adapter.address);
      const inputCurrency = mode.direction === "zero-for-one" ? manifest.poolKey.currency0 : manifest.poolKey.currency1;
      if (inputCurrency === ZERO_ADDRESS) {
        const expectedValue = mode.amountMode === "exact-input" ? pair.executionResult.context.request.amountSpecified : pair.executionResult.observation.slippageGuardAmount;
        assert.equal(pair.executionResult.observation.callBinding.adapterExecution.returnedValue, expectedValue);
      } else {
        assert.equal(pair.executionResult.observation.callBinding.adapterExecution.returnedValue, "0");
        const funding = manifest.route.fundingProfiles.find(({ id }) => id === mode.fundingProfileRef);
        assert.equal(funding.permit2.mode, "used");
        assert.equal(funding.permit2.spender, manifest.route.router.address);
      }
    }
    const pair = findPair(manifest, manifest.capabilities.modeMatrix[0].id);
    const wrongEnvelope = clone(pair.executionResult);
    wrongEnvelope.observation.callBinding.adapterExecution.returnedEnvelopeSha256 = sha("wrong-returned-envelope");
    reseal(wrongEnvelope);
    assert.ok(codes(validateTradeTestResultV1(wrongEnvelope, { manifest, test: pair.executionTest })).has("CANONICAL_ADAPTER_EXECUTION_UNPROVEN"));

    const omittedPermit2 = clone(manifest);
    omittedPermit2.route.fundingProfiles = clone(createCanonicalAdapterTradeCapabilityManifestFixtureV1().route.fundingProfiles);
    for (const mode of omittedPermit2.capabilities.modeMatrix) mode.fundingProfileRef = "adapter-request";
    assert.ok(codes(validateTradeCapabilityManifestV1(omittedPermit2)).has("PERMIT2_FLOW_UNPROVEN"));
  });

  test("manifest mutations fail closed without converting local evidence into approval", () => {
    const mutations = [
      ["TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID", (value) => { value.status = "APPROVED"; }],
      ["TRADE_POOL_KEY_INVALID", (value) => { value.poolKey.fee += 1; }],
      ["TRADE_MODE_MATRIX_INVALID", (value) => { value.capabilities.modeMatrix[1].direction = value.capabilities.modeMatrix[0].direction; value.capabilities.modeMatrix[1].amountMode = value.capabilities.modeMatrix[0].amountMode; }],
      ["TRADE_MODE_EVIDENCE_CARDINALITY_INVALID", (value) => { value.testEvidence.quoteTests.shift(); }],
      ["TRADE_EXTERNAL_ACTION_FORBIDDEN", (value) => { value.testEvidence.quoteTests[0].command.argv.push("--broadcast"); }],
      ["PERMIT2_FLOW_UNPROVEN", (value) => { value.route.fundingProfiles[1].permit2.spender = address("f"); }],
      ["TRADE_FEE_BEHAVIOR_UNRESOLVED", (value) => { value.feeBehavior.programmableFeeV2 = { applicability: "unresolved", reason: "Fee scope needs the project owner's resolution." }; }],
      ["TRADE_TEST_EXPECTED_OUTCOME_MISMATCH", (value) => { value.testEvidence.executionTests.find(({ scenario }) => scenario === "successful-swap").expectedOutcome = "reverts-before-effects"; }],
      ["TRADE_NEGATIVE_TEST_REQUIRED", (value) => { value.testEvidence.executionTests = value.testEvidence.executionTests.filter(({ scenario }) => scenario !== "expired-deadline-revert"); }]
    ];
    for (const [code, mutate] of mutations) {
      const manifest = fixture();
      mutate(manifest);
      assert.ok(codes(validateTradeCapabilityManifestV1(manifest)).has(code), code);
    }
  });

  test("trade evidence rejects the exact arbitrary Node JSON-printer attack and Forge source drift", () => {
    const printer = fixture();
    printer.testEvidence.quoteTests[0].command.argv = ["node", "-e", "console.log(JSON.stringify({fabricated:true}))"];
    assert.ok(codes(validateTradeCapabilityManifestV1(printer)).has("TRADE_EVM_TEST_RUNNER_REQUIRED"));

    const sourceMismatch = fixture();
    sourceMismatch.testEvidence.quoteTests[0].command.argv[6] = "test/FabricatedTradeRoute.t.sol";
    assert.ok(codes(validateTradeCapabilityManifestV1(sourceMismatch)).has("TRADE_TEST_SOURCE_RUNNER_BINDING_INVALID"));

    const signatureMismatch = fixture();
    signatureMismatch.testEvidence.quoteTests[0].command.argv[8] = "^test_fabricated\\(\\)$";
    assert.ok(codes(validateTradeCapabilityManifestV1(signatureMismatch)).has("TRADE_TEST_SIGNATURE_RUNNER_BINDING_INVALID"));
    assert.equal(fixture().testEvidence.semanticAdequacy, "PARTIAL_EVIDENCE");
  });

  test("route endpoints, canonical entrypoints, funding tuples, slippage, and adapter conformance fail closed", () => {
    const mutations = [
      ["TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID", (value) => { value.route.router.address = ZERO_ADDRESS; }],
      ["TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID", (value) => { value.route.quoter.address = ZERO_ADDRESS; }],
      ["TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID", (value) => { value.route.fundingProfiles[1].permit2.address = ZERO_ADDRESS; }],
      ["TRADE_EXECUTION_PATH_MISMATCH", (value) => { value.capabilities.modeMatrix[0].quoteEntrypoint = "NotAQuoter.fake"; }],
      ["NATIVE_FUNDING_RECONCILIATION_FAILED", (value) => { value.route.fundingProfiles[0].owner = "request-envelope"; }],
      ["PERMIT2_FLOW_UNPROVEN", (value) => { value.route.fundingProfiles[1] = { id: "erc20-input", type: "adapter-defined", owner: "request-envelope", token: "request-envelope", amount: "request-envelope", nonce: "adapter-contract", expiration: "adapter-contract", signatureDeadline: "adapter-contract", recipient: "adapter", permit2: { mode: "not-used", reason: "Invalid standard-route escape hatch." } }; }],
      ["PERMIT2_FLOW_UNPROVEN", (value) => { value.route.fundingProfiles[1].recipient = "not-applicable"; }],
      ["TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID", (value) => { value.slippage.defaultBps = 10_000; value.slippage.maximumBps = 10_000; }]
    ];
    for (const [code, mutate] of mutations) {
      const manifest = fixture();
      mutate(manifest);
      assert.ok(codes(validateTradeCapabilityManifestV1(manifest)).has(code), code);
    }
    const adapter = createCanonicalAdapterTradeCapabilityManifestFixtureV1();
    adapter.testEvidence.quoteTests[0].testSourceArtifact.path = "test/UnrelatedAdapter.t.sol";
    assert.ok(codes(validateTradeCapabilityManifestV1(adapter)).has("CANONICAL_ADAPTER_BINDING_MISSING"));
    const adapterDependencyDrift = createCanonicalAdapterTradeCapabilityManifestFixtureV1();
    adapterDependencyDrift.dependencies.entries.find(({ role }) => role === "adapter-interface").contentSha256 = sha("wrong-adapter-interface");
    assert.ok(codes(validateTradeCapabilityManifestV1(adapterDependencyDrift)).has("CANONICAL_ADAPTER_BINDING_MISSING"));
    const emptyExecution = createProgrammableTradeAbiVectorEnvelopesV1().execution;
    emptyExecution.payload.target = ZERO_ADDRESS;
    emptyExecution.payload.calldata = "0x";
    assert.ok(codes(validateProgrammableTradeExecutionEnvelopeV1(emptyExecution)).has("PROGRAMMABLE_TRADE_EXECUTION_SCHEMA_INVALID"));
  });

  test("safety-boundary tests cannot be satisfied by a generic unsupported-mode rejection", () => {
    const manifest = fixture();
    const unsupported = manifest.capabilities.modeMatrix[1];
    unsupported.support = "unsupported";
    delete unsupported.quoteEntrypoint;
    delete unsupported.executionEntrypoint;
    unsupported.reason = "This exact-output direction is deliberately unavailable.";
    manifest.testEvidence.quoteTests = manifest.testEvidence.quoteTests.filter(({ modeRef }) => modeRef !== unsupported.id);
    manifest.testEvidence.executionTests = manifest.testEvidence.executionTests.filter(({ modeRef, scenario }) => modeRef !== unsupported.id || scenario !== "successful-swap");
    const deadline = manifest.testEvidence.executionTests.find(({ scenario }) => scenario === "expired-deadline-revert");
    deadline.modeRef = unsupported.id;
    assert.ok(codes(validateTradeCapabilityManifestV1(manifest)).has("TRADE_TEST_SCENARIO_MODE_MISMATCH"));
  });

  test("typed result mutations detect PoolKey, hookData, chain, funding, fee, settlement, slippage, and vacuous success drift", () => {
    const manifest = fixture();
    const pair = findPair(manifest, "zero-for-one-exact-input");
    const mutations = [
      ["TRADE_DOMAIN_RECEIPT_DIGEST_MISMATCH", (value) => { value.context.request.amountSpecified = "1001"; }, false],
      ["TRADE_POOL_KEY_PARITY_MISMATCH", (value) => { value.context.poolKeySha256 = sha("wrong-pool"); }, true],
      ["TRADE_HOOK_DATA_PARITY_MISMATCH", (value) => { value.context.hookData.valueSha256 = sha("wrong-hook-data"); }, true],
      ["TRADE_CHAIN_CONTEXT_MISMATCH", (value) => { value.context.chain.blockNumber = "2"; }, true],
      ["ADAPTER_FUNDING_PROFILE_MISMATCH", (value) => { value.context.request.fundingProfileRef = "erc20-input"; }, true],
      ["TRADE_FEE_RECONCILIATION_FAILED", (value) => { value.context.fee.feeConformanceReceiptSha256 = sha("wrong-fee"); }, true],
      ["TRADE_POOL_MANAGER_DELTAS_UNSETTLED", (value) => { value.observation.finalPoolManagerDeltas[0].delta = "1"; }, true],
      ["TRADE_EXECUTION_DUST_UNRECONCILED", (value) => { value.observation.dustAmount = "1"; }, true],
      ["TRADE_WALLET_RECONCILIATION_FAILED", (value) => { value.observation.amountIn = "0"; value.observation.amountOut = "0"; value.observation.walletBalances.forEach((entry) => { entry.after = entry.before; }); }, true],
      ["TRADE_DEADLINE_POLICY_UNPROVEN", (value) => { value.context.limits.deadline = (2n ** 256n - 1n).toString(); value.observation.callBinding.deadline = value.context.limits.deadline; }, true],
      ["TRADE_CALLDATA_BINDING_MISMATCH", (value) => { value.observation.calldataSha256 = sha("wrong-calldata"); value.observation.callBinding.calldataSha256 = value.observation.calldataSha256; }, true],
      ["TRADE_WALLET_RECONCILIATION_FAILED", (value) => { value.observation.walletBalances = [{ account: address("9"), currency: value.context.poolKey.currency0, before: "1", after: "0" }, { account: address("a"), currency: value.context.poolKey.currency1, before: "0", after: "1" }]; }, true],
      ["TRADE_STATE_WITNESS_INVALID", (value) => { value.observation.stateWitness.walletAfterSha256 = value.observation.stateWitness.walletBeforeSha256; }, true],
      ["TRADE_UINT256_OUT_OF_RANGE", (value) => { value.observation.gasUsed = "9".repeat(78); }, true]
    ];
    for (const [code, mutate, seal] of mutations) {
      const result = clone(pair.executionResult);
      mutate(result);
      if (seal) reseal(result);
      assert.ok(codes(validateTradeTestResultV1(result, { manifest, test: pair.executionTest })).has(code), code);
    }
    const staleGuard = clone(pair.executionResult);
    staleGuard.observation.slippageGuardAmount = "991";
    staleGuard.observation.callBinding.slippageGuardAmount = "991";
    reseal(staleGuard);
    assert.ok(codes(validateTradeResultPairV1(pair.quoteResult, staleGuard, {
      manifest,
      quoteTest: pair.quoteTest,
      executionTest: pair.executionTest
    })).has("EXACT_INPUT_SLIPPAGE_UNPROVEN"));
    const exactOutput = findPair(manifest, "one-for-zero-exact-output");
    const tightMaximum = clone(exactOutput.executionResult);
    tightMaximum.observation.slippageGuardAmount = (BigInt(tightMaximum.observation.amountIn) - 1n).toString();
    tightMaximum.observation.callBinding.slippageGuardAmount = tightMaximum.observation.slippageGuardAmount;
    reseal(tightMaximum);
    assert.ok(codes(validateTradeResultPairV1(exactOutput.quoteResult, tightMaximum, {
      manifest,
      quoteTest: exactOutput.quoteTest,
      executionTest: exactOutput.executionTest
    })).has("EXACT_OUTPUT_SLIPPAGE_UNPROVEN"));
  });

  test("pre-effects rejection evidence cannot hide approval, funds, balances, deltas, refunds, or dust", () => {
    const manifest = fixture();
    const declaration = manifest.testEvidence.executionTests.find(({ scenario }) => scenario === "expired-deadline-revert");
    const result = clone(createTradeTestResultFixturesV1(manifest).get(declaration.resultArtifactPath));
    result.observation.approvalChanged = true;
    result.observation.refundAmount = "1";
    result.observation.walletBalances[0].after = "999";
    reseal(result);
    assert.ok(codes(validateTradeTestResultV1(result, { manifest, test: declaration })).has("UNSUPPORTED_TRADE_MODE_EFFECTFUL"));
  });

  test("fee rows, quote neutrality, negative reason, state, and subject evidence reject self-consistent drift", () => {
    const manifest = fixture();
    const pair = findPair(manifest, "zero-for-one-exact-input");
    const duplicateFee = clone(pair.executionResult);
    duplicateFee.context.fee.amounts.components.push(clone(duplicateFee.context.fee.amounts.components[0]));
    duplicateFee.context.fee.amounts.totalsByCurrency[0].amount = "7";
    duplicateFee.context.fee.quotedFeesSha256 = canonicalJsonSha256V2(duplicateFee.context.fee.amounts);
    duplicateFee.observation.executedFeesSha256 = duplicateFee.context.fee.quotedFeesSha256;
    reseal(duplicateFee);
    assert.ok(codes(validateTradeTestResultV1(duplicateFee, { manifest, test: pair.executionTest })).has("TRADE_FEE_RECONCILIATION_FAILED"));

    const changedQuoteState = clone(pair.quoteResult);
    changedQuoteState.observation.stateAfterSha256 = sha("changed-quote-state");
    reseal(changedQuoteState);
    assert.ok(codes(validateTradeTestResultV1(changedQuoteState, { manifest, test: pair.quoteTest })).has("TRADE_QUOTE_STATE_NEUTRALITY_UNPROVEN"));

    const negativeTest = manifest.testEvidence.executionTests.find(({ scenario }) => scenario === "expired-deadline-revert");
    const negative = createTradeTestResultFixturesV1(manifest).get(negativeTest.resultArtifactPath);
    const wrongScenario = clone(negative);
    wrongScenario.scenario = "slippage-bound-revert";
    wrongScenario.context.limits.deadline = "2";
    wrongScenario.observation.callBinding.deadline = "2";
    reseal(wrongScenario);
    assert.ok(codes(validateTradeTestResultV1(wrongScenario, { manifest, test: negativeTest })).has("TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"));
    const missingReason = clone(negative);
    missingReason.observation.revertDataSha256 = null;
    reseal(missingReason);
    assert.ok(codes(validateTradeTestResultV1(missingReason, { manifest, test: negativeTest })).has("TRADE_NEGATIVE_REVERT_BINDING_INVALID"));
    const unrelatedSubjects = clone(negative);
    unrelatedSubjects.observation.walletBalances = [
      { account: address("9"), currency: unrelatedSubjects.context.poolKey.currency0, before: "1", after: "1" },
      { account: address("a"), currency: unrelatedSubjects.context.poolKey.currency1, before: "1", after: "1" }
    ];
    reseal(unrelatedSubjects);
    assert.ok(codes(validateTradeTestResultV1(unrelatedSubjects, { manifest, test: negativeTest })).has("TRADE_NEGATIVE_SUBJECT_EVIDENCE_INVALID"));
    const falseState = clone(negative);
    falseState.observation.stateWitness.approvalAfterSha256 = sha("changed-approval-state");
    reseal(falseState);
    assert.ok(codes(validateTradeTestResultV1(falseState, { manifest, test: negativeTest })).has("TRADE_STATE_WITNESS_INVALID"));

    const zeroFeeQuote = clone(pair.quoteResult);
    const zeroFeeExecution = clone(pair.executionResult);
    for (const result of [zeroFeeQuote, zeroFeeExecution]) {
      const hook = result.context.fee.amounts.components.find(({ componentRef }) => componentRef === "programmable-fee-v2-hook-charge");
      hook.amount = "0";
      result.context.fee.amounts.totalsByCurrency[0].amount = "3";
      result.context.fee.quotedFeesSha256 = canonicalJsonSha256V2(result.context.fee.amounts);
      if (result.contract === "trade-execution-test-result-v1") result.observation.executedFeesSha256 = result.context.fee.quotedFeesSha256;
      reseal(result);
    }
    assert.ok(codes(validateTradeResultPairV1(zeroFeeQuote, zeroFeeExecution, {
      manifest,
      quoteTest: pair.quoteTest,
      executionTest: pair.executionTest
    })).has("TRADE_FEE_RECONCILIATION_FAILED"));

    const dustQuote = clone(pair.quoteResult);
    const dustExecution = clone(pair.executionResult);
    for (const result of [dustQuote, dustExecution]) {
      result.context.request.amountSpecified = "500";
      result.observation.callBinding.amountSpecified = "500";
      for (const component of result.context.fee.amounts.components) {
        component.baseAmount = "500";
        component.amount = component.componentRef === "v4-lp-fee" ? "2" : "1";
      }
      result.context.fee.amounts.totalsByCurrency[0].amount = "3";
      result.context.fee.quotedFeesSha256 = canonicalJsonSha256V2(result.context.fee.amounts);
    }
    dustQuote.observation.amountQuoted = "495";
    dustExecution.observation.amountIn = "500";
    dustExecution.observation.amountOut = "495";
    dustExecution.observation.slippageGuardAmount = "492";
    dustExecution.observation.callBinding.slippageGuardAmount = "492";
    dustExecution.observation.executedFeesSha256 = dustExecution.context.fee.quotedFeesSha256;
    dustExecution.observation.walletBalances[0].before = "500";
    dustExecution.observation.walletBalances[1].after = "495";
    reseal(dustQuote);
    reseal(dustExecution);
    assert.ok(codes(validateTradeResultPairV1(dustQuote, dustExecution, {
      manifest,
      quoteTest: pair.quoteTest,
      executionTest: pair.executionTest
    })).has("TRADE_FEE_RECONCILIATION_FAILED"));
  });
}
