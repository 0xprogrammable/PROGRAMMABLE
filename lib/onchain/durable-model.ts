import {
  isAddress,
  isHex,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";

import appDeployments from "../../contracts/config/app-deployments.v1.json";
import deepV3Manifest from "../../contracts/deployments/mainnet-deep-full-range-v3.json";
import {
  getVerifiedDeepRelease,
  getVerifiedDeepV2Release,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";
import {
  DEEP_V3_INTERNAL_RELEASE,
  DEEP_V3_RELEASE_VERSION,
  DEEP_V3_RUNTIME_FIELDS,
  DEEP_V3_SOURCE_COMMITMENT,
  resolveVerifiedDeepV3ReadRelease,
  type DeepV3RuntimeField,
} from "./deep-v3-read-model";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "./types";

const DURABLE_INDEX_PATH =
  "indexes/mainnet-classic-v2/explore-model.json";
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1_000;
const DEFAULT_READ_TIMEOUT_MS = 5_000;
const MAXIMUM_DURABLE_INDEX_BYTES = 4_000_000;

type DurableExplorePayload = {
  generatedAt: string;
  deployment: {
    chainId: number;
    releaseVersion: string;
    launcher: Address;
    feeHook: Address;
  };
  model: Extract<ExploreReadModel, { status: "ready" }>;
};

export type DeepExploreReleaseBinding = {
  releaseVersion: "deep-full-range-v1";
  releaseCommit: string;
  sourceCommitment: Hex;
  lifecycleEvidenceHash: Hex;
  launcher: Address;
  feeHook: Address;
  growthVaultFactory: Address;
  automation: Address;
  deploymentBlock: number;
};

export type DeepV2ExploreReleaseBinding = {
  releaseVersion: "deep-full-range-v2";
  releaseCommit: string;
  sourceCommitment: Hex;
  lifecycleEvidenceHash: Hex;
  launcher: Address;
  feeHook: Address;
  growthVaultFactory: Address;
  growthVaultImplementation: Address;
  automation: Address;
  deploymentBlock: number;
  runtimeCodeHashes: {
    launcher: Hex;
    hookFactory: Hex;
    feeHook: Hex;
    feeSplitVaultFactory: Hex;
    rangeSourceFactory: Hex;
    growthVaultFactory: Hex;
    growthVaultImplementation: Hex;
    automation: Hex;
    positionPlanner: Hex;
    positionForwarderFactory: Hex;
  };
};

export type DeepV3ExploreReleaseBinding = {
  releaseVersion: typeof DEEP_V3_RELEASE_VERSION;
  internalContractRelease: typeof DEEP_V3_INTERNAL_RELEASE;
  releaseCommit: string;
  sourceCommitment: Hex;
  lifecycleEvidenceHash: Hex;
  startBlock: number;
  addresses: Record<DeepV3RuntimeField, Address> & {
    treasury: Address;
    lockedPositionFactory: Address;
  };
  runtimeCodeHashes: Record<DeepV3RuntimeField, Hex> & {
    lockedPositionFactory: Hex;
  };
  deploymentBlocks: Record<DeepV3RuntimeField, number>;
};

type DurableExplorePayloadV2 = DurableExplorePayload & {
  launchModels: {
    deep: DeepExploreReleaseBinding | null;
  };
};

type DurableExplorePayloadV3 = DurableExplorePayload & {
  launchModels: {
    deepV1: DeepExploreReleaseBinding | null;
    deepV2: DeepV2ExploreReleaseBinding | null;
  };
};

type DurableExplorePayloadV4 = DurableExplorePayload & {
  launchModels: {
    deepV1: DeepExploreReleaseBinding | null;
    deepV2: DeepV2ExploreReleaseBinding | null;
    deepV3: DeepV3ExploreReleaseBinding | null;
  };
};

type DurableExploreEnvelopeV1 = {
  schemaVersion: "programmable-durable-index-v1";
  contentHash: Hex;
  payload: DurableExplorePayload;
};

type DurableExploreEnvelopeV2 = {
  schemaVersion: "programmable-durable-index-v2";
  contentHash: Hex;
  payload: DurableExplorePayloadV2;
};

type DurableExploreEnvelopeV3 = {
  schemaVersion: "programmable-durable-index-v3";
  contentHash: Hex;
  payload: DurableExplorePayloadV3;
};

type DurableExploreEnvelopeV4 = {
  schemaVersion: "programmable-durable-index-v4";
  contentHash: Hex;
  payload: DurableExplorePayloadV4;
};

type DurableExploreEnvelope =
  | DurableExploreEnvelopeV1
  | DurableExploreEnvelopeV2
  | DurableExploreEnvelopeV3
  | DurableExploreEnvelopeV4;

export type DurableExploreRead =
  | {
      status: "ready";
      envelope: DurableExploreEnvelope;
      ageMs: number;
    }
  | {
      status: "unavailable";
      reason: "stale";
      detail: string;
      envelope: DurableExploreEnvelope;
      ageMs: number;
    }
  | {
      status: "unavailable";
      reason: "not-configured" | "missing" | "invalid";
      detail: string;
    };

export type DurableExploreReadOptions = Readonly<{
  maxAgeMs?: number;
  signal?: AbortSignal;
  /** Absolute Unix epoch deadline, in milliseconds. */
  deadlineMs?: number;
  /** Testable lower ceiling; callers cannot raise the production cap. */
  maximumBytes?: number;
}>;

export function selectFreshDurableExploreModel(
  read: DurableExploreRead,
): Extract<ExploreReadModel, { status: "ready" }> | null {
  return read.status === "ready" ? read.envelope.payload.model : null;
}

function contentHash(payload: unknown) {
  return keccak256(toBytes(JSON.stringify(payload)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function matchesDeepReleaseBinding(
  value: unknown,
  expected: DeepExploreReleaseBinding | null,
) {
  if (expected === null) return value === null;
  if (!isRecord(value)) return false;
  return (
    value.releaseVersion === expected.releaseVersion &&
    value.releaseCommit === expected.releaseCommit &&
    sameValue(value.sourceCommitment, expected.sourceCommitment) &&
    sameValue(
      value.lifecycleEvidenceHash,
      expected.lifecycleEvidenceHash,
    ) &&
    sameValue(value.launcher, expected.launcher) &&
    sameValue(value.feeHook, expected.feeHook) &&
    sameValue(value.growthVaultFactory, expected.growthVaultFactory) &&
    sameValue(value.automation, expected.automation) &&
    value.deploymentBlock === expected.deploymentBlock
  );
}

function matchesRuntimeHashes(
  value: unknown,
  expected: DeepV2ExploreReleaseBinding["runtimeCodeHashes"],
) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(expected) as Array<
    keyof DeepV2ExploreReleaseBinding["runtimeCodeHashes"]
  >;
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => sameValue(value[key], expected[key]))
  );
}

function matchesDeepV2ReleaseBinding(
  value: unknown,
  expected: DeepV2ExploreReleaseBinding | null,
) {
  if (expected === null) return value === null;
  if (!isRecord(value)) return false;
  return (
    value.releaseVersion === expected.releaseVersion &&
    value.releaseCommit === expected.releaseCommit &&
    sameValue(value.sourceCommitment, expected.sourceCommitment) &&
    sameValue(
      value.lifecycleEvidenceHash,
      expected.lifecycleEvidenceHash,
    ) &&
    sameValue(value.launcher, expected.launcher) &&
    sameValue(value.feeHook, expected.feeHook) &&
    sameValue(value.growthVaultFactory, expected.growthVaultFactory) &&
    sameValue(
      value.growthVaultImplementation,
      expected.growthVaultImplementation,
    ) &&
    sameValue(value.automation, expected.automation) &&
    value.deploymentBlock === expected.deploymentBlock &&
    matchesRuntimeHashes(value.runtimeCodeHashes, expected.runtimeCodeHashes)
  );
}

function matchesDeepV3ReleaseBinding(
  value: unknown,
  expected: DeepV3ExploreReleaseBinding | null,
) {
  if (expected === null) return value === null;
  if (!isRecord(value)) return false;
  const addresses = isRecord(value.addresses) ? value.addresses : null;
  const runtimeCodeHashes = isRecord(value.runtimeCodeHashes)
    ? value.runtimeCodeHashes
    : null;
  const deploymentBlocks = isRecord(value.deploymentBlocks)
    ? value.deploymentBlocks
    : null;
  if (!addresses || !runtimeCodeHashes || !deploymentBlocks) return false;
  const runtimeKeys = [...DEEP_V3_RUNTIME_FIELDS];
  const sortedRuntimeKeys = [...runtimeKeys].sort();
  return (
    value.releaseVersion === expected.releaseVersion &&
    value.internalContractRelease === expected.internalContractRelease &&
    value.releaseCommit === expected.releaseCommit &&
    sameValue(value.sourceCommitment, expected.sourceCommitment) &&
    sameValue(
      value.lifecycleEvidenceHash,
      expected.lifecycleEvidenceHash,
    ) &&
    value.startBlock === expected.startBlock &&
    Object.keys(addresses).sort().join(",") ===
      [...runtimeKeys, "treasury", "lockedPositionFactory"]
        .sort()
        .join(",") &&
    Object.keys(runtimeCodeHashes).sort().join(",") ===
      [...runtimeKeys, "lockedPositionFactory"].sort().join(",") &&
    Object.keys(deploymentBlocks).sort().join(",") ===
      sortedRuntimeKeys.join(",") &&
    DEEP_V3_RUNTIME_FIELDS.every(
      (field) =>
        sameValue(addresses[field], expected.addresses[field]) &&
        sameValue(
          runtimeCodeHashes[field],
          expected.runtimeCodeHashes[field],
        ) &&
        deploymentBlocks[field] === expected.deploymentBlocks[field],
    ) &&
    sameValue(addresses.treasury, expected.addresses.treasury) &&
    sameValue(
      addresses.lockedPositionFactory,
      expected.addresses.lockedPositionFactory,
    ) &&
    sameValue(
      runtimeCodeHashes.lockedPositionFactory,
      expected.runtimeCodeHashes.lockedPositionFactory,
    )
  );
}

function validBytes32(value: unknown) {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function validDeepV2TokenRecord(
  value: unknown,
  expected: DeepV2ExploreReleaseBinding | null,
) {
  if (!isRecord(value)) return false;
  const claimsV2 =
    value.deepReleaseVersion === "deep-full-range-v2" ||
    value.deepV2Provenance !== undefined;
  if (!claimsV2) return true;
  if (
    expected === null ||
    value.launchModel !== "deep" ||
    value.deepReleaseVersion !== "deep-full-range-v2" ||
    !isRecord(value.deepV2Provenance)
  ) {
    return false;
  }
  const proof = value.deepV2Provenance;
  return (
    proof.deepReleaseVersion === "deep-full-range-v2" &&
    sameValue(proof.launcher, expected.launcher) &&
    typeof proof.creator === "string" &&
    isAddress(proof.creator) &&
    sameValue(proof.creator, value.creatorAddress) &&
    typeof proof.tokenAddress === "string" &&
    isAddress(proof.tokenAddress) &&
    sameValue(proof.tokenAddress, value.tokenAddress) &&
    typeof proof.vaultAddress === "string" &&
    isAddress(proof.vaultAddress) &&
    sameValue(proof.vaultAddress, value.growthVaultAddress) &&
    typeof proof.hookAddress === "string" &&
    isAddress(proof.hookAddress) &&
    sameValue(proof.hookAddress, expected.feeHook) &&
    sameValue(proof.hookAddress, value.hookAddress) &&
    validBytes32(proof.poolId) &&
    sameValue(proof.poolId, value.poolId) &&
    validBytes32(proof.launchHash) &&
    sameValue(proof.launchHash, value.launchHash) &&
    validBytes32(proof.vaultConfigurationHash) &&
    typeof proof.blockNumber === "string" &&
    /^\d+$/.test(proof.blockNumber) &&
    BigInt(proof.blockNumber) >= BigInt(expected.deploymentBlock) &&
    proof.blockNumber === value.launchBlockNumber &&
    validBytes32(proof.blockHash) &&
    validBytes32(proof.transactionHash) &&
    sameValue(proof.transactionHash, value.launchTransactionHash) &&
    typeof proof.logIndex === "number" &&
    Number.isSafeInteger(proof.logIndex) &&
    proof.logIndex >= 0 &&
    proof.logIndex === value.launchLogIndex
  );
}

function validDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value);
}

function validNonNegativeInteger(value: unknown) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function zeroOrMissing(value: unknown) {
  return value === undefined || value === null || value === 0 || value === "0";
}

function validDeepV3TokenRecord(
  value: unknown,
  expected: DeepV3ExploreReleaseBinding | null,
) {
  if (!isRecord(value)) return false;
  const claimsV3 =
    value.deepReleaseVersion === DEEP_V3_RELEASE_VERSION ||
    value.deepV3Provenance !== undefined;
  if (!claimsV3) return true;
  if (
    expected === null ||
    value.launchModel !== "deep" ||
    value.deepReleaseVersion !== DEEP_V3_RELEASE_VERSION ||
    value.deepV2Provenance !== undefined ||
    !isRecord(value.deepV3Provenance)
  ) {
    return false;
  }
  const proof = value.deepV3Provenance;
  return (
    proof.deepReleaseVersion === DEEP_V3_RELEASE_VERSION &&
    proof.launchModel === "deep" &&
    sameValue(proof.launcher, expected.addresses.launcher) &&
    typeof proof.creator === "string" &&
    isAddress(proof.creator) &&
    sameValue(proof.creator, value.creatorAddress) &&
    typeof proof.tokenAddress === "string" &&
    isAddress(proof.tokenAddress) &&
    sameValue(proof.tokenAddress, value.tokenAddress) &&
    typeof proof.vaultAddress === "string" &&
    isAddress(proof.vaultAddress) &&
    sameValue(proof.vaultAddress, value.growthVaultAddress) &&
    typeof proof.hookAddress === "string" &&
    isAddress(proof.hookAddress) &&
    sameValue(proof.hookAddress, expected.addresses.feeHook) &&
    sameValue(proof.hookAddress, value.hookAddress) &&
    typeof proof.positionRecipient === "string" &&
    isAddress(proof.positionRecipient) &&
    sameValue(proof.positionRecipient, value.positionRecipient) &&
    validDecimalString(proof.positionTokenId) &&
    proof.positionTokenId === value.positionTokenId &&
    validBytes32(proof.poolId) &&
    sameValue(proof.poolId, value.poolId) &&
    validBytes32(proof.launchHash) &&
    sameValue(proof.launchHash, value.launchHash) &&
    validBytes32(proof.vaultConfigurationHash) &&
    validDecimalString(proof.blockNumber) &&
    BigInt(proof.blockNumber) >= BigInt(expected.startBlock) &&
    proof.blockNumber === value.launchBlockNumber &&
    validBytes32(proof.blockHash) &&
    validBytes32(proof.transactionHash) &&
    sameValue(proof.transactionHash, value.launchTransactionHash) &&
    validNonNegativeInteger(proof.transactionIndex) &&
    proof.transactionIndex === value.launchTransactionIndex &&
    validNonNegativeInteger(proof.logIndex) &&
    proof.logIndex === value.launchLogIndex &&
    value.buyHookFeeBps === 100 &&
    value.sellHookFeeBps === 100 &&
    value.growthFeeBps === 90 &&
    value.programmableFeeBps === 10 &&
    value.launcherFeeBps === 10 &&
    value.transferTaxBps === 0 &&
    value.lpFeePips === 0 &&
    zeroOrMissing(value.creatorFeeBps) &&
    zeroOrMissing(value.buyCreatorFeeBps) &&
    zeroOrMissing(value.sellCreatorFeeBps) &&
    zeroOrMissing(value.creatorFeesGeneratedWei) &&
    zeroOrMissing(value.creatorFeesAccruedWei) &&
    validDecimalString(value.growthFeesGeneratedWei) &&
    validDecimalString(value.growthFeesAccruedWei)
  );
}

function validDeepTokenReleaseRecord(
  value: unknown,
  expectedV1: DeepExploreReleaseBinding | null,
  expectedV2: DeepV2ExploreReleaseBinding | null,
  expectedV3: DeepV3ExploreReleaseBinding | null,
) {
  if (!isRecord(value)) return false;
  if (value.launchModel !== "deep") {
    return (
      value.deepReleaseVersion === undefined &&
      value.deepV2Provenance === undefined &&
      value.deepV3Provenance === undefined
    );
  }
  if (value.deepReleaseVersion === "deep-full-range-v1") {
    return (
      expectedV1 !== null &&
      value.deepV2Provenance === undefined &&
      value.deepV3Provenance === undefined
    );
  }
  if (value.deepReleaseVersion === "deep-full-range-v2") {
    return expectedV2 !== null && value.deepV3Provenance === undefined;
  }
  if (value.deepReleaseVersion === DEEP_V3_RELEASE_VERSION) {
    return expectedV3 !== null && value.deepV2Provenance === undefined;
  }
  return false;
}

export function resolveDeepExploreReleaseBinding(
  deployment: ReadyOnchainDeployment,
): DeepExploreReleaseBinding | null {
  const manifest = appDeployments[
    deployment.environment
  ] as unknown as LaunchModelReleaseManifest;
  const release = getVerifiedDeepRelease(manifest, deployment.chainId);
  if (!release) return null;
  return {
    releaseVersion: "deep-full-range-v1",
    releaseCommit: release.releaseCommit as string,
    sourceCommitment: release.sourceCommitment as Hex,
    lifecycleEvidenceHash: release.lifecycleEvidenceHash as Hex,
    launcher: release.launcher as Address,
    feeHook: release.feeHook as Address,
    growthVaultFactory: release.growthVaultFactory as Address,
    automation: release.automation as Address,
    deploymentBlock: release.deploymentBlock as number,
  };
}

export function resolveDeepV2ExploreReleaseBinding(
  deployment: ReadyOnchainDeployment,
): DeepV2ExploreReleaseBinding | null {
  const manifest = appDeployments[
    deployment.environment
  ] as unknown as LaunchModelReleaseManifest;
  const release = getVerifiedDeepV2Release(manifest, deployment.chainId);
  const hashes = release?.runtimeCodeHashes;
  if (!release || !hashes) return null;
  return {
    releaseVersion: "deep-full-range-v2",
    releaseCommit: release.releaseCommit as string,
    sourceCommitment: release.sourceCommitment as Hex,
    lifecycleEvidenceHash: release.lifecycleEvidenceHash as Hex,
    launcher: release.launcher as Address,
    feeHook: release.feeHook as Address,
    growthVaultFactory: release.growthVaultFactory as Address,
    growthVaultImplementation: release.growthVaultImplementation as Address,
    automation: release.automation as Address,
    deploymentBlock: release.deploymentBlock as number,
    runtimeCodeHashes: {
      launcher: hashes.launcher as Hex,
      hookFactory: hashes.hookFactory as Hex,
      feeHook: hashes.feeHook as Hex,
      feeSplitVaultFactory: hashes.feeSplitVaultFactory as Hex,
      rangeSourceFactory: hashes.rangeSourceFactory as Hex,
      growthVaultFactory: hashes.growthVaultFactory as Hex,
      growthVaultImplementation: hashes.growthVaultImplementation as Hex,
      automation: hashes.automation as Hex,
      positionPlanner: hashes.positionPlanner as Hex,
      positionForwarderFactory: hashes.positionForwarderFactory as Hex,
    },
  };
}

export function resolveDeepV3ExploreReleaseBinding(
  deployment: ReadyOnchainDeployment,
): DeepV3ExploreReleaseBinding | null {
  const release = resolveVerifiedDeepV3ReadRelease(
    deepV3Manifest,
    deployment.chainId,
  );
  const manifest = deepV3Manifest as unknown as Record<string, unknown>;
  const lifecycle = isRecord(manifest.lifecycleEvidence)
    ? manifest.lifecycleEvidence
    : null;
  if (
    !release ||
    typeof manifest.releaseCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(manifest.releaseCommit) ||
    !lifecycle ||
    !validBytes32(lifecycle.evidenceHash)
  ) {
    return null;
  }
  return {
    releaseVersion: DEEP_V3_RELEASE_VERSION,
    internalContractRelease: DEEP_V3_INTERNAL_RELEASE,
    releaseCommit: manifest.releaseCommit,
    sourceCommitment: DEEP_V3_SOURCE_COMMITMENT,
    lifecycleEvidenceHash: lifecycle.evidenceHash as Hex,
    startBlock: release.startBlock,
    addresses: {
      ...(Object.fromEntries(
        DEEP_V3_RUNTIME_FIELDS.map((field) => [
          field,
          release.addresses[field],
        ]),
      ) as Record<DeepV3RuntimeField, Address>),
      treasury: release.addresses.treasury,
      lockedPositionFactory: release.addresses.lockedPositionFactory,
    },
    runtimeCodeHashes: {
      ...(Object.fromEntries(
        DEEP_V3_RUNTIME_FIELDS.map((field) => [
          field,
          release.runtimeCodeHashes[field],
        ]),
      ) as Record<DeepV3RuntimeField, Hex>),
      lockedPositionFactory:
        release.runtimeCodeHashes.lockedPositionFactory,
    },
    deploymentBlocks: Object.fromEntries(
      DEEP_V3_RUNTIME_FIELDS.map((field) => [
        field,
        release.deploymentBlocks[field],
      ]),
    ) as Record<DeepV3RuntimeField, number>,
  };
}

export function validateDurableExploreEnvelope(
  value: unknown,
  deployment: ReadyOnchainDeployment,
  maxAgeMs: number,
  expectedDeepRelease = resolveDeepExploreReleaseBinding(deployment),
  expectedDeepV2Release = resolveDeepV2ExploreReleaseBinding(deployment),
  expectedDeepV3Release = resolveDeepV3ExploreReleaseBinding(deployment),
): DurableExploreRead {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index envelope is malformed",
    };
  }
  const schemaVersion = value.schemaVersion;
  if (
    schemaVersion !== "programmable-durable-index-v1" &&
    schemaVersion !== "programmable-durable-index-v2" &&
    schemaVersion !== "programmable-durable-index-v3" &&
    schemaVersion !== "programmable-durable-index-v4"
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index schema is not supported",
    };
  }
  const payload = value.payload;
  const generatedAt =
    typeof payload.generatedAt === "string"
      ? Date.parse(payload.generatedAt)
      : Number.NaN;
  const ageMs = Date.now() - generatedAt;
  if (
    typeof value.contentHash !== "string" ||
    contentHash(payload).toLowerCase() !==
      value.contentHash.toLowerCase() ||
    !Number.isFinite(generatedAt) ||
    ageMs < -60_000 ||
    !isRecord(payload.deployment) ||
    !isRecord(payload.model) ||
    !isRecord(payload.model.snapshot)
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index does not match the verified deployment",
    };
  }
  if (
    payload.deployment.chainId !== deployment.chainId ||
    payload.deployment.releaseVersion !== deployment.releaseVersion ||
    !sameValue(payload.deployment.launcher, deployment.launcher) ||
    !sameValue(payload.deployment.feeHook, deployment.feeHook) ||
    payload.model.status !== "ready" ||
    payload.model.snapshot.chainId !== deployment.chainId ||
    typeof payload.model.snapshot.blockNumber !== "string" ||
    typeof payload.model.snapshot.blockHash !== "string" ||
    !Array.isArray(payload.model.tokens) ||
    !Array.isArray(payload.model.creatorClaims)
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail: "The durable index does not match the verified deployment",
    };
  }
  if (schemaVersion === "programmable-durable-index-v1") {
    if (
      expectedDeepRelease !== null ||
      expectedDeepV2Release !== null ||
      expectedDeepV3Release !== null
    ) {
      return {
        status: "unavailable",
        reason: "invalid",
        detail:
          "The durable index predates the verified Deep release binding",
      };
    }
  } else if (schemaVersion === "programmable-durable-index-v2") {
    if (
      expectedDeepV2Release !== null ||
      expectedDeepV3Release !== null ||
      !isRecord(payload.launchModels) ||
      !matchesDeepReleaseBinding(
        payload.launchModels.deep,
        expectedDeepRelease,
      )
    ) {
      return {
        status: "unavailable",
        reason: "invalid",
        detail:
          "The durable index Deep release binding does not match the verified lifecycle",
      };
    }
  } else if (schemaVersion === "programmable-durable-index-v3") {
    if (
      expectedDeepV3Release !== null ||
      !isRecord(payload.launchModels) ||
      !matchesDeepReleaseBinding(
        payload.launchModels.deepV1,
        expectedDeepRelease,
      ) ||
      !matchesDeepV2ReleaseBinding(
        payload.launchModels.deepV2,
        expectedDeepV2Release,
      )
    ) {
      return {
        status: "unavailable",
        reason: "invalid",
        detail:
          "The durable index Deep release bindings do not match the verified lifecycle",
      };
    }
  } else if (
    !isRecord(payload.launchModels) ||
    !matchesDeepReleaseBinding(
      payload.launchModels.deepV1,
      expectedDeepRelease,
    ) ||
    !matchesDeepV2ReleaseBinding(
      payload.launchModels.deepV2,
      expectedDeepV2Release,
    ) ||
    !matchesDeepV3ReleaseBinding(
      payload.launchModels.deepV3,
      expectedDeepV3Release,
    )
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail:
        "The durable index Deep release bindings do not match the verified lifecycle",
    };
  }
  if (
    !(payload.model.tokens as unknown[]).every((token) =>
      validDeepTokenReleaseRecord(
        token,
        expectedDeepRelease,
        expectedDeepV2Release,
        expectedDeepV3Release,
      ),
    )
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail:
        "The durable index contains a Deep token outside its verified release",
    };
  }
  if (
    !(payload.model.tokens as unknown[]).every((token) =>
      validDeepV2TokenRecord(token, expectedDeepV2Release),
    )
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail:
        "The durable index contains a Deep V2 token without verified launch provenance",
    };
  }
  if (
    !(payload.model.tokens as unknown[]).every((token) =>
      validDeepV3TokenRecord(token, expectedDeepV3Release),
    )
  ) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail:
        "The durable index contains a Deep V3 token without verified launch provenance",
    };
  }
  if (ageMs > maxAgeMs) {
    return {
      status: "unavailable",
      reason: "stale",
      detail: `The durable index is ${Math.floor(ageMs / 1_000)} seconds old`,
      envelope: value as unknown as DurableExploreEnvelope,
      ageMs,
    };
  }
  return {
    status: "ready",
    envelope: value as unknown as DurableExploreEnvelope,
    ageMs,
  };
}

export function shouldReplaceDurableSnapshot(
  current: { blockNumber: string; blockHash: Hex },
  incoming: { blockNumber: string; blockHash: Hex },
) {
  const currentBlock = BigInt(current.blockNumber);
  const incomingBlock = BigInt(incoming.blockNumber);
  return (
    incomingBlock > currentBlock ||
    (incomingBlock === currentBlock &&
      incoming.blockHash.toLowerCase() !== current.blockHash.toLowerCase())
  );
}

function durableReadOptions(
  value: number | DurableExploreReadOptions | undefined,
) {
  if (typeof value === "number") {
    return {
      maxAgeMs: value,
      maximumBytes: MAXIMUM_DURABLE_INDEX_BYTES,
    } as const;
  }
  const maximumBytes = value?.maximumBytes ?? MAXIMUM_DURABLE_INDEX_BYTES;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes <= 0 ||
    maximumBytes > MAXIMUM_DURABLE_INDEX_BYTES
  ) {
    throw new Error("Durable index byte limit is invalid");
  }
  return {
    maxAgeMs: value?.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    maximumBytes,
    signal: value?.signal,
    deadlineMs: value?.deadlineMs,
  } as const;
}

function createDurableReadAbortScope(options: Readonly<{
  signal?: AbortSignal;
  deadlineMs?: number;
}>) {
  const now = Date.now();
  const requestedDeadline = options.deadlineMs ??
    now + DEFAULT_READ_TIMEOUT_MS;
  if (!Number.isFinite(requestedDeadline)) {
    throw new Error("Durable index deadline is invalid");
  }
  const deadlineMs = Math.min(
    requestedDeadline,
    now + DEFAULT_READ_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const abortFromCaller = () => {
    if (!controller.signal.aborted) {
      controller.abort(
        options.signal?.reason ?? new Error("Durable index read aborted"),
      );
    }
  };
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();

  const abortAtDeadline = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("Durable index read deadline exceeded"));
    }
  };
  const remainingMs = deadlineMs - Date.now();
  const timer = remainingMs <= 0
    ? undefined
    : setTimeout(abortAtDeadline, remainingMs);
  if (remainingMs <= 0) abortAtDeadline();

  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortFromCaller);
    },
  } as const;
}

function rejectWhenAborted<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    }).catch(() => undefined);
  });
}

function parseDeclaredLength(value: string | null) {
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error("Durable index Content-Length is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Durable index Content-Length is unsafe");
  }
  return parsed;
}

function cancelDurableStream(
  stream: ReadableStream<Uint8Array>,
  reason: unknown,
) {
  void stream.cancel(reason).catch(() => undefined);
}

async function readBoundedDurableStream(
  stream: ReadableStream<Uint8Array>,
  input: Readonly<{
    declaredSize: number;
    declaredContentLength: number | null;
    maximumBytes: number;
    signal: AbortSignal;
  }>,
) {
  if (
    !Number.isSafeInteger(input.declaredSize) ||
    input.declaredSize < 0 ||
    input.declaredSize > input.maximumBytes ||
    (input.declaredContentLength !== null &&
      input.declaredContentLength > input.maximumBytes)
  ) {
    cancelDurableStream(stream, "Durable index declaration exceeds limit");
    throw new Error("Durable index declaration exceeds its byte limit");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let totalBytes = 0;
  const abortReader = () => {
    void reader.cancel(input.signal.reason).catch(() => undefined);
  };
  input.signal.addEventListener("abort", abortReader, { once: true });
  try {
    while (true) {
      const next = await rejectWhenAborted(reader.read(), input.signal);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        void reader.cancel("Durable index chunk is invalid").catch(() => undefined);
        throw new Error("Durable index stream contains an invalid chunk");
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > input.maximumBytes) {
        void reader.cancel("Durable index stream exceeds limit").catch(() => undefined);
        throw new Error("Durable index stream exceeds its byte limit");
      }
      chunks.push(decoder.decode(next.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    input.signal.removeEventListener("abort", abortReader);
    try {
      reader.releaseLock();
    } catch {
      // An aborted pending read is already owned by reader.cancel above.
    }
  }
}

export async function readDurableExploreModel(
  deployment: ReadyOnchainDeployment,
  maxAgeOrOptions: number | DurableExploreReadOptions = DEFAULT_MAX_AGE_MS,
): Promise<DurableExploreRead> {
  const blobToken = resolveDurableExploreBlobToken();
  if (!blobToken) {
    return {
      status: "unavailable",
      reason: "not-configured",
      detail: "Persistent index storage is not configured",
    };
  }

  let abortScope: ReturnType<typeof createDurableReadAbortScope> | undefined;
  try {
    const options = durableReadOptions(maxAgeOrOptions);
    abortScope = createDurableReadAbortScope(options);
    const { get } = await import("@vercel/blob");
    const result = await rejectWhenAborted(
      get(DURABLE_INDEX_PATH, {
        access: "private",
        token: blobToken,
        useCache: false,
        abortSignal: abortScope.signal,
      }),
      abortScope.signal,
    );
    if (!result || result.statusCode !== 200 || !result.stream) {
      return {
        status: "unavailable",
        reason: "missing",
        detail: "No durable index snapshot exists",
      };
    }
    const text = await readBoundedDurableStream(result.stream, {
      declaredSize: result.blob.size,
      declaredContentLength: parseDeclaredLength(
        result.headers.get("content-length"),
      ),
      maximumBytes: options.maximumBytes,
      signal: abortScope.signal,
    });
    return validateDurableExploreEnvelope(
      JSON.parse(text),
      deployment,
      options.maxAgeMs,
    );
  } catch (error) {
    return {
      status: "unavailable",
      reason: "invalid",
      detail:
        error instanceof Error
          ? error.message
          : "The durable index could not be read",
    };
  } finally {
    abortScope?.dispose();
  }
}

export async function writeDurableExploreModel(
  deployment: ReadyOnchainDeployment,
  model: ExploreReadModel,
) {
  if (model.status !== "ready") {
    throw new Error("Only a verified ready model can be persisted");
  }
  const blobToken = resolveDurableExploreBlobToken();
  if (!blobToken) {
    throw new Error("Persistent index storage is not configured");
  }
  const deepRelease = resolveDeepExploreReleaseBinding(deployment);
  const deepV2Release = resolveDeepV2ExploreReleaseBinding(deployment);
  const deepV3Release = resolveDeepV3ExploreReleaseBinding(deployment);

  const existing = await readDurableExploreModel(
    deployment,
    Number.MAX_SAFE_INTEGER,
  );
  if (
    existing.status === "ready" &&
    !shouldReplaceDurableSnapshot(
      existing.envelope.payload.model.snapshot,
      model.snapshot,
    )
  ) {
    return {
      updated: false,
      blockNumber: existing.envelope.payload.model.snapshot.blockNumber,
      tokenCount: existing.envelope.payload.model.tokens.length,
      deepReleaseVersion: deepRelease?.releaseVersion ?? null,
      deepV2ReleaseVersion: deepV2Release?.releaseVersion ?? null,
      deepV3ReleaseVersion: deepV3Release?.releaseVersion ?? null,
      deepLifecycleEvidenceHash:
        deepRelease?.lifecycleEvidenceHash ?? null,
      deepV2LifecycleEvidenceHash:
        deepV2Release?.lifecycleEvidenceHash ?? null,
      deepV3LifecycleEvidenceHash:
        deepV3Release?.lifecycleEvidenceHash ?? null,
    };
  }

  const payload: DurableExplorePayloadV4 = {
    generatedAt: new Date().toISOString(),
    deployment: {
      chainId: deployment.chainId,
      releaseVersion: deployment.releaseVersion,
      launcher: deployment.launcher,
      feeHook: deployment.feeHook,
    },
    launchModels: {
      deepV1: deepRelease,
      deepV2: deepV2Release,
      deepV3: deepV3Release,
    },
    model,
  };
  const envelope: DurableExploreEnvelopeV4 = {
    schemaVersion: "programmable-durable-index-v4",
    contentHash: contentHash(payload),
    payload,
  };
  const { put } = await import("@vercel/blob");
  await put(DURABLE_INDEX_PATH, JSON.stringify(envelope), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    token: blobToken,
  });
  return {
    updated: true,
    blockNumber: model.snapshot.blockNumber,
    tokenCount: model.tokens.length,
    deepReleaseVersion: deepRelease?.releaseVersion ?? null,
    deepV2ReleaseVersion: deepV2Release?.releaseVersion ?? null,
    deepV3ReleaseVersion: deepV3Release?.releaseVersion ?? null,
    deepLifecycleEvidenceHash:
      deepRelease?.lifecycleEvidenceHash ?? null,
    deepV2LifecycleEvidenceHash:
      deepV2Release?.lifecycleEvidenceHash ?? null,
    deepV3LifecycleEvidenceHash:
      deepV3Release?.lifecycleEvidenceHash ?? null,
  };
}

export function resolveDurableExploreBlobToken() {
  return (
    process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() ||
    process.env.BLOB_READ_WRITE_TOKEN?.trim()
  );
}
