import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import { getContractAddress, keccak256, toHex } from "viem";

import {
  EXACT_SHARDS_RELEASE_DESCRIPTOR_SCHEMA,
  broadcastSignedExactShardsTransaction,
  canonicalSha256,
  createEmptyExactShardsReleaseCheckpoint,
  createExactShardsReleaseReadbacks,
  createJsonRpcReadProvider,
  expectedExactShardsPairDeploymentEvent,
  exactShardsRpcEndpointCommitment,
  exactShardsRegistryConstructorArgumentsHash,
  inspectExactShardsTwoTransactionRelease,
  signNextExactShardsTransaction,
  validateExactShardsReleaseDescriptor,
} from "../exact-shards-two-transaction-release-core.mjs";

function hash(label) {
  return `0x${createHash("sha256").update(label).digest("hex")}`;
}

function address(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function runtime(index) {
  return `0x60${index.toString(16).padStart(2, "0")}60005260206000f3`;
}

function blockHash(number) {
  return hash(`block:${number}`);
}

function fixtureDescriptor({ activationAllowed = true, freezeStatus = "FROZEN" } = {}) {
  const deployer = address(0xd0);
  const startingNonce = 7n;
  const registry = getContractAddress({ from: deployer, nonce: startingNonce, opcode: "CREATE" });
  const coordinator = getContractAddress({ from: deployer, nonce: startingNonce + 1n, opcode: "CREATE" });
  const factory = getContractAddress({ from: coordinator, nonce: 1n, opcode: "CREATE" });
  const route = getContractAddress({ from: coordinator, nonce: 2n, opcode: "CREATE" });
  const addresses = { registry, coordinator, factory, route };
  const registryInitCode = "0x600060005560016000f3";
  const coordinatorInitCode = "0x600160005560026000f3";
  const runtimeCode = {
    registry: runtime(1),
    coordinator: runtime(2),
    factory: runtime(3),
    route: runtime(4),
  };
  const dependencies = [
    { label: "permitAuthority", address: address(0xa1), code: runtime(11) },
    { label: "feePolicyVerifier", address: address(0xa2), code: runtime(12) },
    { label: "reviewedFactoryImplementation", address: address(0xa3), code: runtime(13) },
    { label: "permitVerifier", address: address(0xa4), code: runtime(14) },
    { label: "poolManager", address: address(0xa5), code: runtime(15) },
    { label: "defaultRenderer", address: address(0xa6), code: runtime(16) },
  ].map((dependency) => ({
    label: dependency.label,
    address: dependency.address,
    runtimeCodeHash: keccak256(dependency.code),
    runtimeByteLength: (dependency.code.length - 2) / 2,
    code: dependency.code,
  }));
  const artifacts = Object.fromEntries(
    Object.entries(runtimeCode).map(([name, code]) => [name, {
      runtimeCodeHash: keccak256(code),
      runtimeByteLength: (code.length - 2) / 2,
      sourceArtifactHash: hash(`artifact:${name}`),
      ...(name === "registry"
        ? {
            initCodeHash: keccak256(registryInitCode),
            initCodeByteLength: (registryInitCode.length - 2) / 2,
          }
        : name === "coordinator"
          ? {
              initCodeHash: keccak256(coordinatorInitCode),
              initCodeByteLength: (coordinatorInitCode.length - 2) / 2,
            }
          : {}),
    }]),
  );
  const descriptor = {
    schema: EXACT_SHARDS_RELEASE_DESCRIPTOR_SCHEMA,
    release: {
      freezeStatus,
      activationAllowed,
      authorizationState: activationAllowed ? "AUTHORIZED" : "NOT_AUTHORIZED",
      authorizationHash: activationAllowed ? hash("release-authorization") : null,
      authorizationPolicyHash: activationAllowed ? hash("release-policy") : null,
      authorizedReleaseActor: activationAllowed ? address(0xf1) : null,
      maximumTotalFeeWei: "18000000000000000",
      maximumExactHashBroadcastAttempts: 3,
    },
    source: {
      repository: "https://example.invalid/programmable/shards",
      commit: "a".repeat(40),
      treeHash: hash("tree"),
      buildInputHash: hash("build-input"),
      artifactBundleHash: hash("artifact-bundle"),
    },
    configHash: hash("temporary-config-hash"),
    registryConfig: {
      initialAdminDelay: "172800",
      initialAdmin: address(0xb1),
      initialApprover: address(0xb2),
      initialLaunchIntentApprover: address(0xb3),
      initialWriter: route,
      initialFinalizer: address(0xb4),
      initialRevoker: address(0xb5),
      registryGeneration: "3",
      minimumFinalityBlocks: "3",
      chainProfileHash: hash("ethereum-mainnet-profile"),
      registryPolicyHash: hash("registry-policy"),
    },
    chain: {
      chainId: "1",
      chainProfileHash: hash("ethereum-mainnet-profile"),
      maximumTransactionGas: "7000000",
      readProviders: [
        {
          providerId: "rpc-a",
          credentialProviderId: "vault-a",
          canonicalOrigin: "https://rpc-a.example",
          trustDomain: "provider-a.example",
          operatorIdentityHash: hash("operator-a"),
          endpointCommitment: exactShardsRpcEndpointCommitment(
            "https://rpc-a.example/v1/key?token=top-secret",
          ),
        },
        {
          providerId: "rpc-b",
          credentialProviderId: "vault-b",
          canonicalOrigin: "https://rpc-b.example",
          trustDomain: "provider-b.example",
          operatorIdentityHash: hash("operator-b"),
          endpointCommitment: exactShardsRpcEndpointCommitment(
            "https://rpc-b.example/v1/key?token=another-secret",
          ),
        },
      ],
      finality: { minimumConfirmations: 3, maximumProviderHeadLag: 2 },
    },
    deployer: { address: deployer, startingNonce: startingNonce.toString() },
    addresses,
    artifacts,
    dependencies: dependencies.map((dependency) => ({
      label: dependency.label,
      address: dependency.address,
      runtimeCodeHash: dependency.runtimeCodeHash,
      runtimeByteLength: dependency.runtimeByteLength,
    })),
    transactions: [
      {
        step: "registry",
        type: "eip1559",
        chainId: "1",
        from: deployer,
        to: null,
        nonce: startingNonce.toString(),
        value: "0",
        data: registryInitCode,
        gas: "3000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "100000000",
        expectedContractAddress: registry,
      },
      {
        step: "coordinator",
        type: "eip1559",
        chainId: "1",
        from: deployer,
        to: null,
        nonce: (startingNonce + 1n).toString(),
        value: "0",
        data: coordinatorInitCode,
        gas: "6000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "100000000",
        expectedContractAddress: coordinator,
      },
    ],
    readbacks: [],
  };
  descriptor.configHash = exactShardsRegistryConstructorArgumentsHash(descriptor);
  descriptor.readbacks = createExactShardsReleaseReadbacks(descriptor);
  return { descriptor, runtimeCode, dependencies };
}

function transactionFor(descriptor, step) {
  const index = step === "registry" ? 0 : 1;
  const transaction = descriptor.transactions[index];
  return {
    hash: hash(`transaction:${step}`),
    from: transaction.from,
    to: null,
    nonce: toHex(BigInt(transaction.nonce)),
    input: transaction.data,
    value: "0x0",
    chainId: toHex(BigInt(transaction.chainId)),
  };
}

function receiptFor(descriptor, step, blockNumber) {
  const transaction = transactionFor(descriptor, step);
  const receipt = {
    transactionHash: transaction.hash,
    status: "0x1",
    blockNumber: toHex(BigInt(blockNumber)),
    blockHash: blockHash(blockNumber),
    contractAddress: descriptor.addresses[step],
    from: descriptor.deployer.address,
    to: null,
    logs: [],
  };
  if (step === "coordinator") {
    receipt.logs.push(expectedExactShardsPairDeploymentEvent(descriptor));
  }
  return receipt;
}

function checkpointFor(descriptor, statuses) {
  const checkpoint = createEmptyExactShardsReleaseCheckpoint(descriptor);
  for (const step of ["registry", "coordinator"]) {
    const status = statuses[step];
    if (!status || status === "not-signed") continue;
    checkpoint.steps[step] = {
      status,
      transactionHash: hash(`transaction:${step}`),
      ...(status === "signed" || status === "submitted"
        ? { signedPayloadRef: `kms://${step}`, broadcastAttempts: status === "submitted" ? 1 : 0 }
        : {}),
      ...(status === "finalized"
        ? {
            blockNumber: step === "registry" ? "105" : "108",
            blockHash: blockHash(step === "registry" ? 105 : 108),
          }
        : {}),
    };
  }
  return checkpoint;
}

function fakeNetwork(fixture, options = {}) {
  const state = {
    stage: options.stage ?? 0,
    head: options.head ?? 110,
    confirmedNonce: options.confirmedNonce,
    pendingNonce: options.pendingNonce,
    transactions: options.transactions ?? {},
    receipts: options.receipts ?? {},
    reorgs: options.reorgs ?? {},
    codeOverrides: options.codeOverrides ?? {},
    readbackOverrides: options.readbackOverrides ?? {},
  };
  const expectedNonce = BigInt(fixture.descriptor.deployer.startingNonce) + BigInt(state.stage);
  if (state.confirmedNonce === undefined) state.confirmedNonce = expectedNonce;
  if (state.pendingNonce === undefined) state.pendingNonce = expectedNonce;

  function codeAt(target) {
    const normalized = target.toLowerCase();
    if (Object.hasOwn(state.codeOverrides, normalized)) return state.codeOverrides[normalized];
    for (const dependency of fixture.dependencies) {
      if (dependency.address.toLowerCase() === normalized) return dependency.code;
    }
    const deployed = state.stage === 0
      ? []
      : state.stage === 1
        ? ["registry"]
        : ["registry", "coordinator", "factory", "route"];
    for (const name of deployed) {
      if (fixture.descriptor.addresses[name].toLowerCase() === normalized) {
        return fixture.runtimeCode[name];
      }
    }
    return "0x";
  }

  function provider(identity, overrides = {}) {
    return {
      ...identity,
      async request(method, params) {
        const local = { ...state, ...overrides };
        if (method === "eth_chainId") return toHex(BigInt(fixture.descriptor.chain.chainId));
        if (method === "eth_getBlockByNumber") {
          const requested = params[0] === "latest" ? BigInt(local.head) : BigInt(params[0]);
          const key = requested.toString();
          return {
            number: toHex(requested),
            hash: local.reorgs[key] ?? blockHash(Number(requested)),
          };
        }
        if (method === "eth_getTransactionCount") {
          return toHex(params[1] === "pending" ? BigInt(local.pendingNonce) : BigInt(local.confirmedNonce));
        }
        if (method === "eth_getCode") {
          const target = params[0].toLowerCase();
          if (overrides.codeOverrides && Object.hasOwn(overrides.codeOverrides, target)) {
            return overrides.codeOverrides[target];
          }
          return codeAt(target);
        }
        if (method === "eth_getTransactionByHash") {
          return local.transactions[params[0].toLowerCase()] ?? null;
        }
        if (method === "eth_getTransactionReceipt") {
          return local.receipts[params[0].toLowerCase()] ?? null;
        }
        if (method === "eth_call") {
          const callData = params[0].data.toLowerCase();
          if (Object.hasOwn(local.readbackOverrides, callData)) {
            return local.readbackOverrides[callData];
          }
          const readback = fixture.descriptor.readbacks.find(
            (candidate) => candidate.data.toLowerCase() === callData,
          );
          if (!readback) throw new Error(`unknown readback ${callData}`);
          return readback.expectedReturn;
        }
        throw new Error(`unsupported fake RPC method ${method}`);
      },
    };
  }

  return {
    state,
    providers: fixture.descriptor.chain.readProviders.map((identity) =>
      provider(identity),
    ),
  };
}

test("binds the exact CREATE topology and produces one content-addressed tx1", async () => {
  const fixture = fixtureDescriptor();
  const validation = validateExactShardsReleaseDescriptor(fixture.descriptor);
  assert.equal(validation.descriptorDigest, canonicalSha256(fixture.descriptor));
  const network = fakeNetwork(fixture);
  const result = await inspectExactShardsTwoTransactionRelease({
    descriptor: fixture.descriptor,
    providers: network.providers,
  });
  assert.equal(result.action.type, "READY_TO_SIGN");
  assert.equal(result.action.step, "registry");
  assert.equal(result.action.transaction.nonce, "7");
  assert.equal(result.agreement.stage, 0);
});

test("the published JSON Schema accepts the same exact frozen descriptor", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../spec/exact-shards-two-transaction-release-descriptor-v1.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const descriptor = fixtureDescriptor().descriptor;
  assert.equal(validate(descriptor), true, JSON.stringify(validate.errors));
});

test("rejects selector substitution, missing role proof, role collision, and stale constructor config hash", () => {
  const selector = fixtureDescriptor();
  selector.descriptor.readbacks[0].data = "0xdeadbeef";
  assert.throws(
    () => validateExactShardsReleaseDescriptor(selector.descriptor),
    /canonical ABI-generated/,
  );

  const missingRole = fixtureDescriptor();
  missingRole.descriptor.readbacks = missingRole.descriptor.readbacks.filter(
    (readback) => readback.label !== "registry.role.revoker.revoker",
  );
  assert.throws(
    () => validateExactShardsReleaseDescriptor(missingRole.descriptor),
    /canonical ABI-generated/,
  );

  const roleCollision = fixtureDescriptor();
  roleCollision.descriptor.registryConfig.initialApprover =
    roleCollision.descriptor.registryConfig.initialAdmin;
  assert.throws(
    () => validateExactShardsReleaseDescriptor(roleCollision.descriptor),
    /pairwise distinct/,
  );

  const configMutation = fixtureDescriptor();
  configMutation.descriptor.registryConfig.initialFinalizer = address(0xbeef);
  assert.throws(
    () => validateExactShardsReleaseDescriptor(configMutation.descriptor),
    /configHash does not match/,
  );
});

test("keeps activation fail-closed until the exact descriptor is frozen and authorized", async () => {
  for (const release of [
    { activationAllowed: false, freezeStatus: "FROZEN" },
    { activationAllowed: false, freezeStatus: "DRAFT" },
  ]) {
    const fixture = fixtureDescriptor(release);
    const result = await inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      providers: fakeNetwork(fixture).providers,
    });
    assert.equal(result.action.type, "BLOCKED_ACTIVATION");
  }
  const invalid = fixtureDescriptor({ activationAllowed: false, freezeStatus: "DRAFT" });
  invalid.descriptor.release.authorizationHash = hash("invented-authorization");
  assert.throws(
    () => validateExactShardsReleaseDescriptor(invalid.descriptor),
    /explicitly NOT_AUTHORIZED/,
  );
});

test("rejects initcode size drift, EIP-3860 overflow, chain gas cap, and fee-budget overflow", () => {
  const lengthDrift = fixtureDescriptor();
  lengthDrift.descriptor.artifacts.registry.initCodeByteLength += 1;
  assert.throws(
    () => validateExactShardsReleaseDescriptor(lengthDrift.descriptor),
    /initcode byte length drifted/,
  );

  const oversized = fixtureDescriptor();
  oversized.descriptor.transactions[0].data = `0x${"00".repeat(49_153)}`;
  oversized.descriptor.artifacts.registry.initCodeHash = keccak256(
    oversized.descriptor.transactions[0].data,
  );
  oversized.descriptor.artifacts.registry.initCodeByteLength = 49_153;
  assert.throws(
    () => validateExactShardsReleaseDescriptor(oversized.descriptor),
    /49152|EIP-3860/,
  );

  const gas = fixtureDescriptor();
  gas.descriptor.transactions[1].gas = "7000001";
  assert.throws(() => validateExactShardsReleaseDescriptor(gas.descriptor), /chain cap/);

  const fee = fixtureDescriptor();
  fee.descriptor.release.maximumTotalFeeWei = "1";
  assert.throws(() => validateExactShardsReleaseDescriptor(fee.descriptor), /max-fee envelope/);
});

test("fails closed on confirmed or pending deployer nonce drift", async () => {
  const fixture = fixtureDescriptor();
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      providers: fakeNetwork(fixture, { confirmedNonce: 8n, pendingNonce: 8n }).providers,
    }),
    /NONCE_DRIFT/,
  );
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      providers: fakeNetwork(fixture, { pendingNonce: 9n }).providers,
    }),
    /NONCE_DRIFT/,
  );
});

test("rejects preoccupation and a partially deployed wrong order", async () => {
  const fixture = fixtureDescriptor();
  const occupied = fakeNetwork(fixture, {
    codeOverrides: {
      [fixture.descriptor.addresses.registry.toLowerCase()]: runtime(99),
    },
  });
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      providers: occupied.providers,
    }),
    /ADDRESS_PREOCCUPIED/,
  );

  const wrongOrder = fakeNetwork(fixture, {
    codeOverrides: {
      [fixture.descriptor.addresses.coordinator.toLowerCase()]: fixture.runtimeCode.coordinator,
    },
  });
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      providers: wrongOrder.providers,
    }),
    /WRONG_DEPLOYMENT_ORDER/,
  );
});

test("resumes a durable signed checkpoint with an idempotent rebroadcast action", async () => {
  const fixture = fixtureDescriptor();
  const checkpoint = checkpointFor(fixture.descriptor, { registry: "signed" });
  const result = await inspectExactShardsTwoTransactionRelease({
    descriptor: fixture.descriptor,
    checkpoint,
    providers: fakeNetwork(fixture).providers,
  });
  assert.equal(result.action.type, "READY_REBROADCAST");
  assert.equal(result.action.step, "registry");
  assert.deepEqual(result.checkpoint, checkpoint);
});

test("recovers a dropped submitted exact hash with bounded rebroadcast and rejects nonce replacement", async () => {
  const fixture = fixtureDescriptor();
  const submitted = checkpointFor(fixture.descriptor, { registry: "submitted" });
  const network = fakeNetwork(fixture);
  const inspection = await inspectExactShardsTwoTransactionRelease({
    descriptor: fixture.descriptor,
    checkpoint: submitted,
    providers: network.providers,
  });
  assert.equal(inspection.action.type, "READY_REBROADCAST");
  assert.equal(inspection.action.step, "registry");

  const transaction = fixture.descriptor.transactions[0];
  const transactionHash = hash("transaction:registry");
  const recovered = await broadcastSignedExactShardsTransaction({
    descriptor: fixture.descriptor,
    checkpoint: submitted,
    providers: network.providers,
    signedTransactionVerifier: {
      async verify() {
        return {
          transactionHash,
          signerAddress: transaction.from,
          chainId: transaction.chainId,
          nonce: transaction.nonce,
          to: null,
          value: transaction.value,
          data: transaction.data,
          gas: transaction.gas,
          maxFeePerGas: transaction.maxFeePerGas,
          maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        };
      },
    },
    broadcasterPort: {
      async broadcastSignedTransaction() {
        return transactionHash;
      },
    },
    checkpointStore: { async save() {} },
  });
  assert.equal(recovered.steps.registry.status, "submitted");
  assert.equal(recovered.steps.registry.broadcastAttempts, 2);

  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      checkpoint: submitted,
      providers: fakeNetwork(fixture, { confirmedNonce: 8n, pendingNonce: 8n }).providers,
    }),
    /NONCE_DRIFT|UNBOUND_DEPLOYMENT_EVIDENCE/,
  );
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      checkpoint: submitted,
      providers: fakeNetwork(fixture, { confirmedNonce: 7n, pendingNonce: 8n }).providers,
    }),
    /PENDING_REPLACEMENT_OR_UNKNOWN/,
  );

  const exhausted = structuredClone(submitted);
  exhausted.steps.registry.broadcastAttempts = 3;
  const exhaustion = await inspectExactShardsTwoTransactionRelease({
    descriptor: fixture.descriptor,
    checkpoint: exhausted,
    providers: network.providers,
  });
  assert.equal(exhaustion.action.type, "BROADCAST_RETRY_EXHAUSTED");
});

test("waits for transaction inclusion and canonical finality before tx2", async () => {
  const fixture = fixtureDescriptor();
  const registryTransaction = transactionFor(fixture.descriptor, "registry");
  const checkpoint = checkpointFor(fixture.descriptor, { registry: "submitted" });
  const pendingNetwork = fakeNetwork(fixture, {
    pendingNonce: 8n,
    transactions: { [registryTransaction.hash]: registryTransaction },
  });
  const pending = await inspectExactShardsTwoTransactionRelease({
    descriptor: fixture.descriptor,
    checkpoint,
    providers: pendingNetwork.providers,
  });
  assert.equal(pending.action.type, "AWAITING_TRANSACTION");

  const receipt = receiptFor(fixture.descriptor, "registry", 105);
  const shallowNetwork = fakeNetwork(fixture, {
    stage: 1,
    head: 106,
    transactions: { [registryTransaction.hash]: registryTransaction },
    receipts: { [registryTransaction.hash]: receipt },
  });
  const shallow = await inspectExactShardsTwoTransactionRelease({
    descriptor: fixture.descriptor,
    checkpoint,
    providers: shallowNetwork.providers,
  });
  assert.equal(shallow.action.type, "AWAITING_FINALITY");
  assert.equal(shallow.action.confirmations, "2");

  const finalNetwork = fakeNetwork(fixture, {
    stage: 1,
    head: 107,
    transactions: { [registryTransaction.hash]: registryTransaction },
    receipts: { [registryTransaction.hash]: receipt },
  });
  const finalized = await inspectExactShardsTwoTransactionRelease({
    descriptor: fixture.descriptor,
    checkpoint,
    providers: finalNetwork.providers,
  });
  assert.equal(finalized.action.type, "READY_TO_SIGN");
  assert.equal(finalized.action.step, "coordinator");
  assert.equal(finalized.checkpoint.steps.registry.status, "finalized");
});

test("detects a reorg even after a prior checkpoint marked the receipt finalized", async () => {
  const fixture = fixtureDescriptor();
  const checkpoint = checkpointFor(fixture.descriptor, { registry: "finalized" });
  const network = fakeNetwork(fixture, {
    stage: 1,
    reorgs: { "105": hash("replacement-block-105") },
  });
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      checkpoint,
      providers: network.providers,
    }),
    /REORG_DETECTED/,
  );
});

test("captures dual-provider receipts, runtimes, and all mutual binding readbacks", async () => {
  const fixture = fixtureDescriptor();
  const checkpoint = checkpointFor(fixture.descriptor, {
    registry: "finalized",
    coordinator: "submitted",
  });
  const coordinatorTransaction = transactionFor(fixture.descriptor, "coordinator");
  const coordinatorReceipt = receiptFor(fixture.descriptor, "coordinator", 108);
  const network = fakeNetwork(fixture, {
    stage: 2,
    head: 110,
    transactions: { [coordinatorTransaction.hash]: coordinatorTransaction },
    receipts: { [coordinatorTransaction.hash]: coordinatorReceipt },
  });
  const result = await inspectExactShardsTwoTransactionRelease({
    descriptor: fixture.descriptor,
    checkpoint,
    providers: network.providers,
  });
  assert.equal(result.action.type, "COMPLETE");
  assert.equal(result.checkpoint.steps.coordinator.status, "finalized");
  assert.equal(result.capture.activationAllowed, false);
  assert.equal(result.capture.readbacks.length, fixture.descriptor.readbacks.length);
  assert.equal(result.capture.captureDigest, canonicalSha256({
    schema: result.capture.schema,
    descriptorDigest: result.capture.descriptorDigest,
    activationAllowed: result.capture.activationAllowed,
    agreedBlock: result.capture.agreedBlock,
    providers: result.capture.providers,
    receipts: result.capture.receipts,
    runtimes: result.capture.runtimes,
    readbacks: result.capture.readbacks,
    pairDeploymentEvent: result.capture.pairDeploymentEvent,
  }));
});

test("fails closed when providers disagree on runtime or mutual readback", async () => {
  const fixture = fixtureDescriptor();
  const base = fakeNetwork(fixture, { stage: 1 });
  const divergentProvider = fakeNetwork(fixture, { stage: 1 }).providers[1];
  const originalRequest = divergentProvider.request.bind(divergentProvider);
  divergentProvider.request = async (method, params) => {
    if (method === "eth_getCode" && params[0].toLowerCase() === fixture.descriptor.addresses.registry.toLowerCase()) {
      return runtime(99);
    }
    return originalRequest(method, params);
  };
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      checkpoint: checkpointFor(fixture.descriptor, { registry: "finalized" }),
      providers: [base.providers[0], divergentProvider],
    }),
    /PROVIDER_DIVERGENCE/,
  );

  const full = fakeNetwork(fixture, { stage: 2 });
  const readbackProvider = fakeNetwork(fixture, {
    stage: 2,
    readbackOverrides: {
      [fixture.descriptor.readbacks[0].data.toLowerCase()]: hash("wrong-readback"),
    },
  }).providers[1];
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      checkpoint: checkpointFor(fixture.descriptor, {
        registry: "finalized",
        coordinator: "finalized",
      }),
      providers: [full.providers[0], readbackProvider],
    }),
    /PROVIDER_DIVERGENCE/,
  );
});

test("rejects a coordinator receipt without the exact Factory-Route pair event", async () => {
  const fixture = fixtureDescriptor();
  const checkpoint = checkpointFor(fixture.descriptor, {
    registry: "finalized",
    coordinator: "submitted",
  });
  const coordinatorTransaction = transactionFor(fixture.descriptor, "coordinator");
  const coordinatorReceipt = receiptFor(fixture.descriptor, "coordinator", 108);
  coordinatorReceipt.logs = [];
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      checkpoint,
      providers: fakeNetwork(fixture, {
        stage: 2,
        head: 110,
        transactions: { [coordinatorTransaction.hash]: coordinatorTransaction },
        receipts: { [coordinatorTransaction.hash]: coordinatorReceipt },
      }).providers,
    }),
    /INVALID_RECEIPT.*pair event/,
  );
});

test("rejects unbound provider identities and excessive head lag", async () => {
  const fixture = fixtureDescriptor();
  const network = fakeNetwork(fixture);
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({
      descriptor: fixture.descriptor,
      providers: [{ ...network.providers[0], providerId: "other" }, network.providers[1]],
    }),
    /frozen provider identities/,
  );
  const lagged = fakeNetwork(fixture).providers;
  const original = lagged[1].request.bind(lagged[1]);
  lagged[1].request = (method, params) =>
    method === "eth_getBlockByNumber" && params[0] === "latest"
      ? Promise.resolve({ number: "0x64", hash: blockHash(100) })
      : original(method, params);
  await assert.rejects(
    inspectExactShardsTwoTransactionRelease({ descriptor: fixture.descriptor, providers: lagged }),
    /head lag/,
  );
});

test("descriptor rejects shared provider id, credential source, origin, trust domain, operator, or endpoint", () => {
  for (const field of [
    "providerId",
    "credentialProviderId",
    "canonicalOrigin",
    "trustDomain",
    "operatorIdentityHash",
    "endpointCommitment",
  ]) {
    const fixture = fixtureDescriptor();
    fixture.descriptor.chain.readProviders[1][field] =
      fixture.descriptor.chain.readProviders[0][field];
    assert.throws(
      () => validateExactShardsReleaseDescriptor(fixture.descriptor),
      new RegExp(`distinct ${field}`),
    );
  }
});

test("JSON-RPC adapter binds the frozen origin without exposing URL query credentials", async () => {
  const identity = fixtureDescriptor().descriptor.chain.readProviders[0];
  let requestedUrl = null;
  const provider = createJsonRpcReadProvider({
    identity,
    url: `${identity.canonicalOrigin}/v1/key?token=top-secret`,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        async json() {
          return { jsonrpc: "2.0", id: 1, result: "0x1" };
        },
      };
    },
  });
  assert.equal(provider.providerId, identity.providerId);
  assert.equal(Object.values(provider).includes("top-secret"), false);
  assert.equal(await provider.request("eth_chainId"), "0x1");
  assert.match(requestedUrl, /top-secret/);
  assert.doesNotMatch(JSON.stringify(provider), /top-secret/);
  assert.throws(
    () =>
      createJsonRpcReadProvider({
        identity,
        url: "https://other-rpc.example/v1/key?token=top-secret",
      }),
    /origin differs/,
  );
});

test("uses injected signer, verifier, durable store, and broadcaster without a key in process", async () => {
  const fixture = fixtureDescriptor();
  const network = fakeNetwork(fixture);
  const transactionHash = hash("transaction:registry");
  const saved = [];
  const checkpointStore = { async save(checkpoint) { saved.push(checkpoint); } };
  const signedTransactionVerifier = {
    async verify() {
      const transaction = fixture.descriptor.transactions[0];
      return {
        transactionHash,
        signerAddress: transaction.from,
        chainId: transaction.chainId,
        nonce: transaction.nonce,
        to: null,
        value: transaction.value,
        data: transaction.data,
        gas: transaction.gas,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      };
    },
  };
  const signed = await signNextExactShardsTransaction({
    descriptor: fixture.descriptor,
    providers: network.providers,
    signerPort: {
      async signExactTransaction() {
        return { signedPayloadRef: "kms://release/registry", transactionHash };
      },
    },
    signedTransactionVerifier,
    checkpointStore,
  });
  assert.equal(signed.steps.registry.status, "signed");
  assert.equal(saved.length, 1);

  const submitted = await broadcastSignedExactShardsTransaction({
    descriptor: fixture.descriptor,
    checkpoint: signed,
    providers: network.providers,
    signedTransactionVerifier,
    broadcasterPort: {
      async broadcastSignedTransaction({ transactionHash: expected }) {
        return expected;
      },
    },
    checkpointStore,
  });
  assert.equal(submitted.steps.registry.status, "submitted");
  assert.equal(saved.length, 2);
});

test("rejects a signer port that changes any frozen transaction field", async () => {
  const fixture = fixtureDescriptor();
  const transactionHash = hash("transaction:registry");
  await assert.rejects(
    signNextExactShardsTransaction({
      descriptor: fixture.descriptor,
      providers: fakeNetwork(fixture).providers,
      signerPort: {
        async signExactTransaction() {
          return { signedPayloadRef: "kms://release/registry", transactionHash };
        },
      },
      signedTransactionVerifier: {
        async verify() {
          const transaction = fixture.descriptor.transactions[0];
          return {
            transactionHash,
            signerAddress: transaction.from,
            chainId: transaction.chainId,
            nonce: "8",
            to: null,
            value: transaction.value,
            data: transaction.data,
            gas: transaction.gas,
            maxFeePerGas: transaction.maxFeePerGas,
            maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
          };
        },
      },
      checkpointStore: { async save() {} },
    }),
    /SIGNED_TRANSACTION_DRIFT/,
  );
});
