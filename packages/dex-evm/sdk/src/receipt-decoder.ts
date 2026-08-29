import {
  decodeEventLog,
  getAddress,
  isHex,
  keccak256,
  parseAbi,
  size,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import { PORTABLE_RECEIPT_MAPPING_STATUS } from "./constants.js";
import { ProgrammableSdkError } from "./errors.js";
import { assertExactKeys, snapshotDataRecord, snapshotDenseArray } from "./input-snapshot.js";
import type { Bytes32 } from "./eip712-candidate.js";

/** Exact events currently emitted by the foundations-only CoreV1 source. */
export const CORE_V1_FOUNDATION_EVENT_ABI = parseAbi([
  "event EngineRevisionRegistered(bytes32 indexed engineRevisionId, address indexed engine, bytes32 runtimeCodeHash)",
  "event MarketCreated(bytes32 indexed marketId, bytes32 indexed engineRevisionId, address indexed creator)",
  "event DomainRevisionCreated(bytes32 indexed domainRevisionId, bytes32 indexed domainId, address indexed creator)",
  "event DomainVaultCreated(bytes32 indexed vaultId, bytes32 indexed domainRevisionId, bytes32 indexed assetProfileId, address nativeAsset, address vault)",
]);

export const RECEIPT_TARGET_DOMAIN_MAPPING_BLOCKER_ID = keccak256(
  stringToHex("DEX_EVM_SPEC_RECEIPT_TARGET_DOMAIN_MAPPING_V1"),
);

/** Binding-local resource limits; these are not portable Receipt semantics. */
export const BINDING_LOCAL_MAX_RECEIPT_TARGETS = 256;
export const BINDING_LOCAL_MAX_DOMAINS_PER_TARGET = 256;

export type FoundationEvent =
  | {
      readonly kind: "engine-revision-registered";
      readonly engineRevisionId: Bytes32;
      readonly engine: Address;
      readonly runtimeCodeHash: Bytes32;
    }
  | {
      readonly kind: "market-created";
      readonly marketId: Bytes32;
      readonly engineRevisionId: Bytes32;
      readonly creator: Address;
    }
  | {
      readonly kind: "domain-revision-created";
      readonly domainRevisionId: Bytes32;
      readonly domainId: Bytes32;
      readonly creator: Address;
    }
  | {
      readonly kind: "domain-vault-created";
      readonly vaultId: Bytes32;
      readonly domainRevisionId: Bytes32;
      readonly assetProfileId: Bytes32;
      readonly nativeAsset: Address;
      readonly vault: Address;
    };

export function decodeCoreV1FoundationEvent(log: {
  readonly topics: readonly [Hex, ...Hex[]];
  readonly data: Hex;
}): FoundationEvent {
  const snapshot = snapshotDataRecord(log, "foundationEventLog");
  assertExactKeys(snapshot, ["topics", "data"], [], "foundationEventLog");
  const topicValues = snapshotDenseArray<unknown>(
    snapshot["topics"],
    "foundationEventLog.topics",
    (length) => {
      if (length === 0) {
        throw new ProgrammableSdkError(
          "FOUNDATION_EVENT_TOPICS_INVALID",
          "foundation event must contain topic0",
        );
      }
    },
  );
  const topics = topicValues.map((topic, index) => bytes32(topic, `foundationEventLog.topics[${index}]`));
  const data = snapshot["data"];
  if (typeof data !== "string" || !isHex(data, { strict: true }) || (data.length - 2) % 2 !== 0) {
    throw new ProgrammableSdkError(
      "FOUNDATION_EVENT_DATA_INVALID",
      "foundation event data must be strict whole-byte hexadecimal data",
    );
  }
  const decoded = decodeEventLog({
    abi: CORE_V1_FOUNDATION_EVENT_ABI,
    topics: topics as [Hex, ...Hex[]],
    data,
    strict: true,
  });
  switch (decoded.eventName) {
    case "EngineRevisionRegistered":
      return Object.freeze({
        kind: "engine-revision-registered",
        engineRevisionId: decoded.args.engineRevisionId,
        engine: getAddress(decoded.args.engine),
        runtimeCodeHash: decoded.args.runtimeCodeHash,
      });
    case "MarketCreated":
      return Object.freeze({
        kind: "market-created",
        marketId: decoded.args.marketId,
        engineRevisionId: decoded.args.engineRevisionId,
        creator: getAddress(decoded.args.creator),
      });
    case "DomainRevisionCreated":
      return Object.freeze({
        kind: "domain-revision-created",
        domainRevisionId: decoded.args.domainRevisionId,
        domainId: decoded.args.domainId,
        creator: getAddress(decoded.args.creator),
      });
    case "DomainVaultCreated":
      return Object.freeze({
        kind: "domain-vault-created",
        vaultId: decoded.args.vaultId,
        domainRevisionId: decoded.args.domainRevisionId,
        assetProfileId: decoded.args.assetProfileId,
        nativeAsset: getAddress(decoded.args.nativeAsset),
        vault: getAddress(decoded.args.vault),
      });
  }
}

export interface BindingLocalReceiptTarget {
  readonly targetIndex: number;
  readonly marketId: Bytes32;
  readonly effectiveEngineRevisionId: Bytes32;
  readonly domainRevisionIds: readonly Bytes32[];
  readonly actionPayloadDigest: Bytes32;
}

export interface BindingLocalReceiptProjection {
  readonly classification: "BINDING_LOCAL_UNNORMALIZED_RECEIPT_V1";
  readonly receiptId: Bytes32;
  readonly coreDeploymentId: Bytes32;
  readonly chainId: number;
  readonly transactionHash: Bytes32;
  readonly blockNumber: bigint;
  readonly blockHash: Bytes32;
  readonly targets: readonly BindingLocalReceiptTarget[];
  readonly portableNormalizedReceiptMapping: {
    readonly status: typeof PORTABLE_RECEIPT_MAPPING_STATUS;
    readonly blockerId: Bytes32;
    readonly reason: "portable-target-domain-mapping-not-frozen";
  };
}

function bytes32(value: unknown, label: string): Bytes32 {
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length !== 66 || size(value) !== 32) {
    throw new ProgrammableSdkError("RECEIPT_BYTES32_INVALID", `${label} must be exactly 32 bytes`);
  }
  return value.toLowerCase() as Bytes32;
}

/**
 * Preserves each ordered Target's own Domain Revision list without flattening
 * it into a receipt-wide set. This is a binding-local projection only: the
 * portable normalized Receipt mapping remains BLOCKED_BY_SPEC.
 */
export function projectBindingLocalReceipt(input: {
  readonly receiptId: Bytes32;
  readonly coreDeploymentId: Bytes32;
  readonly chainId: number;
  readonly transactionHash: Bytes32;
  readonly blockNumber: bigint;
  readonly blockHash: Bytes32;
  readonly targets: readonly BindingLocalReceiptTarget[];
}): BindingLocalReceiptProjection {
  const root = snapshotDataRecord(input, "receipt");
  assertExactKeys(
    root,
    ["receiptId", "coreDeploymentId", "chainId", "transactionHash", "blockNumber", "blockHash", "targets"],
    [],
    "receipt",
  );
  const chainId = root["chainId"];
  const blockNumber = root["blockNumber"];
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new ProgrammableSdkError("RECEIPT_CHAIN_ID_INVALID", "chainId must be a positive safe integer");
  }
  if (typeof blockNumber !== "bigint" || blockNumber < 0n) {
    throw new ProgrammableSdkError("RECEIPT_BLOCK_NUMBER_INVALID", "blockNumber must be a non-negative bigint");
  }
  const targetInputs = snapshotDenseArray(root["targets"], "receipt.targets", (length) => {
    if (length === 0 || length > BINDING_LOCAL_MAX_RECEIPT_TARGETS) {
      throw new ProgrammableSdkError(
        "RECEIPT_TARGET_COUNT_INVALID",
        `receipt must contain 1..${BINDING_LOCAL_MAX_RECEIPT_TARGETS} Targets`,
      );
    }
  });
  const targets = targetInputs.map((targetValue, index): BindingLocalReceiptTarget => {
    const target = snapshotDataRecord(targetValue, `receipt.targets[${index}]`);
    assertExactKeys(
      target,
      ["targetIndex", "marketId", "effectiveEngineRevisionId", "domainRevisionIds", "actionPayloadDigest"],
      [],
      `receipt.targets[${index}]`,
    );
    if (target["targetIndex"] !== index) {
      throw new ProgrammableSdkError(
        "RECEIPT_TARGET_ORDER_INVALID",
        `targetIndex ${String(target["targetIndex"])} does not match ordered position ${index}`,
      );
    }
    const domainInputs = snapshotDenseArray(target["domainRevisionIds"], `receipt.targets[${index}].domainRevisionIds`, (length) => {
      if (length === 0 || length > BINDING_LOCAL_MAX_DOMAINS_PER_TARGET) {
        throw new ProgrammableSdkError(
          "RECEIPT_TARGET_DOMAIN_COUNT_INVALID",
          `target ${index} must contain 1..${BINDING_LOCAL_MAX_DOMAINS_PER_TARGET} Domain Revisions`,
        );
      }
    });
    const domains = domainInputs.map((domain, domainIndex) =>
      bytes32(domain, `targets[${index}].domainRevisionIds[${domainIndex}]`),
    );
    if (new Set(domains).size !== domains.length) {
      throw new ProgrammableSdkError(
        "RECEIPT_TARGET_DOMAIN_DUPLICATE",
        `target ${index} repeats a Domain Revision identity`,
      );
    }
    return Object.freeze({
      targetIndex: index,
      marketId: bytes32(target["marketId"], `targets[${index}].marketId`),
      effectiveEngineRevisionId: bytes32(
        target["effectiveEngineRevisionId"],
        `targets[${index}].effectiveEngineRevisionId`,
      ),
      domainRevisionIds: Object.freeze(domains),
      actionPayloadDigest: bytes32(target["actionPayloadDigest"], `targets[${index}].actionPayloadDigest`),
    });
  });
  return Object.freeze({
    classification: "BINDING_LOCAL_UNNORMALIZED_RECEIPT_V1",
    receiptId: bytes32(root["receiptId"], "receiptId"),
    coreDeploymentId: bytes32(root["coreDeploymentId"], "coreDeploymentId"),
    chainId,
    transactionHash: bytes32(root["transactionHash"], "transactionHash"),
    blockNumber,
    blockHash: bytes32(root["blockHash"], "blockHash"),
    targets: Object.freeze(targets),
    portableNormalizedReceiptMapping: Object.freeze({
      status: PORTABLE_RECEIPT_MAPPING_STATUS,
      blockerId: RECEIPT_TARGET_DOMAIN_MAPPING_BLOCKER_ID,
      reason: "portable-target-domain-mapping-not-frozen",
    }),
  });
}
