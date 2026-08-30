import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { keccak256, stringToHex } from "viem";

import { sha256CanonicalJson } from "../main-token-migration-snapshot-core.mjs";
import {
  MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY,
  MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS,
  buildMainTokenMigrationDistribution,
  migrationAllocationLeaf,
  migrationMerkleHashPair,
  verifyMigrationMerkleProof,
} from "../main-token-migration-distribution-core.mjs";
import { readFrozenMigrationSourceFiles } from "../main-token-migration-distribution.mjs";

const ACCOUNT_A = "0x1111111111111111111111111111111111111111";
const ACCOUNT_B = "0x2222222222222222222222222222222222222222";
const ACCOUNT_C = "0x3333333333333333333333333333333333333333";
const SOURCE_TOKEN = "0x7987f03462200b3D8A072E02C89A8A41dCB124EE";
const DEADLINE = "1900000000";
const SNAPSHOT_RULE =
  "first-canonical-block-at-or-after-timestamp|block.timestamp >= windowStart && block.timestamp < deadline|1:1 raw token units|same EVM recipient only";
const TARGET_TOKEN = "0x5555555555555555555555555555555555555555";
const TARGET_DISTRIBUTOR = "0x6666666666666666666666666666666666666666";
const TARGET_TOKEN_HASH = `0x${"77".repeat(32)}`;
const TARGET_DISTRIBUTOR_HASH = `0x${"88".repeat(32)}`;
const RELEASE_ID_HASH =
  "0xe22e729786da05c9b8b2b4c94df049badbdbd427563177c87abe4e1036edde6e";
const ALLOCATION_TYPEHASH =
  "0xad2fffcc1f1c630a5449082a781eabf0c6b3e2e19597d5858353e4ca24e95fe7";
const REVIEW_EVIDENCE_FILE = "account-c-review.json";
const REVIEW_EVIDENCE_BYTES = Buffer.from(
  '{"address":"0x3333333333333333333333333333333333333333","reviewed":true}\n',
  "utf8",
);
const REVIEW_EVIDENCE_SHA256 =
  `sha256:${createHash("sha256").update(REVIEW_EVIDENCE_BYTES).digest("hex")}`;
const TARGET_DESIGN_SOURCE_BYTES = new Map(
  MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS.map((sourcePath) => [
    sourcePath,
    Buffer.from(`frozen migration source fixture: ${sourcePath}\n`, "utf8"),
  ]),
);

function evidenceFiles() {
  return new Map([[REVIEW_EVIDENCE_FILE, REVIEW_EVIDENCE_BYTES]]);
}

function targetDesignSourceFiles() {
  return new Map(
    [...TARGET_DESIGN_SOURCE_BYTES].map(([sourcePath, bytes]) => [
      sourcePath,
      Buffer.from(bytes),
    ]),
  );
}

function snapshot(overrides = {}) {
  return {
    automaticAllocations: [
      { address: ACCOUNT_B, amountRaw: "200", eventCount: "1" },
      { address: ACCOUNT_A, amountRaw: "100", eventCount: "1" },
    ],
    chain: {
      genesisHash:
        "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3",
      id: "1",
      name: "Ethereum Mainnet",
    },
    finality: { status: "verified" },
    manualReviewAllocations: [
      {
        address: ACCOUNT_C,
        amountRaw: "300",
        eventCount: "1",
        reviewReasons: ["runtime_code_observed"],
      },
    ],
    policy: {
      conversion: "1:1 raw token units",
      cutoff: "block.timestamp >= windowStart && block.timestamp < deadline",
      deadlineTimestampExclusive: DEADLINE,
      releaseId: "v4-ethereum-to-robinhood-96h-2026-v1",
      snapshotBoundaryRule: "first-canonical-block-at-or-after-timestamp",
    },
    reconciliation: {
      automaticAllocationRaw: "300",
      combinedAllocationRaw: "600",
      inboundRaw: "600",
      manualReviewAllocationRaw: "300",
      matches: true,
    },
    schema: "programmable-main-token-migration-snapshot/v2",
    sourceToken: {
      address: SOURCE_TOKEN,
      decimals: "18",
      symbol: "V4",
      totalSupplyRaw: "1000000000000000000000000000",
    },
    ...overrides,
  };
}

function decisions(snapshotValue, entries = null) {
  return {
    decisions: entries ?? [
      {
        address: ACCOUNT_C,
        amountRaw: "300",
        decision: "include_same_address",
        reviewEvidenceFile: REVIEW_EVIDENCE_FILE,
        reviewEvidenceSha256: REVIEW_EVIDENCE_SHA256,
      },
    ],
    schema:
      "programmable-main-token-migration-manual-review-decisions/v1",
    snapshotSha256: sha256CanonicalJson(snapshotValue),
  };
}

function targetDesign(overrides = {}) {
  return {
    schema: "programmable-main-token-migration-target-design/v1",
    state: "deployed-finalized-source-window-pending",
    enabled: true,
    releaseId: "v4-ethereum-to-robinhood-96h-2026-v1",
    releaseIdHash: RELEASE_ID_HASH,
    source: {
      chainId: "1",
      tokenAddress: SOURCE_TOKEN,
      tokenDecimals: "18",
      tokenTotalSupplyRaw: "1000000000000000000000000000",
      deadlineTimestampExclusive: DEADLINE,
      snapshotRule: SNAPSHOT_RULE,
      snapshotRuleHash: keccak256(stringToHex(SNAPSHOT_RULE)),
    },
    target: {
      chainId: "4663",
      tokenName: "Programmable",
      tokenSymbol: "V4",
      tokenDecimals: "18",
      tokenTotalSupplyRaw: "1000000000000000000000000000",
      tokenAddress: TARGET_TOKEN,
      distributorAddress: TARGET_DISTRIBUTOR,
      tokenRuntimeCodeKeccak256: TARGET_TOKEN_HASH,
      distributorRuntimeCodeKeccak256: TARGET_DISTRIBUTOR_HASH,
    },
    deployment: {
      transactionHash: `0x${"11".repeat(32)}`,
      blockNumber: "123",
      blockHash: `0x${"22".repeat(32)}`,
      finalizedBlockNumber: "125",
      finalizedBlockHash: `0x${"33".repeat(32)}`,
      independentRpcAgreement: true,
      tokenMigrationDistributorAddress: TARGET_DISTRIBUTOR,
      distributorTokenBalanceRaw: "1000000000000000000000000000",
      distributorIsSealed: false,
      verificationReceiptSha256: `sha256:${"44".repeat(32)}`,
    },
    authorities: {
      sealAuthority: "0x7777777777777777777777777777777777777777",
      remainderRecipient: "0x8888888888888888888888888888888888888888",
      sealAuthorityPower:
        "one call at or after the frozen source deadline to bind root, snapshot digest, and migration total",
      postSealAdministrativePower: "none",
    },
    distribution: {
      allocationType:
        MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.allocationType,
      allocationTypehash: ALLOCATION_TYPEHASH,
      leafHashing:
        "keccak256(bytes.concat(keccak256(abi.encode(allocation fields))))",
      pairHashing: "keccak256(sort(bytes32 left, bytes32 right))",
      recipientRule:
        "exact same EVM address committed in the leaf; caller cannot redirect",
      singleDistribution: "permissionless",
      batchDistribution: "permissionless, atomic, maximum 64 entries",
      duplicateProtection: "uint256 bitmap indexed by allocation index",
      vesting: "none",
      rescueOrSweep: "none",
    },
    activationGuards: {
      targetDeploymentBeforeSourceWindowRequired: true,
      fullTargetSupplyLockedInDistributorBeforeSourceWindowRequired: true,
      sealBeforeSourceDeadlineAllowed: false,
      sealIsOneTime: true,
      distributionBeforeSealAllowed: false,
      deploymentEnabled: true,
      sealEnabled: false,
      distributionEnabled: false,
    },
    build: {
      solcVersion: "0.8.26",
      evmVersion: "cancun",
      optimizerEnabled: true,
      optimizerRuns: "1000",
      bytecodeHash: "none",
      cborMetadata: false,
      openzeppelinContractsCommit:
        "21c8312b022f495ebe3621d5daeed20552b43ff9",
      sources: MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS.map((sourcePath) => ({
        path: sourcePath,
        sha256: `sha256:${createHash("sha256")
          .update(TARGET_DESIGN_SOURCE_BYTES.get(sourcePath))
          .digest("hex")}`,
      })),
    },
    remainingOwnerFields: [],
    ...overrides,
  };
}

function artifact(snapshotValue, designValue = targetDesign()) {
  return {
    canonicalization: "recursively sorted JSON object keys; UTF-8; no whitespace",
    rpcAgreement: {
      independentEndpointCount: "2",
      snapshotsIdentical: true,
    },
    snapshot: snapshotValue,
    snapshotSha256: sha256CanonicalJson(snapshotValue),
    targetDelivery: {
      chainId: "4663",
      targetDesignSha256: sha256CanonicalJson(designValue),
      distributorAddress: designValue.target.distributorAddress,
      distributorRuntimeCodeKeccak256:
        designValue.target.distributorRuntimeCodeKeccak256,
      tokenAddress: designValue.target.tokenAddress,
      tokenRuntimeCodeKeccak256:
        designValue.target.tokenRuntimeCodeKeccak256,
      tokenTotalSupplyRaw: designValue.target.tokenTotalSupplyRaw,
    },
  };
}

function build(snapshotValue, review = decisions(snapshotValue), design = targetDesign()) {
  return buildMainTokenMigrationDistribution(
    artifact(snapshotValue, design),
    review,
    design,
    review.decisions.length === 0 ? new Map() : evidenceFiles(),
    targetDesignSourceFiles(),
  );
}

test("builds deterministic same-address proofs with exact sum and remainder", () => {
  const snapshotValue = snapshot();
  const first = build(snapshotValue);
  const second = build(snapshotValue);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "programmable-main-token-migration-distribution/v1");
  assert.equal(first.targetChainId, "4663");
  assert.equal(first.sourceChainId, "1");
  assert.equal(first.sourceDeadlineTimestampExclusive, DEADLINE);
  assert.equal(first.sourceToken, SOURCE_TOKEN.toLowerCase());
  assert.deepEqual(
    first.entries.map((entry) => entry.account),
    [ACCOUNT_A, ACCOUNT_B, ACCOUNT_C],
  );
  assert.deepEqual(
    first.entries.map((entry) => entry.index),
    ["0", "1", "2"],
  );
  assert.equal(first.reconciliation.migrationTotalRaw, "600");
  assert.equal(
    first.reconciliation.remainderRaw,
    "999999999999999999999999400",
  );
  assert.equal(
    BigInt(first.reconciliation.migrationTotalRaw) +
      BigInt(first.reconciliation.remainderRaw),
    MAIN_TOKEN_MIGRATION_DISTRIBUTION_POLICY.targetTokenTotalSupplyRaw,
  );
  assert.match(first.distributionPlanSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(first.manualReviewDecisionsSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first.targetDesignSha256, sha256CanonicalJson(targetDesign()));

  const domain = {
    allocationTypehash: first.allocationTypehash,
    releaseIdHash: first.releaseIdHash,
    snapshotRuleHash: first.snapshotRuleHash,
    sourceChainId: BigInt(first.sourceChainId),
    sourceDeadlineTimestampExclusive: BigInt(
      first.sourceDeadlineTimestampExclusive,
    ),
    sourceSnapshotSha256Bytes32: first.sourceSnapshotSha256Bytes32,
    sourceToken: first.sourceToken,
    targetChainId: BigInt(first.targetChainId),
  };
  for (const entry of first.entries) {
    assert.equal(
      entry.leaf,
      migrationAllocationLeaf(
        domain,
        BigInt(entry.index),
        entry.account,
        BigInt(entry.amountRaw),
      ),
    );
    assert.equal(
      verifyMigrationMerkleProof(entry.leaf, entry.proof, first.merkleRoot),
      true,
    );
  }
});

test("accepts a digest-bound snapshot artifact", () => {
  const snapshotValue = snapshot();
  const designValue = targetDesign();
  const finalArtifact = artifact(snapshotValue, designValue);
  const plan = buildMainTokenMigrationDistribution(
    finalArtifact,
    decisions(snapshotValue),
    designValue,
    evidenceFiles(),
    targetDesignSourceFiles(),
  );
  assert.equal(plan.sourceSnapshotSha256, finalArtifact.snapshotSha256);
});

test("rejects a bare self-asserted snapshot without RPC and target bindings", () => {
  const snapshotValue = snapshot();
  assert.throws(
    () => buildMainTokenMigrationDistribution(
      snapshotValue,
      decisions(snapshotValue),
      targetDesign(),
      evidenceFiles(),
      targetDesignSourceFiles(),
    ),
    /final snapshot artifact wrapper is required/u,
  );
});

test("rejects a tampered snapshot artifact", () => {
  const snapshotValue = snapshot();
  const designValue = targetDesign();
  const tamperedArtifact = {
    ...artifact(snapshotValue, designValue),
    snapshotSha256: `sha256:${"00".repeat(32)}`,
  };
  assert.throws(
    () =>
      buildMainTokenMigrationDistribution(
        tamperedArtifact,
        decisions(snapshotValue),
        designValue,
        evidenceFiles(),
        targetDesignSourceFiles(),
      ),
    /digest does not match/u,
  );
});

test("requires an explicit same-address decision for every manual allocation", () => {
  const snapshotValue = snapshot();
  assert.throws(
    () =>
      build(snapshotValue, decisions(snapshotValue, [])),
    /lacks an include_same_address decision/u,
  );
});

test("rejects manual exclusion, redirect semantics, or amount changes", () => {
  const snapshotValue = snapshot();
  const excluded = decisions(snapshotValue);
  excluded.decisions[0].decision = "exclude";
  assert.throws(
    () => build(snapshotValue, excluded),
    /attempts to exclude or redirect/u,
  );

  const changed = decisions(snapshotValue);
  changed.decisions[0].amountRaw = "301";
  assert.throws(
    () => build(snapshotValue, changed),
    /changes the raw amount/u,
  );

  const redirected = decisions(snapshotValue);
  redirected.decisions[0].address = ACCOUNT_B;
  assert.throws(
    () => build(snapshotValue, redirected),
    /lacks an include_same_address decision/u,
  );
});

test("rejects duplicate recipients across automatic and reviewed allocations", () => {
  const snapshotValue = snapshot({
    manualReviewAllocations: [
      { address: ACCOUNT_A, amountRaw: "300", eventCount: "1" },
    ],
  });
  const review = decisions(snapshotValue, [
    {
      address: ACCOUNT_A,
      amountRaw: "300",
      decision: "include_same_address",
      reviewEvidenceSha256: REVIEW_EVIDENCE_SHA256,
      reviewEvidenceFile: REVIEW_EVIDENCE_FILE,
    },
  ]);
  assert.throws(
    () => build(snapshotValue, review),
    /is duplicated/u,
  );
});

test("rejects a migration total above the fixed one-billion supply", () => {
  const snapshotValue = snapshot({
    automaticAllocations: [
      {
        address: ACCOUNT_A,
        amountRaw: "1000000000000000000000000001",
        eventCount: "1",
      },
    ],
    manualReviewAllocations: [],
    reconciliation: {
      automaticAllocationRaw: "1000000000000000000000000001",
      combinedAllocationRaw: "1000000000000000000000000001",
      inboundRaw: "1000000000000000000000000001",
      manualReviewAllocationRaw: "0",
      matches: true,
    },
  });
  assert.throws(
    () =>
      build(snapshotValue, decisions(snapshotValue, [])),
    /outside the fixed target supply/u,
  );
});

test("rejects zero review evidence and a target design mismatch", () => {
  const snapshotValue = snapshot();
  const zeroEvidence = decisions(snapshotValue);
  zeroEvidence.decisions[0].reviewEvidenceSha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(() => build(snapshotValue, zeroEvidence), /reviewEvidenceSha256/u);

  assert.throws(
    () => buildMainTokenMigrationDistribution(
      artifact(snapshotValue),
      decisions(snapshotValue),
      targetDesign(),
      new Map([[REVIEW_EVIDENCE_FILE, Buffer.from("fabricated", "utf8")]]),
      targetDesignSourceFiles(),
    ),
    /does not match the evidence bytes/u,
  );

  const designValue = targetDesign();
  const mismatchedDesign = targetDesign({
    target: {
      ...designValue.target,
      tokenRuntimeCodeKeccak256: `0x${"99".repeat(32)}`,
    },
  });
  assert.throws(
    () => buildMainTokenMigrationDistribution(
      artifact(snapshotValue, designValue),
      decisions(snapshotValue),
      mismatchedDesign,
      evidenceFiles(),
      targetDesignSourceFiles(),
    ),
    /target delivery differs/u,
  );
});

test("rejects target domains that differ from the deployed Solidity literals", () => {
  const snapshotValue = snapshot();
  for (const mutation of [
    (design) => ({ ...design, releaseIdHash: `0x${"99".repeat(32)}` }),
    (design) => ({
      ...design,
      distribution: {
        ...design.distribution,
        allocationTypehash: `0x${"aa".repeat(32)}`,
      },
    }),
    (design) => ({
      ...design,
      deployment: {
        ...design.deployment,
        tokenMigrationDistributorAddress: ACCOUNT_A,
      },
    }),
    (design) => ({
      ...design,
      deployment: {
        ...design.deployment,
        finalizedBlockNumber: "122",
      },
    }),
  ]) {
    const design = mutation(targetDesign());
    assert.throws(
      () => buildMainTokenMigrationDistribution(
        artifact(snapshotValue, design),
        decisions(snapshotValue),
        design,
        evidenceFiles(),
        targetDesignSourceFiles(),
      ),
      /activated immutable migration design/u,
    );
  }
});

test("rejects allocations to the target token or distributor", () => {
  for (const blockedAddress of [TARGET_TOKEN, TARGET_DISTRIBUTOR]) {
    const snapshotValue = snapshot({
      automaticAllocations: [
        { address: blockedAddress, amountRaw: "600", eventCount: "1" },
      ],
      manualReviewAllocations: [],
      reconciliation: {
        automaticAllocationRaw: "600",
        combinedAllocationRaw: "600",
        inboundRaw: "600",
        manualReviewAllocationRaw: "0",
        matches: true,
      },
    });
    assert.throws(
      () => build(snapshotValue, decisions(snapshotValue, [])),
      /cannot receive target tokens/u,
    );
  }
});

test("requires exact frozen source bytes from every direct core caller", () => {
  const snapshotValue = snapshot();
  const designValue = targetDesign();
  const invoke = (sourceFiles) => buildMainTokenMigrationDistribution(
    artifact(snapshotValue, designValue),
    decisions(snapshotValue),
    designValue,
    evidenceFiles(),
    sourceFiles,
  );

  assert.throws(() => invoke(undefined), /frozen source bytes were not supplied/u);

  const missing = targetDesignSourceFiles();
  missing.delete(MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS[0]);
  assert.throws(() => invoke(missing), /source byte inventory is incomplete/u);

  const extra = targetDesignSourceFiles();
  extra.set("scripts/unfrozen-source.mjs", Buffer.from("unexpected\n", "utf8"));
  assert.throws(() => invoke(extra), /unexpected file/u);

  const drifted = targetDesignSourceFiles();
  const driftedPath = MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS[2];
  drifted.set(driftedPath, Buffer.from("drifted source bytes\n", "utf8"));
  assert.throws(
    () => invoke(drifted),
    new RegExp(`sha256 does not match its bytes: ${driftedPath}`, "u"),
  );
});

test("rejects missing or extra paths in the frozen design inventory", () => {
  const snapshotValue = snapshot();
  const baseline = targetDesign();
  const inventories = [
    baseline.build.sources.slice(0, -1),
    [
      ...baseline.build.sources,
      {
        path: "scripts/unfrozen-source.mjs",
        sha256: `sha256:${"99".repeat(32)}`,
      },
    ],
  ];
  for (const sources of inventories) {
    const designValue = targetDesign({
      build: { ...baseline.build, sources },
    });
    assert.throws(
      () => buildMainTokenMigrationDistribution(
        artifact(snapshotValue, designValue),
        decisions(snapshotValue),
        designValue,
        evidenceFiles(),
        targetDesignSourceFiles(),
      ),
      /activated immutable migration design/u,
    );
  }
});

test("CLI rejects a frozen source symlink that escapes the repository root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "programmable-migration-sources-"));
  const outside = await mkdtemp(path.join(tmpdir(), "programmable-migration-outside-"));
  try {
    for (const sourcePath of MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS) {
      const candidate = path.join(root, sourcePath);
      await mkdir(path.dirname(candidate), { recursive: true });
      await writeFile(candidate, `physical source fixture: ${sourcePath}\n`);
    }
    const outsideFile = path.join(outside, "escaped-source.mjs");
    await writeFile(outsideFile, "escaped source bytes\n");
    const symlinkPath = path.join(
      root,
      MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS.at(-1),
    );
    await rm(symlinkPath);
    await symlink(outsideFile, symlinkPath);

    await assert.rejects(
      () => readFrozenMigrationSourceFiles(root),
      /Frozen source escapes its repository root/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  }
});

test("matches the frozen Solidity allocation and Merkle known-answer vector", () => {
  const domain = {
    allocationTypehash: ALLOCATION_TYPEHASH,
    targetChainId: 4663n,
    releaseIdHash: RELEASE_ID_HASH,
    sourceChainId: 1n,
    sourceToken: SOURCE_TOKEN,
    sourceDeadlineTimestampExclusive: 1_900_000_000n,
    snapshotRuleHash:
      "0x6720fe7cfe3d287cc5f21d264bb4a4125f1ab7f37189407d213c89489ed2d5f0",
    sourceSnapshotSha256Bytes32:
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  };
  const leaves = [
    migrationAllocationLeaf(domain, 0n, ACCOUNT_A, 100n),
    migrationAllocationLeaf(domain, 1n, ACCOUNT_B, 200n),
    migrationAllocationLeaf(domain, 2n, ACCOUNT_C, 300n),
  ];
  assert.deepEqual(leaves, [
    "0xfaac6d5d4d5000374eef29617bfbf20d13c0d0d7cb0a256e803c8518fa9fca29",
    "0x54f3d4d3349d19a27efa50969ee5098a55be7868b7baeeaf151179605d90191a",
    "0x39e7c088ab62e59234e785bd6b787d0125d6a4d6d956f944433f5c3b7245b24d",
  ]);
  const pair =
    "0xd11907ca87401ab5f42b41d9eb9606fd704d42673bc822356e607e77ed5bcf7f";
  assert.equal(migrationMerkleHashPair(leaves[0], leaves[1]), pair);
  const root = migrationMerkleHashPair(pair, leaves[2]);
  assert.equal(
    root,
    "0x701000a3e13361cb07c7a9da4707ab970a33884226af429cd28ce48ce8fa21b4",
  );
  assert.equal(verifyMigrationMerkleProof(leaves[0], [leaves[1], leaves[2]], root), true);
  assert.equal(verifyMigrationMerkleProof(leaves[1], [leaves[0], leaves[2]], root), true);
  assert.equal(verifyMigrationMerkleProof(leaves[2], [pair], root), true);
});

test("keeps the checked-in predeployment design disabled and source-byte pinned", async () => {
  const repositoryRoot = new URL("../../", import.meta.url);
  const design = JSON.parse(
    await readFile(
      new URL("config/main-token-migration-target-design.v1.json", repositoryRoot),
      "utf8",
    ),
  );
  assert.equal(design.enabled, false);
  assert.equal(design.activationGuards.deploymentEnabled, false);
  assert.equal(design.source.snapshotSha256, undefined);
  assert.equal(design.postSnapshotFields, undefined);
  assert.deepEqual(design.remainingOwnerFields, [
    "source.deadlineTimestampExclusive",
    "authorities.sealAuthority",
    "authorities.remainderRecipient",
  ]);
  assert.deepEqual(
    design.build.sources.map((source) => source.path),
    MAIN_TOKEN_MIGRATION_DISTRIBUTION_SOURCE_PATHS,
  );
  const sourceFiles = await readFrozenMigrationSourceFiles();
  for (const source of design.build.sources) {
    const bytes = sourceFiles.get(source.path);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.equal(source.sha256, digest, source.path);
  }
});
