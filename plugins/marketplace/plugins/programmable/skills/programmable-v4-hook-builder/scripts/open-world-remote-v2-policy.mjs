import { CliFailure, MAX_APPLICATION_V3_JSON_NODES, MAX_OUTPUT_FILE_BYTES, OPEN_WORLD_V2_ARTIFACTS, OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS, OPEN_WORLD_V2_SUPPORTING_ARTIFACTS, SHA256_PATTERN, deriveOpenWorldV2FeeApplicability, isRepositorySchemaBinding, path, strictUtf8, validateOpenWorldV2Package } from "./open-world-shared.mjs";

const TRADE_APPLICATION_RECORD_KINDS = new Set(["trade-capability-manifest", "trade-test-result"]);

export function installOpenWorldRemoteV2Policy(runtime) {
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const openWorldReportIsValid = (...args) => runtime.openWorldReportIsValid(...args);
  const parseStrictCliJson = (...args) => runtime.parseStrictCliJson(...args);
  const relative = (...args) => runtime.relative(...args);
  const routeStrictJsonResourceFailure = (...args) => runtime.routeStrictJsonResourceFailure(...args);
  const safeSourceRepositoryPath = (...args) => runtime.safeSourceRepositoryPath(...args);
  const throwGitHubSplitReviewHold = (...args) => runtime.throwGitHubSplitReviewHold(...args);

  function verifyRemoteApplicationV3V2PolicyBindings({ application, remoteSourceVerifications }) {
    const policy = application?.policyBindings;
    const repositoryRef = policy?.submissionRepositoryRef;
    const remote = remoteSourceVerifications.get(repositoryRef);
    if (!remote) {
      throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "the exact V2 source repository was not independently replayed", { exitCode: 1 });
    }
    const submissionPath = policy?.submissionPath;
    if (!safeSourceRepositoryPath(submissionPath ?? "")) {
      throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "the bound V2 submission path is unsafe", { exitCode: 1 });
    }
    const packageDirectory = path.posix.dirname(submissionPath);
    const resolveArtifactPath = (relativePath) => {
      if (!safeSourceRepositoryPath(relativePath ?? "") || path.posix.isAbsolute(relativePath)) {
        throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "the remote V2 package contains an unsafe artifact path", { exitCode: 1 });
      }
      const resolved = packageDirectory === "."
        ? relativePath
        : path.posix.join(packageDirectory, relativePath);
      const relativeResolved = path.posix.relative(packageDirectory, resolved);
      if (
        !safeSourceRepositoryPath(resolved)
        || relativeResolved === ".."
        || relativeResolved.startsWith("../")
        || path.posix.isAbsolute(relativeResolved)
      ) {
        throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "a remote V2 artifact escapes its package directory", { exitCode: 1 });
      }
      return resolved;
    };
    const parseExactJson = (snapshot, label) => {
      let document;
      try {
        document = parseStrictCliJson(strictUtf8.decode(snapshot.bytes), MAX_OUTPUT_FILE_BYTES);
      } catch (error) {
        routeStrictJsonResourceFailure(error, `the exact remote ${label} exceeds the bounded JSON review window`, "github");
        throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `the exact remote ${label} is not valid UTF-8 JSON`, { exitCode: 1 });
      }
      return document;
    };
    const submissionSnapshot = remote.blobsByPath.get(submissionPath);
    if (!submissionSnapshot || submissionSnapshot.sha256 !== policy.submissionSha256) {
      throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "the exact remote V2 submission differs from its Application binding", { exitCode: 1 });
    }
    const submission = parseExactJson(submissionSnapshot, "V2 submission");
    const readBinding = (binding, label) => {
      if (
        !isPlainObject(binding)
        || typeof binding.path !== "string"
        || !SHA256_PATTERN.test(binding.sha256 ?? "")
        || !Number.isSafeInteger(binding.byteLength)
        || binding.byteLength < 1
      ) {
        throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `the remote V2 ${label} binding is incomplete`, { exitCode: 1 });
      }
      const repositoryPath = resolveArtifactPath(binding.path);
      const snapshot = remote.blobsByPath.get(repositoryPath);
      if (
        !snapshot
        || snapshot.byteLength !== binding.byteLength
        || snapshot.sha256 !== binding.sha256
      ) {
        throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `the exact remote V2 ${label} bytes differ from their content binding`, { exitCode: 1 });
      }
      return Object.freeze({
        repositoryPath,
        snapshot,
        value: parseExactJson(snapshot, `V2 ${label}`)
      });
    };
    const records = {};
    const boundArtifacts = [{
      kind: "submission",
      repositoryPath: submissionPath,
      snapshot: submissionSnapshot,
      value: submission
    }];
    for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) {
      const record = readBinding(submission?.intentPackage?.[key], spec.artifactType);
      records[key] = { value: record.value, bytes: record.snapshot.bytes };
      boundArtifacts.push({ kind: spec.artifactType, ...record });
    }
    const supportingRecords = {};
    for (const [key, spec] of Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS)) {
      const binding = submission?.supportingPackage?.[key];
      if (key === "securityAssessment" && binding === null) continue;
      const record = readBinding(binding, spec.artifactType);
      supportingRecords[key] = { value: record.value, bytes: record.snapshot.bytes };
      boundArtifacts.push({ kind: spec.artifactType, ...record });
    }
    const feePolicyBinding = submission?.supportingPackage?.feePolicy;
    if (feePolicyBinding !== null && feePolicyBinding !== undefined) {
      const record = readBinding(feePolicyBinding, OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy.artifactType);
      supportingRecords.feePolicy = { value: record.value, bytes: record.snapshot.bytes };
      boundArtifacts.push({ kind: OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy.artifactType, ...record });
    }
    const scopeArtifacts = submission?.programmableFee?.conformance?.scopeArtifacts;
    if (Array.isArray(scopeArtifacts) && scopeArtifacts.length > 0) {
      supportingRecords.feeConformance = scopeArtifacts.map((artifact, index) => {
        const entry = { feeScopeRef: artifact?.feeScopeRef };
        for (const key of ["receipt", "vectorSet"]) {
          const binding = artifact?.[key];
          const record = readBinding(binding, `fee conformance ${key} ${index + 1}`);
          entry[key] = { value: record.value, bytes: record.snapshot.bytes };
          boundArtifacts.push({ kind: binding.artifactType, ...record });
        }
        return entry;
      });
    }
    const tradeCapabilityMarkets = submission?.tradeCapability?.markets;
    if (Array.isArray(tradeCapabilityMarkets) && tradeCapabilityMarkets.length > 0) {
      const consumedTradePaths = new Set(boundArtifacts.map(({ repositoryPath }) => repositoryPath));
      supportingRecords.tradeCapabilities = tradeCapabilityMarkets.map((market, index) => {
        const binding = market?.manifest;
        const record = readBinding(binding, `trade capability manifest ${index + 1}`);
        boundArtifacts.push({ kind: binding.artifactType, ...record });
        consumedTradePaths.add(record.repositoryPath);
        const entry = {
          marketRef: market?.marketRef,
          manifest: { value: record.value, bytes: record.snapshot.bytes },
          quoteResults: [],
          executionResults: []
        };
        for (const [testsKey, recordsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
          const tests = record.value?.testEvidence?.[testsKey];
          if (!Array.isArray(tests)) continue;
          entry[recordsKey] = tests.map((test, testIndex) => {
            const repositoryPath = resolveArtifactPath(test?.resultArtifactPath);
            if (consumedTradePaths.has(repositoryPath)) {
              throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "each declared trade test must own one distinct result artifact path", { exitCode: 1 });
            }
            consumedTradePaths.add(repositoryPath);
            const snapshot = remote.blobsByPath.get(repositoryPath);
            if (!snapshot) {
              throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", `the exact remote V2 trade ${testsKey} result ${testIndex + 1} is missing`, { exitCode: 1 });
            }
            const value = parseExactJson(snapshot, `V2 trade ${testsKey} result ${testIndex + 1}`);
            boundArtifacts.push({ kind: "trade-test-result", repositoryPath, snapshot, value });
            return { testId: test?.id, result: { value, bytes: snapshot.bytes } };
          });
        }
        return entry;
      });
    }
    const extensionPaths = collectRemoteV2ExtensionSchemaPaths({ submission, records, supportingRecords });
    const extensionSchemaBytes = {};
    for (const extensionPath of extensionPaths) {
      const repositoryPath = resolveArtifactPath(extensionPath);
      const snapshot = remote.blobsByPath.get(repositoryPath);
      if (!snapshot) {
        throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "one exact remote V2 extension schema is missing from the pinned source snapshot", { exitCode: 1 });
      }
      parseExactJson(snapshot, "V2 extension schema");
      extensionSchemaBytes[extensionPath] = snapshot.bytes;
      if (!boundArtifacts.some((artifact) => artifact.repositoryPath === repositoryPath)) {
        boundArtifacts.push({ kind: "extension-schema", repositoryPath, snapshot });
      }
    }
    const report = validateOpenWorldV2Package({
      submission,
      submissionBytes: submissionSnapshot.bytes,
      records,
      supportingRecords,
      extensionSchemaBytes
    });
    if (!openWorldReportIsValid(report)) {
      throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "the complete exact remote V2 source package failed its authoritative validator", { exitCode: 1 });
    }
    const feeApplicability = deriveOpenWorldV2FeeApplicability(submission);
    if (
      submission.applicationId !== application.applicationId
      || submission.stage !== application.stage
      || policy.feeApplicability !== feeApplicability
    ) {
      throw new CliFailure("APPLICATION_V3_FEE_APPLICABILITY_MISMATCH", "Application V3 fee state differs from the complete exact validated remote V2 package", { exitCode: 1 });
    }
    const schemaRecord = boundArtifacts.find(({ kind }) => kind === "fee-policy-schema");
    if (
      policy.feePolicySchemaRepositoryRef !== repositoryRef
      || policy.feePolicySchemaPath !== schemaRecord?.repositoryPath
      || policy.feePolicySchemaSha256 !== schemaRecord?.snapshot.sha256
    ) {
      throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "Application V3 differs from the exact remote Fee V2 schema binding", { exitCode: 1 });
    }
    const feeRecord = boundArtifacts.filter(({ kind }) => kind === "fee-policy");
    const instanceTuple = [
      policy.feePolicyInstanceRepositoryRef,
      policy.feePolicyInstancePath,
      policy.feePolicyInstanceSha256
    ];
    if (feeApplicability === "applicable") {
      if (
        feeRecord.length !== 1
        || instanceTuple[0] !== repositoryRef
        || instanceTuple[1] !== feeRecord[0].repositoryPath
        || instanceTuple[2] !== feeRecord[0].snapshot.sha256
      ) {
        throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "the applicable Fee V2 instance tuple differs from the exact validated remote package", { exitCode: 1 });
      }
    } else if (
      feePolicyBinding !== null
      || feeRecord.length !== 0
      || instanceTuple.some((value) => value !== null)
    ) {
      throw new CliFailure("APPLICATION_REMOTE_V2_PACKAGE_INVALID", "a non-applicable or unresolved Fee state carries a forbidden policy instance", { exitCode: 1 });
    }
    for (const { kind, repositoryPath, snapshot } of boundArtifacts) {
      const isTradeApplicationRecord = TRADE_APPLICATION_RECORD_KINDS.has(kind);
      const applicationPath = isTradeApplicationRecord
        ? path.posix.relative(packageDirectory, repositoryPath)
        : repositoryPath;
      const matches = application.reviewPackage.records.filter((record) => (
        record.kind === kind
        && record.source === (isTradeApplicationRecord ? "application-package" : "source-repository")
        && record.repositoryRef === (isTradeApplicationRecord ? null : repositoryRef)
        && record.path === applicationPath
        && record.sha256 === snapshot.sha256
        && record.byteLength === snapshot.byteLength
      ));
      if (matches.length !== 1) {
        throw new CliFailure("APPLICATION_V2_REVIEW_BINDING_MISMATCH", "every required V2 artifact must have one exact source-repository review binding", { exitCode: 1 });
      }
    }
    const expectedTradeRecordCount = boundArtifacts.filter(({ kind }) => TRADE_APPLICATION_RECORD_KINDS.has(kind)).length;
    const applicationTradeRecords = application.reviewPackage.records.filter(({ kind }) => TRADE_APPLICATION_RECORD_KINDS.has(kind));
    if (applicationTradeRecords.length !== expectedTradeRecordCount) {
      throw new CliFailure(
        "APPLICATION_V2_REVIEW_BINDING_MISMATCH",
        "trade manifests and local trade-test results must biject the exact validated V2 package; orphan route evidence is forbidden",
        { exitCode: 1 }
      );
    }
    return Object.freeze({
      repositoryRef,
      submissionSha256: submissionSnapshot.sha256,
      feeApplicability,
      artifactCount: boundArtifacts.length
    });
  }

  function collectRemoteV2ExtensionSchemaPaths(value) {
    const paths = new Set();
    const stack = [value];
    let nodes = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      nodes += 1;
      if (nodes > MAX_APPLICATION_V3_JSON_NODES) {
        throwGitHubSplitReviewHold("the remote V2 package exceeds the bounded extension-schema discovery window");
      }
      if (Array.isArray(current)) {
        for (const entry of current) stack.push(entry);
        continue;
      }
      if (!isPlainObject(current)) continue;
      if (isRepositorySchemaBinding(current)) paths.add(current.path);
      for (const entry of Object.values(current)) stack.push(entry);
    }
    return [...paths].sort(compareUtf8);
  }

  Object.assign(runtime, {
    verifyRemoteApplicationV3V2PolicyBindings,
    collectRemoteV2ExtensionSchemaPaths
  });
}
