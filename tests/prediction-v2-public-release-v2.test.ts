import {
  createHash,
  createPrivateKey,
  sign,
} from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { keccak256, type Hex } from "viem";

vi.mock("server-only", () => ({}));

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import { canonicalizeJson } from
  "../lib/server/projection-target/canonical-json";
import {
  createPredictionV2DistributedBudgetV2,
  PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_COMMITMENT_DOMAIN,
  type PredictionV2AtomicBudgetBackendV2,
} from "../lib/prediction-v2/distributed-budget-v2.server";
import {
  PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS,
} from "../lib/prediction-v2/logical-rpc-costs-v2";
import {
  PREDICTION_V2_COMPONENT_SPECS,
  PREDICTION_V2_PUBLIC_RELEASE_HISTORICAL_SESSION_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_PUBLIC_RELEASE_PRODUCTION_TRUST_ROOT,
  PREDICTION_V2_PUBLIC_RELEASE_RUNTIME_PREFLIGHT_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_REQUIRED_RELEASE_GATES,
  PredictionV2RuntimeDependencySnapshotErrorV2,
  assertPredictionV2RuntimeDistributedBudgetMatchesRelease,
  assertPredictionV2RuntimeRpcCommitmentProjectionMatchesRelease,
  assertPredictionV2VerifiedEnabledPublicReleaseV2,
  createPredictionV2PublicReleaseRpcSession,
  createPredictionV2PublicReleaseSigningMessage,
  derivePredictionV2PublicReleaseGraphCommitments,
  getPredictionV2PublicReleaseV2,
  isPredictionV2PublicReleaseV2Enabled,
  parsePredictionV2PublicReleaseV2,
  predictionV2PublicReleaseRpcIdentityCommitment,
  toPredictionV2PublicMarketCanonicalReleaseV2,
  toPredictionV2ReadBindingFromPublicReleaseV2,
  verifyPredictionV2RuntimeDependencySnapshotV2,
  verifyPredictionV2PublicReleaseV2WithTrustRoot,
  type PredictionV2PublicReleaseTrustRoot,
  type PredictionV2RuntimeDependencySnapshotBindingV2,
} from "../lib/prediction-v2/public-release-v2.server";
import {
  PREDICTION_V2_RPC_LIMITS,
  predictionV2RpcBindingInput,
  predictionV2RpcCommitment as runtimeReaderRpcIdentityCommitment,
} from "../lib/prediction-v2/rpc-reader-v2.server";
import {
  createPredictionV2ActionRpcSnapshotLease,
  createPredictionV2ActionRpcSession,
  PREDICTION_V2_ACTION_CONFIRMATION_DEPTH,
  PREDICTION_V2_ACTION_SNAPSHOT_NEGOTIATION_RPC_LOGICAL_CALLS,
  predictionV2ActionRpcRuntimeProjection,
} from "../lib/prediction-v2/rpc-session-v2.server";

const PRIVATE_KEY_DER = Buffer.from(
  `302e020100300506032b657004220420${"42".repeat(32)}`,
  "hex",
);
const PRIVATE_KEY = createPrivateKey({
  key: PRIVATE_KEY_DER,
  format: "der",
  type: "pkcs8",
});
const PUBLIC_KEY_DER = Buffer.from(
  "302a300506032b65700321002152f8d19b791d24453242e15f2eab6cb7cffa7b6a5ed30097960e069881db12",
  "hex",
);

function actualSha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fixtureSha256(index: number): `sha256:${string}` {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function fixtureBytes32(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function fixtureAddress(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

const TEST_TRUST_ROOT = Object.freeze({
  algorithm: "Ed25519",
  keyId: "prediction-v2-test-root-1",
  publicKeySpkiBase64Url: PUBLIC_KEY_DER.toString("base64url"),
  publicKeySpkiSha256: actualSha256(PUBLIC_KEY_DER),
}) satisfies PredictionV2PublicReleaseTrustRoot;

function unsignedEnabledFixture() {
  const release = {
    releaseId: "protocol-v2",
    manifestStatus: "live",
    repository: "0xprogrammable/programmable-prediction-markets",
    sourceCommit: "1".repeat(40),
    sourceTree: "2".repeat(40),
    manifestPath: "releases/protocol-v2/manifest.json",
    manifestSha256: fixtureSha256(1),
    dependencySourcesPath: "releases/protocol-v2/dependency-sources.json",
    dependencySourcesSha256: fixtureSha256(2),
    projectionAttestorAddress: fixtureAddress(900),
  };
  const components = PREDICTION_V2_COMPONENT_SPECS.map((spec, index) => ({
    component: spec.component,
    address: fixtureAddress(index + 1),
    deploymentBlock: String(1_000 + index),
    runtimeCodeHash: fixtureBytes32(index + 1),
    contractIdentifier: spec.contractIdentifier,
    sourceVerificationInputSha256: fixtureSha256(index + 10),
  }));
  const runtimeDependencies = {
    executionEnvironment: "ROBINHOOD_CHAIN_4663_CANCUN_EIP1153",
    usdg: {
      proxy: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      proxyRuntimeCodeHash: fixtureBytes32(101),
      implementationSlot:
        "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      implementation: fixtureAddress(101),
      implementationRuntimeCodeHash: fixtureBytes32(102),
      decimals: 6,
      permitDomain: {
        separator: fixtureBytes32(103),
        chainId: 4_663,
        verifyingContract: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      },
    },
    poolManager: {
      address: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
      runtimeCodeHash: fixtureBytes32(104),
    },
    create2Deployer: {
      address: "0x4e59b44847b379578588920ca78fbf26c0b4956c",
      runtimeCodeHash: fixtureBytes32(105),
    },
    checkpointCloneRuntimeCodeHash: fixtureBytes32(106),
    readbackBlockNumber: "1234567",
    readbackBlockHash: fixtureBytes32(202),
    runtimeReadbackEvidenceSha256: fixtureSha256(107),
  };
  const registrySnapshot = {
    networkId: "eip155:4663",
    chainId: 4_663,
    registryAddress: components[0]!.address,
    snapshotHash: fixtureBytes32(201),
    blockNumber: "1234567",
    blockHash: fixtureBytes32(202),
    activePolicyCount: 1,
    snapshotArtifactSha256: fixtureSha256(203),
  };
  const rpcCommitment = {
    networkId: "eip155:4663",
    chainId: 4_663,
    confirmedBlockNumber: registrySnapshot.blockNumber,
    confirmedBlockHash: registrySnapshot.blockHash,
    snapshotPolicy: {
      kind: "action",
      confirmationDepth: Number(PREDICTION_V2_ACTION_CONFIRMATION_DEPTH),
    },
    transportPolicy: { ...PREDICTION_V2_RPC_LIMITS },
    readStrategy: "single-eip-1898-confirmed-block-hash-v1",
    requireCanonical: true,
    requiredProviderCount: 1,
    provider: {
      role: "settlement",
      providerId: "test-settlement",
      providerCommitment: predictionV2PublicReleaseRpcIdentityCommitment(
        "provider",
        "test-settlement",
      ),
      vendorGroup: "alchemy",
      vendorCommitment: predictionV2PublicReleaseRpcIdentityCommitment(
        "vendor",
        "alchemy",
      ),
      endpointCommitment: rpcProviderCommitment(
        "endpoint",
        "https://robinhood-mainnet.g.alchemy.com/v2/test-settlement-secret",
      ),
      endpointOriginCommitment: rpcProviderCommitment(
        "origin",
        "https://robinhood-mainnet.g.alchemy.com",
      ),
      batchMode: "batch",
    },
    evidenceSha256: fixtureSha256(303),
  };
  const distributedBudget = budgetRuntime();
  const distributedBudgetPolicy = distributedBudget.runtimePolicyProjection();
  const distributedBudgetPolicyCommitment =
    distributedBudget.runtimePolicyCommitment();
  const gates = PREDICTION_V2_REQUIRED_RELEASE_GATES.map((gateId, index) => ({
    gateId,
    status: "closed",
    evidenceSha256: fixtureSha256(400 + index),
  }));
  const graphCommitments = derivePredictionV2PublicReleaseGraphCommitments({
    release,
    components,
    runtimeDependencies,
    registrySnapshot,
    rpcCommitment,
    distributedBudgetPolicy,
    distributedBudgetPolicyCommitment,
    gates,
  });

  return {
    schemaVersion: "programmable.prediction-v2-public-release.v2",
    releaseVersion: "prediction-v2",
    status: "enabled",
    release,
    components,
    runtimeDependencies,
    registrySnapshot,
    rpcCommitment,
    distributedBudgetPolicy,
    distributedBudgetPolicyCommitment,
    gates,
    graphCommitments,
  };
}

function signedEnabledFixture() {
  const unsigned = unsignedEnabledFixture();
  const signingMessage = createPredictionV2PublicReleaseSigningMessage(unsigned);
  return {
    ...unsigned,
    attestation: {
      algorithm: "Ed25519",
      keyId: TEST_TRUST_ROOT.keyId,
      payloadSha256: actualSha256(signingMessage),
      signature: sign(null, signingMessage, PRIVATE_KEY).toString("base64url"),
    },
  };
}

function signUncheckedUnsignedFixture(
  unsigned: ReturnType<typeof unsignedEnabledFixture>,
) {
  const signingMessage = Buffer.from(
    `PROGRAMMABLE_PREDICTION_V2_PUBLIC_RELEASE_V2\0${canonicalizeJson(unsigned)}`,
    "utf8",
  );
  return {
    ...unsigned,
    attestation: {
      algorithm: "Ed25519",
      keyId: TEST_TRUST_ROOT.keyId,
      payloadSha256: actualSha256(signingMessage),
      signature: sign(null, signingMessage, PRIVATE_KEY).toString("base64url"),
    },
  };
}

function refreshFixtureGraph(
  value: ReturnType<typeof unsignedEnabledFixture>,
) {
  value.graphCommitments = derivePredictionV2PublicReleaseGraphCommitments({
    release: value.release,
    components: value.components,
    runtimeDependencies: value.runtimeDependencies,
    registrySnapshot: value.registrySnapshot,
    rpcCommitment: value.rpcCommitment,
    distributedBudgetPolicy: value.distributedBudgetPolicy,
    distributedBudgetPolicyCommitment:
      value.distributedBudgetPolicyCommitment,
    gates: value.gates,
  });
  return value;
}

function refreshFixtureBudgetPolicy(
  value: ReturnType<typeof unsignedEnabledFixture>,
) {
  value.distributedBudgetPolicyCommitment = actualSha256(
    `${PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_COMMITMENT_DOMAIN}\n${JSON.stringify(value.distributedBudgetPolicy)}`,
  );
  return refreshFixtureGraph(value);
}

type MutableFixture = ReturnType<typeof signedEnabledFixture>;

function cloneFixture() {
  return structuredClone(signedEnabledFixture());
}

function actionReader(
  confirmationDepth = PREDICTION_V2_ACTION_CONFIRMATION_DEPTH,
  fetcher = releaseRpcFetcher(),
) {
  return createPredictionV2ActionRpcSession({
    confirmationDepth,
    binding: predictionV2RpcBindingInput({
      providerId: "test-settlement",
      vendorGroup: "alchemy",
      endpoint:
        "https://robinhood-mainnet.g.alchemy.com/v2/test-settlement-secret",
    }),
    dependencies: {
      provider: { fetcher },
    },
  });
}

type PreflightRpcRequest = Readonly<{
  id: number;
  method: string;
  params: readonly unknown[];
}>;

type PreflightFetcherOptions = Readonly<{
  blockHashAfterNegotiation?: Hex;
  code?: (address: string) => Hex;
  decimals?: Hex;
  domainSeparator?: Hex;
  storage?: Hex;
}>;

const PREFLIGHT_CODE = "0x60006000" as const;
const PREFLIGHT_BLOCK_HASH = fixtureBytes32(8_001);
const PREFLIGHT_PARENT_HASH = fixtureBytes32(8_000);

function runtimeDependencyBindingFixture():
PredictionV2RuntimeDependencySnapshotBindingV2 {
  const codeTargets = Array.from({
    length: PREDICTION_V2_COMPONENT_SPECS.length + 4,
  }, (_unused, index) =>
    Object.freeze({
      address: fixtureAddress(2_000 + index),
      runtimeCodeHash: keccak256(PREFLIGHT_CODE),
    }));
  return Object.freeze({
    codeTargets: Object.freeze(codeTargets),
    usdgProxy: codeTargets[13]!.address,
    usdgImplementationSlot:
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    usdgImplementation: codeTargets[14]!.address,
    usdgDecimals: 6,
    usdgDomainSeparator: fixtureBytes32(9_001),
  });
}

function runtimePreflightFetcher(
  binding: PredictionV2RuntimeDependencySnapshotBindingV2,
  requests: PreflightRpcRequest[],
  options: PreflightFetcherOptions = {},
) {
  const observedAt = BigInt(Math.floor(Date.now() / 1_000));
  let blockReads = 0;
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body)) as
      | PreflightRpcRequest
      | readonly PreflightRpcRequest[];
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    const replies = batch.map((request) => {
      requests.push(request);
      let result: unknown;
      if (request.method === "eth_chainId") result = "0x1237";
      else if (request.method === "eth_blockNumber") result = "0x64";
      else if (request.method === "eth_getBlockByNumber") {
        blockReads += 1;
        const number = BigInt(String(request.params[0]));
        result = {
          number: `0x${number.toString(16)}`,
          hash: blockReads > 1 && options.blockHashAfterNegotiation
            ? options.blockHashAfterNegotiation
            : PREFLIGHT_BLOCK_HASH,
          parentHash: PREFLIGHT_PARENT_HASH,
          timestamp: `0x${observedAt.toString(16)}`,
        };
      } else if (request.method === "eth_getCode") {
        const address = String(request.params[0]).toLowerCase();
        result = options.code?.(address) ?? PREFLIGHT_CODE;
      } else if (request.method === "eth_getStorageAt") {
        result = options.storage ??
          `0x${"0".repeat(24)}${binding.usdgImplementation.slice(2)}`;
      } else if (request.method === "eth_call") {
        const call = request.params[0] as Readonly<{ data: string }>;
        if (call.data === "0x313ce567") {
          result = options.decimals ?? `0x${"6".padStart(64, "0")}`;
        } else if (call.data === "0x3644e515") {
          result = options.domainSeparator ?? binding.usdgDomainSeparator;
        } else throw new Error("unexpected preflight call");
      } else throw new Error("unexpected preflight RPC method");
      return { jsonrpc: "2.0", id: request.id, result };
    });
    return new Response(
      JSON.stringify(Array.isArray(parsed) ? replies : replies[0]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

function budgetRuntime() {
  const backend: PredictionV2AtomicBudgetBackendV2 = Object.freeze({
    scope: "shared-atomic",
    backendIdCommitment: fixtureSha256(8_100),
    async reserveAtomic() {
      throw new Error("unused budget fixture backend");
    },
    async markStartedAtomic() {
      throw new Error("unused budget fixture backend");
    },
    async commitAtomic() {
      throw new Error("unused budget fixture backend");
    },
    async cancelAtomic() {
      throw new Error("unused budget fixture backend");
    },
  });
  return createPredictionV2DistributedBudgetV2({
    backend,
    backendTimeoutMs: 3_000,
    lanes: [
      ["directory", PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS],
      [
        "redeem-prepare",
        PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS,
      ],
      [
        "resolution-decision",
        PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS,
      ],
    ].map(([action, exactUnits]) => ({
      provider: "robinhood-settlement-rpc",
      action: String(action),
      unit: "rpc-logical-call",
      worstCaseUnits: Number(exactUnits),
      reservationTtlMs: 30_000,
      idempotencyTtlMs: 60_000,
      limits: {
        provider: {
          capacityUnits:
            PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS * 2,
          windowMs: 60_000,
        },
        action: {
          capacityUnits: Number(exactUnits) * 2,
          windowMs: 60_000,
        },
        client: {
          capacityUnits: Number(exactUnits),
          windowMs: 60_000,
        },
      },
    })),
  });
}

function releaseRpcFetcher() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body)) as
      | Readonly<{ id: number; method: string; params: readonly unknown[] }>
      | readonly Readonly<{
          id: number;
          method: string;
          params: readonly unknown[];
        }>[];
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    const replies = requests.map((request) => {
      let result: unknown;
      if (request.method === "eth_chainId") result = "0x1237";
      else if (request.method === "eth_blockNumber") result = "0x64";
      else if (request.method === "eth_getBlockByNumber") {
        const number = BigInt(String(request.params[0]));
        result = {
          number: `0x${number.toString(16)}`,
          hash: fixtureBytes32(8_001),
          parentHash: fixtureBytes32(8_000),
          timestamp: `0x${BigInt(Math.floor(Date.now() / 1_000)).toString(16)}`,
        };
      } else throw new Error("unexpected release RPC method");
      return { jsonrpc: "2.0", id: request.id, result };
    });
    return new Response(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("Prediction V2 exact-snapshot runtime dependency preflight", () => {
  it("checks every signed runtime dependency with exact EIP-1898 reads", async () => {
    const binding = runtimeDependencyBindingFixture();
    const requests: PreflightRpcRequest[] = [];
    const reader = actionReader(
      4n,
      runtimePreflightFetcher(binding, requests),
    );
    const lease = await createPredictionV2ActionRpcSnapshotLease(reader);

    try {
      await expect(verifyPredictionV2RuntimeDependencySnapshotV2(
        lease,
        binding,
      )).resolves.toBeUndefined();
      expect(PREDICTION_V2_PUBLIC_RELEASE_RUNTIME_PREFLIGHT_MAX_RPC_LOGICAL_CALLS)
        .toBe(21);
      expect(PREDICTION_V2_ACTION_SNAPSHOT_NEGOTIATION_RPC_LOGICAL_CALLS)
        .toBe(3);
      expect(PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS)
        .toBe(24);
      expect(
        PREDICTION_V2_PUBLIC_RELEASE_HISTORICAL_SESSION_MAX_RPC_LOGICAL_CALLS,
      ).toBe(25);
      expect(requests).toHaveLength(24);

      const exactBlock = {
        blockHash: PREFLIGHT_BLOCK_HASH,
        requireCanonical: true,
      };
      for (const request of requests) {
        if (request.method === "eth_getCode") {
          expect(request.params[1]).toEqual(exactBlock);
        } else if (request.method === "eth_getStorageAt") {
          expect(request.params).toEqual([
            binding.usdgProxy,
            binding.usdgImplementationSlot,
            exactBlock,
          ]);
        } else if (request.method === "eth_call") {
          expect(request.params[1]).toEqual(exactBlock);
          expect(request.params[0]).toMatchObject({ to: binding.usdgProxy });
        }
      }
    } finally {
      lease.close();
    }
  });

  it("fails closed on dependency drift and reorg", async () => {
    const binding = runtimeDependencyBindingFixture();
    const implementation = binding.usdgImplementation.toLowerCase();
    const proxy = binding.usdgProxy.toLowerCase();
    const changedCode = "0x6001" as const;
    const changedDecimals = `0x${"7".padStart(64, "0")}` as Hex;
    const cases: readonly Readonly<{
      expected: PredictionV2RuntimeDependencySnapshotErrorV2["code"];
      options?: PreflightFetcherOptions;
    }>[] = [
      {
        expected: "runtime-mismatch",
        options: {
          code: (address) =>
            address === implementation ? changedCode : PREFLIGHT_CODE,
        },
      },
      {
        expected: "runtime-mismatch",
        options: {
          code: (address) => address === proxy ? changedCode : PREFLIGHT_CODE,
        },
      },
      {
        expected: "runtime-mismatch",
        options: { storage: fixtureBytes32(0) },
      },
      {
        expected: "runtime-mismatch",
        options: { decimals: changedDecimals },
      },
      {
        expected: "runtime-mismatch",
        options: { domainSeparator: fixtureBytes32(9_002) },
      },
      {
        expected: "block-mismatch",
        options: { blockHashAfterNegotiation: fixtureBytes32(9_003) },
      },
    ];

    for (const testCase of cases) {
      const reader = actionReader(
        4n,
        runtimePreflightFetcher(binding, [], testCase.options),
      );
      const lease = await createPredictionV2ActionRpcSnapshotLease(reader);
      try {
        await expect(verifyPredictionV2RuntimeDependencySnapshotV2(
          lease,
          binding,
        )).rejects.toMatchObject({ code: testCase.expected });
      } finally {
        lease.close();
      }
    }
  });

  it("rejects malformed bindings before any dependency read", async () => {
    const binding = runtimeDependencyBindingFixture();
    const requests: PreflightRpcRequest[] = [];
    const reader = actionReader(
      4n,
      runtimePreflightFetcher(binding, requests),
    );
    const lease = await createPredictionV2ActionRpcSnapshotLease(reader);
    const requestsAfterNegotiation = requests.length;
    try {
      await expect(verifyPredictionV2RuntimeDependencySnapshotV2(
        lease,
        { ...binding, codeTargets: binding.codeTargets.slice(1) },
      )).rejects.toMatchObject({ code: "invalid-binding" });
      expect(requests).toHaveLength(requestsAfterNegotiation);
    } finally {
      lease.close();
    }
  });
});

describe("Prediction V2 public release V2 binding", () => {
  it("locks the runtime reader provider and vendor commitment domains", () => {
    expect(
      predictionV2PublicReleaseRpcIdentityCommitment(
        "provider",
        "test-settlement",
      ),
    ).toBe(
      "0x6d6dc13700b28eaa1d196ba4969ccc55ed3b02110bdb752d1ae41603e2f44443",
    );
    expect(
      predictionV2PublicReleaseRpcIdentityCommitment("vendor", "alchemy"),
    ).toBe(
      "0x647e6d5bde6b04148ac4eb8d56a93a1299d48182a85f7744e97a1be85c5265a2",
    );
    for (const [scope, value] of [
      ["provider", "test-settlement"],
      ["vendor", "alchemy"],
      ["vendor", "drpc"],
      ["vendor", "quicknode"],
    ] as const) {
      expect(
        predictionV2PublicReleaseRpcIdentityCommitment(scope, value),
      ).toBe(runtimeReaderRpcIdentityCommitment(scope, value));
    }
  });

  it("ships release-dark with no invented production trust root", () => {
    const binding = getPredictionV2PublicReleaseV2();

    expect(binding).toEqual({
      schemaVersion: "programmable.prediction-v2-public-release.v2",
      releaseVersion: "prediction-v2",
      status: "disabled",
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(PREDICTION_V2_PUBLIC_RELEASE_PRODUCTION_TRUST_ROOT).toBeNull();
    expect(isPredictionV2PublicReleaseV2Enabled()).toBe(false);
  });

  it("accepts a fully closed exact graph signed by the supplied test trust root", () => {
    const binding = verifyPredictionV2PublicReleaseV2WithTrustRoot(
      signedEnabledFixture(),
      TEST_TRUST_ROOT,
    );

    expect(binding.status).toBe("enabled");
    if (binding.status !== "enabled") throw new Error("unreachable");
    expect(binding.components).toHaveLength(13);
    expect(binding.components.map((component) => component.component)).toEqual(
      PREDICTION_V2_COMPONENT_SPECS.map((component) => component.component),
    );
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.components)).toBe(true);
    expect(Object.isFrozen(binding.components[0])).toBe(true);
    expect(binding.components.map(({ deploymentBlock }) => deploymentBlock))
      .toEqual(PREDICTION_V2_COMPONENT_SPECS.map(
        (_component, index) => String(1_000 + index),
      ));
    expect(Object.isFrozen(binding.runtimeDependencies)).toBe(true);
    expect(Object.isFrozen(binding.registrySnapshot)).toBe(true);
    expect(Object.isFrozen(binding.rpcCommitment)).toBe(true);
    expect(Object.isFrozen(binding.distributedBudgetPolicy)).toBe(true);
    expect(Object.isFrozen(binding.distributedBudgetPolicy.lanes)).toBe(true);
    expect(binding.distributedBudgetPolicy).toEqual(
      budgetRuntime().runtimePolicyProjection(),
    );
    expect(binding.distributedBudgetPolicyCommitment).toBe(
      budgetRuntime().runtimePolicyCommitment(),
    );
    expect(binding.distributedBudgetPolicy.lanes.map((lane) => ({
      provider: lane.provider,
      action: lane.action,
      unit: lane.unit,
      exactUnitsPerAction: lane.exactUnitsPerAction,
    }))).toEqual([
      {
        provider: "robinhood-settlement-rpc",
        action: "directory",
        unit: "rpc-logical-call",
        exactUnitsPerAction:
          PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS,
      },
      {
        provider: "robinhood-settlement-rpc",
        action: "redeem-prepare",
        unit: "rpc-logical-call",
        exactUnitsPerAction:
          PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS,
      },
      {
        provider: "robinhood-settlement-rpc",
        action: "resolution-decision",
        unit: "rpc-logical-call",
        exactUnitsPerAction:
          PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS,
      },
    ]);
    expect(binding.graphCommitments.distributedBudgetPolicySha256)
      .toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(binding.distributedBudgetPolicy)).not.toContain(
      "endpoint",
    );
    expect(Object.isFrozen(binding.gates)).toBe(true);
    expect(Object.isFrozen(binding.attestation)).toBe(true);
  });

  it.each([0, 2])(
    "rejects a fully re-signed maximumRetries=%i transport policy",
    (maximumRetries) => {
      expect(signUncheckedUnsignedFixture(unsignedEnabledFixture()).attestation)
        .toEqual(signedEnabledFixture().attestation);
      const unsigned = unsignedEnabledFixture();
      Reflect.set(
        unsigned.rpcCommitment.transportPolicy,
        "maximumRetries",
        maximumRetries,
      );
      const signed = signUncheckedUnsignedFixture(refreshFixtureGraph(unsigned));

      expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
        signed,
        TEST_TRUST_ROOT,
      )).toThrow("Invalid Prediction V2 public release binding");
    },
  );

  it.each([1, 4, 64])(
    "rejects a fully re-signed confirmationDepth=%i policy",
    (depth) => {
      const unsigned = unsignedEnabledFixture();
      Reflect.set(unsigned.rpcCommitment.snapshotPolicy, "confirmationDepth", depth);
      const signed = signUncheckedUnsignedFixture(refreshFixtureGraph(unsigned));

      expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
        signed,
        TEST_TRUST_ROOT,
      )).toThrow("Invalid Prediction V2 public release binding");
    },
  );

  it("binds the settlement endpoint and batch mode into the signed RPC graph", () => {
    const batch = unsignedEnabledFixture();
    const solo = unsignedEnabledFixture();
    const rotatedEndpoint = unsignedEnabledFixture();
    Reflect.set(solo.rpcCommitment.provider, "batchMode", "solo");
    refreshFixtureGraph(solo);
    Reflect.set(
      rotatedEndpoint.rpcCommitment.provider,
      "endpointCommitment",
      fixtureBytes32(9_900),
    );
    refreshFixtureGraph(rotatedEndpoint);
    expect(solo.graphCommitments.rpcCommitmentSha256).not.toBe(
      batch.graphCommitments.rpcCommitmentSha256,
    );
    expect(rotatedEndpoint.graphCommitments.rpcCommitmentSha256).not.toBe(
      batch.graphCommitments.rpcCommitmentSha256,
    );

    const verified = verifyPredictionV2PublicReleaseV2WithTrustRoot(
      signUncheckedUnsignedFixture(solo),
      TEST_TRUST_ROOT,
    );
    expect(verified.status).toBe("enabled");
    if (verified.status !== "enabled") throw new Error("unreachable");
    expect(verified.rpcCommitment.provider.batchMode).toBe("solo");
  });

  it("never promotes a caller-root release into Production authority", async () => {
    const release = verifyPredictionV2PublicReleaseV2WithTrustRoot(
      signedEnabledFixture(),
      TEST_TRUST_ROOT,
    );
    expect(release.status).toBe("enabled");
    if (release.status !== "enabled") throw new Error("unreachable");

    const clone = structuredClone(release);
    const mutated = structuredClone(release);
    Reflect.set(mutated.release, "projectionAttestorAddress", fixtureAddress(999));
    for (const value of [
      release,
      clone,
      { ...release },
      mutated,
      signedEnabledFixture(),
      {
        schemaVersion: "programmable.prediction-v2-public-release.v2",
        releaseVersion: "prediction-v2",
        status: "disabled",
      },
    ]) {
      expect(() =>
        assertPredictionV2VerifiedEnabledPublicReleaseV2(value)
      ).toThrow("Invalid Prediction V2 public release binding");
    }

    expect(() =>
      assertPredictionV2RuntimeRpcCommitmentProjectionMatchesRelease(
        release,
        predictionV2ActionRpcRuntimeProjection(actionReader()),
      )
    ).toThrow(
      "Prediction V2 runtime RPC commitment does not match public release",
    );
    expect(() =>
      assertPredictionV2RuntimeDistributedBudgetMatchesRelease(
        release,
        budgetRuntime(),
      )
    ).toThrow(
      "Prediction V2 distributed budget does not match public release",
    );
    expect(() => toPredictionV2PublicMarketCanonicalReleaseV2(release))
      .toThrow("Invalid Prediction V2 public release binding");
    expect(() => toPredictionV2ReadBindingFromPublicReleaseV2(release))
      .toThrow("Invalid Prediction V2 public release binding");

    const fetcher = releaseRpcFetcher();
    await expect(createPredictionV2PublicReleaseRpcSession(
      release,
      actionReader(4n, fetcher),
      budgetRuntime(),
    )).rejects.toThrow(
      "Prediction V2 distributed budget does not match public release",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not allow an injected root through the Production parser", () => {
    const callWithInjectedRoot = parsePredictionV2PublicReleaseV2 as unknown as
      (
        value: unknown,
        trustRoot: PredictionV2PublicReleaseTrustRoot,
      ) => unknown;

    expect(() => callWithInjectedRoot(
      signedEnabledFixture(),
      TEST_TRUST_ROOT,
    )).toThrow("Invalid Prediction V2 public release binding");
  });

  it("keeps Production adapters closed while the shipped release is disabled", () => {
    const disabled = getPredictionV2PublicReleaseV2();
    expect(() => toPredictionV2PublicMarketCanonicalReleaseV2(disabled))
      .toThrow("Invalid Prediction V2 public release binding");
    expect(() => toPredictionV2ReadBindingFromPublicReleaseV2(disabled))
      .toThrow("Invalid Prediction V2 public release binding");
  });

  it("rejects enabled data while no Production trust root is pinned", () => {
    expect(() => parsePredictionV2PublicReleaseV2(signedEnabledFixture())).toThrow(
      "Invalid Prediction V2 public release binding",
    );
  });

  it.each([
    ["root", (value: MutableFixture) => { Object.assign(value, { debug: true }); }],
    ["release", (value: MutableFixture) => {
      Object.assign(value.release, { branch: "main" });
    }],
    ["component", (value: MutableFixture) => {
      Object.assign(value.components[0], { verified: true });
    }],
    ["runtime dependency", (value: MutableFixture) => {
      Object.assign(value.runtimeDependencies.poolManager, {
        endpoint: "https://example.invalid",
      });
    }],
    ["registry snapshot", (value: MutableFixture) => {
      Object.assign(value.registrySnapshot, { asset: "BTC" });
    }],
    ["RPC provider", (value: MutableFixture) => {
      Object.assign(value.rpcCommitment.provider, {
        url: "https://example.invalid",
      });
    }],
    ["distributed budget", (value: MutableFixture) => {
      Object.assign(value.distributedBudgetPolicy.policy, {
        retryAfterSeconds: 1,
      });
    }],
    ["gate", (value: MutableFixture) => {
      Object.assign(value.gates[0], { note: "done" });
    }],
    ["attestation", (value: MutableFixture) => {
      Object.assign(value.attestation, { publicKey: "self-declared" });
    }],
  ])("rejects unknown keys in the %s schema", (_label, mutate) => {
    const value = cloneFixture();
    mutate(value);
    expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
      value,
      TEST_TRUST_ROOT,
    )).toThrow(
      "Invalid Prediction V2 public release binding",
    );
  });

  it.each([
    ["draft envelope", (value: MutableFixture) => { value.status = "draft"; }],
    ["draft release manifest", (value: MutableFixture) => {
      value.release.manifestStatus = "draft";
    }],
    ["open gate", (value: MutableFixture) => { value.gates[3].status = "open"; }],
    ["unset gate evidence", (value: MutableFixture) => {
      Reflect.set(value.gates[3], "evidenceSha256", null);
    }],
    ["missing gate", (value: MutableFixture) => { value.gates.pop(); }],
  ])("rejects %s", (_label, mutate) => {
    const value = cloneFixture();
    mutate(value);
    expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
      value,
      TEST_TRUST_ROOT,
    )).toThrow(
      "Invalid Prediction V2 public release binding",
    );
  });

  it.each([
    ["wrong settlement chain", (value: MutableFixture) => {
      value.rpcCommitment.chainId = 1;
    }],
    ["more than one provider", (value: MutableFixture) => {
      Reflect.set(value.rpcCommitment, "requiredProviderCount", 2);
    }],
    ["dual-provider read strategy", (value: MutableFixture) => {
      Reflect.set(
        value.rpcCommitment,
        "readStrategy",
        "dual-eip-1898-confirmed-block-hash-v1",
      );
    }],
    ["non-settlement provider role", (value: MutableFixture) => {
      Reflect.set(value.rpcCommitment.provider, "role", "primary");
    }],
    ["wrong protocol repository", (value: MutableFixture) => {
      value.release.repository = "attacker/prediction-markets";
    }],
    ["changed component runtime", (value: MutableFixture) => {
      value.components[4].runtimeCodeHash = fixtureBytes32(9_999);
    }],
    ["empty component runtime", (value: MutableFixture) => {
      value.components[4].runtimeCodeHash =
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
    }],
    ["changed registry snapshot", (value: MutableFixture) => {
      value.registrySnapshot.snapshotHash = fixtureBytes32(9_998);
    }],
    ["registry block outside the RPC commitment", (value: MutableFixture) => {
      value.registrySnapshot.blockNumber = "1234568";
    }],
    ["runtime block outside the RPC commitment", (value: MutableFixture) => {
      value.runtimeDependencies.readbackBlockNumber = "1234568";
    }],
    ["component deployment after runtime readback", (value: MutableFixture) => {
      value.components[11].deploymentBlock = "1234568";
    }],
  ])("rejects %s", (_label, mutate) => {
    const value = cloneFixture();
    mutate(value);
    expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
      value,
      TEST_TRUST_ROOT,
    )).toThrow(
      "Invalid Prediction V2 public release binding",
    );
  });

  it("rejects missing, malformed, self-declared, and invalid signatures", () => {
    const missing = cloneFixture();
    Reflect.deleteProperty(missing.attestation, "signature");

    const malformed = cloneFixture();
    malformed.attestation.signature = "not+base64";

    const selfDeclared = cloneFixture();
    Reflect.set(selfDeclared.attestation, "keyId", "attacker-key");

    const invalid = cloneFixture();
    invalid.attestation.signature = Buffer.alloc(64, 7).toString("base64url");

    for (const value of [missing, malformed, selfDeclared, invalid]) {
      expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
        value,
        TEST_TRUST_ROOT,
      )).toThrow(
        "Invalid Prediction V2 public release binding",
      );
    }
  });

  it("rejects omitted or mutated attestor authority and a wrong Factory component", () => {
    const omitted = cloneFixture();
    Reflect.deleteProperty(omitted.release, "projectionAttestorAddress");

    const mutated = cloneFixture();
    mutated.release.projectionAttestorAddress = fixtureAddress(901);

    const wrongFactory = cloneFixture();
    wrongFactory.components[11]!.component = "PredictionQuoterV2";

    for (const value of [omitted, mutated, wrongFactory]) {
      expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
        value,
        TEST_TRUST_ROOT,
      ))
        .toThrow("Invalid Prediction V2 public release binding");
    }
  });

  it("rejects omitted or mutated component deployment provenance", () => {
    const omitted = cloneFixture();
    Reflect.deleteProperty(omitted.components[11], "deploymentBlock");

    const zero = cloneFixture();
    zero.components[11].deploymentBlock = "0";

    const mutated = cloneFixture();
    mutated.components[11].deploymentBlock = "1012";

    for (const value of [omitted, zero, mutated]) {
      expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
        value,
        TEST_TRUST_ROOT,
      ))
        .toThrow("Invalid Prediction V2 public release binding");
    }
  });

  it("rejects omitted, non-shared, or drifted distributed budget policy", () => {
    const omitted = cloneFixture();
    Reflect.deleteProperty(omitted, "distributedBudgetPolicy");

    const missingCommitment = cloneFixture();
    Reflect.deleteProperty(
      missingCommitment,
      "distributedBudgetPolicyCommitment",
    );

    const testBackend = cloneFixture();
    Reflect.set(
      testBackend.distributedBudgetPolicy.backend,
      "scope",
      "single-runtime-test",
    );

    const driftedUnits = cloneFixture();
    Reflect.set(
      driftedUnits.distributedBudgetPolicy.lanes[0],
      "exactUnitsPerAction",
      225,
    );

    const driftedCommitment = cloneFixture();
    Reflect.set(
      driftedCommitment,
      "distributedBudgetPolicyCommitment",
      fixtureSha256(8_102),
    );

    for (const value of [
      omitted,
      missingCommitment,
      testBackend,
      driftedUnits,
      driftedCommitment,
    ]) {
      expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
        value,
        TEST_TRUST_ROOT,
      ))
        .toThrow("Invalid Prediction V2 public release binding");
    }
  });

  it.each([
    ["underpriced", (value: ReturnType<typeof unsignedEnabledFixture>) => {
      Reflect.set(
        value.distributedBudgetPolicy.lanes[2],
        "exactUnitsPerAction",
        PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS - 1,
      );
    }],
    ["overpriced", (value: ReturnType<typeof unsignedEnabledFixture>) => {
      Reflect.set(
        value.distributedBudgetPolicy.lanes[2],
        "exactUnitsPerAction",
        PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS + 1,
      );
      Reflect.set(
        value.distributedBudgetPolicy.lanes[2]!.capacities.client,
        "capacityUnits",
        PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS + 1,
      );
    }],
    ["missing", (value: ReturnType<typeof unsignedEnabledFixture>) => {
      Reflect.set(
        value.distributedBudgetPolicy,
        "lanes",
        value.distributedBudgetPolicy.lanes.slice(0, 2),
      );
    }],
    ["extra", (value: ReturnType<typeof unsignedEnabledFixture>) => {
      const extra = structuredClone(value.distributedBudgetPolicy.lanes[2]!);
      Reflect.set(extra, "action", "z-extra");
      Reflect.set(extra, "laneId", "robinhood-settlement-rpc:z-extra");
      Reflect.set(extra, "exactUnitsPerAction", 1);
      Reflect.set(value.distributedBudgetPolicy, "lanes", [
        ...value.distributedBudgetPolicy.lanes,
        extra,
      ]);
    }],
    ["wrong provider", (value: ReturnType<typeof unsignedEnabledFixture>) => {
      for (const lane of value.distributedBudgetPolicy.lanes) {
        Reflect.set(lane, "provider", "attacker-settlement-rpc");
        Reflect.set(lane, "laneId", `attacker-settlement-rpc:${lane.action}`);
      }
    }],
    ["wrong unit", (value: ReturnType<typeof unsignedEnabledFixture>) => {
      for (const lane of value.distributedBudgetPolicy.lanes) {
        Reflect.set(lane, "unit", "request");
      }
    }],
  ] as const)(
    "rejects a fully re-signed %s distributed budget lane graph",
    (_label, mutate) => {
      const unsigned = structuredClone(unsignedEnabledFixture());
      mutate(unsigned);
      const signed = signUncheckedUnsignedFixture(
        refreshFixtureBudgetPolicy(unsigned),
      );

      expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
        signed,
        TEST_TRUST_ROOT,
      )).toThrow("Invalid Prediction V2 public release binding");
    },
  );

  it("rejects a different Ed25519 trust root even when the key id is copied", () => {
    const otherPublicKey = Buffer.from(
      "302a300506032b657003210058936604abda112bc94933569c82f8d0cc0ddf92a3f8329f2f448f7f484a594c",
      "hex",
    );
    const otherTrustRoot = {
      ...TEST_TRUST_ROOT,
      publicKeySpkiBase64Url: otherPublicKey.toString("base64url"),
      publicKeySpkiSha256: actualSha256(otherPublicKey),
    };

    expect(() =>
      verifyPredictionV2PublicReleaseV2WithTrustRoot(
        signedEnabledFixture(),
        otherTrustRoot,
      )
    ).toThrow("Invalid Prediction V2 public release binding");
  });

  it("rejects arrays, hidden additions, accessors, and symbol-keyed fields", () => {
    const hidden = cloneFixture();
    Object.defineProperty(hidden.release, "hidden", {
      value: true,
      enumerable: false,
    });
    const accessor = cloneFixture();
    Object.defineProperty(accessor.release, "sourceCommit", {
      enumerable: true,
      get: () => "1".repeat(40),
    });
    const symbolKeyed = cloneFixture();
    Reflect.set(symbolKeyed.release, Symbol("hidden"), true);

    for (const value of [[signedEnabledFixture()], hidden, accessor, symbolKeyed]) {
      expect(() => verifyPredictionV2PublicReleaseV2WithTrustRoot(
        value,
        TEST_TRUST_ROOT,
      )).toThrow(
        "Invalid Prediction V2 public release binding",
      );
    }
  });
});
