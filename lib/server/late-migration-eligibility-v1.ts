import "server-only";

import eligibilityConfig from "@/config/late-migration-eligibility.v1.json";
import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

export const LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1 =
  "programmable-late-migration-eligibility/v1";

const EXPECTED_CONFIG_SCHEMA =
  "programmable-late-migration-eligibility-config/v1";
const EXPECTED_SOURCE_ARTIFACT_SCHEMA =
  "programmable-v4-late-migration-source-proofs/v1";
const EXPECTED_SOURCE_ARTIFACT_SHA256 =
  "5e09163c764abbd2c29a63df990b3a9a99d8547d1a69840a8033d7d794d6ecb1";
const EXPECTED_ROUND_ID =
  "0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179";
const EXPECTED_MERKLE_ROOT =
  "0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0";
const EXPECTED_OFFER_COUNT = 1_499;
const EXPECTED_AGGREGATE_GROSS_AMOUNT_RAW = "176529129261873518239425341";
const EXPECTED_AGGREGATE_PAYOUT_AMOUNT_RAW = "141223303409498814591539678";
const CANONICAL_POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const ELIGIBILITY_LEAF_PARAMETERS = [
  { name: "roundId", type: "bytes32" },
  { name: "offerIndex", type: "uint256" },
  { name: "sourceAddress", type: "address" },
  { name: "requiredGrossDepositRaw", type: "uint256" },
  { name: "targetPayout80Raw", type: "uint256" },
] as const;

const RESPONSE_HEADERS = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

type EligibilityOfferV1 = Readonly<{
  offerIndex: number;
  leafHash: Hex;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
  walletAddress: Address;
}>;

export type LateMigrationEligibilityClaimV1 = Readonly<{
  eligibilityProof: readonly Hex[];
  offerIndex: number;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
  walletAddress: Address;
}>;

type EligibilitySummaryV1 = Readonly<{
  aggregateGrossAmountRaw: string;
  aggregatePayoutAmountRaw: string;
  count: number;
  merkleRoot: string;
  roundId: string;
  sourceArtifactSha256: string;
}>;

type EligibilityIndexV1 = Readonly<{
  leafTreeIndexes: ReadonlyMap<Hex, number>;
  offersByAddress: ReadonlyMap<string, EligibilityOfferV1>;
  summary: EligibilitySummaryV1;
  tree: readonly Hex[];
}>;

export class LateMigrationEligibilityConfigError extends Error {
  constructor() {
    super("LATE_MIGRATION_ELIGIBILITY_CONFIG_INVALID");
    this.name = "LateMigrationEligibilityConfigError";
  }
}

function invalidConfig(): never {
  throw new LateMigrationEligibilityConfigError();
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function parseCanonicalPositiveDecimal(value: unknown): bigint {
  if (typeof value !== "string" || !CANONICAL_POSITIVE_DECIMAL.test(value)) {
    invalidConfig();
  }
  return BigInt(value);
}

function standardEligibilityLeafHash(
  offerIndex: number,
  sourceAddress: Address,
  requiredGrossDeposit: bigint,
  targetPayout: bigint,
): Hex {
  const encoded = encodeAbiParameters(ELIGIBILITY_LEAF_PARAMETERS, [
    EXPECTED_ROUND_ID,
    BigInt(offerIndex),
    sourceAddress,
    requiredGrossDeposit,
    targetPayout,
  ]);
  return keccak256(keccak256(encoded));
}

function standardNodeHash(left: Hex, right: Hex): Hex {
  const ordered = left < right ? [left, right] : [right, left];
  return keccak256(concatHex(ordered));
}

function standardMerkleTree(leaves: readonly Hex[]): Readonly<{
  leafTreeIndexes: ReadonlyMap<Hex, number>;
  root: Hex;
  tree: readonly Hex[];
}> {
  if (leaves.length === 0) {
    invalidConfig();
  }

  const sortedLeaves = [...leaves].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const tree = new Array<Hex>(2 * sortedLeaves.length - 1);
  const leafTreeIndexes = new Map<Hex, number>();
  for (const [index, leaf] of sortedLeaves.entries()) {
    const treeIndex = tree.length - 1 - index;
    if (leafTreeIndexes.has(leaf)) invalidConfig();
    tree[treeIndex] = leaf;
    leafTreeIndexes.set(leaf, treeIndex);
  }
  for (
    let index = tree.length - 1 - sortedLeaves.length;
    index >= 0;
    index -= 1
  ) {
    tree[index] = standardNodeHash(tree[2 * index + 1], tree[2 * index + 2]);
  }

  return Object.freeze({
    leafTreeIndexes,
    root: tree[0],
    tree: Object.freeze(tree),
  });
}

function standardMerkleProof(tree: readonly Hex[], leafTreeIndex: number) {
  const proof: Hex[] = [];
  let treeIndex = leafTreeIndex;
  while (treeIndex > 0) {
    const siblingIndex = treeIndex % 2 === 0 ? treeIndex - 1 : treeIndex + 1;
    const sibling = tree[siblingIndex];
    if (!sibling) invalidConfig();
    proof.push(sibling);
    treeIndex = Math.floor((treeIndex - 1) / 2);
  }
  return Object.freeze(proof);
}

/**
 * Validates the complete frozen lookup snapshot before it can serve requests.
 * The production index is constructed at module initialization below.
 */
export function buildLateMigrationEligibilityIndexV1(
  input: unknown,
): EligibilityIndexV1 {
  if (
    !hasExactKeys(input, [
      "aggregateGrossAmountRaw",
      "aggregatePayoutAmountRaw",
      "rows",
      "schema",
      "sourceArtifact",
    ])
  ) {
    invalidConfig();
  }

  if (
    input.schema !== EXPECTED_CONFIG_SCHEMA ||
    input.aggregateGrossAmountRaw !== EXPECTED_AGGREGATE_GROSS_AMOUNT_RAW ||
    input.aggregatePayoutAmountRaw !== EXPECTED_AGGREGATE_PAYOUT_AMOUNT_RAW ||
    !Array.isArray(input.rows) ||
    input.rows.length !== EXPECTED_OFFER_COUNT
  ) {
    invalidConfig();
  }

  const sourceArtifact = input.sourceArtifact;
  if (
    !hasExactKeys(sourceArtifact, [
      "count",
      "merkleRoot",
      "roundId",
      "schema",
      "sha256",
    ])
  ) {
    invalidConfig();
  }

  if (
    sourceArtifact.schema !== EXPECTED_SOURCE_ARTIFACT_SCHEMA ||
    sourceArtifact.sha256 !== EXPECTED_SOURCE_ARTIFACT_SHA256 ||
    sourceArtifact.roundId !== EXPECTED_ROUND_ID ||
    sourceArtifact.merkleRoot !== EXPECTED_MERKLE_ROOT ||
    sourceArtifact.count !== EXPECTED_OFFER_COUNT
  ) {
    invalidConfig();
  }

  let aggregateGrossAmount = 0n;
  let aggregatePayoutAmount = 0n;
  const leafHashes: Hex[] = [];
  const seenOfferIndexes = new Set<number>();
  const offersByAddress = new Map<string, EligibilityOfferV1>();

  for (const [position, row] of input.rows.entries()) {
    if (
      !hasExactKeys(row, [
        "offerIndex",
        "requiredGrossDepositRaw",
        "sourceAddress",
        "targetPayout80Raw",
      ])
    ) {
      invalidConfig();
    }

    const offerIndex = row.offerIndex;
    const sourceAddress = row.sourceAddress;
    if (
      typeof offerIndex !== "number" ||
      !Number.isSafeInteger(offerIndex) ||
      offerIndex !== position ||
      seenOfferIndexes.has(offerIndex) ||
      typeof sourceAddress !== "string" ||
      !isAddress(sourceAddress, { strict: true })
    ) {
      invalidConfig();
    }

    const walletAddress = getAddress(sourceAddress);
    const addressKey = walletAddress.toLowerCase();
    if (offersByAddress.has(addressKey)) {
      // Reject both exact duplicates and addresses that differ only by case.
      invalidConfig();
    }

    const requiredGrossDeposit = parseCanonicalPositiveDecimal(
      row.requiredGrossDepositRaw,
    );
    const targetPayout = parseCanonicalPositiveDecimal(row.targetPayout80Raw);
    if (targetPayout !== (requiredGrossDeposit * 8_000n) / 10_000n) {
      invalidConfig();
    }

    const leafHash = standardEligibilityLeafHash(
      offerIndex,
      walletAddress,
      requiredGrossDeposit,
      targetPayout,
    );
    const offer = Object.freeze({
      offerIndex,
      leafHash,
      requiredGrossDepositRaw: requiredGrossDeposit.toString(),
      targetPayout80Raw: targetPayout.toString(),
      walletAddress,
    });
    seenOfferIndexes.add(offerIndex);
    offersByAddress.set(addressKey, offer);
    leafHashes.push(leafHash);
    aggregateGrossAmount += requiredGrossDeposit;
    aggregatePayoutAmount += targetPayout;
  }

  const merkleTree = standardMerkleTree(leafHashes);
  if (
    seenOfferIndexes.size !== EXPECTED_OFFER_COUNT ||
    aggregateGrossAmount.toString() !== EXPECTED_AGGREGATE_GROSS_AMOUNT_RAW ||
    aggregatePayoutAmount.toString() !== EXPECTED_AGGREGATE_PAYOUT_AMOUNT_RAW ||
    merkleTree.root !== EXPECTED_MERKLE_ROOT
  ) {
    invalidConfig();
  }

  return Object.freeze({
    leafTreeIndexes: merkleTree.leafTreeIndexes,
    offersByAddress,
    summary: Object.freeze({
      aggregateGrossAmountRaw: aggregateGrossAmount.toString(),
      aggregatePayoutAmountRaw: aggregatePayoutAmount.toString(),
      count: EXPECTED_OFFER_COUNT,
      merkleRoot: EXPECTED_MERKLE_ROOT,
      roundId: EXPECTED_ROUND_ID,
      sourceArtifactSha256: EXPECTED_SOURCE_ARTIFACT_SHA256,
    }),
    tree: merkleTree.tree,
  });
}

const ELIGIBILITY_INDEX = buildLateMigrationEligibilityIndexV1(
  eligibilityConfig as unknown,
);

export const lateMigrationEligibilitySummaryV1 = ELIGIBILITY_INDEX.summary;

/**
 * Returns the contract-bound claim tuple and proof for trusted server code only.
 * Public eligibility responses deliberately never call or expose this helper.
 */
export function getLateMigrationEligibilityClaimV1(
  walletAddressInput: string,
): LateMigrationEligibilityClaimV1 | null {
  if (!isAddress(walletAddressInput, { strict: true })) return null;
  const walletAddress = getAddress(walletAddressInput);
  const offer = ELIGIBILITY_INDEX.offersByAddress.get(
    walletAddress.toLowerCase(),
  );
  if (!offer) return null;

  const leafTreeIndex = ELIGIBILITY_INDEX.leafTreeIndexes.get(offer.leafHash);
  if (leafTreeIndex === undefined) invalidConfig();
  return Object.freeze({
    eligibilityProof: standardMerkleProof(
      ELIGIBILITY_INDEX.tree,
      leafTreeIndex,
    ),
    offerIndex: offer.offerIndex,
    requiredGrossDepositRaw: offer.requiredGrossDepositRaw,
    targetPayout80Raw: offer.targetPayout80Raw,
    walletAddress: offer.walletAddress,
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: RESPONSE_HEADERS,
    status,
  });
}

function invalidInputResponse(): Response {
  return jsonResponse(
    {
      error: "invalid_input",
      schema: LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1,
    },
    400,
  );
}

export function handleLateMigrationEligibilityGetV1(
  request: Request,
): Response {
  let entries: [string, string][];
  try {
    entries = [...new URL(request.url).searchParams.entries()];
  } catch {
    return invalidInputResponse();
  }

  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "walletAddress" ||
    !isAddress(entries[0][1], { strict: true })
  ) {
    return invalidInputResponse();
  }

  const walletAddress = getAddress(entries[0][1]);
  const offer = ELIGIBILITY_INDEX.offersByAddress.get(
    walletAddress.toLowerCase(),
  );
  if (!offer) {
    return jsonResponse(
      {
        schema: LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1,
        status: "not_eligible",
        walletAddress,
      },
      200,
    );
  }

  return jsonResponse(
    {
      offerIndex: offer.offerIndex,
      requiredGrossDepositRaw: offer.requiredGrossDepositRaw,
      schema: LATE_MIGRATION_ELIGIBILITY_RESPONSE_SCHEMA_V1,
      status: "eligible",
      targetPayout80Raw: offer.targetPayout80Raw,
      walletAddress: offer.walletAddress,
    },
    200,
  );
}
