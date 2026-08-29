import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  toEventSelector,
  type Address,
  type Abi,
  type AbiEvent,
  type Hex,
  type PublicClient,
} from "viem";

import * as sdk from "../src/index.js";
import {
  CORE_V1_FOUNDATION_EVENT_ABI,
  BINDING_LOCAL_MAX_DOMAINS_PER_TARGET,
  BINDING_LOCAL_MAX_RECEIPT_TARGETS,
  decodeCoreV1FoundationEvent,
  projectBindingLocalReceipt,
  reviewUnsignedTransaction,
  simulateUnsignedTransaction,
  unsignedTransactionFingerprint,
  type BindingLocalReceiptTarget,
  type Bytes32,
  type SimulationObservation,
  type UnsignedTransactionRequest,
} from "../src/index.js";
import { BINDING_VECTORS, readJson } from "./helpers.js";

const bytes32 = (byte: string): Bytes32 => `0x${byte.repeat(64 / byte.length)}` as Bytes32;
const indexedBytes32 = (value: number): Bytes32 =>
  `0x${BigInt(value).toString(16).padStart(64, "0")}` as Bytes32;

function changingGetProxy<T extends object>(target: T) {
  const descriptorReads = new Map<PropertyKey, number>();
  let getReads = 0;
  const proxy = new Proxy(target, {
    get() {
      getReads += 1;
      throw new Error("caller property get trap must not run");
    },
    getOwnPropertyDescriptor(current, key) {
      descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
  });
  return { proxy, descriptorReads, getReads: () => getReads };
}

function assertCapturedOnce(
  trace: ReturnType<typeof changingGetProxy>,
  keys: readonly PropertyKey[],
): void {
  assert.equal(trace.getReads(), 0);
  for (const key of keys) assert.equal(trace.descriptorReads.get(key), 1, String(key));
}

function request(overrides: Partial<UnsignedTransactionRequest> = {}): UnsignedTransactionRequest {
  return {
    chainId: 46630,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    data: "0x12345678",
    value: 9n,
    nonce: 10n,
    gasLimit: 100_000n,
    maxFeePerGas: 3_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    ...overrides,
  };
}

function simulation(transaction: UnsignedTransactionRequest): SimulationObservation {
  return {
    schema: "programmable.dex-evm.simulation-observation.v1",
    source: "simulateUnsignedTransaction",
    requestFingerprint: unsignedTransactionFingerprint(transaction),
    chainId: transaction.chainId,
    blockNumber: 100n,
    blockHash: bytes32("aa"),
    accountNonce: transaction.nonce ?? 0n,
    accountBalance: 1_000_000_000_000_000_000n,
    baseFeePerGas: 1_000_000_000n,
    success: true,
    returnData: "0x",
    estimatedGas: 80_000n,
  };
}

async function authenticSimulation(transaction: UnsignedTransactionRequest): Promise<SimulationObservation> {
  const client = {
    getChainId: async () => transaction.chainId,
    getBlock: async () => ({
      number: 100n,
      hash: bytes32("aa"),
      baseFeePerGas: 1_000_000_000n,
    }),
    getTransactionCount: async () => Number(transaction.nonce ?? 0n),
    getBalance: async () => 1_000_000_000_000_000_000n,
    call: async () => ({ data: "0x" as Hex }),
    estimateGas: async () => 80_000n,
  } as unknown as PublicClient;
  return simulateUnsignedTransaction(client, transaction);
}

function normalizedEvent(item: AbiEvent) {
  return {
    selector: toEventSelector(item),
    anonymous: item.anonymous ?? false,
    inputs: item.inputs.map((input) => ({
      name: input.name,
      type: input.type,
      indexed: input.indexed ?? false,
    })),
  };
}

test("transaction review binds a module-produced simulation to the exact unsigned request", async () => {
  const original = request();
  const observation = await authenticSimulation(original);
  const accepted = reviewUnsignedTransaction(original, observation);
  assert.equal(accepted.localSimulationChecksPassed, true);
  assert.equal(accepted.ownerGateSatisfied, false);
  assert.equal(accepted.simulationObservationProvenance, "module-produced-live-observation");
  assert.deepEqual(accepted.findings, []);
  assert.equal(accepted.signingPerformed, false);
  assert.equal(accepted.broadcastingPerformed, false);
  assert.equal(accepted.ownerMustRevalidateBlockHashAndCurrentness, true);

  const different = request({ value: original.value + 1n });
  const rejected = reviewUnsignedTransaction(different, observation);
  assert.equal(rejected.localSimulationChecksPassed, false);
  assert.equal(rejected.ownerGateSatisfied, false);
  assert.ok(rejected.findings.includes("simulation-request-mismatch"));
});

test("caller-constructed simulation observations never satisfy local or owner gates", () => {
  const transaction = request();
  const review = reviewUnsignedTransaction(transaction, simulation(transaction));
  assert.equal(review.localSimulationChecksPassed, false);
  assert.equal(review.ownerGateSatisfied, false);
  assert.equal(review.simulationObservationProvenance, "unauthenticated-caller-input");
  assert.ok(review.findings.includes("simulation-observation-provenance-unauthenticated"));
});

test("simulation forwards the complete envelope and binds a canonical block hash", async () => {
  const calls: unknown[] = [];
  const estimates: unknown[] = [];
  const blocks: unknown[] = [];
  const anchor = bytes32("aa");
  const client = {
    getChainId: async () => 46630,
    getBlock: async (parameters: unknown) => {
      blocks.push(parameters);
      return { number: 100n, hash: anchor, baseFeePerGas: 1_000_000_000n };
    },
    getTransactionCount: async () => 10,
    getBalance: async () => 1_000_000_000_000_000_000n,
    call: async (parameters: unknown) => {
      calls.push(parameters);
      return { data: "0x" as Hex };
    },
    estimateGas: async (parameters: unknown) => {
      estimates.push(parameters);
      return 80_000n;
    },
  } as unknown as PublicClient;

  const transaction = request();
  const observation = await simulateUnsignedTransaction(client, transaction);
  assert.deepEqual(calls, [
    {
      account: transaction.from,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      nonce: 10,
      gas: transaction.gasLimit,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      blockHash: anchor,
      requireCanonical: true,
    },
  ]);
  assert.deepEqual(estimates, [
    {
      account: transaction.from,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      nonce: 10,
      gas: transaction.gasLimit,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      blockNumber: 100n,
    },
  ]);
  assert.equal(blocks.length, 4);
  assert.equal(observation.blockHash, anchor);
  assert.equal(observation.accountNonce, 10n);
});

test("simulation rejects a changed canonical block hash", async () => {
  let blockRead = 0;
  const client = {
    getChainId: async () => 46630,
    getBlock: async () => {
      blockRead += 1;
      return {
        number: 100n,
        hash: blockRead === 1 ? bytes32("aa") : bytes32("bb"),
        baseFeePerGas: 1_000_000_000n,
      };
    },
    getTransactionCount: async () => 10,
    getBalance: async () => 1_000_000_000_000_000_000n,
    call: async () => ({ data: "0x" as Hex }),
    estimateGas: async () => 80_000n,
  } as unknown as PublicClient;
  await assert.rejects(
    () => simulateUnsignedTransaction(client, request()),
    (error: unknown) => error instanceof Error && error.message.includes("block hash changed"),
  );
});

test("transaction review rejects malformed or incoherent observations", () => {
  const transaction = request();
  const malformed: SimulationObservation = {
    ...simulation(transaction),
    blockNumber: -1n,
    blockHash: "0x1" as Hex,
    estimatedGas: -1n,
    errorName: "ImpossibleSuccessError",
  };
  const review = reviewUnsignedTransaction(transaction, malformed);
  assert.equal(review.localSimulationChecksPassed, false);
  assert.ok(review.findings.includes("simulation-block-number-invalid"));
  assert.ok(review.findings.includes("simulation-block-hash-invalid"));
  assert.ok(review.findings.includes("simulation-estimated-gas-invalid"));
  assert.ok(review.findings.includes("simulation-result-incoherent"));

  const runtimeMalformed = {
    ...simulation(transaction),
    accountBalance: undefined,
    success: "true",
    unexpectedAuthorityClaim: true,
  } as unknown as SimulationObservation;
  const runtimeReview = reviewUnsignedTransaction(transaction, runtimeMalformed);
  assert.equal(runtimeReview.localSimulationChecksPassed, false);
  assert.ok(runtimeReview.findings.includes("simulation-account-balance-invalid"));
  assert.ok(runtimeReview.findings.includes("simulation-success-invalid"));
  assert.ok(runtimeReview.findings.includes("simulation-observation-field-invalid"));
});

test("transaction review observations and findings are defensively frozen", async () => {
  const transaction = request();
  const observation = await authenticSimulation(transaction);
  const review = reviewUnsignedTransaction(transaction, observation);
  (transaction as unknown as { value: bigint }).value = 999n;
  assert.throws(() => {
    (observation as unknown as { blockHash: Hex }).blockHash = bytes32("ff");
  }, TypeError);
  assert.equal(review.request.value, 9n);
  assert.equal(review.simulation.blockHash, bytes32("aa"));
  assert.equal(Object.isFrozen(review), true);
  assert.equal(Object.isFrozen(review.request), true);
  assert.equal(Object.isFrozen(review.simulation), true);
  assert.equal(Object.isFrozen(review.findings), true);
  assert.throws(() => {
    (review.findings as string[]).push("forged-ready-state");
  }, TypeError);
});

test("unsigned fingerprint distinguishes every optional field's absence from explicit zero", () => {
  for (const field of ["nonce", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"] as const) {
    const omitted = { ...request() };
    delete omitted[field];
    const explicitZero = { ...omitted, [field]: 0n };
    assert.notEqual(unsignedTransactionFingerprint(omitted), unsignedTransactionFingerprint(explicitZero), field);
  }
  assert.throws(
    () => unsignedTransactionFingerprint(request({ data: "0x0" as Hex })),
    /data must be strict hexadecimal bytes/,
  );
});

test("transaction helpers capture request and observation descriptors once without property gets", () => {
  const transaction = request();
  const requestTrace = changingGetProxy(transaction);
  assert.equal(
    unsignedTransactionFingerprint(requestTrace.proxy),
    unsignedTransactionFingerprint(transaction),
  );
  assertCapturedOnce(requestTrace, Reflect.ownKeys(transaction));

  const observation = simulation(transaction);
  const reviewRequestTrace = changingGetProxy(request());
  const observationTrace = changingGetProxy(observation);
  const review = reviewUnsignedTransaction(reviewRequestTrace.proxy, observationTrace.proxy);
  assert.equal(review.simulation.requestFingerprint, observation.requestFingerprint);
  assertCapturedOnce(reviewRequestTrace, Reflect.ownKeys(transaction));
  assertCapturedOnce(observationTrace, Reflect.ownKeys(observation));
});

test("transaction helpers reject request and observation accessors without invoking them", () => {
  let reads = 0;
  const transaction = request();
  Object.defineProperty(transaction, "nonce", {
    enumerable: true,
    get: () => {
      reads += 1;
      return 10n;
    },
  });
  assert.throws(() => unsignedTransactionFingerprint(transaction), /own data property/);
  assert.equal(reads, 0);

  const observation = simulation(request());
  Object.defineProperty(observation, "estimatedGas", {
    enumerable: true,
    get: () => {
      reads += 1;
      return 80_000n;
    },
  });
  assert.throws(() => reviewUnsignedTransaction(request(), observation), /own data property/);
  assert.equal(reads, 0);
});

test("transaction review leaves unresolved owner-controlled fields visible", async () => {
  const unresolved: UnsignedTransactionRequest = {
    chainId: 46630,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    data: "0x",
    value: 0n,
  };
  const review = reviewUnsignedTransaction(unresolved, await authenticSimulation(unresolved));
  assert.equal(review.localSimulationChecksPassed, false);
  assert.equal(review.ownerGateSatisfied, false);
  assert.deepEqual(
    review.findings,
    ["gas-limit-unresolved", "maximum-fee-unresolved", "priority-fee-unresolved", "nonce-unresolved"],
  );
});

test("binding-local receipt projection preserves Domains per ordered Target", () => {
  const targets: readonly BindingLocalReceiptTarget[] = [
    {
      targetIndex: 0,
      marketId: bytes32("01"),
      effectiveEngineRevisionId: bytes32("02"),
      domainRevisionIds: [bytes32("03"), bytes32("04")],
      actionPayloadDigest: bytes32("05"),
    },
    {
      targetIndex: 1,
      marketId: bytes32("06"),
      effectiveEngineRevisionId: bytes32("07"),
      domainRevisionIds: [bytes32("08")],
      actionPayloadDigest: bytes32("09"),
    },
  ];
  const receipt = projectBindingLocalReceipt({
    receiptId: bytes32("10"),
    coreDeploymentId: bytes32("11"),
    chainId: 46630,
    transactionHash: bytes32("12"),
    blockNumber: 13n,
    blockHash: bytes32("14"),
    targets,
  });
  assert.deepEqual(receipt.targets[0]?.domainRevisionIds, [bytes32("03"), bytes32("04")]);
  assert.deepEqual(receipt.targets[1]?.domainRevisionIds, [bytes32("08")]);
  assert.equal(receipt.portableNormalizedReceiptMapping.status, "BLOCKED_BY_SPEC");
  assert.equal(
    receipt.portableNormalizedReceiptMapping.reason,
    "portable-target-domain-mapping-not-frozen",
  );
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.targets), true);
  assert.equal(Object.isFrozen(receipt.targets[0]?.domainRevisionIds), true);
  assert.equal(Object.isFrozen(receipt.portableNormalizedReceiptMapping), true);
  assert.throws(() => {
    (receipt.targets as BindingLocalReceiptTarget[]).pop();
  }, TypeError);
});

test("receipt projection snapshots its root, nested records, and arrays exactly once", () => {
  const domains = [bytes32("03")];
  const domainsTrace = changingGetProxy(domains);
  const target = {
    targetIndex: 0,
    marketId: bytes32("01"),
    effectiveEngineRevisionId: bytes32("02"),
    domainRevisionIds: domainsTrace.proxy,
    actionPayloadDigest: bytes32("04"),
  };
  const targetTrace = changingGetProxy(target);
  const targets = [targetTrace.proxy];
  const targetsTrace = changingGetProxy(targets);
  const input = {
    receiptId: bytes32("10"),
    coreDeploymentId: bytes32("11"),
    chainId: 46630,
    transactionHash: bytes32("12"),
    blockNumber: 13n,
    blockHash: bytes32("14"),
    targets: targetsTrace.proxy,
  };
  const inputTrace = changingGetProxy(input);
  assert.equal(projectBindingLocalReceipt(inputTrace.proxy).targets.length, 1);
  assertCapturedOnce(inputTrace, Reflect.ownKeys(input));
  assertCapturedOnce(targetsTrace, Reflect.ownKeys(targets));
  assertCapturedOnce(targetTrace, Reflect.ownKeys(target));
  assertCapturedOnce(domainsTrace, Reflect.ownKeys(domains));
});

test("receipt projection rejects nested accessors without invoking them", () => {
  let reads = 0;
  const target = {
    targetIndex: 0,
    marketId: bytes32("01"),
    effectiveEngineRevisionId: bytes32("02"),
    domainRevisionIds: [bytes32("03")],
    actionPayloadDigest: bytes32("04"),
  };
  Object.defineProperty(target, "domainRevisionIds", {
    enumerable: true,
    get: () => {
      reads += 1;
      return [bytes32("03")];
    },
  });
  assert.throws(
    () =>
      projectBindingLocalReceipt({
        receiptId: bytes32("10"),
        coreDeploymentId: bytes32("11"),
        chainId: 46630,
        transactionHash: bytes32("12"),
        blockNumber: 13n,
        blockHash: bytes32("14"),
        targets: [target as BindingLocalReceiptTarget],
      }),
    /own data property/,
  );
  assert.equal(reads, 0);
});

test("receipt projection rejects target-wide Domain aliasing and order mutation", () => {
  const target: BindingLocalReceiptTarget = {
    targetIndex: 0,
    marketId: bytes32("01"),
    effectiveEngineRevisionId: bytes32("02"),
    domainRevisionIds: [bytes32("03"), bytes32("03")],
    actionPayloadDigest: bytes32("04"),
  };
  const input = {
    receiptId: bytes32("10"),
    coreDeploymentId: bytes32("11"),
    chainId: 46630,
    transactionHash: bytes32("12"),
    blockNumber: 13n,
    blockHash: bytes32("14"),
    targets: [target],
  } as const;
  assert.throws(() => projectBindingLocalReceipt(input), /repeats a Domain Revision/);
  assert.throws(
    () =>
      projectBindingLocalReceipt({
        ...input,
        targets: [{ ...target, targetIndex: 1, domainRevisionIds: [bytes32("03")] }],
      }),
    /ordered position/,
  );
  assert.throws(
    () =>
      projectBindingLocalReceipt({
        ...input,
        receiptId: `0x${"a".repeat(63)}` as Bytes32,
        targets: [{ ...target, domainRevisionIds: [bytes32("03")] }],
      }),
    /receiptId must be exactly 32 bytes/,
  );
  assert.throws(
    () => projectBindingLocalReceipt({ ...input, blockNumber: 13 as unknown as bigint }),
    /blockNumber must be a non-negative bigint/,
  );
});

test("binding-local receipt projection rejects sparse and max-plus-one arrays", () => {
  const target = (targetIndex: number, domainRevisionIds: readonly Bytes32[]): BindingLocalReceiptTarget => ({
    targetIndex,
    marketId: bytes32("01"),
    effectiveEngineRevisionId: bytes32("02"),
    domainRevisionIds,
    actionPayloadDigest: bytes32("03"),
  });
  const project = (targets: readonly BindingLocalReceiptTarget[]) =>
    projectBindingLocalReceipt({
      receiptId: bytes32("10"),
      coreDeploymentId: bytes32("11"),
      chainId: 46630,
      transactionHash: bytes32("12"),
      blockNumber: 13n,
      blockHash: bytes32("14"),
      targets,
    });

  const sparseTargets = new Array<BindingLocalReceiptTarget>(1);
  assert.throws(() => project(sparseTargets), /sparse positions/);
  const sparseDomains = new Array<Bytes32>(1);
  assert.throws(() => project([target(0, sparseDomains)]), /sparse positions/);

  const maximumTargets = Array.from(
    { length: BINDING_LOCAL_MAX_RECEIPT_TARGETS },
    (_, index) => target(index, [indexedBytes32(index + 1)]),
  );
  assert.equal(project(maximumTargets).targets.length, BINDING_LOCAL_MAX_RECEIPT_TARGETS);
  assert.throws(
    () =>
      project([
        ...maximumTargets,
        target(BINDING_LOCAL_MAX_RECEIPT_TARGETS, [bytes32("ff")]),
      ]),
    /must contain 1..256 Targets/,
  );

  const maximumDomains = Array.from(
    { length: BINDING_LOCAL_MAX_DOMAINS_PER_TARGET },
    (_, index) => indexedBytes32(index + 1),
  );
  assert.equal(project([target(0, maximumDomains)]).targets[0]?.domainRevisionIds.length, 256);
  assert.throws(
    () => project([target(0, [...maximumDomains, indexedBytes32(257)])]),
    /must contain 1..256 Domain Revisions/,
  );
});

test("foundation event decoder uses only the exact source-frozen event ABI", () => {
  const vaultId = bytes32("01");
  const domainRevisionId = bytes32("02");
  const assetProfileId = bytes32("03");
  const nativeAsset = "0x1111111111111111111111111111111111111111" as Address;
  const vault = "0x2222222222222222222222222222222222222222" as Address;
  const topics = encodeEventTopics({
    abi: CORE_V1_FOUNDATION_EVENT_ABI,
    eventName: "DomainVaultCreated",
    args: { vaultId, domainRevisionId, assetProfileId },
  });
  const data = encodeAbiParameters(parseAbiParameters("address nativeAsset, address vault"), [
    nativeAsset,
    vault,
  ]);
  assert.deepEqual(decodeCoreV1FoundationEvent({ topics: topics as [Hex, ...Hex[]], data }), {
    kind: "domain-vault-created",
    vaultId,
    domainRevisionId,
    assetProfileId,
    nativeAsset,
    vault,
  });

  const topicsTrace = changingGetProxy(topics as [Hex, ...Hex[]]);
  const log = { topics: topicsTrace.proxy, data };
  const logTrace = changingGetProxy(log);
  assert.equal(decodeCoreV1FoundationEvent(logTrace.proxy).kind, "domain-vault-created");
  assertCapturedOnce(logTrace, Reflect.ownKeys(log));
  assertCapturedOnce(topicsTrace, Reflect.ownKeys(topics));
});

test("foundation event fragments match the compiler-generated CoreV1 ABI", () => {
  const bundle = readJson(
    resolve(BINDING_VECTORS, "../abi/foundations.generated.json"),
  ) as {
    readonly protectedExecutionAbiFrozen: boolean;
    readonly terminalState: string;
    readonly entries: readonly { readonly sourcePath: string; readonly abi: Abi }[];
  };
  assert.equal(bundle.protectedExecutionAbiFrozen, false);
  assert.equal(bundle.terminalState, "BLOCKED_BY_SPEC");
  const core = bundle.entries.find((entry) => entry.sourcePath === "src/core/CoreV1.sol");
  assert.notEqual(core, undefined);
  const eventNames = new Set([
    "EngineRevisionRegistered",
    "MarketCreated",
    "DomainRevisionCreated",
    "DomainVaultCreated",
  ]);
  const generated = (core?.abi ?? [])
    .filter((item): item is AbiEvent => item.type === "event" && eventNames.has(item.name))
    .map(normalizedEvent)
    .sort((left, right) => left.selector.localeCompare(right.selector));
  const sdkEvents = CORE_V1_FOUNDATION_EVENT_ABI.map(normalizedEvent).sort((left, right) =>
    left.selector.localeCompare(right.selector),
  );
  assert.deepEqual(sdkEvents, generated);
});

test("public SDK surface exposes no signing, sending or broadcasting primitive", () => {
  assert.deepEqual(Object.keys(sdk).sort(), [
    "AUTHORIZATION_SCOPE_V1_DOMAIN",
    "AssessmentVectorError",
    "BINDING_LOCAL_MAX_DOMAINS_PER_TARGET",
    "BINDING_LOCAL_MAX_RECEIPT_TARGETS",
    "CANONICAL_JSON_TEST_DOMAIN",
    "CONSTITUTION_ID",
    "CORE_DEPLOYMENT_V1_TYPE",
    "CORE_DEPLOYMENT_V1_TYPEHASH",
    "CORE_V1_FOUNDATION_EVENT_ABI",
    "CanonicalEventBuffer",
    "DOMAIN_REVISION_V1_TYPE",
    "DOMAIN_REVISION_V1_TYPEHASH",
    "DOMAIN_VAULT_V1_TYPE",
    "DOMAIN_VAULT_V1_TYPEHASH",
    "EIP712_CANDIDATE_BLOCKERS",
    "EIP712_CANDIDATE_STATUS",
    "ENGINE_REVISION_V1_TYPE",
    "ENGINE_REVISION_V1_TYPEHASH",
    "ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID",
    "EVM_MAX_INITCODE_BYTES",
    "EVM_RUNTIME_ID",
    "MARKET_TEMPLATE_V1_DOMAIN",
    "MARKET_V1_TYPE",
    "MARKET_V1_TYPEHASH",
    "NATIVE_ETH_ASSET_PROFILE_ID",
    "PORTABLE_RECEIPT_MAPPING_STATUS",
    "PORTABLE_VECTOR_SET_DIGEST",
    "PROTOCOL_ASSESSMENT_DENOMINATOR",
    "PROTOCOL_COMMIT",
    "PROTOCOL_SPEC_ID",
    "PortableJsonError",
    "ProgrammableSdkError",
    "RECEIPT_TARGET_DOMAIN_MAPPING_BLOCKER_ID",
    "RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID",
    "STRICT_MEASURED_ERC20_ASSET_PROFILE_ID",
    "UINT128_MAX",
    "UINT64_MAX",
    "UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR",
    "assertAuthorizationScopeDescriptorV1",
    "assertMarketTemplateV1",
    "assertUint",
    "assertUint128",
    "assertUint64",
    "authorizationScopeIdV1",
    "buildUnfrozenAuthorizationCandidateTypedData",
    "canonicalJsonTestDigest",
    "canonicalizePortableJson",
    "canonicalizePortableValue",
    "checkedAddUint128",
    "coreDeploymentId",
    "decodeCoreV1FoundationEvent",
    "domainRevisionId",
    "domainVaultId",
    "domainVaultInitCode",
    "emptyEventIndexerCheckpoint",
    "engineRevisionId",
    "evaluateProtocolAssessmentVectorDocument",
    "eventIndexerConfigurationDigest",
    "expectedDomainVaultAddress",
    "hashUnfrozenAuthorizationCandidate",
    "invariant",
    "isCanonicalDecimal",
    "marketId",
    "marketTemplateIdV1",
    "parsePortableJson",
    "parseUint128Decimal",
    "portableSha256Identifier",
    "portableSha256IdentifierFromSource",
    "projectBindingLocalReceipt",
    "protocolAssessmentAt",
    "protocolAssessmentDelta",
    "reviewUnsignedTransaction",
    "sha256IdentifierToBytes32",
    "simulateUnsignedTransaction",
    "unsignedTransactionFingerprint",
    "verifyUnfrozenCandidateEoaAuthorization",
  ]);
});
