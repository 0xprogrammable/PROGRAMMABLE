import { CliFailure, MAX_APPLICATION_BYTES, MAX_APPLICATION_V3_JSON_DEPTH, MAX_APPLICATION_V3_JSON_NODES, MAX_GITHUB_PACKAGE_FILES, MAX_OUTPUT_FILE_BYTES, MAX_OUTPUT_PACKAGE_BYTES, assertInsideRepository, canonicalJson, fs, generatePublicPrApplicationV3, openWorldSecurityV1Bytes, path, scanPublicPrApplicationV3ArtifactBytes, sha256Canonical, validatePublicPrApplicationV3 } from "./open-world-shared.mjs";

export function installOpenWorldApplicationPackage(runtime) {
  const assertSafeApplicationPackagePath = (...args) => runtime.assertSafeApplicationPackagePath(...args);
  const canonicalPositiveDecimal = (...args) => runtime.canonicalPositiveDecimal(...args);
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const enforceGitHubPackageTransportLimits = (...args) => runtime.enforceGitHubPackageTransportLimits(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const listApplicationPackageFiles = (...args) => runtime.listApplicationPackageFiles(...args);
  const parseStrictCliJson = (...args) => runtime.parseStrictCliJson(...args);
  const readFileSnapshot = (...args) => runtime.readFileSnapshot(...args);
  const resolveExactDirectory = (...args) => runtime.resolveExactDirectory(...args);
  const routeStrictJsonResourceFailure = (...args) => runtime.routeStrictJsonResourceFailure(...args);
  const throwApplicationInputSplitReviewHold = (...args) => runtime.throwApplicationInputSplitReviewHold(...args);
  const throwGitHubSplitReviewHold = (...args) => runtime.throwGitHubSplitReviewHold(...args);

  function loadApplicationV3TransportPackage(input) {
    const packageRoot = resolveExactDirectory(input, "Application V3 package");
    const applicationPath = path.join(packageRoot, "application.v3.json");
    let applicationStat;
    try {
      applicationStat = fs.lstatSync(applicationPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      throw new CliFailure(
        "APPLICATION_V3_ROOT_MISSING",
        "Application V3 status and transport require a closed Application V3 package directory containing application.v3.json; a Submission V2 source package is not an Application V3 status package.",
        {
          exitCode: 1,
          details: {
            expectedFile: "application.v3.json",
            nextStep: "Prepare and validate the immutable Application V3 package, then rerun open-world status with that package directory.",
            validationCommand: "node $SKILL_ROOT/scripts/cli.mjs open-world validate-application $APPLICATION_V3_PACKAGE",
            writePerformed: false
          }
        }
      );
    }
    if (!applicationStat.isFile() || applicationStat.isSymbolicLink()) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "application.v3.json must be one regular non-symlink file", { exitCode: 1 });
    }
    const applicationSnapshot = readFileSnapshot(
      applicationPath,
      "application.v3.json",
      MAX_APPLICATION_BYTES,
      { requireUtf8: true }
    );
    let application;
    try {
      application = parseStrictCliJson(applicationSnapshot.text, MAX_APPLICATION_BYTES);
    } catch (error) {
      routeStrictJsonResourceFailure(error, "the Application V3 root exceeds the bounded JSON review window");
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "application.v3.json must contain valid UTF-8 JSON", { exitCode: 1 });
    }
    assertBoundedApplicationV3Json(application, "application.v3.json");
    if (applicationSnapshot.text !== `${canonicalJson(application)}\n`) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "application.v3.json must be canonical JSON with one final newline", { exitCode: 1 });
    }
    const validation = validatePublicPrApplicationV3(application);
    if (validation?.valid !== true) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "application.v3.json does not satisfy the closed Application V3 contract", {
        exitCode: 1,
        details: { report: validation }
      });
    }
    const applicationId = application.applicationId;
    const applicationRevision = canonicalPositiveDecimal(application.applicationRevision, "application revision");
    const applicationRecords = application.reviewPackage.records
      .filter((record) => record.source === "application-package");
    if (applicationRecords.length === 0 || applicationRecords.length + 1 > MAX_GITHUB_PACKAGE_FILES) {
      if (applicationRecords.length + 1 > MAX_GITHUB_PACKAGE_FILES) {
        throwGitHubSplitReviewHold("the Application V3 package exceeds the bounded exact GitHub file-inspection window");
      }
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "Application V3 package contains no application-package records", { exitCode: 1 });
    }
    const expectedRecords = [{
      path: "application.v3.json",
      mediaType: "application/json",
      byteLength: applicationSnapshot.byteLength,
      sha256: applicationSnapshot.sha256
    }, ...applicationRecords.map((record) => ({
      path: record.path,
      mediaType: record.mediaType,
      byteLength: record.byteLength,
      sha256: record.sha256
    }))];
    const expectedPaths = expectedRecords.map(({ path: recordPath }) => recordPath);
    if (new Set(expectedPaths).size !== expectedPaths.length) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "Application V3 package reuses an application-package path", { exitCode: 1 });
    }
    const records = [];
    let totalBytes = 0;
    for (const expected of expectedRecords.sort((left, right) => compareUtf8(left.path, right.path))) {
      assertSafeApplicationPackagePath(expected.path);
      const absolutePath = path.resolve(packageRoot, ...expected.path.split("/"));
      let contained;
      try {
        contained = assertInsideRepository(packageRoot, absolutePath);
      } catch {
        throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "an application-package record escapes its exact directory", { exitCode: 1 });
      }
      const snapshot = expected.path === "application.v3.json"
        ? applicationSnapshot
        : readFileSnapshot(contained, expected.path, MAX_OUTPUT_FILE_BYTES, { requireUtf8: true });
      if (snapshot.byteLength !== expected.byteLength || snapshot.sha256 !== expected.sha256) {
        throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", `application-package record ${expected.path} differs from application.v3.json`, { exitCode: 1 });
      }
      if (expected.mediaType === "application/json" || expected.mediaType === "application/schema+json") {
        let document;
        try {
          document = parseStrictCliJson(snapshot.text, MAX_OUTPUT_FILE_BYTES);
        } catch (error) {
          routeStrictJsonResourceFailure(error, `application-package record ${expected.path} exceeds the bounded JSON review window`);
          throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", `${expected.path} must contain valid UTF-8 JSON`, { exitCode: 1 });
        }
        assertBoundedApplicationV3Json(document, expected.path);
        if (snapshot.text !== `${canonicalJson(document)}\n`) {
          throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", `${expected.path} must be canonical JSON with one final newline`, { exitCode: 1 });
        }
      }
      if (expected.path !== "application.v3.json") {
        const privacy = scanPublicPrApplicationV3ArtifactBytes({
          bytes: snapshot.bytes,
          path: expected.path,
          mediaType: expected.mediaType
        });
        if (privacy.valid !== true) {
          throw new CliFailure(
            "APPLICATION_PUBLIC_ARTIFACT_SENSITIVE",
            `application-package record ${expected.path} contains a non-publishable secret, private identifier, or unattested financial identifier`,
            {
              exitCode: 1,
              details: {
                status: "HELD_FOR_PRIVACY_REDACTION",
                ideaEligibility: "ELIGIBLE_FOR_REVIEW",
                path: expected.path,
                candidateKinds: privacy.candidateKinds,
                writePerformed: false
              }
            }
          );
        }
      }
      totalBytes += snapshot.byteLength;
      if (totalBytes > MAX_OUTPUT_PACKAGE_BYTES) {
        throwGitHubSplitReviewHold("the Application V3 package exceeds the bounded aggregate GitHub transport size");
      }
      records.push(Object.freeze({
        path: expected.path,
        mediaType: expected.mediaType,
        byteLength: snapshot.byteLength,
        sha256: snapshot.sha256,
        content: snapshot.text
      }));
    }
    const actualPaths = listApplicationPackageFiles(packageRoot);
    if (canonicalJson(actualPaths) !== canonicalJson(records.map(({ path: recordPath }) => recordPath).sort(compareUtf8))) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "Application V3 package must contain exactly its bound public application-package files", { exitCode: 1 });
    }
    validateMaterializedApplicationV3Package({ application, records });
    const targetDirectory = `submissions/${applicationId}/v3/revisions/${applicationRevision}`;
    const files = records.map((record) => Object.freeze({
      ...record,
      path: `${targetDirectory}/${record.path}`
    }));
    enforceGitHubPackageTransportLimits(files);
    const packageSha256 = sha256Canonical({
      contract: "public-pr-application-v3-package",
      applicationId,
      applicationRevision,
      targetDirectory,
      files: files.map(({ path: filePath, mediaType, byteLength, sha256 }) => ({
        path: filePath,
        mediaType,
        byteLength,
        sha256
      }))
    });
    return Object.freeze({
      root: packageRoot,
      application,
      applicationId,
      applicationRevision,
      applicationSha256: applicationSnapshot.sha256,
      targetDirectory,
      files: Object.freeze(files),
      packageSha256
    });
  }

  function assertBoundedApplicationV3Json(value, label) {
    const stack = [{ value, depth: 0 }];
    let nodes = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      nodes += 1;
      if (nodes > MAX_APPLICATION_V3_JSON_NODES || current.depth > MAX_APPLICATION_V3_JSON_DEPTH) {
        throwApplicationInputSplitReviewHold(`${label} exceeds the bounded canonical JSON structure window`);
      }
      if (current.value === null || typeof current.value !== "object") continue;
      if (Array.isArray(current.value)) {
        if (nodes + stack.length + current.value.length > MAX_APPLICATION_V3_JSON_NODES) {
          throwApplicationInputSplitReviewHold(`${label} exceeds the bounded canonical JSON node window`);
        }
        for (let index = current.value.length - 1; index >= 0; index -= 1) {
          stack.push({ value: current.value[index], depth: current.depth + 1 });
        }
      } else {
        const keys = Object.keys(current.value);
        if (nodes + stack.length + keys.length > MAX_APPLICATION_V3_JSON_NODES) {
          throwApplicationInputSplitReviewHold(`${label} exceeds the bounded canonical JSON node window`);
        }
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          stack.push({ value: current.value[keys[index]], depth: current.depth + 1 });
        }
      }
    }
  }

  function validateMaterializedApplicationV3Package({ application, records }) {
    const recordsByPath = new Map(records.map((record) => [record.path, record]));
    const readCanonicalArtifact = (artifactPath, label) => {
      const record = recordsByPath.get(artifactPath);
      if (!record || record.mediaType !== "application/json") {
        throw new CliFailure("APPLICATION_V3_MATERIALIZATION_INVALID", `${label} is not one exact application-package JSON artifact`, { exitCode: 1 });
      }
      try {
        const document = parseStrictCliJson(record.content, MAX_OUTPUT_FILE_BYTES);
        if (record.content !== `${canonicalJson(document)}\n`) throw new Error("non-canonical");
        return { document, record };
      } catch (error) {
        routeStrictJsonResourceFailure(error, `${label} exceeds the bounded JSON review window`);
        throw new CliFailure("APPLICATION_V3_MATERIALIZATION_INVALID", `${label} is not canonical UTF-8 JSON`, { exitCode: 1 });
      }
    };

    const securitySchemaPath = application.securityBindings?.securityAssessmentSchemaPath;
    const securitySchemaRecord = recordsByPath.get(securitySchemaPath);
    if (
      securitySchemaPath !== "security-assessment-v1.schema.json"
      || !securitySchemaRecord
      || securitySchemaRecord.mediaType !== "application/schema+json"
      || !Buffer.from(securitySchemaRecord.content, "utf8").equals(openWorldSecurityV1Bytes)
    ) {
      throw new CliFailure("APPLICATION_V3_MATERIALIZATION_INVALID", "the package does not contain the exact bundled Application V3 security schema bytes", { exitCode: 1 });
    }
    const { document: securityAssessment } = readCanonicalArtifact(
      application.securityBindings?.securityAssessmentPath,
      "source-assessed security assessment"
    );
    const persistedReports = application.source?.verificationReports;
    if (!Array.isArray(persistedReports) || persistedReports.length === 0) {
      throw new CliFailure("APPLICATION_V3_MATERIALIZATION_INVALID", "the package has no persisted source-verification reports", { exitCode: 1 });
    }
    const sourceCoverage = persistedReports.map((binding) => {
      const { document: verificationReport, record } = readCanonicalArtifact(
        binding?.reportPath,
        `source-verification report for ${binding?.repositoryRef ?? "unknown repository"}`
      );
      if (
        record.sha256 !== binding.reportSha256
        || record.byteLength !== binding.reportByteLength
      ) {
        throw new CliFailure("APPLICATION_V3_MATERIALIZATION_INVALID", "a source-verification report artifact differs from its persisted byte binding", { exitCode: 1 });
      }
      return {
        repositoryRef: binding.repositoryRef,
        revisionObjectId: binding.revisionObjectId,
        treeObjectId: binding.treeObjectId,
        sourceClosureMode: binding.sourceClosureMode,
        sourcePaths: binding.sourcePaths,
        sourcePathsSha256: binding.sourcePathsSha256,
        manifestPath: binding.manifestPath,
        manifestSha256: binding.manifestSha256,
        manifestByteLength: binding.manifestByteLength,
        closureSha256: binding.closureSha256,
        verificationReportPath: binding.reportPath,
        verificationReportSha256: binding.reportSha256,
        verificationReportByteLength: binding.reportByteLength,
        verificationReport
      };
    });
    const evidenceRefs = collectApplicationV3EvidenceRefs(securityAssessment);
    const securityEvidenceBindings = [...evidenceRefs].sort(compareUtf8).map((evidenceRef) => {
      const matches = application.reviewPackage.records.filter(({ path: recordPath }) => recordPath === evidenceRef);
      if (matches.length !== 1) {
        throw new CliFailure("APPLICATION_V3_MATERIALIZATION_INVALID", "a security evidence reference does not resolve to exactly one review-package record", { exitCode: 1 });
      }
      const [record] = matches;
      return {
        evidenceRef,
        kind: record.kind,
        path: record.path,
        repositoryRef: record.repositoryRef,
        sha256: record.sha256,
        source: record.source
      };
    });
    const generated = generatePublicPrApplicationV3({
      application,
      securityAssessment,
      sourceCoverage,
      securityEvidenceBindings
    });
    if (
      generated.materializationAllowed !== true
      || generated.report?.valid !== true
      || canonicalJson(generated.application) !== canonicalJson(application)
    ) {
      throw new CliFailure(
        "APPLICATION_V3_MATERIALIZATION_INVALID",
        "the package cannot be reconstructed as an exact source-verified prototype emitted by the current Application V3 materializer",
        {
          exitCode: 1,
          details: {
            status: generated.report?.status ?? "INVALID",
            findingCodes: [...new Set((generated.report?.findings ?? []).map(({ code }) => code))].sort(),
            writePerformed: false,
            ideaEligibility: "ELIGIBLE_FOR_REVIEW"
          }
        }
      );
    }
  }

  function collectApplicationV3EvidenceRefs(value) {
    const refs = new Set();
    const stack = [value];
    let visited = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      visited += 1;
      if (visited > 250_000) {
        throw new CliFailure("APPLICATION_V3_MATERIALIZATION_INVALID", "the security assessment exceeds the bounded evidence-reference scan", { exitCode: 1 });
      }
      if (Array.isArray(current)) {
        if (stack.length + current.length > 250_000) {
          throw new CliFailure("APPLICATION_V3_MATERIALIZATION_INVALID", "the security assessment exceeds the bounded evidence-reference scan", { exitCode: 1 });
        }
        for (let index = current.length - 1; index >= 0; index -= 1) stack.push(current[index]);
      } else if (isPlainObject(current)) {
        for (const [key, child] of Object.entries(current)) {
          if (key === "evidenceRefs" && Array.isArray(child)) {
            for (const ref of child) if (typeof ref === "string") refs.add(ref);
          } else {
            stack.push(child);
          }
        }
      }
    }
    return refs;
  }

  Object.assign(runtime, {
    loadApplicationV3TransportPackage,
    assertBoundedApplicationV3Json,
    validateMaterializedApplicationV3Package,
    collectApplicationV3EvidenceRefs
  });
}
