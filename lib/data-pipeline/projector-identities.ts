import "server-only";

import {
  canonicalAddress,
  canonicalBytes32,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import { validationError } from "./errors";
import { canonicalUint32DecimalText } from "./provider-evidence";
import {
  canonicalImmutableReferences,
  type ImmutableReference,
} from "./runtime-bytecode";
import { getDataPipelineReleaseBinding } from "./release-binding.server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CANDIDATE_ID_PATTERN =
  /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(0|[1-9]\d*)$/u;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const DYNAMIC_FACTORY_CONTRACTS = Object.freeze({
  ClassicV3RewardVault: "ClassicV3RewardVaultFactory",
  StockV1RewardVault: "StockV1RewardVaultFactory",
  StockV2V3RewardVault: "StockV2V3RewardVaultFactory",
} as const);

export type VerifiedDynamicSourceLineage = Readonly<{
  attestationId: string;
  sourceAddress: HexAddress;
  contractName: keyof typeof DYNAMIC_FACTORY_CONTRACTS;
  model: "classic" | "stock-paired";
  releaseVersion:
    | "classic-v3"
    | "stock-paired-v1"
    | "stock-paired-v2"
    | "stock-paired-v3";
  factoryAddress: HexAddress;
  factoryContractName: (typeof DYNAMIC_FACTORY_CONTRACTS)[keyof typeof DYNAMIC_FACTORY_CONTRACTS];
  parentOccurrenceId?: string;
  factoryCandidateId?: string;
  factoryBlockNumber: string;
  factoryBlockGlobalLogIndex?: string;
  activationCandidateId?: string;
  activationOccurrenceId?: string;
  activationBlockNumber?: string;
  activationBlockHash?: HexBytes32;
  activationBlockGlobalLogIndex?: string;
  expectedExactRuntimeCodeHash: HexBytes32;
  expectedNormalizedRuntimeCodeHash: HexBytes32;
  expectedImmutableReferencesCommitment: HexBytes32;
  expectedRuntimeByteLength: string;
  immutableReferences: readonly ImmutableReference[];
}>;

function dynamicLineageError(): never {
  throw validationError("rpc", "dynamic-source-lineage");
}

export function canonicalDynamicSourceLineage(
  value: VerifiedDynamicSourceLineage,
): VerifiedDynamicSourceLineage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return dynamicLineageError();
  }
  const binding = getDataPipelineReleaseBinding();
  const contractName = value.contractName;
  const expectedFactoryContractName = DYNAMIC_FACTORY_CONTRACTS[contractName];
  if (
    !expectedFactoryContractName ||
    value.factoryContractName !== expectedFactoryContractName ||
    !UUID_PATTERN.test(value.attestationId)
  ) {
    return dynamicLineageError();
  }
  const release = binding.releases.find(
    (candidate) =>
      candidate.model === value.model &&
      candidate.releaseVersion === value.releaseVersion &&
      candidate.dynamicContracts.includes(contractName) &&
      candidate.sourceContracts.includes(expectedFactoryContractName),
  );
  const factory = binding.sources.find(
    (source) =>
      source.contractName === expectedFactoryContractName &&
      source.address === value.factoryAddress,
  );
  if (!release || !factory) return dynamicLineageError();
  let sourceAddress: HexAddress;
  let factoryAddress: HexAddress;
  let expectedExactRuntimeCodeHash: HexBytes32;
  let expectedNormalizedRuntimeCodeHash: HexBytes32;
  let expectedImmutableReferencesCommitment: HexBytes32;
  let factoryBlockNumber: string;
  let factoryBlockGlobalLogIndex: string | undefined;
  let activationBlockNumber: string | undefined;
  let activationBlockHash: HexBytes32 | undefined;
  let activationBlockGlobalLogIndex: string | undefined;
  let expectedRuntimeByteLength: string;
  try {
    sourceAddress = canonicalAddress(value.sourceAddress);
    factoryAddress = canonicalAddress(value.factoryAddress);
    expectedExactRuntimeCodeHash = canonicalBytes32(
      value.expectedExactRuntimeCodeHash,
    );
    expectedNormalizedRuntimeCodeHash = canonicalBytes32(
      value.expectedNormalizedRuntimeCodeHash,
    );
    expectedImmutableReferencesCommitment = canonicalBytes32(
      value.expectedImmutableReferencesCommitment,
    );
    factoryBlockNumber = parseNonnegativeIntegerText(
      value.factoryBlockNumber,
    );
    factoryBlockGlobalLogIndex =
      value.factoryBlockGlobalLogIndex === undefined
        ? undefined
        : canonicalUint32DecimalText(
            value.factoryBlockGlobalLogIndex,
            "dynamic-factory-log-index",
          );
    activationBlockNumber = value.activationBlockNumber === undefined
      ? undefined
      : parseNonnegativeIntegerText(value.activationBlockNumber);
    activationBlockHash = value.activationBlockHash === undefined
      ? undefined
      : canonicalBytes32(value.activationBlockHash);
    activationBlockGlobalLogIndex =
      value.activationBlockGlobalLogIndex === undefined
        ? undefined
        : canonicalUint32DecimalText(
            value.activationBlockGlobalLogIndex,
            "dynamic-activation-log-index",
          );
    expectedRuntimeByteLength = canonicalUint32DecimalText(
      value.expectedRuntimeByteLength,
      "dynamic-runtime-length",
    );
  } catch {
    return dynamicLineageError();
  }
  const byteLength = Number(expectedRuntimeByteLength);
  if (
    sourceAddress === factoryAddress ||
    expectedExactRuntimeCodeHash === ZERO_BYTES32 ||
    expectedNormalizedRuntimeCodeHash === ZERO_BYTES32 ||
    expectedImmutableReferencesCommitment === ZERO_BYTES32 ||
    byteLength < 1 ||
    byteLength > 24_576 ||
    BigInt(factoryBlockNumber) < BigInt(factory.startBlock)
  ) {
    return dynamicLineageError();
  }
  let immutableReferences: readonly ImmutableReference[];
  try {
    immutableReferences = canonicalImmutableReferences(
      value.immutableReferences,
      byteLength,
    );
  } catch {
    return dynamicLineageError();
  }
  const hasCandidateParent = value.factoryCandidateId !== undefined;
  const hasOccurrenceParent = value.parentOccurrenceId !== undefined;
  if (hasCandidateParent === hasOccurrenceParent) {
    return dynamicLineageError();
  }
  if (hasCandidateParent) {
    const parentMatch = CANDIDATE_ID_PATTERN.exec(value.factoryCandidateId!);
    if (
      !parentMatch ||
      factoryBlockGlobalLogIndex === undefined ||
      BigInt(parentMatch[3]) !== BigInt(factoryBlockGlobalLogIndex)
    ) {
      return dynamicLineageError();
    }
  } else if (!UUID_PATTERN.test(value.parentOccurrenceId!)) {
    return dynamicLineageError();
  }
  const activationShape = [
    activationBlockNumber,
    activationBlockHash,
    activationBlockGlobalLogIndex,
  ];
  const hasActivationBoundary = activationShape.every(
    (entry) => entry !== undefined,
  );
  if (
    (!hasActivationBoundary &&
      activationShape.some((entry) => entry !== undefined)) ||
    (hasActivationBoundary &&
      ((value.activationCandidateId === undefined) ===
        (value.activationOccurrenceId === undefined)))
  ) {
    return dynamicLineageError();
  }
  if (hasActivationBoundary) {
    const activationAfterFactory =
      BigInt(activationBlockNumber!) > BigInt(factoryBlockNumber) ||
      (BigInt(activationBlockNumber!) === BigInt(factoryBlockNumber) &&
        factoryBlockGlobalLogIndex !== undefined &&
        BigInt(activationBlockGlobalLogIndex!) >
          BigInt(factoryBlockGlobalLogIndex));
    const activationMatch = value.activationCandidateId === undefined
      ? null
      : CANDIDATE_ID_PATTERN.exec(value.activationCandidateId);
    if (
      !activationAfterFactory ||
      (value.activationOccurrenceId !== undefined &&
        !UUID_PATTERN.test(value.activationOccurrenceId)) ||
      (activationMatch !== null &&
        (activationMatch[1] !== activationBlockHash ||
          BigInt(activationMatch[3]!) !==
            BigInt(activationBlockGlobalLogIndex!))) ||
      (value.activationCandidateId !== undefined && activationMatch === null)
    ) {
      return dynamicLineageError();
    }
  } else if (
    value.activationCandidateId !== undefined ||
    value.activationOccurrenceId !== undefined
  ) {
    return dynamicLineageError();
  }
  return Object.freeze({
    attestationId: value.attestationId,
    sourceAddress,
    contractName,
    model: value.model,
    releaseVersion: value.releaseVersion,
    factoryAddress,
    factoryContractName: expectedFactoryContractName,
    ...(value.parentOccurrenceId
      ? { parentOccurrenceId: value.parentOccurrenceId }
      : {}),
    ...(value.factoryCandidateId
      ? { factoryCandidateId: value.factoryCandidateId }
      : {}),
    factoryBlockNumber,
    ...(factoryBlockGlobalLogIndex === undefined
      ? {}
      : { factoryBlockGlobalLogIndex }),
    ...(activationBlockNumber === undefined
      ? {}
      : {
          ...(value.activationCandidateId
            ? { activationCandidateId: value.activationCandidateId }
            : {}),
          ...(value.activationOccurrenceId
            ? { activationOccurrenceId: value.activationOccurrenceId }
            : {}),
          activationBlockNumber,
          activationBlockHash: activationBlockHash!,
          activationBlockGlobalLogIndex: activationBlockGlobalLogIndex!,
        }),
    expectedExactRuntimeCodeHash,
    expectedNormalizedRuntimeCodeHash,
    expectedImmutableReferencesCommitment,
    expectedRuntimeByteLength,
    immutableReferences,
  });
}

export function canonicalDynamicSourceLineages(
  values: readonly VerifiedDynamicSourceLineage[] | undefined,
): ReadonlyMap<HexAddress, VerifiedDynamicSourceLineage> {
  if (values === undefined) return new Map();
  if (!Array.isArray(values) || values.length > 10_000) {
    return dynamicLineageError();
  }
  const result = new Map<HexAddress, VerifiedDynamicSourceLineage>();
  for (const value of values) {
    const lineage = canonicalDynamicSourceLineage(value);
    if (result.has(lineage.sourceAddress)) return dynamicLineageError();
    result.set(lineage.sourceAddress, lineage);
  }
  return result;
}
