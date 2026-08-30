import { createHash } from "node:crypto";

import { encodeAbiParameters, keccak256, stringToHex } from "viem";

import {
  MAIN_TOKEN_MIGRATION_POLICY,
  sha256CanonicalJson,
} from "./main-token-migration-snapshot-core.mjs";

export const MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY = Object.freeze({
  schema: "programmable-main-token-migration-distribution/v1",
  manualReviewDecisionSchema:
    "programmable-main-token-migration-manual-review-decisions/v1",
  targetChainId: 4663n,
  targetTokenTotalSupplyRaw:
    1_000_000_000_000_000_000_000_000_000n,
  allocationType:
    "ProgrammableV4MigrationAllocationV1(uint256 targetChainId,bytes32 releaseIdHash,uint256 sourceChainId,address sourceToken,uint256 sourceDeadlineTimestampExclusive,bytes32 snapshotRuleHash,bytes32 sourceSnapshotSha256,uint256 index,address account,uint256 amountRaw)",
});

const FROZEN_RELEASE_ID_HASH = keccak256(
  stringToHex(MAIN_TOKEN_MIGRATION_POLICY.releaseId),
);
const FROZEN_ALLOCATION_TYPEHASH = keccak256(
  stringToHex(MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.allocationType),
);
const FROZEN_SNAPSHOT_RULE = [
  MAIN_TOKEN_MIGRATION_POLICY.snapshotBoundaryRule,
  MAIN_TOKEN_MIGRATION_POLICY.cutoffRule,
  MAIN_TOKEN_MIGRATION_POLICY.conversionRule,
  "same EVM recipient only",
].join("|");
const FROZEN_SNAPSHOT_RULE_HASH = keccak256(stringToHex(FROZEN_SNAPSHOT_RULE));
export const MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS = Object.freeze([
  "contracts/src/robinhood-main-token/ProgrammableV4TokenV1.sol",
  "contracts/src/robinhood-main-token/ProgrammableV4MigrationDistributorV1.sol",
  "scripts/main-token-migration-snapshot-core.mjs",
  "scripts/main-token-migration-distribution-core.mjs",
  "scripts/main-token-migration-distribution.mjs",
]);

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const ZERO_SHA256 = `sha256:${"0".repeat(64)}`;
const EVIDENCE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function fail(message) {
  throw new Error(`Migration distribution rejected: ${message}`);
}

function exactPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unsignedBigInt(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) fail(`${label} is negative`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(`${label} is not a safe unsigned integer`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && DECIMAL.test(value)) return BigInt(value);
  fail(`${label} is not an unsigned decimal integer`);
}

function normalizedAddress(value, label) {
  if (!ADDRESS.test(String(value ?? ""))) fail(`${label} is malformed`);
  const address = value.toLowerCase();
  if (address === ZERO_ADDRESS) fail(`${label} is the zero address`);
  return address;
}

function exactBytes32(value, label) {
  if (!BYTES32.test(String(value ?? ""))) fail(`${label} is malformed`);
  const digest = value.toLowerCase();
  if (digest === ZERO_BYTES32) fail(`${label} is zero`);
  return digest;
}

function sha256Bytes32(value, label) {
  if (!SHA256.test(String(value ?? "")) || value === ZERO_SHA256) {
    fail(`${label} is malformed or zero`);
  }
  return `0x${value.slice("sha256:".length)}`;
}

function exactKeys(value, expected) {
  if (!exactPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function verifyFrozenSourceFiles(sources, sourceFiles) {
  if (!(sourceFiles instanceof Map)) {
    fail("frozen source bytes were not supplied");
  }
  for (const path of sourceFiles.keys()) {
    if (!MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS.includes(path)) {
      fail(`frozen source bytes contain an unexpected file: ${String(path)}`);
    }
  }
  if (sourceFiles.size !== MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS.length) {
    fail("frozen source byte inventory is incomplete");
  }
  for (const source of sources) {
    const bytes = sourceFiles.get(source.path);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      fail(`frozen source file was not supplied: ${source.path}`);
    }
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== source.sha256) {
      fail(`frozen source sha256 does not match its bytes: ${source.path}`);
    }
  }
}

export function normalizeMainTokenMigrationTargetDesign(value, sourceFiles) {
  if (!exactPlainObject(value)) fail("target design is malformed");
  const target = value.target;
  const source = value.source;
  const authorities = value.authorities;
  const deployment = value.deployment;
  const distribution = value.distribution;
  const guards = value.activationGuards;
  const build = value.build;
  const releaseIdHash = exactBytes32(
    value.releaseIdHash,
    "target design releaseIdHash",
  );
  const snapshotRuleHash = exactBytes32(
    source?.snapshotRuleHash,
    "target design source.snapshotRuleHash",
  );
  const allocationTypehash = exactBytes32(
    distribution?.allocationTypehash,
    "target design distribution.allocationTypehash",
  );
  const tokenAddress = normalizedAddress(
    target?.tokenAddress,
    "target design target.tokenAddress",
  );
  const distributorAddress = normalizedAddress(
    target?.distributorAddress,
    "target design target.distributorAddress",
  );
  const sealAuthority = normalizedAddress(
    authorities?.sealAuthority,
    "target design authorities.sealAuthority",
  );
  const remainderRecipient = normalizedAddress(
    authorities?.remainderRecipient,
    "target design authorities.remainderRecipient",
  );
  const deploymentBlockNumber = unsignedBigInt(
    deployment?.blockNumber,
    "target design deployment.blockNumber",
  );
  const finalizedBlockNumber = unsignedBigInt(
    deployment?.finalizedBlockNumber,
    "target design deployment.finalizedBlockNumber",
  );
  const sourcePaths = Array.isArray(build?.sources)
    ? build.sources.map((entry) => entry?.path)
    : [];
  if (
    value.schema !== "programmable-main-token-migration-target-design/v1" ||
    value.state !== "deployed-finalized-source-window-pending" ||
    value.enabled !== true ||
    value.releaseId !== MAIN_TOKEN_MIGRATION_POLICY.releaseId ||
    releaseIdHash !== FROZEN_RELEASE_ID_HASH ||
    !exactPlainObject(source) ||
    unsignedBigInt(source.chainId, "target design source.chainId") !==
      MAIN_TOKEN_MIGRATION_POLICY.chainId ||
    normalizedAddress(source.tokenAddress, "target design source.tokenAddress") !==
      MAIN_TOKEN_MIGRATION_POLICY.tokenAddress.toLowerCase() ||
    unsignedBigInt(
      source.tokenTotalSupplyRaw,
      "target design source.tokenTotalSupplyRaw",
    ) !== MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw ||
    unsignedBigInt(source.tokenDecimals, "target design source.tokenDecimals") !==
      MAIN_TOKEN_MIGRATION_POLICY.tokenDecimals ||
    unsignedBigInt(
      source.deadlineTimestampExclusive,
      "target design source.deadlineTimestampExclusive",
    ) === 0n ||
    source.snapshotRule !== FROZEN_SNAPSHOT_RULE ||
    snapshotRuleHash !== FROZEN_SNAPSHOT_RULE_HASH ||
    !exactPlainObject(target) ||
    unsignedBigInt(target.chainId, "target design target.chainId") !==
      MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetChainId ||
    target.tokenName !== "Programmable" ||
    target.tokenSymbol !== "V4" ||
    unsignedBigInt(target.tokenDecimals, "target design target.tokenDecimals") !== 18n ||
    unsignedBigInt(
      target.tokenTotalSupplyRaw,
      "target design target.tokenTotalSupplyRaw",
    ) !== MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetTokenTotalSupplyRaw ||
    tokenAddress === distributorAddress ||
    !exactPlainObject(authorities) ||
    sealAuthority === tokenAddress ||
    sealAuthority === distributorAddress ||
    remainderRecipient === tokenAddress ||
    remainderRecipient === distributorAddress ||
    authorities.sealAuthorityPower !==
      "one call at or after the frozen source deadline to bind root, snapshot digest, and migration total" ||
    authorities.postSealAdministrativePower !== "none" ||
    !exactPlainObject(distribution) ||
    distribution.allocationType !==
      MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.allocationType ||
    allocationTypehash !== FROZEN_ALLOCATION_TYPEHASH ||
    distribution.leafHashing !==
      "keccak256(bytes.concat(keccak256(abi.encode(allocation fields))))" ||
    distribution.pairHashing !==
      "keccak256(sort(bytes32 left, bytes32 right))" ||
    distribution.recipientRule !==
      "exact same EVM address committed in the leaf; caller cannot redirect" ||
    distribution.singleDistribution !== "permissionless" ||
    distribution.batchDistribution !==
      "permissionless, atomic, maximum 64 entries" ||
    distribution.duplicateProtection !==
      "uint256 bitmap indexed by allocation index" ||
    distribution.vesting !== "none" ||
    distribution.rescueOrSweep !== "none" ||
    !exactPlainObject(deployment) ||
    exactBytes32(
      deployment.transactionHash,
      "target design deployment.transactionHash",
    ) === ZERO_BYTES32 ||
    deploymentBlockNumber === 0n ||
    exactBytes32(
      deployment.blockHash,
      "target design deployment.blockHash",
    ) === ZERO_BYTES32 ||
    finalizedBlockNumber < deploymentBlockNumber ||
    exactBytes32(
      deployment.finalizedBlockHash,
      "target design deployment.finalizedBlockHash",
    ) === ZERO_BYTES32 ||
    deployment.independentRpcAgreement !== true ||
    normalizedAddress(
      deployment.tokenMigrationDistributorAddress,
      "target design deployment.tokenMigrationDistributorAddress",
    ) !== distributorAddress ||
    unsignedBigInt(
      deployment.distributorTokenBalanceRaw,
      "target design deployment.distributorTokenBalanceRaw",
    ) !== MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetTokenTotalSupplyRaw ||
    deployment.distributorIsSealed !== false ||
    !SHA256.test(String(deployment.verificationReceiptSha256 ?? "")) ||
    deployment.verificationReceiptSha256 === ZERO_SHA256 ||
    !exactPlainObject(guards) ||
    guards.targetDeploymentBeforeSourceWindowRequired !== true ||
    guards.fullTargetSupplyLockedInDistributorBeforeSourceWindowRequired !== true ||
    guards.sealBeforeSourceDeadlineAllowed !== false ||
    guards.sealIsOneTime !== true ||
    guards.distributionBeforeSealAllowed !== false ||
    guards.deploymentEnabled !== true ||
    guards.sealEnabled !== false ||
    guards.distributionEnabled !== false ||
    !exactPlainObject(build) ||
    build.solcVersion !== "0.8.26" ||
    build.evmVersion !== "cancun" ||
    build.optimizerEnabled !== true ||
    build.optimizerRuns !== "1000" ||
    build.bytecodeHash !== "none" ||
    build.cborMetadata !== false ||
    build.openzeppelinContractsCommit !==
      "21c8312b022f495ebe3621d5daeed20552b43ff9" ||
    sourcePaths.length !== MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS.length ||
    sourcePaths.some((path, index) =>
      path !== MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS[index]
    ) ||
    build.sources.some((entry) =>
      !exactKeys(entry, ["path", "sha256"]) ||
      !SHA256.test(String(entry.sha256 ?? "")) ||
      entry.sha256 === ZERO_SHA256
    ) ||
    !Array.isArray(value.remainingOwnerFields) ||
    value.remainingOwnerFields.length !== 0
  ) {
    fail("target design is not the activated immutable migration design");
  }
  verifyFrozenSourceFiles(build.sources, sourceFiles);
  return {
    deadlineTimestampExclusive: unsignedBigInt(
      source.deadlineTimestampExclusive,
      "target design source.deadlineTimestampExclusive",
    ),
    designSha256: sha256CanonicalJson(value),
    distributorAddress,
    distributorRuntimeCodeKeccak256: exactBytes32(
      target.distributorRuntimeCodeKeccak256,
      "target design target.distributorRuntimeCodeKeccak256",
    ),
    releaseIdHash,
    snapshotRule: source.snapshotRule,
    snapshotRuleHash,
    tokenAddress,
    tokenRuntimeCodeKeccak256: exactBytes32(
      target.tokenRuntimeCodeKeccak256,
      "target design target.tokenRuntimeCodeKeccak256",
    ),
  };
}

function normalizeSnapshotInput(value, targetDesignInput, targetDesignSourceFiles) {
  if (!exactKeys(value, [
    "canonicalization",
    "rpcAgreement",
    "snapshot",
    "snapshotSha256",
    "targetDelivery",
  ]) || !exactPlainObject(value.snapshot)) {
    fail("final snapshot artifact wrapper is required");
  }
  if (
    value.canonicalization !==
      "recursively sorted JSON object keys; UTF-8; no whitespace" ||
    !exactKeys(value.rpcAgreement, [
      "independentEndpointCount",
      "snapshotsIdentical",
    ]) ||
    value.rpcAgreement.independentEndpointCount !== "2" ||
    value.rpcAgreement.snapshotsIdentical !== true
  ) {
    fail("snapshot artifact lacks exact independent RPC agreement");
  }
  const computed = sha256CanonicalJson(value.snapshot);
  if (computed !== value.snapshotSha256) {
    fail("snapshot artifact digest does not match its canonical snapshot");
  }
  const targetDelivery = value.targetDelivery;
  if (!exactKeys(targetDelivery, [
    "chainId",
    "targetDesignSha256",
    "distributorAddress",
    "distributorRuntimeCodeKeccak256",
    "tokenAddress",
    "tokenRuntimeCodeKeccak256",
    "tokenTotalSupplyRaw",
  ])) {
    fail("snapshot target delivery is malformed");
  }
  const targetDesign = normalizeMainTokenMigrationTargetDesign(
    targetDesignInput,
    targetDesignSourceFiles,
  );
  if (
    unsignedBigInt(targetDelivery.chainId, "target delivery chainId") !==
      MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetChainId ||
    unsignedBigInt(
      targetDelivery.tokenTotalSupplyRaw,
      "target delivery tokenTotalSupplyRaw",
    ) !== MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetTokenTotalSupplyRaw ||
    targetDelivery.targetDesignSha256 !== targetDesign.designSha256 ||
    normalizedAddress(targetDelivery.tokenAddress, "target delivery tokenAddress") !==
      targetDesign.tokenAddress ||
    normalizedAddress(
      targetDelivery.distributorAddress,
      "target delivery distributorAddress",
    ) !== targetDesign.distributorAddress ||
    exactBytes32(
      targetDelivery.tokenRuntimeCodeKeccak256,
      "target delivery tokenRuntimeCodeKeccak256",
    ) !== targetDesign.tokenRuntimeCodeKeccak256 ||
    exactBytes32(
      targetDelivery.distributorRuntimeCodeKeccak256,
      "target delivery distributorRuntimeCodeKeccak256",
    ) !== targetDesign.distributorRuntimeCodeKeccak256
  ) {
    fail("snapshot target delivery differs from the frozen target design");
  }
  return {
    snapshot: value.snapshot,
    snapshotSha256: computed,
    targetDesign,
  };
}

function normalizeAllocation(value, label) {
  if (!exactPlainObject(value)) fail(`${label} is malformed`);
  const account = normalizedAddress(value.address, `${label}.address`);
  const amountRaw = unsignedBigInt(value.amountRaw, `${label}.amountRaw`);
  if (amountRaw === 0n) fail(`${label}.amountRaw is zero`);
  return { account, amountRaw };
}

function normalizeManualDecisions(value, snapshotSha256, evidenceFiles) {
  if (!exactPlainObject(value)) fail("manual-review decisions are malformed");
  if (value.schema !== MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.manualReviewDecisionSchema) {
    fail("manual-review decision schema is unsupported");
  }
  if (value.snapshotSha256 !== snapshotSha256) {
    fail("manual-review decisions are not bound to this snapshot");
  }
  if (!Array.isArray(value.decisions)) fail("manual-review decisions are not an array");

  const decisions = new Map();
  const referencedEvidenceFiles = new Set();
  for (const [index, decision] of value.decisions.entries()) {
    const label = `manual-review decision ${index}`;
    if (!exactKeys(decision, [
      "address",
      "amountRaw",
      "decision",
      "reviewEvidenceFile",
      "reviewEvidenceSha256",
    ])) fail(`${label} is malformed`);
    const account = normalizedAddress(decision.address, `${label}.address`);
    if (decisions.has(account)) fail(`${label}.address is duplicated`);
    const amountRaw = unsignedBigInt(decision.amountRaw, `${label}.amountRaw`);
    if (decision.decision !== "include_same_address") {
      fail(`${label} attempts to exclude or redirect a source allocation`);
    }
    if (!SHA256.test(String(decision.reviewEvidenceSha256 ?? "")) ||
      decision.reviewEvidenceSha256 === ZERO_SHA256) {
      fail(`${label}.reviewEvidenceSha256 is malformed`);
    }
    if (!EVIDENCE_FILE.test(String(decision.reviewEvidenceFile ?? ""))) {
      fail(`${label}.reviewEvidenceFile is not a safe evidence filename`);
    }
    if (!(evidenceFiles instanceof Map)) {
      fail("manual-review evidence bytes were not supplied");
    }
    const evidence = evidenceFiles.get(decision.reviewEvidenceFile);
    if (!(evidence instanceof Uint8Array) || evidence.byteLength === 0) {
      fail(`${label}.reviewEvidenceFile was not supplied`);
    }
    const computedEvidenceSha256 =
      `sha256:${createHash("sha256").update(evidence).digest("hex")}`;
    if (computedEvidenceSha256 !== decision.reviewEvidenceSha256) {
      fail(`${label}.reviewEvidenceSha256 does not match the evidence bytes`);
    }
    if (referencedEvidenceFiles.has(decision.reviewEvidenceFile)) {
      fail(`${label}.reviewEvidenceFile is duplicated`);
    }
    referencedEvidenceFiles.add(decision.reviewEvidenceFile);
    decisions.set(account, {
      account,
      amountRaw,
      reviewEvidenceFile: decision.reviewEvidenceFile,
      reviewEvidenceSha256: decision.reviewEvidenceSha256,
    });
  }
  if (evidenceFiles instanceof Map &&
    evidenceFiles.size !== referencedEvidenceFiles.size) {
    fail("manual-review evidence contains an unreferenced file");
  }
  return {
    decisions,
    decisionsSha256: sha256CanonicalJson(value),
  };
}

function snapshotRule(snapshot) {
  const boundary = snapshot?.policy?.snapshotBoundaryRule;
  const cutoff = snapshot?.policy?.cutoff;
  const conversion = snapshot?.policy?.conversion;
  if (
    typeof boundary !== "string" ||
    typeof cutoff !== "string" ||
    typeof conversion !== "string"
  ) {
    fail("snapshot policy does not contain the frozen boundary, cutoff, and conversion rules");
  }
  return `${boundary}|${cutoff}|${conversion}|same EVM recipient only`;
}

function normalizeSnapshot(
  snapshot,
  snapshotSha256,
  manualReviewDecisions,
  targetDesign,
  manualReviewEvidenceFiles,
) {
  if (snapshot.schema !== MAIN_TOKEN_MIGRATION_POLICY.schema) {
    fail("snapshot schema is unsupported");
  }
  if (snapshot.policy?.releaseId !== MAIN_TOKEN_MIGRATION_POLICY.releaseId) {
    fail("snapshot releaseId is not the frozen release");
  }
  const sourceChainId = unsignedBigInt(snapshot.chain?.id, "snapshot.chain.id");
  if (sourceChainId !== MAIN_TOKEN_MIGRATION_POLICY.chainId) {
    fail("snapshot source chain is not Ethereum Mainnet");
  }
  if (
    String(snapshot.chain?.genesisHash ?? "").toLowerCase() !==
    MAIN_TOKEN_MIGRATION_POLICY.ethereumGenesisHash
  ) {
    fail("snapshot source genesis hash is not Ethereum Mainnet");
  }
  if (snapshot.finality?.status !== "verified") {
    fail("snapshot finality is not verified");
  }
  const sourceToken = normalizedAddress(
    snapshot.sourceToken?.address,
    "snapshot.sourceToken.address",
  );
  if (sourceToken !== MAIN_TOKEN_MIGRATION_POLICY.tokenAddress.toLowerCase()) {
    fail("snapshot source token is not the frozen V4 token");
  }
  if (
    unsignedBigInt(snapshot.sourceToken?.decimals, "snapshot.sourceToken.decimals") !==
    MAIN_TOKEN_MIGRATION_POLICY.tokenDecimals
  ) {
    fail("snapshot source token decimals are not frozen at 18");
  }
  if (
    unsignedBigInt(
      snapshot.sourceToken?.totalSupplyRaw,
      "snapshot.sourceToken.totalSupplyRaw",
    ) !== MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw
  ) {
    fail("snapshot source token supply is not the frozen one-billion supply");
  }
  const sourceDeadlineTimestampExclusive = unsignedBigInt(
    snapshot.policy?.deadlineTimestampExclusive,
    "snapshot.policy.deadlineTimestampExclusive",
  );
  if (sourceDeadlineTimestampExclusive === 0n) {
    fail("snapshot source deadline is zero");
  }
  if (
    sourceDeadlineTimestampExclusive !== targetDesign.deadlineTimestampExclusive ||
    snapshotRule(snapshot) !== targetDesign.snapshotRule
  ) {
    fail("snapshot domain differs from the frozen deployed target immutables");
  }
  if (!Array.isArray(snapshot.automaticAllocations)) {
    fail("snapshot automatic allocations are not an array");
  }
  if (!Array.isArray(snapshot.manualReviewAllocations)) {
    fail("snapshot manual-review allocations are not an array");
  }

  const normalizedDecisions = normalizeManualDecisions(
    manualReviewDecisions,
    snapshotSha256,
    manualReviewEvidenceFiles,
  );
  const decisions = normalizedDecisions.decisions;
  const allocations = snapshot.automaticAllocations.map((allocation, index) =>
    normalizeAllocation(allocation, `automatic allocation ${index}`),
  );
  const automaticTotalRaw = allocations.reduce(
    (sum, allocation) => sum + allocation.amountRaw,
    0n,
  );
  let manualReviewTotalRaw = 0n;
  for (const [index, allocationValue] of snapshot.manualReviewAllocations.entries()) {
    const allocation = normalizeAllocation(
      allocationValue,
      `manual-review allocation ${index}`,
    );
    const decision = decisions.get(allocation.account);
    if (!decision) {
      fail(`manual-review allocation ${allocation.account} lacks an include_same_address decision`);
    }
    if (decision.amountRaw !== allocation.amountRaw) {
      fail(`manual-review allocation ${allocation.account} decision changes the raw amount`);
    }
    allocations.push(allocation);
    manualReviewTotalRaw += allocation.amountRaw;
    decisions.delete(allocation.account);
  }
  if (decisions.size !== 0) {
    fail("manual-review decisions contain an address absent from the snapshot review queue");
  }

  allocations.sort((left, right) =>
    left.account < right.account ? -1 : left.account > right.account ? 1 : 0,
  );
  for (const allocation of allocations) {
    if (
      allocation.account === targetDesign.tokenAddress ||
      allocation.account === targetDesign.distributorAddress
    ) {
      fail(`allocation address ${allocation.account} cannot receive target tokens`);
    }
  }
  for (let index = 1; index < allocations.length; index += 1) {
    if (allocations[index - 1].account === allocations[index].account) {
      fail(`allocation address ${allocations[index].account} is duplicated`);
    }
  }
  if (allocations.length === 0) fail("snapshot has no migration allocations");

  const migrationTotalRaw = allocations.reduce(
    (sum, allocation) => sum + allocation.amountRaw,
    0n,
  );
  if (
    migrationTotalRaw === 0n ||
    migrationTotalRaw >
      MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetTokenTotalSupplyRaw
  ) {
    fail("migration allocation total is outside the fixed target supply");
  }
  if (snapshot.reconciliation?.matches !== true) {
    fail("snapshot reconciliation is not marked exact");
  }
  if (
    unsignedBigInt(
      snapshot.reconciliation?.automaticAllocationRaw,
      "snapshot.reconciliation.automaticAllocationRaw",
    ) !== automaticTotalRaw ||
    unsignedBigInt(
      snapshot.reconciliation?.manualReviewAllocationRaw,
      "snapshot.reconciliation.manualReviewAllocationRaw",
    ) !== manualReviewTotalRaw ||
    unsignedBigInt(
      snapshot.reconciliation?.combinedAllocationRaw,
      "snapshot.reconciliation.combinedAllocationRaw",
    ) !== migrationTotalRaw ||
    unsignedBigInt(
      snapshot.reconciliation?.inboundRaw,
      "snapshot.reconciliation.inboundRaw",
    ) !== migrationTotalRaw
  ) {
    fail("snapshot reconciliation totals do not match its allocation rows");
  }

  const rule = snapshotRule(snapshot);
  const releaseIdHash = keccak256(stringToHex(snapshot.policy.releaseId));
  const snapshotRuleHash = keccak256(stringToHex(rule));
  if (
    releaseIdHash !== targetDesign.releaseIdHash ||
    snapshotRuleHash !== targetDesign.snapshotRuleHash
  ) {
    fail("snapshot hashes differ from the frozen deployed target immutables");
  }
  return {
    allocations,
    manualReviewDecisionsSha256: normalizedDecisions.decisionsSha256,
    migrationTotalRaw,
    releaseId: snapshot.policy.releaseId,
    releaseIdHash,
    snapshotRule: rule,
    snapshotRuleHash,
    sourceChainId,
    sourceDeadlineTimestampExclusive,
    sourceSnapshotSha256: snapshotSha256,
    sourceSnapshotSha256Bytes32: sha256Bytes32(
      snapshotSha256,
      "snapshotSha256",
    ),
    sourceToken,
  };
}

export function migrationAllocationLeaf(domain, index, account, amountRaw) {
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
      ],
      [
        domain.allocationTypehash,
        domain.targetChainId,
        domain.releaseIdHash,
        domain.sourceChainId,
        domain.sourceToken,
        domain.sourceDeadlineTimestampExclusive,
        domain.snapshotRuleHash,
        domain.sourceSnapshotSha256Bytes32,
        index,
        account,
        amountRaw,
      ],
    ),
  );
  return keccak256(inner);
}

export function migrationMerkleHashPair(left, right) {
  const normalizedLeft = exactBytes32(left, "Merkle left node");
  const normalizedRight = exactBytes32(right, "Merkle right node");
  return normalizedLeft < normalizedRight
    ? keccak256(`${normalizedLeft}${normalizedRight.slice(2)}`)
    : keccak256(`${normalizedRight}${normalizedLeft.slice(2)}`);
}

function buildMerkleTree(leaves) {
  const layers = [leaves];
  while (layers.at(-1).length > 1) {
    const current = layers.at(-1);
    const next = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(
        index + 1 < current.length
          ? migrationMerkleHashPair(current[index], current[index + 1])
          : current[index],
      );
    }
    layers.push(next);
  }
  return layers;
}

function merkleProof(layers, leafIndex) {
  const proof = [];
  let index = leafIndex;
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    const layer = layers[layerIndex];
    const sibling = index ^ 1;
    if (sibling < layer.length) proof.push(layer[sibling]);
    index = Math.floor(index / 2);
  }
  return proof;
}

export function verifyMigrationMerkleProof(leaf, proof, root) {
  let computed = exactBytes32(leaf, "Merkle leaf");
  for (const sibling of proof) computed = migrationMerkleHashPair(computed, sibling);
  return computed === exactBytes32(root, "Merkle root");
}

export function buildMainTokenMigrationDistribution(
  snapshotInput,
  manualReviewDecisions,
  targetDesignInput,
  manualReviewEvidenceFiles,
  targetDesignSourceFiles,
) {
  const { snapshot, snapshotSha256, targetDesign } = normalizeSnapshotInput(
    snapshotInput,
    targetDesignInput,
    targetDesignSourceFiles,
  );
  const normalized = normalizeSnapshot(
    snapshot,
    snapshotSha256,
    manualReviewDecisions,
    targetDesign,
    manualReviewEvidenceFiles,
  );
  const allocationTypehash = keccak256(
    stringToHex(MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.allocationType),
  );
  const domain = {
    allocationTypehash,
    releaseIdHash: normalized.releaseIdHash,
    snapshotRuleHash: normalized.snapshotRuleHash,
    sourceChainId: normalized.sourceChainId,
    sourceDeadlineTimestampExclusive:
      normalized.sourceDeadlineTimestampExclusive,
    sourceSnapshotSha256Bytes32: normalized.sourceSnapshotSha256Bytes32,
    sourceToken: normalized.sourceToken,
    targetChainId:
      MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetChainId,
  };
  const rows = normalized.allocations.map((allocation, index) => ({
    account: allocation.account,
    amountRaw: allocation.amountRaw,
    index: BigInt(index),
    leaf: migrationAllocationLeaf(
      domain,
      BigInt(index),
      allocation.account,
      allocation.amountRaw,
    ),
  }));
  const layers = buildMerkleTree(rows.map((row) => row.leaf));
  const merkleRoot = layers.at(-1)[0];
  const entries = rows.map((row, index) => {
    const proof = merkleProof(layers, index);
    if (!verifyMigrationMerkleProof(row.leaf, proof, merkleRoot)) {
      fail(`generated proof ${index} does not reproduce the root`);
    }
    return {
      account: row.account,
      amountRaw: row.amountRaw.toString(),
      index: row.index.toString(),
      leaf: row.leaf,
      proof,
    };
  });
  const remainderRaw =
    MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetTokenTotalSupplyRaw -
    normalized.migrationTotalRaw;
  const plan = {
    allocationCount: entries.length.toString(),
    allocationType:
      MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.allocationType,
    allocationTypehash,
    entries,
    manualReviewDecisionsSha256: normalized.manualReviewDecisionsSha256,
    merklePairing: "keccak256(sort(bytes32 left, bytes32 right))",
    merkleRoot,
    reconciliation: {
      migrationTotalRaw: normalized.migrationTotalRaw.toString(),
      remainderRaw: remainderRaw.toString(),
      targetTokenTotalSupplyRaw:
        MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetTokenTotalSupplyRaw.toString(),
      sumsExactly: true,
    },
    releaseId: normalized.releaseId,
    releaseIdHash: normalized.releaseIdHash,
    schema: MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.schema,
    snapshotRule: normalized.snapshotRule,
    snapshotRuleHash: normalized.snapshotRuleHash,
    sourceChainId: normalized.sourceChainId.toString(),
    sourceDeadlineTimestampExclusive:
      normalized.sourceDeadlineTimestampExclusive.toString(),
    sourceSnapshotSha256: normalized.sourceSnapshotSha256,
    sourceSnapshotSha256Bytes32: normalized.sourceSnapshotSha256Bytes32,
    sourceToken: normalized.sourceToken,
    targetChainId:
      MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetChainId.toString(),
    targetDesignSha256: targetDesign.designSha256,
    targetDistributor: targetDesign.distributorAddress,
    targetToken: targetDesign.tokenAddress,
  };
  return {
    ...plan,
    distributionPlanSha256: sha256CanonicalJson(plan),
  };
}
