import { canonicalJson } from "./submission-core.mjs";
import {
  architectureSnapshotSha256,
  bundledSupportingArtifactDocument,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  PROGRAMMABLE_FEE_V2
} from "./open-world-v2-core.mjs";
import {
  ARCHITECTURE_DECISIONS_SCHEMA_ID,
  IDEA_SOURCE_SCHEMA_ID,
  INTENT_CONTRACT_SCHEMA_ID,
  INTENT_FIDELITY_SCHEMA_ID,
  OPEN_WORLD_MIGRATION_SCHEMA_VERSION,
  OPEN_WORLD_SUBMISSION_SCHEMA_ID,
  TARGET_SUBMISSION_STANDARD,
  sha256Bytes,
  sha256Canonical
} from "./open-world-migration-contract.mjs";
import {
  canonicalFileRecord,
  cloneJson,
  fail,
  isPlainObject,
  legacyMigrationChainId,
  normalizeLegacyPathList,
  normalizeMigrationSourceRef,
  requireLegacyApplicationId,
  requireNonEmptyString
} from "./open-world-migration-shared.mjs";

/**
 * Deterministically project one parsed legacy submission into an explicitly unconfirmed
 * open-world v2 package. The function is pure: it accepts no filesystem path to write,
 * performs no I/O, and returns canonical file contents for a separate caller to materialize.
 *
 * sourceRef is the caller's exact byte/Git observation and must contain:
 *   path, sha256, byteLength, commit (or revisionObjectId), tree (or treeObjectId).
 * Optional repositoryUri, numericRepositoryId, schemaId and applicationPackageSha256 values
 * are preserved as bindings but never treated as validation or approval.
 */

export function migrateLegacySubmissionToOpenWorldV2({ legacySubmission, sourceRef }) {
  if (!isPlainObject(legacySubmission)) {
    fail("LEGACY_SUBMISSION_INVALID", "legacySubmission must be one parsed JSON object");
  }
  const originalCanonical = canonicalJson(legacySubmission);
  const originalCanonicalSha256 = sha256Bytes(Buffer.from(originalCanonical, "utf8"));
  const source = normalizeMigrationSourceRef(sourceRef, legacySubmission, originalCanonicalSha256);
  const applicationId = requireLegacyApplicationId(legacySubmission);
  const historicalStage = legacySubmission.stage === "prototype" ? "prototype" : "proposal";
  // A migration cannot inherit prototype readiness. The generated target remains a proposal
  // until fee-v2 conformance and the recaptured owner intent have fresh review evidence.
  const stage = "proposal";
  // Legacy prose is not copied into the new public package. It may contain secrets or text
  // that the owner never approved for publication. Exact historical bytes remain hash/Git-bound.
  const targetName = `Legacy migration ${applicationId}`;
  const targetSummary = "A source-bound legacy package awaiting public-safe owner intent recapture. No legacy title, summary, or inferred product claim is copied into this target preview.";
  const legacyStandardVersion = requireNonEmptyString(
    legacySubmission.standardVersion,
    "legacy submission standardVersion",
    100
  );
  const legacyFeeProjectionSha256 = sha256Canonical(legacySubmission.programmableFee ?? null);
  const targetChainId = legacyMigrationChainId(legacySubmission);

  const migrationProfileSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:programmable:legacy-migration-profile:1.0.0",
    title: "Programmable legacy migration profile",
    description: "Closed non-executable profile for source-bound facts that remain unconfirmed during a legacy migration.",
    type: "object",
    additionalProperties: false,
    required: [
      "captureStatus",
      "originalSubmissionSha256",
      "originalCanonicalSha256",
      "legacyStandardVersion",
      "historicalStage",
      "status"
    ],
    properties: {
      captureStatus: { const: "unavailable-legacy" },
      originalSubmissionSha256: { const: source.sha256 },
      originalCanonicalSha256: { const: originalCanonicalSha256 },
      legacyStandardVersion: { type: "string", minLength: 1, maxLength: 100 },
      historicalStage: { enum: ["proposal", "prototype"] },
      status: { const: "legacy-unconfirmed" },
      statement: { type: "string", minLength: 1, maxLength: 5000 },
      scope: { type: "string", minLength: 1, maxLength: 500 },
      owner: { type: "string", minLength: 1, maxLength: 500 },
      policyProjectionSha256: { const: legacyFeeProjectionSha256 },
      historicalPolicyId: { type: ["string", "null"], maxLength: 120 },
      historicalPolicyVersion: { type: ["string", "null"], maxLength: 100 },
      targetPolicyId: { type: "string", minLength: 1, maxLength: 120 },
      conformanceRequired: { type: "boolean" },
      chainId: { const: targetChainId }
    }
  };
  const migrationProfileRecord = canonicalFileRecord(
    "legacy-migration-profile.v1.schema.json",
    migrationProfileSchema
  );
  const profileSchemaBinding = Object.freeze({
    kind: "repository",
    schemaId: migrationProfileSchema.$id,
    path: migrationProfileRecord.path,
    sha256: migrationProfileRecord.sha256,
    byteLength: migrationProfileRecord.byteLength
  });
  const baseLegacyProfile = Object.freeze({
    captureStatus: "unavailable-legacy",
    originalSubmissionSha256: source.sha256,
    originalCanonicalSha256,
    legacyStandardVersion,
    historicalStage,
    status: "legacy-unconfirmed"
  });

  const ideaSource = {
    schemaVersion: "1.0.0",
    applicationId,
    captureStatus: "unavailable-legacy",
    originalEntryId: null,
    entries: [],
    legacySourceRefs: [
      source.path,
      `${source.path}#/model/name`,
      `${source.path}#/model/summary`
    ]
  };
  const ideaSourceRecord = canonicalFileRecord("idea-source.v1.json", ideaSource);

  const factInputs = Object.freeze([
    Object.freeze({
      id: "legacy-application-title",
      kind: "legacy-application-title",
      statement: "A legacy title exists at the bound source pointer; its text is withheld until public-safe owner recapture.",
      sourcePointer: `${source.path}#/model/name`
    }),
    Object.freeze({
      id: "legacy-application-summary",
      kind: "legacy-application-summary",
      statement: "A legacy summary exists at the bound source pointer; its text is withheld until public-safe owner recapture.",
      sourcePointer: `${source.path}#/model/summary`
    })
  ]);
  const intentContract = {
    schemaVersion: "1.0.0",
    applicationId,
    revision: 1,
    ideaSourceSha256: ideaSourceRecord.sha256,
    status: "legacy-unconfirmed",
    workingLanguage: "und",
    route: {
      id: "CUSTOM_ARCHITECTURE",
      reasons: [{
        language: "en",
        text: "The legacy package is preserved, but the owner's original intent must be recaptured before architecture and fidelity can be reviewed."
      }],
      blockedByRefs: factInputs.map(({ id }) => id)
    },
    entities: [],
    facts: factInputs.map(({ id, kind, statement, sourcePointer }) => ({
      id,
      kind,
      materiality: "material",
      modality: "desired",
      state: "legacy-unconfirmed",
      subjectRefs: [],
      semanticPayload: {
        ...baseLegacyProfile,
        statement
      },
      payloadSchema: profileSchemaBinding,
      plainLanguage: {
        language: "und",
        text: statement
      },
      provenance: [{
        ideaEntryId: null,
        startByte: null,
        endByte: null,
        legacySourceRef: sourcePointer,
        relation: "legacy-derived"
      }]
    })),
    ambiguities: [],
    confirmation: {
      state: "legacy-unconfirmed",
      ideaEntryId: null,
      confirmedFactIds: [],
      delegatedDefaultFactIds: []
    }
  };
  const intentContractRecord = canonicalFileRecord("intent-contract.v1.json", intentContract);

  const architectureDecisions = {
    schemaVersion: "1.0.0",
    applicationId,
    revision: 1,
    intentContractSha256: intentContractRecord.sha256,
    decisions: []
  };
  const architectureDecisionsRecord = canonicalFileRecord(
    "architecture-decisions.v1.json",
    architectureDecisions
  );

  const feePolicySchemaRecord = canonicalFileRecord(
    OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.feePolicySchema.file,
    bundledSupportingArtifactDocument("feePolicySchema")
  );
  const securityAssessmentSchemaRecord = canonicalFileRecord(
    OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessmentSchema.file,
    bundledSupportingArtifactDocument("securityAssessmentSchema")
  );
  const securityAssessment = {
    schemaVersion: "open-world-security-v1",
    subject: {
      id: applicationId,
      revision: source.commit,
      stage: "proposal"
    },
    assessment: {
      state: "unassessed",
      reasonCode: "LEGACY_INTENT_UNAVAILABLE",
      evidenceRefs: [],
      sourceCoverage: null
    },
    layers: {
      intent: {
        evidenceRefs: [],
        customProfiles: []
      }
    },
    extensions: []
  };
  const securityAssessmentRecord = canonicalFileRecord(
    OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessment.file,
    securityAssessment
  );

  const platformOwner = PROGRAMMABLE_FEE_V2.owner;
  const legacyPolicyId = typeof legacySubmission?.programmableFee?.policyId === "string"
    ? legacySubmission.programmableFee.policyId
    : null;
  const legacyPolicyVersion = typeof legacySubmission?.programmableFee?.policyVersion === "string"
    ? legacySubmission.programmableFee.policyVersion
    : null;
  const builtinFeePolicySchema = Object.freeze({
    kind: "builtin",
    schemaId: PROGRAMMABLE_FEE_V2.policySchemaId,
    path: null,
    sha256: null,
    byteLength: null
  });
  const architecture = {
    targets: [{
      id: "legacy-application-scope",
      kind: "legacy-application",
      profileSchema: profileSchemaBinding,
      profile: {
        ...baseLegacyProfile,
        scope: "whole-legacy-submission"
      }
    }],
    assets: [
      {
        id: "legacy-fee-base-asset",
        kind: "legacy-unresolved-base-asset",
        roleIds: ["base", "launched"],
        profileSchema: profileSchemaBinding,
        profile: {
          ...baseLegacyProfile,
          scope: "fee-v2-base-asset-placeholder"
        },
        authorityRefs: []
      },
      {
        id: "legacy-fee-quote-asset",
        kind: "legacy-unresolved-quote-asset",
        roleIds: ["quote"],
        profileSchema: profileSchemaBinding,
        profile: {
          ...baseLegacyProfile,
          scope: "fee-v2-quote-asset-placeholder"
        },
        authorityRefs: []
      }
    ],
    markets: [{
      id: "legacy-fee-market",
      kind: "uniswap-v4-canonical-pool",
      executionClass: "unknown",
      profileSchema: profileSchemaBinding,
      profile: {
        ...baseLegacyProfile,
        scope: "fee-v2-market-placeholder",
        chainId: targetChainId
      },
      assetRefs: ["legacy-fee-base-asset", "legacy-fee-quote-asset"],
      hookRef: null,
      liquidity: {
        nativeAmmMode: "optional",
        minimumInitialLiquidity: "0",
        sourceRefs: [],
        custodyRefs: []
      },
      canonicalScopes: []
    }],
    hooks: [],
    lifecyclePhases: [],
    components: [],
    valueFlows: [],
    authorities: [{
      id: "programmable-fee-owner",
      kind: "immutable-claim-authority",
      profileSchema: profileSchemaBinding,
      profile: {
        ...baseLegacyProfile,
        scope: "programmable-fee-claim",
        owner: platformOwner
      },
      holder: platformOwner,
      capabilityRefs: [],
      revocation: "immutable"
    }],
    capabilityProfiles: [],
    programmableFee: {
      policyId: PROGRAMMABLE_FEE_V2.policyId,
      policyVersion: PROGRAMMABLE_FEE_V2.policyVersion,
      policyHashPreimage: PROGRAMMABLE_FEE_V2.policyHashPreimage,
      policyHash: PROGRAMMABLE_FEE_V2.policyHash,
      policySchema: builtinFeePolicySchema,
      platformHundredthsOfBip: PROGRAMMABLE_FEE_V2.platformHundredthsOfBip,
      owner: platformOwner,
      feeScopes: [],
      executionScopeRefs: [],
      collectionProfileSchema: profileSchemaBinding,
      collectionProfile: {
        ...baseLegacyProfile,
        scope: "fee-v2-conformance-required",
        policyProjectionSha256: legacyFeeProjectionSha256,
        historicalPolicyId: legacyPolicyId,
        historicalPolicyVersion: legacyPolicyVersion,
        targetPolicyId: PROGRAMMABLE_FEE_V2.policyId,
        conformanceRequired: true
      },
      claimAuthorityRef: "programmable-fee-owner",
      conformance: {
        status: "required",
        evidenceRefs: [],
        evidenceDigests: [],
        scopeArtifacts: []
      }
    },
    implementation: {
      sourcePaths: normalizeLegacyPathList(legacySubmission?.implementation?.sourcePaths, "implementation.sourcePaths"),
      testPaths: normalizeLegacyPathList(legacySubmission?.implementation?.testPaths, "implementation.testPaths"),
      evidenceRefs: [`legacy-submission:${source.sha256}`]
    },
    fragmentation: {
      strategy: "single-review",
      fragments: []
    }
  };
  const tradeCapability = Object.freeze({
    applicability: "unresolved",
    facetEntryRef: "routing-trade-capability",
    markets: Object.freeze([])
  });
  const currentArchitectureSnapshotSha256 = architectureSnapshotSha256({
    ...architecture,
    tradeCapability
  });
  const fidelity = {
    schemaVersion: "1.0.0",
    applicationId,
    revision: 1,
    inputDigests: {
      ideaSourceSha256: ideaSourceRecord.sha256,
      intentContractSha256: intentContractRecord.sha256,
      architectureDecisionsSha256: architectureDecisionsRecord.sha256,
      architectureSnapshotSha256: currentArchitectureSnapshotSha256
    },
    overallStatus: "incomplete",
    traces: factInputs.map(({ id }) => ({
      factId: id,
      status: "unassessed",
      decisionRefs: [],
      architectureRefs: [],
      implementationRefs: [],
      testRefs: [],
      evidenceRefs: [],
      difference: {
        language: "en",
        text: "The original owner intent is unavailable, so this legacy-derived statement cannot yet be assessed for fidelity."
      },
      acceptedChangeIdeaEntryId: null
    })),
    driftEvents: [],
    generatedBy: {
      tool: "programmable-open-world-legacy-migration",
      version: OPEN_WORLD_MIGRATION_SCHEMA_VERSION,
      rulesetSha256: null
    }
  };
  const fidelityRecord = canonicalFileRecord("intent-fidelity.v1.json", fidelity);

  const artifactBinding = (artifactType, schemaId, record) => Object.freeze({
    artifactType,
    schemaId,
    path: record.path,
    sha256: record.sha256,
    byteLength: record.byteLength
  });
  const supportingArtifactBinding = (spec, record) => Object.freeze({
    artifactType: spec.artifactType,
    schemaId: spec.schemaId,
    path: record.path,
    sha256: record.sha256,
    byteLength: record.byteLength
  });
  const targetSubmission = {
    $schema: OPEN_WORLD_SUBMISSION_SCHEMA_ID,
    schemaVersion: 2,
    standardVersion: TARGET_SUBMISSION_STANDARD,
    applicationId,
    stage,
    project: {
      name: targetName,
      summary: {
        language: "und",
        text: targetSummary
      },
      repository: source.repositoryUri,
      license: "UNSPECIFIED-LEGACY"
    },
    intentPackage: {
      ideaSource: artifactBinding("idea-source", IDEA_SOURCE_SCHEMA_ID, ideaSourceRecord),
      intentContract: artifactBinding("intent-contract", INTENT_CONTRACT_SCHEMA_ID, intentContractRecord),
      architectureDecisions: artifactBinding(
        "architecture-decisions",
        ARCHITECTURE_DECISIONS_SCHEMA_ID,
        architectureDecisionsRecord
      ),
      intentFidelity: artifactBinding("intent-fidelity", INTENT_FIDELITY_SCHEMA_ID, fidelityRecord)
    },
    supportingPackage: {
      feePolicySchema: supportingArtifactBinding(
        OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.feePolicySchema,
        feePolicySchemaRecord
      ),
      feePolicy: null,
      securityAssessmentSchema: supportingArtifactBinding(
        OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessmentSchema,
        securityAssessmentSchemaRecord
      ),
      securityAssessment: supportingArtifactBinding(
        OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessment,
        securityAssessmentRecord
      )
    },
    tradeCapability,
    ...architecture
  };
  const targetSubmissionRecord = canonicalFileRecord("submission.v2.json", targetSubmission);
  const fileRecords = Object.freeze([
    migrationProfileRecord,
    ideaSourceRecord,
    intentContractRecord,
    architectureDecisionsRecord,
    fidelityRecord,
    feePolicySchemaRecord,
    securityAssessmentSchemaRecord,
    securityAssessmentRecord,
    targetSubmissionRecord
  ]);
  const targetPackageSha256 = sha256Canonical({
    schemaVersion: OPEN_WORLD_MIGRATION_SCHEMA_VERSION,
    applicationId,
    files: fileRecords.map(({ path: filePath, byteLength, sha256 }) => ({
      path: filePath,
      byteLength,
      sha256
    }))
  });
  const originalBinding = Object.freeze({
    schemaId: source.schemaId,
    schemaVersion: cloneJson(legacySubmission.schemaVersion ?? null),
    standardVersion: legacyStandardVersion,
    path: source.path,
    byteLength: source.byteLength,
    sha256: source.sha256,
    canonicalDocumentSha256: originalCanonicalSha256,
    commit: source.commit,
    tree: source.tree,
    repositoryUri: source.repositoryUri,
    numericRepositoryId: source.numericRepositoryId,
    applicationPackageSha256: source.applicationPackageSha256
  });
  const targetLineage = Object.freeze({
    kind: "schema-migration",
    previous: Object.freeze({
      schemaId: originalBinding.schemaId,
      standardVersion: originalBinding.standardVersion,
      path: originalBinding.path,
      byteLength: originalBinding.byteLength,
      sha256: originalBinding.sha256,
      commit: originalBinding.commit,
      tree: originalBinding.tree,
      applicationPackageSha256: originalBinding.applicationPackageSha256
    })
  });
  const migrationReportWithoutDigest = {
    kind: "open-world-v2-legacy-migration-report",
    schemaVersion: OPEN_WORLD_MIGRATION_SCHEMA_VERSION,
    applicationId,
    historicalResult: {
      status: "preserved-source-binding",
      original: originalBinding,
      historicalFeeProjection: {
        status: "historical-unconfirmed",
        policyId: legacyPolicyId,
        policyVersion: legacyPolicyVersion,
        sha256: legacyFeeProjectionSha256
      },
      validatorExecution: "not-run",
      approvalInherited: false
    },
    targetPreview: {
      schemaId: OPEN_WORLD_SUBMISSION_SCHEMA_ID,
      standardVersion: TARGET_SUBMISSION_STANDARD,
      packageSha256: targetPackageSha256,
      lineage: targetLineage,
      captureStatus: "unavailable-legacy",
      legacyFactState: "legacy-unconfirmed",
      fidelityAssessment: "unassessed",
      architectureAssessment: "unassessed",
      stage,
      executionClass: "unknown",
      feeScopeStatus: "UNRESOLVED",
      route: "INTEGRATION_PENDING",
      feePolicy: {
        policySchemaId: PROGRAMMABLE_FEE_V2.policySchemaId,
        policyId: PROGRAMMABLE_FEE_V2.policyId,
        policyVersion: PROGRAMMABLE_FEE_V2.policyVersion,
        policyHashPreimage: PROGRAMMABLE_FEE_V2.policyHashPreimage,
        policyHash: PROGRAMMABLE_FEE_V2.policyHash,
        owner: PROGRAMMABLE_FEE_V2.owner,
        conformanceStatus: "required"
      },
      approvalCreated: false
    },
    sourceSubmissionPreserved: true,
    historicalEvidencePreserved: true,
    writePerformed: false,
    networkAccessed: false,
    externalActionsPerformed: []
  };
  const migrationReport = Object.freeze({
    ...migrationReportWithoutDigest,
    reportSha256: sha256Canonical(migrationReportWithoutDigest)
  });
  const result = Object.freeze({
    kind: "open-world-v2-legacy-migration",
    schemaVersion: OPEN_WORLD_MIGRATION_SCHEMA_VERSION,
    source: originalBinding,
    target: Object.freeze({
      schemaId: OPEN_WORLD_SUBMISSION_SCHEMA_ID,
      standardVersion: TARGET_SUBMISSION_STANDARD,
      applicationId,
      packageSha256: targetPackageSha256,
      fileCount: fileRecords.length,
      lineage: targetLineage
    }),
    files: fileRecords,
    migrationReport,
    dryRun: true,
    writePerformed: false,
    networkAccessed: false,
    externalActionsPerformed: []
  });
  if (canonicalJson(legacySubmission) !== originalCanonical) {
    fail("LEGACY_SUBMISSION_MUTATED", "the pure migration changed its legacy input");
  }
  return result;
}

/**
 * Inspect one historical six-file application package and its exact local source checkout.
 *
 * This function is intentionally read-only. It never creates a target submission, rewrites the
 * historical package, executes project code, accesses the network, or performs a Git write.
 */
