import {
  getAddress,
  hashTypedData,
  isAddressEqual,
  isHex,
  keccak256,
  recoverTypedDataAddress,
  size,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import {
  EIP712_CANDIDATE_BLOCKERS,
  EIP712_CANDIDATE_STATUS,
  UINT128_MAX,
  UINT64_MAX,
} from "./constants.js";
import { ProgrammableSdkError } from "./errors.js";
import { assertExactKeys, snapshotDataRecord } from "./input-snapshot.js";
import { assertUint } from "./uint.js";

export type Bytes32 = `0x${string}`;

export interface UnfrozenAuthorizationCandidateInput {
  readonly chainId: number;
  readonly coreAddress: Address;
  readonly coreMajor: number;
  readonly constitutionId: Bytes32;
  readonly marketId: Bytes32;
  readonly effectiveEngineRevisionId: Bytes32;
  readonly domainRevisionIdsHash: Bytes32;
  readonly portableAuthorizationScopeId: Bytes32;
  readonly principal: Address;
  readonly nonce: bigint;
  readonly replayProtectionCommitment: Bytes32;
  readonly fillStateCommitment: Bytes32;
  readonly cancellationPolicyCommitment: Bytes32;
  readonly expiry: bigint;
  readonly replacementCommitment: Bytes32;
  readonly assetsCommitment: Bytes32;
  readonly assetProfilesCommitment: Bytes32;
  readonly exactSourcesCommitment: Bytes32;
  readonly recipientsOrPredicatesCommitment: Bytes32;
  readonly maximumEngineFundedGrossDebit: bigint;
  readonly maximumProtocolAssessmentDebit: bigint;
  readonly maximumTotalGrossDebit: bigint;
  readonly maximumExternalWithholding: bigint;
  readonly minimumSpendableCreditsCommitment: Bytes32;
  readonly actionPayloadDigest: Bytes32;
  readonly partialFillPolicyCommitment: Bytes32;
  readonly sponsorAuthorizationCommitment: Bytes32;
  readonly capabilityGrammarCommitment: Bytes32;
  readonly refundGrammarCommitment: Bytes32;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

const CANDIDATE_TYPES = deepFreeze({
  ProgrammableAuthorizationCandidateV1: [
    { name: "candidateStatus", type: "bytes32" },
    { name: "coreMajor", type: "uint32" },
    { name: "constitutionId", type: "bytes32" },
    { name: "marketId", type: "bytes32" },
    { name: "effectiveEngineRevisionId", type: "bytes32" },
    { name: "domainRevisionIdsHash", type: "bytes32" },
    { name: "portableAuthorizationScopeId", type: "bytes32" },
    { name: "principal", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "replayProtectionCommitment", type: "bytes32" },
    { name: "fillStateCommitment", type: "bytes32" },
    { name: "cancellationPolicyCommitment", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "replacementCommitment", type: "bytes32" },
    { name: "assetsCommitment", type: "bytes32" },
    { name: "assetProfilesCommitment", type: "bytes32" },
    { name: "exactSourcesCommitment", type: "bytes32" },
    { name: "recipientsOrPredicatesCommitment", type: "bytes32" },
    { name: "maximumEngineFundedGrossDebit", type: "uint128" },
    { name: "maximumProtocolAssessmentDebit", type: "uint128" },
    { name: "maximumTotalGrossDebit", type: "uint128" },
    { name: "maximumExternalWithholding", type: "uint128" },
    { name: "minimumSpendableCreditsCommitment", type: "bytes32" },
    { name: "actionPayloadDigest", type: "bytes32" },
    { name: "partialFillPolicyCommitment", type: "bytes32" },
    { name: "sponsorAuthorizationCommitment", type: "bytes32" },
    { name: "capabilityGrammarCommitment", type: "bytes32" },
    { name: "refundGrammarCommitment", type: "bytes32" },
  ],
} as const);

const SECP256K1N_HALF =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

const CANDIDATE_INPUT_FIELDS = Object.freeze([
  "chainId",
  "coreAddress",
  "coreMajor",
  "constitutionId",
  "marketId",
  "effectiveEngineRevisionId",
  "domainRevisionIdsHash",
  "portableAuthorizationScopeId",
  "principal",
  "nonce",
  "replayProtectionCommitment",
  "fillStateCommitment",
  "cancellationPolicyCommitment",
  "expiry",
  "replacementCommitment",
  "assetsCommitment",
  "assetProfilesCommitment",
  "exactSourcesCommitment",
  "recipientsOrPredicatesCommitment",
  "maximumEngineFundedGrossDebit",
  "maximumProtocolAssessmentDebit",
  "maximumTotalGrossDebit",
  "maximumExternalWithholding",
  "minimumSpendableCreditsCommitment",
  "actionPayloadDigest",
  "partialFillPolicyCommitment",
  "sponsorAuthorizationCommitment",
  "capabilityGrammarCommitment",
  "refundGrammarCommitment",
] as const);

export const UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR = deepFreeze({
  status: EIP712_CANDIDATE_STATUS,
  blockers: EIP712_CANDIDATE_BLOCKERS,
  primaryType: "ProgrammableAuthorizationCandidateV1",
  domainName: "Programmable DEX Core Authorization Candidate",
  types: CANDIDATE_TYPES,
} as const);

function bytes32(value: Hex, label: string): Bytes32 {
  if (!isHex(value, { strict: true }) || value.length !== 66 || size(value) !== 32) {
    throw new ProgrammableSdkError("CANDIDATE_BYTES32_INVALID", `${label} must be exactly 32 bytes`);
  }
  return value;
}

function positiveSafeInteger(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new ProgrammableSdkError(
      "CANDIDATE_INTEGER_INVALID",
      `${label} must be a positive safe integer no greater than ${maximum}`,
    );
  }
  return value;
}

function isCanonicalEoaSignature(signature: unknown): signature is Hex {
  if (typeof signature !== "string" || !isHex(signature, { strict: true }) || signature.length !== 132) return false;
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  if (s === 0n || s > SECP256K1N_HALF) return false;
  const v = Number.parseInt(signature.slice(130, 132), 16);
  return v === 27 || v === 28;
}

export function sha256IdentifierToBytes32(identifier: `sha256:${string}`): Bytes32 {
  if (!/^sha256:[0-9a-f]{64}$/.test(identifier)) {
    throw new ProgrammableSdkError(
      "CANDIDATE_SHA256_IDENTIFIER_INVALID",
      "identifier must use the exact lowercase sha256:<64-hex> form",
    );
  }
  const payload = identifier.slice("sha256:".length);
  return bytes32(`0x${payload}`, "SHA-256 identifier");
}

export function buildUnfrozenAuthorizationCandidateTypedData(
  inputValue: UnfrozenAuthorizationCandidateInput,
) {
  const input = snapshotDataRecord(inputValue, "authorizationCandidate");
  assertExactKeys(input, CANDIDATE_INPUT_FIELDS, [], "authorizationCandidate");
  const candidate = input as unknown as UnfrozenAuthorizationCandidateInput;
  const chainId = positiveSafeInteger(candidate.chainId, Number.MAX_SAFE_INTEGER, "chainId");
  const coreMajor = positiveSafeInteger(candidate.coreMajor, 0xffff_ffff, "coreMajor");
  const message = {
    candidateStatus: keccak256(stringToHex(EIP712_CANDIDATE_STATUS)),
    coreMajor,
    constitutionId: bytes32(candidate.constitutionId, "constitutionId"),
    marketId: bytes32(candidate.marketId, "marketId"),
    effectiveEngineRevisionId: bytes32(candidate.effectiveEngineRevisionId, "effectiveEngineRevisionId"),
    domainRevisionIdsHash: bytes32(candidate.domainRevisionIdsHash, "domainRevisionIdsHash"),
    portableAuthorizationScopeId: bytes32(
      candidate.portableAuthorizationScopeId,
      "portableAuthorizationScopeId",
    ),
    principal: getAddress(candidate.principal),
    nonce: assertUint(candidate.nonce, (1n << 256n) - 1n, "nonce"),
    replayProtectionCommitment: bytes32(
      candidate.replayProtectionCommitment,
      "replayProtectionCommitment",
    ),
    fillStateCommitment: bytes32(candidate.fillStateCommitment, "fillStateCommitment"),
    cancellationPolicyCommitment: bytes32(
      candidate.cancellationPolicyCommitment,
      "cancellationPolicyCommitment",
    ),
    expiry: assertUint(candidate.expiry, UINT64_MAX, "expiry"),
    replacementCommitment: bytes32(candidate.replacementCommitment, "replacementCommitment"),
    assetsCommitment: bytes32(candidate.assetsCommitment, "assetsCommitment"),
    assetProfilesCommitment: bytes32(candidate.assetProfilesCommitment, "assetProfilesCommitment"),
    exactSourcesCommitment: bytes32(candidate.exactSourcesCommitment, "exactSourcesCommitment"),
    recipientsOrPredicatesCommitment: bytes32(
      candidate.recipientsOrPredicatesCommitment,
      "recipientsOrPredicatesCommitment",
    ),
    maximumEngineFundedGrossDebit: assertUint(
      candidate.maximumEngineFundedGrossDebit,
      UINT128_MAX,
      "maximumEngineFundedGrossDebit",
    ),
    maximumProtocolAssessmentDebit: assertUint(
      candidate.maximumProtocolAssessmentDebit,
      UINT128_MAX,
      "maximumProtocolAssessmentDebit",
    ),
    maximumTotalGrossDebit: assertUint(
      candidate.maximumTotalGrossDebit,
      UINT128_MAX,
      "maximumTotalGrossDebit",
    ),
    maximumExternalWithholding: assertUint(
      candidate.maximumExternalWithholding,
      UINT128_MAX,
      "maximumExternalWithholding",
    ),
    minimumSpendableCreditsCommitment: bytes32(
      candidate.minimumSpendableCreditsCommitment,
      "minimumSpendableCreditsCommitment",
    ),
    actionPayloadDigest: bytes32(candidate.actionPayloadDigest, "actionPayloadDigest"),
    partialFillPolicyCommitment: bytes32(
      candidate.partialFillPolicyCommitment,
      "partialFillPolicyCommitment",
    ),
    sponsorAuthorizationCommitment: bytes32(
      candidate.sponsorAuthorizationCommitment,
      "sponsorAuthorizationCommitment",
    ),
    capabilityGrammarCommitment: bytes32(
      candidate.capabilityGrammarCommitment,
      "capabilityGrammarCommitment",
    ),
    refundGrammarCommitment: bytes32(candidate.refundGrammarCommitment, "refundGrammarCommitment"),
  } as const;

  return deepFreeze({
    domain: {
      name: UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.domainName,
      version: `${coreMajor}-candidate-unfrozen`,
      chainId,
      verifyingContract: getAddress(candidate.coreAddress),
    },
    types: CANDIDATE_TYPES,
    primaryType: UNFROZEN_AUTHORIZATION_CANDIDATE_DESCRIPTOR.primaryType,
    message,
  } as const);
}

export function hashUnfrozenAuthorizationCandidate(
  input: UnfrozenAuthorizationCandidateInput,
): Hex {
  return hashTypedData(buildUnfrozenAuthorizationCandidateTypedData(input));
}

export async function verifyUnfrozenCandidateEoaAuthorization(input: {
  readonly authorization: UnfrozenAuthorizationCandidateInput;
  readonly expectedPrincipal: Address;
  readonly signature: Hex;
}): Promise<boolean> {
  const request = snapshotDataRecord(input, "candidateVerification");
  assertExactKeys(
    request,
    ["authorization", "expectedPrincipal", "signature"],
    [],
    "candidateVerification",
  );
  const expectedValue = request["expectedPrincipal"];
  const signatureValue = request["signature"];
  if (typeof expectedValue !== "string" || !isCanonicalEoaSignature(signatureValue)) return false;
  let expectedPrincipal: Address;
  let typedData: ReturnType<typeof buildUnfrozenAuthorizationCandidateTypedData>;
  try {
    expectedPrincipal = getAddress(expectedValue);
    typedData = buildUnfrozenAuthorizationCandidateTypedData(
      request["authorization"] as UnfrozenAuthorizationCandidateInput,
    );
  } catch {
    return false;
  }
  if (!isAddressEqual(typedData.message.principal, expectedPrincipal)) return false;
  try {
    const recovered = await recoverTypedDataAddress({ ...typedData, signature: signatureValue });
    return isAddressEqual(recovered, expectedPrincipal);
  } catch {
    return false;
  }
}
