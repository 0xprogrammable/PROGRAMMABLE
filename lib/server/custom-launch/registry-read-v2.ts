import "server-only";

const HASH32 = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

export const CUSTOM_REGISTRY_V2_MARKET_PROFILES = Object.freeze({
  NoMarket0: Object.freeze({ marketMode: 0, protocolFeeBps: 0 }),
  Standard10: Object.freeze({ marketMode: 1, protocolFeeBps: 10 }),
} as const);

export type CustomRegistryV2MarketProfile =
  keyof typeof CUSTOM_REGISTRY_V2_MARKET_PROFILES;

export type CustomRegistryV2ApiRecord = Readonly<{
  schemaVersion: "programmable.custom-registry-v2-read.v1";
  generation: "2";
  chainId: "1";
  status: "finalized";
  launchId: `0x${string}`;
  descriptorHash: `0x${string}`;
  primaryContract: `0x${string}`;
  launchWallet: `0x${string}`;
  primaryRuntimeCodeHash: `0x${string}`;
  componentSetHash: `0x${string}`;
  sourceArtifactHash: `0x${string}`;
  configurationHash: `0x${string}`;
  launchPlanHash: `0x${string}`;
  projectCommitment: `0x${string}`;
  marketProfile: CustomRegistryV2MarketProfile;
  approval: Readonly<{
    approvalId: `0x${string}`;
    evidenceHash: `0x${string}`;
  }>;
  registration: Readonly<{
    evidenceHash: `0x${string}`;
    observedAtBlock: string;
    transitionSequence: string;
  }>;
  finality: Readonly<{
    evidenceHash: `0x${string}`;
    observedAtBlock: string;
    observedBlockHash: `0x${string}`;
    confirmedHeadBlock: string;
    confirmedHeadBlockHash: `0x${string}`;
    finalizedAtBlock: string;
    transitionSequence: string;
  }>;
}>;

export function parseCustomRegistryV2ApiRecord(
  value: unknown,
): CustomRegistryV2ApiRecord {
  const source = exactObject(value, "Custom Registry V2 read record", [
    "approval",
    "chainId",
    "componentSetHash",
    "configurationHash",
    "descriptorHash",
    "finality",
    "generation",
    "launchId",
    "launchPlanHash",
    "launchWallet",
    "marketMode",
    "primaryContract",
    "primaryRuntimeCodeHash",
    "projectCommitment",
    "protocolFeeBps",
    "registration",
    "schemaVersion",
    "sourceArtifactHash",
    "status",
  ]);
  if (
    source.schemaVersion !== "programmable.custom-registry-v2-read.v1"
    || source.generation !== "2"
    || source.chainId !== "1"
    || source.status !== "finalized"
  ) throw new TypeError("Custom Registry V2 read identity is invalid");

  const marketProfile = parseMarketProfile(
    source.marketMode,
    source.protocolFeeBps,
  );
  const approval = exactObject(source.approval, "approval evidence", [
    "approvalId",
    "evidenceHash",
  ]);
  const registration = exactObject(source.registration, "registration evidence", [
    "evidenceHash",
    "observedAtBlock",
    "transitionSequence",
  ]);
  const finality = exactObject(source.finality, "finality evidence", [
    "confirmedHeadBlock",
    "confirmedHeadBlockHash",
    "evidenceHash",
    "finalizedAtBlock",
    "observedAtBlock",
    "observedBlockHash",
    "transitionSequence",
  ]);

  const registrationSequence = decimal(
    registration.transitionSequence,
    "registration transition sequence",
  );
  const finalitySequence = decimal(
    finality.transitionSequence,
    "finality transition sequence",
  );
  if (BigInt(finalitySequence) <= BigInt(registrationSequence)) {
    throw new TypeError("Custom Registry V2 lifecycle sequence is invalid");
  }
  const registrationBlock = decimal(
    registration.observedAtBlock,
    "registration observation block",
  );
  const observedAtBlock = decimal(
    finality.observedAtBlock,
    "finality observation block",
  );
  const confirmedHeadBlock = decimal(
    finality.confirmedHeadBlock,
    "confirmed head block",
  );
  const finalizedAtBlock = decimal(
    finality.finalizedAtBlock,
    "finalized block",
  );
  if (
    BigInt(observedAtBlock) !== BigInt(registrationBlock)
    || BigInt(confirmedHeadBlock) < BigInt(observedAtBlock)
    || BigInt(finalizedAtBlock) <= BigInt(confirmedHeadBlock)
  ) throw new TypeError("Custom Registry V2 finality block relation is invalid");

  return Object.freeze({
    schemaVersion: "programmable.custom-registry-v2-read.v1" as const,
    generation: "2" as const,
    chainId: "1" as const,
    status: "finalized" as const,
    launchId: hash32(source.launchId, "launch id"),
    descriptorHash: hash32(source.descriptorHash, "descriptor hash"),
    primaryContract: address(source.primaryContract, "primary contract"),
    launchWallet: address(source.launchWallet, "launch wallet"),
    primaryRuntimeCodeHash: hash32(
      source.primaryRuntimeCodeHash,
      "primary runtime code hash",
    ),
    componentSetHash: hash32(source.componentSetHash, "component set hash"),
    sourceArtifactHash: hash32(source.sourceArtifactHash, "source artifact hash"),
    configurationHash: hash32(source.configurationHash, "configuration hash"),
    launchPlanHash: hash32(source.launchPlanHash, "launch plan hash"),
    projectCommitment: hash32(source.projectCommitment, "project commitment"),
    marketProfile,
    approval: Object.freeze({
      approvalId: hash32(approval.approvalId, "approval id"),
      evidenceHash: hash32(approval.evidenceHash, "approval evidence hash"),
    }),
    registration: Object.freeze({
      evidenceHash: hash32(
        registration.evidenceHash,
        "registration evidence hash",
      ),
      observedAtBlock: registrationBlock,
      transitionSequence: registrationSequence,
    }),
    finality: Object.freeze({
      evidenceHash: hash32(finality.evidenceHash, "finality evidence hash"),
      observedAtBlock,
      observedBlockHash: hash32(
        finality.observedBlockHash,
        "observed block hash",
      ),
      confirmedHeadBlock,
      confirmedHeadBlockHash: hash32(
        finality.confirmedHeadBlockHash,
        "confirmed head block hash",
      ),
      finalizedAtBlock,
      transitionSequence: finalitySequence,
    }),
  });
}

function parseMarketProfile(
  marketMode: unknown,
  protocolFeeBps: unknown,
): CustomRegistryV2MarketProfile {
  if (marketMode === 0 && protocolFeeBps === 0) return "NoMarket0";
  if (marketMode === 1 && protocolFeeBps === 10) return "Standard10";
  throw new TypeError("Custom Registry V2 market profile is invalid");
}

function exactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) throw new TypeError(`${label} keys are invalid`);
  return value as Record<string, unknown>;
}

function hash32(value: unknown, label: string): `0x${string}` {
  if (
    typeof value !== "string"
    || !HASH32.test(value)
    || value === `0x${"00".repeat(32)}`
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function address(value: unknown, label: string): `0x${string}` {
  if (
    typeof value !== "string"
    || !ADDRESS.test(value)
    || value === `0x${"00".repeat(20)}`
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
