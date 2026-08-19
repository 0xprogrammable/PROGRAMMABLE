import { APPLICATION_V3_REQUIRED_KINDS, CliFailure, FULL_GIT_OBJECT_PATTERN, MAX_OUTPUT_FILE_BYTES, MAX_OUTPUT_PACKAGE_BYTES, MAX_ROOT_MANIFEST_BYTES, canonicalJson, computeRawGitObjectId, createOpenWorldDraftPackage, deriveDependencyAwareSecurityAssessment, fs, path, sha256Bytes, strictUtf8 } from "./open-world-shared.mjs";

const TRADE_APPLICATION_RECORD_KINDS = new Set(["trade-capability-manifest", "trade-test-result"]);

export function installOpenWorldApplicationAssembly(runtime) {
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const parseStrictCliJson = (...args) => runtime.parseStrictCliJson(...args);
  const relative = (...args) => runtime.relative(...args);
  const routeStrictJsonResourceFailure = (...args) => runtime.routeStrictJsonResourceFailure(...args);
  const runGitBytes = (...args) => runtime.runGitBytes(...args);

  function readCommittedJsonAtPath(repositoryRoot, commit, binding, label) {
    if (
      !binding
      || typeof binding.path !== "string"
      || !FULL_GIT_OBJECT_PATTERN.test(commit ?? "")
      || !FULL_GIT_OBJECT_PATTERN.test(binding.blobObjectId ?? "")
    ) {
      throw new CliFailure("APPLICATION_SOURCE_MANIFEST_INVALID", `${label} binding is incomplete`, { exitCode: 1 });
    }
    const listing = runGitBytes(
      repositoryRoot,
      ["ls-tree", "-z", "--full-tree", commit, "--", binding.path],
      `${label} tree entry`,
      16_384
    );
    const entry = parseApplicationTreeEntry(listing, binding.path, label);
    if (entry.objectId !== binding.blobObjectId) {
      throw new CliFailure("APPLICATION_SOURCE_MANIFEST_INVALID", `${label} Git blob differs from its declared binding`, { exitCode: 1 });
    }
    if (!Number.isSafeInteger(binding.byteLength) || binding.byteLength < 1 || binding.byteLength > MAX_ROOT_MANIFEST_BYTES) {
      throw new CliFailure("APPLICATION_SOURCE_MANIFEST_INVALID", `${label} exceeds the bounded root-manifest size`, { exitCode: 1 });
    }
    const bytes = runGitBytes(repositoryRoot, ["cat-file", "blob", entry.objectId], `${label} blob`, binding.byteLength + 1);
    if (computeRawGitObjectId("blob", bytes) !== entry.objectId) {
      throw new CliFailure("APPLICATION_SOURCE_MANIFEST_GIT_OBJECT_HASH_MISMATCH", `${label} raw bytes do not hash to the pinned Git blob identity`, { exitCode: 1 });
    }
    let source;
    let document;
    try {
      source = strictUtf8.decode(bytes);
      document = parseStrictCliJson(source, MAX_ROOT_MANIFEST_BYTES);
    } catch (error) {
      routeStrictJsonResourceFailure(error, `${label} exceeds the bounded source-manifest JSON review window`);
      throw new CliFailure("APPLICATION_SOURCE_MANIFEST_INVALID", `${label} must be canonical UTF-8 JSON`, { exitCode: 1 });
    }
    if (
      bytes.length !== binding.byteLength
      || sha256Bytes(bytes) !== binding.sha256
      || source !== `${canonicalJson(document)}\n`
    ) {
      throw new CliFailure("APPLICATION_SOURCE_MANIFEST_INVALID", `${label} bytes do not match the exact canonical binding`, { exitCode: 1 });
    }
    return { document, bytes, objectId: entry.objectId };
  }

  function parseApplicationTreeEntry(bytes, repositoryPath, label) {
    const records = bytes.toString("utf8").split("\0").filter(Boolean);
    const match = records.length === 1
      ? /^([0-7]{6}) (blob) ([0-9a-f]{40})\t(.+)$/u.exec(records[0])
      : null;
    if (match === null || match[4] !== repositoryPath || !new Set(["100644", "100755"]).has(match[1])) {
      throw new CliFailure("APPLICATION_SOURCE_MANIFEST_INVALID", `${label} is not exactly one regular Git blob`, { exitCode: 1 });
    }
    return { mode: match[1], objectId: match[3] };
  }

  function validateApplicationPackageBindings({
    application,
    packageRepositoryRef,
    packageRepositoryRoot,
    packageRoot,
    packageSnapshots,
    feeApplicability
  }) {
    const repository = [application.source.primary, ...application.source.companions]
      .find((candidate) => candidate.id === packageRepositoryRef);
    if (!repository) {
      throw new CliFailure("APPLICATION_V2_PACKAGE_BINDING_MISMATCH", "V2 package repositoryRef is not declared in Application V3", { exitCode: 1 });
    }
    const snapshotsByName = new Map(packageSnapshots.map((snapshot) => [snapshot.packagePath, snapshot]));
    const submission = snapshotsByName.get("submission.v2.json");
    const relativeSubmissionPath = relative(packageRepositoryRoot, submission.path);
    if (
      relativeSubmissionPath !== application.policyBindings?.submissionPath
      || submission.sha256 !== application.policyBindings?.submissionSha256
    ) {
      throw new CliFailure("APPLICATION_V2_PACKAGE_BINDING_MISMATCH", "Application V3 submission path or hash differs from the exact V2 package", { exitCode: 1 });
    }
    for (const snapshot of packageSnapshots) {
      assertCommittedFileSnapshot(packageRepositoryRoot, repository.revisionObjectId, snapshot);
    }

    const submissionDocument = submission.document;
    if (application.policyBindings?.feeApplicability !== feeApplicability) {
      throw new CliFailure(
        "APPLICATION_V3_FEE_APPLICABILITY_MISMATCH",
        "Application V3 feeApplicability differs from the exact validated V2 execution-scope state",
        { exitCode: 1, details: { expected: feeApplicability, actual: application.policyBindings?.feeApplicability ?? null } }
      );
    }
    const bindings = [
      ["idea-source", submissionDocument.intentPackage?.ideaSource, application.intentCapture?.ideaSourcePath, application.intentCapture?.ideaSourceSha256],
      ["intent-contract", submissionDocument.intentPackage?.intentContract, null, null],
      ["architecture-decisions", submissionDocument.intentPackage?.architectureDecisions, null, null],
      ["intent-fidelity", submissionDocument.intentPackage?.intentFidelity, null, null],
      ["fee-policy-schema", submissionDocument.supportingPackage?.feePolicySchema, application.policyBindings?.feePolicySchemaPath, application.policyBindings?.feePolicySchemaSha256],
      ...(feeApplicability === "applicable"
        ? [["fee-policy", submissionDocument.supportingPackage?.feePolicy, application.policyBindings?.feePolicyInstancePath, application.policyBindings?.feePolicyInstanceSha256]]
        : [])
    ];
    for (const [kind, binding, explicitPath, explicitSha256] of bindings) {
      if (!binding || typeof binding.path !== "string") {
        throw new CliFailure("APPLICATION_V2_PACKAGE_BINDING_MISMATCH", `prototype V2 package is missing ${kind}`, { exitCode: 1 });
      }
      const snapshot = snapshotsByName.get(binding.path);
      const repositoryPath = snapshot ? relative(packageRepositoryRoot, snapshot.path) : null;
      if (
        !snapshot
        || repositoryPath === null
        || snapshot.sha256 !== binding.sha256
        || snapshot.byteLength !== binding.byteLength
        || (explicitPath !== null && explicitPath !== repositoryPath)
        || (explicitSha256 !== null && explicitSha256 !== snapshot.sha256)
      ) {
        throw new CliFailure("APPLICATION_V2_PACKAGE_BINDING_MISMATCH", `${kind} does not match the exact content-addressed V2 artifact`, { exitCode: 1 });
      }
      const reviewMatches = application.reviewPackage?.records?.filter((record) => (
        record.kind === kind
        && record.source === "source-repository"
        && record.repositoryRef === packageRepositoryRef
        && record.path === repositoryPath
        && record.sha256 === snapshot.sha256
        && record.byteLength === snapshot.byteLength
      )) ?? [];
      if (reviewMatches.length !== 1) {
        throw new CliFailure("APPLICATION_V2_REVIEW_BINDING_MISMATCH", `Application V3 must bind exact ${kind} bytes once as a source-repository review record`, { exitCode: 1 });
      }
    }
    for (const snapshot of packageSnapshots) {
      const repositoryPath = relative(packageRepositoryRoot, snapshot.path);
      if (TRADE_APPLICATION_RECORD_KINDS.has(snapshot.artifactKind)) {
        const reviewMatches = application.reviewPackage?.records?.filter((record) => (
          record.kind === snapshot.artifactKind
          && record.source === "application-package"
          && record.repositoryRef === null
          && record.path === snapshot.packagePath
          && record.sha256 === snapshot.sha256
          && record.byteLength === snapshot.byteLength
        )) ?? [];
        if (reviewMatches.length !== 1) {
          throw new CliFailure(
            "APPLICATION_V2_REVIEW_BINDING_MISMATCH",
            "every trade manifest and local trade-test result requires one exact application-package mirror",
            { exitCode: 1 }
          );
        }
        continue;
      }
      const reviewMatches = application.reviewPackage?.records?.filter((record) => (
        record.kind === snapshot.artifactKind
        && record.source === "source-repository"
        && record.repositoryRef === packageRepositoryRef
        && record.path === repositoryPath
        && record.sha256 === snapshot.sha256
        && record.byteLength === snapshot.byteLength
      )) ?? [];
      if (reviewMatches.length !== 1) {
        throw new CliFailure(
          "APPLICATION_V2_REVIEW_BINDING_MISMATCH",
          "every consumed V2 submission, receipt, vector, extension schema, and supporting artifact requires one exact source-repository review record",
          { exitCode: 1 }
        );
      }
    }
    const expectedTradeRecords = deriveTradeApplicationArtifacts(packageSnapshots).map(({ reviewRecord }) => reviewRecord);
    const actualTradeRecords = (application.reviewPackage?.records ?? []).filter(({ kind }) => TRADE_APPLICATION_RECORD_KINDS.has(kind));
    const tradeRecordIdentity = ({ kind, path: recordPath, source, repositoryRef, sha256, byteLength }) => canonicalJson({ kind, path: recordPath, source, repositoryRef, sha256, byteLength });
    if (
      actualTradeRecords.length !== expectedTradeRecords.length
      || canonicalJson(actualTradeRecords.map(tradeRecordIdentity).sort(compareUtf8)) !== canonicalJson(expectedTradeRecords.map(tradeRecordIdentity).sort(compareUtf8))
    ) {
      throw new CliFailure(
        "APPLICATION_V2_REVIEW_BINDING_MISMATCH",
        "trade application-package records must biject the exact validated V2 manifest and result snapshots; orphan route evidence is forbidden",
        { exitCode: 1 }
      );
    }
    if (feeApplicability === "not-applicable") {
      const instanceFields = [
        application.policyBindings?.feePolicyInstancePath,
        application.policyBindings?.feePolicyInstanceRepositoryRef,
        application.policyBindings?.feePolicyInstanceSha256
      ];
      const feePolicyReviewRecords = application.reviewPackage?.records?.filter(({ kind }) => kind === "fee-policy") ?? [];
      if (
        submissionDocument.supportingPackage?.feePolicy !== null
        || !instanceFields.every((value) => value === null)
        || feePolicyReviewRecords.length !== 0
      ) {
        throw new CliFailure(
          "APPLICATION_V3_FEE_NOT_APPLICABLE_BINDING_INVALID",
          "exact zero-scope fee-not-applicable packages require a null fee-policy instance tuple and no fee-policy review record",
          { exitCode: 1 }
        );
      }
    }
    if (fs.realpathSync(path.dirname(submission.path)) !== fs.realpathSync(packageRoot)) {
      throw new CliFailure("APPLICATION_V2_PACKAGE_BINDING_MISMATCH", "V2 package submission is not rooted in the selected package directory", { exitCode: 1 });
    }
  }

  function materializeApplicationV2SourceReviewRecords({
    application,
    packageRepositoryRef,
    packageRepositoryRoot,
    packageSnapshots
  }) {
    if (!Array.isArray(application?.reviewPackage?.records)) {
      throw new CliFailure("APPLICATION_V2_REVIEW_BINDING_MISMATCH", "Application V3 review records are unavailable for exact V2 source derivation", { exitCode: 1 });
    }
    const normalizations = [];
    for (const snapshot of packageSnapshots) {
      const repositoryPath = relative(packageRepositoryRoot, snapshot.path);
      if (TRADE_APPLICATION_RECORD_KINDS.has(snapshot.artifactKind)) {
        const sourceMirrors = application.reviewPackage.records.filter((record) => (
          record?.source === "source-repository"
          && record.repositoryRef === packageRepositoryRef
          && record.path === repositoryPath
          && TRADE_APPLICATION_RECORD_KINDS.has(record.kind)
        ));
        if (sourceMirrors.length > 0) {
          throw new CliFailure(
            "APPLICATION_V2_REVIEW_BINDING_MISMATCH",
            "trade manifests and results must be mirrored into the Application package, not treated as source-closure review records",
            { exitCode: 1 }
          );
        }
        const identityMatches = application.reviewPackage.records.filter((record) => (
          record?.source === "application-package"
          && record.repositoryRef === null
          && record.path === snapshot.packagePath
        ));
        if (identityMatches.length === 0) {
          application.reviewPackage.records.push({
            kind: snapshot.artifactKind,
            path: snapshot.packagePath,
            mediaType: "application/json",
            byteLength: snapshot.byteLength,
            sha256: snapshot.sha256,
            source: "application-package",
            repositoryRef: null
          });
          continue;
        }
        if (
          identityMatches.length !== 1
          || identityMatches[0].kind !== snapshot.artifactKind
          || identityMatches[0].mediaType !== "application/json"
          || identityMatches[0].byteLength !== snapshot.byteLength
          || identityMatches[0].sha256 !== snapshot.sha256
        ) {
          throw new CliFailure(
            "APPLICATION_V2_REVIEW_BINDING_MISMATCH",
            "an existing Application trade-record identity conflicts with the exact validated V2 artifact",
            { exitCode: 1 }
          );
        }
        continue;
      }
      const identityMatches = application.reviewPackage.records.filter((record) => (
        record?.source === "source-repository"
        && record.repositoryRef === packageRepositoryRef
        && record.path === repositoryPath
      ));
      const mediaType = new Set([
        "fee-policy-schema",
        "security-assessment-schema",
        "extension-schema"
      ]).has(snapshot.artifactKind)
        ? "application/schema+json"
        : "application/json";
      if (identityMatches.length === 0) {
        application.reviewPackage.records.push({
          kind: snapshot.artifactKind,
          path: repositoryPath,
          mediaType,
          byteLength: snapshot.byteLength,
          sha256: snapshot.sha256,
          source: "source-repository",
          repositoryRef: packageRepositoryRef
        });
        continue;
      }
      if (
        identityMatches.length !== 1
        || identityMatches[0].byteLength !== snapshot.byteLength
        || identityMatches[0].sha256 !== snapshot.sha256
      ) {
        throw new CliFailure(
          "APPLICATION_V2_REVIEW_BINDING_MISMATCH",
          "an existing V2 source-review identity conflicts with the exact committed artifact",
          {
            exitCode: 1,
            details: {
              artifactKind: snapshot.artifactKind,
              repositoryPath,
              identityMatchCount: identityMatches.length,
              observedKinds: identityMatches.map(({ kind }) => kind),
              expectedSha256: snapshot.sha256,
              observedSha256: identityMatches.map(({ sha256 }) => sha256),
              expectedByteLength: snapshot.byteLength,
              observedByteLength: identityMatches.map(({ byteLength }) => byteLength)
            }
          }
        );
      }
      const priorKind = identityMatches[0].kind;
      identityMatches[0].kind = snapshot.artifactKind;
      identityMatches[0].mediaType = mediaType;
      if (priorKind !== snapshot.artifactKind) {
        normalizations.push(Object.freeze({
          repositoryRef: packageRepositoryRef,
          path: repositoryPath,
          sha256: snapshot.sha256,
          priorKind,
          kind: snapshot.artifactKind
        }));
      }
    }
    return Object.freeze(normalizations);
  }

  function normalizeApplicationV2SecurityEvidenceBindingKinds(bindings, normalizations) {
    if (!Array.isArray(bindings) || normalizations.length === 0) return;
    for (const normalization of normalizations) {
      for (const binding of bindings) {
        if (
          binding?.source === "source-repository"
          && binding.repositoryRef === normalization.repositoryRef
          && binding.path === normalization.path
          && binding.sha256 === normalization.sha256
          && binding.kind === normalization.priorKind
        ) binding.kind = normalization.kind;
      }
    }
  }

  function assertCommittedFileSnapshot(repositoryRoot, commit, snapshot) {
    const repositoryPath = relative(repositoryRoot, snapshot.path);
    if (repositoryPath.length === 0 || repositoryPath.startsWith("../")) {
      throw new CliFailure("APPLICATION_SOURCE_FILE_UNBOUND", "a V2 package artifact is outside its declared source repository", { exitCode: 1 });
    }
    const listing = runGitBytes(repositoryRoot, ["ls-tree", "-z", "--full-tree", commit, "--", repositoryPath], "source artifact tree entry", 16_384);
    const entry = parseApplicationTreeEntry(listing, repositoryPath, "source artifact");
    const committed = runGitBytes(repositoryRoot, ["cat-file", "blob", entry.objectId], "source artifact blob", snapshot.byteLength + 1);
    if (!committed.equals(snapshot.bytes)) {
      throw new CliFailure("APPLICATION_SOURCE_FILE_UNBOUND", "working V2 package bytes differ from the pinned source commit", { exitCode: 1 });
    }
  }

  function assertPublicApplicationInputs(snapshots) {
    const chunkBytes = 512 * 1024;
    for (const snapshot of snapshots) {
      let text;
      try {
        text = snapshot.structuredPublicHashFieldsVerified === true
          ? canonicalJson(maskVerifiedPublicHashFields(snapshot.document))
          : snapshot.text ?? strictUtf8.decode(snapshot.bytes);
      } catch {
        throw new CliFailure("PUBLIC_APPLICATION_INPUT_INVALID", "a public Application V3 input is not valid UTF-8", { exitCode: 1 });
      }
      for (let offset = 0; offset < text.length; offset += chunkBytes - 256) {
        const chunk = text.slice(offset, offset + chunkBytes);
        let privacy;
        try {
          privacy = createOpenWorldDraftPackage({
            applicationId: "application-public-input-scan",
            publicIdeaText: chunk,
            sourceRef: { publicId: "application-input" }
          });
        } catch {
          throw new CliFailure("PUBLIC_APPLICATION_INPUT_INVALID", "a public Application V3 input could not be privacy-scanned", { exitCode: 1 });
        }
        if (privacy?.report?.ideaEligibility === "HELD_FOR_PRIVACY_REDACTION") {
          throw new CliFailure(
            "PUBLIC_APPLICATION_REDACTION_REQUIRED",
            "an Application V3 input may contain a secret, key, token, seed phrase, private PII, or financial identifier and must be manually redacted",
            {
              exitCode: 1,
              details: {
                inputPath: path.basename(snapshot.path),
                candidateKinds: privacy.report.findings
                  ?.flatMap((finding) => finding?.details?.candidateKinds ?? [])
                  .filter((value) => typeof value === "string")
                  .slice(0, 32) ?? [],
                writePerformed: false
              }
            }
          );
        }
        if (offset + chunkBytes >= text.length) break;
      }
    }
  }

  function maskVerifiedPublicHashFields(value, fieldName = null) {
    if (typeof value === "string") {
      if (
        typeof fieldName === "string"
        && publicHashFieldName(fieldName)
        && /^(?:sha256:|0x)?[0-9a-fA-F]{64}$/u.test(value)
      ) return "PUBLIC_CONTENT_HASH_REDACTED_FOR_PRIVACY_CLASSIFICATION";
      return value;
    }
    if (Array.isArray(value)) return value.map((entry) => maskVerifiedPublicHashFields(entry, fieldName));
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      maskVerifiedPublicHashFields(
        child,
        publicHashFieldName(fieldName)
          && /^(?:const|default|enum|examples)$/u.test(key)
          ? fieldName
          : key
      )
    ]));
  }

  function publicHashFieldName(fieldName) {
    if (typeof fieldName !== "string") return false;
    const tokens = fieldName
      .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
      .split(/[^A-Za-z0-9]+/u)
      .map((token) => token.toLowerCase())
      .filter(Boolean);
    if (tokens.some((token) => [
      "private",
      "secret",
      "credential",
      "password",
      "token",
      "seed",
      "mnemonic",
      "signing",
      "recovery",
      "wallet",
      "key"
    ].includes(token))) return false;
    const compact = tokens.join("");
    if (["keyhash", "wallethash", "privatekeyhash", "signingkeyhash", "recoverykeyhash"].includes(compact)) return false;
    return /(?:sha256|hash(?:hex32)?|poolid|objectid|revisionobjectid|treeobjectid|commitobjectid|blobobjectid)$/iu.test(fieldName);
  }

  function deriveSourceAssessedSecurityAssessment({ draft, application, sourceCoverage }) {
    try {
      return deriveDependencyAwareSecurityAssessment({ draft, application, sourceCoverage });
    } catch (error) {
      const missingCoverage = error?.code === "DEPENDENCY_POINTER_COVERAGE_MISSING";
      throw new CliFailure(
        missingCoverage ? "APPLICATION_DEPENDENCY_POINTER_COVERAGE_REQUIRED" : "APPLICATION_SOURCE_SECURITY_REVIEW_REQUIRED",
        missingCoverage
          ? "every source verifier report must contain closed dependency pointer coverage before Application materialization"
          : "the derived security input must contain a source-assessed review with nonempty source-layer evidence and exact verified pointer identities; raw byte verification alone cannot invent security review",
        {
          exitCode: 1,
          details: {
            derivationCode: typeof error?.code === "string" ? error.code : "DEPENDENCY_SECURITY_DERIVATION_FAILED",
            ideaEligibility: "ELIGIBLE_FOR_REVIEW",
            writePerformed: false
          }
        }
      );
    }
  }

  function assembleDerivedApplicationV3({
    application,
    securityAssessment,
    sourceCoverage,
    packageSnapshots,
    reviewSnapshots
  }) {
    const assembled = JSON.parse(canonicalJson(application));
    const securityArtifacts = deriveSecurityArtifactRecords(packageSnapshots, securityAssessment);
    const tradeArtifacts = deriveTradeApplicationArtifacts(packageSnapshots);
    const sourceRecords = (Array.isArray(assembled?.reviewPackage?.records) ? assembled.reviewPackage.records : [])
      .filter((record) => (
        record?.source === "source-repository"
        && record.kind !== "source-closure-verification"
        && !TRADE_APPLICATION_RECORD_KINDS.has(record.kind)
      ));
    const applicationRecords = [
      ...reviewSnapshots.map((snapshot) => ({
        kind: snapshot.reviewSpec.kind,
        path: snapshot.reviewSpec.path,
        mediaType: snapshot.reviewSpec.mediaType,
        byteLength: snapshot.byteLength,
        sha256: snapshot.sha256,
        source: "application-package",
        repositoryRef: null
      })),
      securityArtifacts.schema.reviewRecord,
      securityArtifacts.assessment.reviewRecord,
      ...tradeArtifacts.map(({ reviewRecord }) => reviewRecord),
      ...sourceCoverage.map((coverage) => ({
        kind: "source-closure-verification",
        path: coverage.verificationReportPath,
        mediaType: "application/json",
        byteLength: coverage.verificationReportByteLength,
        sha256: coverage.verificationReportSha256,
        source: "application-package",
        repositoryRef: null
      }))
    ];
    const records = [...sourceRecords, ...applicationRecords].sort((left, right) => compareUtf8(
      `${left.source}:${left.repositoryRef ?? ""}:${left.kind}:${left.path}`,
      `${right.source}:${right.repositoryRef ?? ""}:${right.kind}:${right.path}`
    ));
    const identities = records.map((record) => `${record.source}:${record.repositoryRef ?? ""}:${record.path}`);
    if (new Set(identities).size !== identities.length) {
      throw new CliFailure("APPLICATION_REVIEW_PACKAGE_INVALID", "derived and source review records contain a duplicate source/path identity", { exitCode: 1 });
    }
    assembled.reviewPackage = {
      schemaVersion: "1.0.0",
      requiredKinds: [...APPLICATION_V3_REQUIRED_KINDS],
      records
    };
    assembled.securityBindings = {
      securityAssessmentSchemaId: "urn:programmable:open-world-security:1.0.0",
      securityAssessmentSchemaPath: securityArtifacts.schema.path,
      securityAssessmentSchemaRepositoryRef: null,
      securityAssessmentSchemaSha256: securityArtifacts.schema.sha256,
      securityAssessmentSchemaByteLength: securityArtifacts.schema.byteLength,
      securityAssessmentPath: securityArtifacts.assessment.path,
      securityAssessmentRepositoryRef: null,
      securityAssessmentSha256: securityArtifacts.assessment.sha256,
      securityAssessmentByteLength: securityArtifacts.assessment.byteLength
    };
    assembled.source.verificationReports = sourceCoverage.map(persistedSourceCoverageRecord);
    return assembled;
  }

  function persistedSourceCoverageRecord(coverage) {
    return {
      repositoryRef: coverage.repositoryRef,
      revisionObjectId: coverage.revisionObjectId,
      treeObjectId: coverage.treeObjectId,
      sourceClosureMode: coverage.sourceClosureMode,
      sourcePaths: [...coverage.sourcePaths],
      sourcePathsSha256: coverage.sourcePathsSha256,
      manifestPath: coverage.manifestPath,
      manifestSha256: coverage.manifestSha256,
      manifestByteLength: coverage.manifestByteLength,
      closureSha256: coverage.closureSha256,
      reportPath: coverage.verificationReportPath,
      reportSha256: coverage.verificationReportSha256,
      reportByteLength: coverage.verificationReportByteLength,
      result: "VERIFIED"
    };
  }

  function deriveSecurityArtifactRecords(packageSnapshots, securityAssessment) {
    const schemaSnapshot = packageSnapshots.find((snapshot) => snapshot.document?.$id === "urn:programmable:open-world-security:1.0.0");
    if (!schemaSnapshot) {
      throw new CliFailure("APPLICATION_SECURITY_SCHEMA_MISSING", "the validated V2 package does not expose the exact bundled security schema", { exitCode: 1 });
    }
    const schemaBytes = Buffer.from(`${canonicalJson(schemaSnapshot.document)}\n`, "utf8");
    const assessmentBytes = Buffer.from(`${canonicalJson(securityAssessment)}\n`, "utf8");
    const make = (kind, artifactPath, mediaType, bytes) => {
      const sha256 = sha256Bytes(bytes);
      const byteLength = bytes.length;
      return {
        kind,
        path: artifactPath,
        mediaType,
        bytes,
        sha256,
        byteLength,
        reviewRecord: {
          kind,
          path: artifactPath,
          mediaType,
          byteLength,
          sha256,
          source: "application-package",
          repositoryRef: null
        }
      };
    };
    return {
      schema: make("security-assessment-schema", "security-assessment-v1.schema.json", "application/schema+json", schemaBytes),
      assessment: make("security-assessment", "security-assessment.v1.json", "application/json", assessmentBytes)
    };
  }

  function deriveTradeApplicationArtifacts(packageSnapshots) {
    const artifacts = packageSnapshots
      .filter(({ artifactKind }) => TRADE_APPLICATION_RECORD_KINDS.has(artifactKind))
      .map((snapshot) => {
        const canonicalBytes = Buffer.from(`${canonicalJson(snapshot.document)}\n`, "utf8");
        if (!snapshot.bytes.equals(canonicalBytes)) {
          throw new CliFailure(
            "APPLICATION_V2_REVIEW_BINDING_MISMATCH",
            "trade manifests and local trade-test results must use canonical JSON bytes before exact Application mirroring",
            { exitCode: 1 }
          );
        }
        return {
          kind: snapshot.artifactKind,
          path: snapshot.packagePath,
          mediaType: "application/json",
          bytes: snapshot.bytes,
          byteLength: snapshot.byteLength,
          sha256: snapshot.sha256,
          reviewRecord: {
            kind: snapshot.artifactKind,
            path: snapshot.packagePath,
            mediaType: "application/json",
            byteLength: snapshot.byteLength,
            sha256: snapshot.sha256,
            source: "application-package",
            repositoryRef: null
          }
        };
      });
    const identities = artifacts.map(({ path: artifactPath }) => artifactPath);
    if (new Set(identities).size !== identities.length) {
      throw new CliFailure("APPLICATION_V2_REVIEW_BINDING_MISMATCH", "trade application-package paths must be globally unique", { exitCode: 1 });
    }
    return artifacts;
  }

  function buildApplicationV3OutputRecords({
    application,
    securityAssessment,
    sourceCoverage,
    packageSnapshots,
    reviewSnapshots
  }) {
    const applicationBytes = Buffer.from(`${canonicalJson(application)}\n`, "utf8");
    const securityArtifacts = deriveSecurityArtifactRecords(packageSnapshots, securityAssessment);
    const tradeArtifacts = deriveTradeApplicationArtifacts(packageSnapshots);
    const records = [{
      path: "application.v3.json",
      bytes: applicationBytes,
      byteLength: applicationBytes.length,
      sha256: sha256Bytes(applicationBytes)
    }];
    for (const snapshot of reviewSnapshots) {
      records.push({
        path: snapshot.reviewSpec.path,
        bytes: snapshot.bytes,
        byteLength: snapshot.byteLength,
        sha256: snapshot.sha256
      });
    }
    for (const artifact of [securityArtifacts.schema, securityArtifacts.assessment]) {
      records.push({
        path: artifact.path,
        bytes: artifact.bytes,
        byteLength: artifact.byteLength,
        sha256: artifact.sha256
      });
    }
    for (const artifact of tradeArtifacts) {
      records.push({
        path: artifact.path,
        bytes: artifact.bytes,
        byteLength: artifact.byteLength,
        sha256: artifact.sha256
      });
    }
    for (const coverage of [...sourceCoverage].sort((left, right) => compareUtf8(left.repositoryRef, right.repositoryRef))) {
      const bytes = Buffer.from(`${canonicalJson(coverage.verificationReport)}\n`, "utf8");
      records.push({
        path: coverage.verificationReportPath,
        bytes,
        byteLength: bytes.length,
        sha256: sha256Bytes(bytes)
      });
    }
    const identities = records.map(({ path: recordPath }) => recordPath);
    if (new Set(identities).size !== identities.length) {
      throw new CliFailure("APPLICATION_OUTPUT_FILE_COLLISION", "Application V3 output file names are not unique", { exitCode: 1 });
    }
    const total = records.reduce((sum, record) => sum + record.byteLength, 0);
    if (records.some((record) => record.byteLength < 1 || record.byteLength > MAX_OUTPUT_FILE_BYTES) || total > MAX_OUTPUT_PACKAGE_BYTES) {
      throw new CliFailure("APPLICATION_OUTPUT_SPLIT_REVIEW_REQUIRED", "Application V3 output exceeds the bounded local materialization window", {
        exitCode: 1,
        details: {
          status: "HOLD_SPLIT_REVIEW",
          ideaEligibility: "ELIGIBLE_FOR_REVIEW",
          route: "INTEGRATION_PENDING",
          classification: "tooling-split-review",
          writePerformed: false,
          approvalGranted: false,
          launchAuthorizationGranted: false
        }
      });
    }
    return records;
  }

  Object.assign(runtime, {
    readCommittedJsonAtPath,
    parseApplicationTreeEntry,
    validateApplicationPackageBindings,
    materializeApplicationV2SourceReviewRecords,
    normalizeApplicationV2SecurityEvidenceBindingKinds,
    assertCommittedFileSnapshot,
    assertPublicApplicationInputs,
    maskVerifiedPublicHashFields,
    publicHashFieldName,
    deriveSourceAssessedSecurityAssessment,
    assembleDerivedApplicationV3,
    persistedSourceCoverageRecord,
    deriveSecurityArtifactRecords,
    buildApplicationV3OutputRecords
  });
}
