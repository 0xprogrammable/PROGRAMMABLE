import {
  UINT128_MAX,
  UINT256_MAX,
  checksumAddress,
  decimalUint,
  encodeLaunchExecutorPoolConfigurationV1,
  hashDeploymentArtifactSet,
  hashDeploymentSourceBinding,
  hashDeploymentSpec,
  hashExecutorHookConfigurationV1,
  hashExecutorLaunchParametersV1,
  hashExecutorPoolConfigurationV1,
  hashLaunchEvidenceBundle,
  hashV4PoolKey,
  keccak256HexBytes,
  normalizeHexBytes
} from "./evm-encoding-core.mjs";

import {
  analyzeSubmission,
  canonicalJson,
  STANDARD_VERSION,
  submissionHash,
  validateAgainstSchema
} from "./submission-core.mjs";

import {
  ACCEPTANCE_PATH,
  APPLICATION_ID,
  assertExactKeys,
  CANONICAL_REGISTRY_REPOSITORY,
  compareUtf8,
  COMPONENT,
  derivePoolFee,
  digest32,
  exactObject,
  gitBytes20,
  GITHUB_REPOSITORY,
  invalid,
  jsonPointer,
  LAUNCH_BUNDLE_SCHEMA_VERSION,
  MAX_BOUND_FILE_BYTES,
  MAX_CALLDATA_BYTES,
  MAX_CONFIGURATION_BYTES,
  OPAQUE_DECIMAL,
  parseFileRef,
  parseJson,
  PROGRAMMABLE_FEE_POLICY_HASH,
  PROGRAMMABLE_FEE_RECIPIENT,
  PROGRAMMABLE_PLATFORM_FEE_HUNDREDTHS_OF_BIP,
  readBoundFile,
  realDirectory,
  realFile,
  requireBindingPaths,
  requireBindingText,
  requireCanonicalTimestamp,
  requireObject,
  requirePattern,
  resolveJsonPointer,
  resolvePoolAsset,
  rootsOverlap,
  SHA1,
  sha256Canonical,
  shaLabelToBytes32,
  stripArtifact,
  stripRegistry,
  stripSource,
  submissionSchema,
  verifyGitIdentity
} from "./launch-bundle-shared.mjs";

export function buildLaunchBundle({ submission, bindings, repositoryRoot, registryRoot, evidenceRoot, submissionPath }) {
  requireObject(submission, "submission");
  requireObject(bindings, "bindings");
  const roots = {
    source: realDirectory(repositoryRoot, "repository root"),
    registry: realDirectory(registryRoot, "Registry root"),
    evidence: realDirectory(evidenceRoot, "evidence root")
  };
  if (rootsOverlap(roots.evidence, roots.source) || rootsOverlap(roots.evidence, roots.registry)) {
    invalid("EVIDENCE_ROOT_OVERLAP", "evidence root must be an explicit separate directory outside the accepted source and Registry checkouts");
  }
  const suppliedSubmissionPath = realFile(submissionPath, "submission", MAX_BOUND_FILE_BYTES);
  if (submission.standardVersion !== STANDARD_VERSION || submission.$schema !== `urn:programmable:v4-hook-submission:${STANDARD_VERSION}`) {
    invalid("SUBMISSION_STANDARD_UNSUPPORTED", `submission must use standard ${STANDARD_VERSION}`);
  }
  if (submission.stage !== "prototype") invalid("PROTOTYPE_REQUIRED", "a post-acceptance launch bundle requires a prototype submission");
  const modelId = requirePattern(submission.model?.id, "submission.model.id", APPLICATION_ID, "lowercase kebab-case");
  const launchPlan = requireObject(submission.launchPlan, "submission.launchPlan");
  const pool = requireObject(submission.pool, "submission.pool");
  if (launchPlan.executorVersion !== "launch-authorization-executor-v1") {
    invalid("EXECUTOR_VERSION_UNSUPPORTED", "submission.launchPlan.executorVersion must equal launch-authorization-executor-v1");
  }
  if (launchPlan.poolMustBeUninitialized !== true || launchPlan.postAcceptanceBundleRequired !== true) {
    invalid("LAUNCH_PRESTATE_UNBOUND", "the launch plan must require an absent pool and a post-acceptance bundle");
  }
  requirePattern(launchPlan.targetStrategy, "submission.launchPlan.targetStrategy", COMPONENT, "an open lowercase kebab-case strategy slug");
  const targetComponent = requirePattern(launchPlan.targetComponent, "submission.launchPlan.targetComponent", COMPONENT, "lowercase kebab-case");
  for (const [field, maximum] of [
    ["callDataFunction", 500],
    ["hookConfigurationRule", 1_000],
    ["initialLiquidityRule", 1_200],
    ["nativeValueRule", 1_000],
    ["nativeValueSource", 800],
    ["refundRecipientPolicy", 800]
  ]) requireBindingText(launchPlan[field], `submission.launchPlan.${field}`, maximum);
  for (const field of ["callDataSourcePaths", "liquiditySourcePaths", "testPaths"]) {
    requireBindingPaths(launchPlan[field], `submission.launchPlan.${field}`, false);
  }
  requireBindingPaths(launchPlan.hookConfigurationSourcePaths, "submission.launchPlan.hookConfigurationSourcePaths", true);
  if (pool.canonical !== true) invalid("EXECUTOR_CANONICAL_POOL_REQUIRED", "submission.pool.canonical must be true for the authorized pool launch");
  const minimumInitialLiquidity = decimalUint(pool.minimumInitialLiquidity, "submission.pool.minimumInitialLiquidity", UINT128_MAX, false);
  const minimumNativeValue = decimalUint(launchPlan.minimumNativeValue, "submission.launchPlan.minimumNativeValue", UINT256_MAX, true);
  const maximumNativeValue = decimalUint(launchPlan.maximumNativeValue, "submission.launchPlan.maximumNativeValue", UINT256_MAX, true);
  if (minimumNativeValue > maximumNativeValue) invalid("NATIVE_VALUE_RANGE_INVALID", "submission launch native-value bounds are inverted");

  const analysis = analyzeSubmission(submission, { schema: submissionSchema });
  const blockingFindings = analysis.findings.filter(({ severity }) => severity === "hard" || severity === "blocker");
  if (blockingFindings.length > 0) {
    invalid("SUBMISSION_ANALYSIS_BLOCKED", "the full Builder submission analysis contains hard or blocker findings", {
      decision: analysis.decision,
      readiness: analysis.readiness,
      findings: blockingFindings.slice(0, 128)
    });
  }

  assertExactKeys(bindings, "bindings", [
    "schemaVersion", "authority", "registry", "source", "build", "artifacts", "evidence",
    "launchInfrastructure", "executorCall", "assetAddresses"
  ]);
  if (bindings.schemaVersion !== LAUNCH_BUNDLE_SCHEMA_VERSION) invalid("BINDINGS_SCHEMA_UNSUPPORTED", `bindings.schemaVersion must equal ${LAUNCH_BUNDLE_SCHEMA_VERSION}`);
  if (bindings.authority !== "builder-supplied-pre-authorization") invalid("BINDINGS_AUTHORITY_INVALID", "bindings.authority must preserve the builder-supplied pre-authorization boundary");

  const registry = parseRegistry(bindings.registry, modelId);
  const source = parseSource(bindings.source);
  const registryGit = verifyGitIdentity(roots.registry, registry.registryCommit.slice(2), registry.registryTreeObjectId, CANONICAL_REGISTRY_REPOSITORY, "Registry");
  const sourceGit = verifyGitIdentity(roots.source, source.revisionObjectId.slice(2), source.treeObjectId.slice(2), source.repositoryUri, "source");
  const files = [];
  const acceptanceFile = readBoundFile(
    { root: "registry", path: registry.acceptancePath, sha256: `sha256:${registry.acceptanceSha256.slice(2)}` },
    "Registry acceptance",
    roots,
    files,
    { tracked: true }
  );
  const acceptance = parseJson(acceptanceFile.bytes, "Registry acceptance");
  const acceptanceSummary = assertAcceptance(acceptance, { registry, source, modelId });

  const submissionFile = readBoundFile(source.submission, "accepted submission", roots, files, { tracked: true });
  if (submissionFile.absolutePath !== suppliedSubmissionPath) invalid("SUBMISSION_PATH_MISMATCH", "--submission must select bindings.source.submission.path");
  const sourceSubmission = parseJson(submissionFile.bytes, "accepted submission");
  if (canonicalJson(sourceSubmission) !== canonicalJson(submission)) invalid("SUBMISSION_CONTENT_MISMATCH", "parsed submission differs from the exact bound submission file");
  readBoundFile(source.reviewTarget, "review target", roots, files, { tracked: true });

  const build = parseBuild(bindings.build, roots, files);
  const artifacts = parseArtifacts(bindings.artifacts, roots, files);
  const evidence = parseEvidence(bindings.evidence, roots, files);
  const infrastructure = parseInfrastructure(bindings.launchInfrastructure, submission.target?.chainId);
  const executorInput = parseExecutorInput(bindings.executorCall);
  if (executorInput.hookConfiguration !== "0x" && launchPlan.hookConfigurationSourcePaths.length === 0) {
    invalid("HOOK_CONFIGURATION_SOURCE_MISSING", "non-empty hookConfiguration requires at least one reviewed hookConfigurationSourcePath");
  }
  const assets = parseAssetAddresses(bindings.assetAddresses, submission.assets);
  const nativeValue = decimalUint(infrastructure.nativeValue, "bindings.launchInfrastructure.nativeValue", UINT256_MAX, true);
  if (nativeValue < minimumNativeValue || nativeValue > maximumNativeValue) {
    invalid("NATIVE_VALUE_OUTSIDE_REVIEWED_RANGE", `exact nativeValue must be inside ${minimumNativeValue}..${maximumNativeValue}`);
  }

  const artifactByAddress = new Map(artifacts.map((artifact) => [artifact.address.toLowerCase(), artifact]));
  const criticalArtifacts = assertCriticalArtifacts({ artifactByAddress, infrastructure, executorInput, targetComponent });
  const currency0 = resolvePoolAsset(pool.currency0, assets, "currency0");
  const currency1 = resolvePoolAsset(pool.currency1, assets, "currency1");
  const poolFee = derivePoolFee(pool.lpFee);
  const poolConfiguration = encodeLaunchExecutorPoolConfigurationV1({
    currency0,
    currency1,
    fee: poolFee,
    tickSpacing: pool.tickSpacing,
    hooks: infrastructure.hook,
    minimumInitialLiquidity
  });
  const targetRuntimeCodeHash = criticalArtifacts.target.runtimeCodeHash;
  const hookRuntimeCodeHash = criticalArtifacts.hook.runtimeCodeHash;
  const launchCall = {
    callData: executorInput.callData,
    hook: infrastructure.hook,
    hookConfiguration: executorInput.hookConfiguration,
    poolConfiguration: poolConfiguration.encoded,
    poolManager: infrastructure.poolManager,
    refundRecipient: executorInput.refundRecipient,
    target: executorInput.target,
    targetRuntimeCodeHash
  };
  const executorHashes = {
    hookConfigurationHash: hashExecutorHookConfigurationV1(launchCall),
    launchParametersHash: hashExecutorLaunchParametersV1(launchCall),
    poolConfigurationHash: hashExecutorPoolConfigurationV1(launchCall)
  };
  const evidenceBundleHash = hashLaunchEvidenceBundle({
    buildEvidenceSha256: evidence.build.digest32,
    configurationEvidenceSha256: evidence.configuration.digest32,
    feeConformanceEvidenceSha256: evidence.feeConformance.digest32
  });
  const deploymentSpec = {
    schemaVersion: "1.0.0",
    registry: stripRegistry(registry),
    source: stripSource(source),
    build,
    artifacts: artifacts.map(stripArtifact),
    launch: {
      authorityContract: infrastructure.authorityContract,
      authorityRuntimeCodeHash: criticalArtifacts.authority.runtimeCodeHash,
      launcher: infrastructure.launcher,
      launcherRuntimeCodeHash: criticalArtifacts.launcher.runtimeCodeHash,
      launchCaller: infrastructure.launchCaller,
      nativeValue: nativeValue.toString(),
      poolManager: infrastructure.poolManager,
      poolManagerRuntimeCodeHash: criticalArtifacts.poolManager.runtimeCodeHash,
      hook: infrastructure.hook,
      hookRuntimeCodeHash,
      launchParametersHash: executorHashes.launchParametersHash,
      poolConfigurationHash: executorHashes.poolConfigurationHash,
      hookConfigurationHash: executorHashes.hookConfigurationHash,
      chainId: String(submission.target.chainId)
    },
    buildEvidenceSha256: evidence.build.digest32,
    configurationEvidenceSha256: evidence.configuration.digest32,
    evidenceBundleHash,
    feeConformanceEvidenceSha256: evidence.feeConformance.digest32,
    feeRecipient: PROGRAMMABLE_FEE_RECIPIENT,
    feePolicyHash: PROGRAMMABLE_FEE_POLICY_HASH,
    platformFeeHundredthsOfBip: PROGRAMMABLE_PLATFORM_FEE_HUNDREDTHS_OF_BIP
  };
  const derivedHashes = {
    artifactSetHash: hashDeploymentArtifactSet(deploymentSpec),
    callDataHash: keccak256HexBytes(launchCall.callData, "launchCall.callData"),
    deploymentSpecHash: hashDeploymentSpec(deploymentSpec),
    evidenceBundleHash,
    hookConfigurationHash: executorHashes.hookConfigurationHash,
    hookConfigurationPayloadHash: keccak256HexBytes(launchCall.hookConfiguration, "launchCall.hookConfiguration"),
    hookRuntimeCodeHash,
    launchParametersHash: executorHashes.launchParametersHash,
    poolConfigurationHash: executorHashes.poolConfigurationHash,
    poolConfigurationPayloadHash: keccak256HexBytes(launchCall.poolConfiguration, "launchCall.poolConfiguration"),
    poolId: hashV4PoolKey(poolConfiguration.decoded),
    sourceBindingHash: hashDeploymentSourceBinding(deploymentSpec),
    targetRuntimeCodeHash
  };
  const withoutDigest = {
    schemaVersion: LAUNCH_BUNDLE_SCHEMA_VERSION,
    result: "builder-post-acceptance-launch-bundle-candidate-v1",
    authorizationState: "NOT_AUTHORIZED",
    authorizationCompatibility: acceptanceSummary.compatibilityResult === "prototype-ready"
      ? {
          state: "CURRENT_PRIVATE_V1_CANDIDATE",
          unresolvedReason: "ADMIN_INDEPENDENT_VERIFICATION_AND_AUTHORIZATION_REQUIRED"
        }
      : {
          state: "NOT_COMPATIBLE_WITH_CURRENT_PRIVATE_V1",
          unresolvedReason: "REVIEWED_ARCHITECTURE_PATH_REQUIRED_NOT_IMPLEMENTED"
        },
    authority: "builder-declared-untrusted",
    submission: {
      applicationId: modelId,
      standardVersion: submission.standardVersion,
      submissionHash: submissionHash(submission)
    },
    poolConfigurationV1: poolConfiguration.decoded,
    launchCall,
    deploymentSpec,
    derivedHashes,
    provenance: {
      state: "LOCAL_GIT_AND_FILE_BYTES_BOUND_ONLY",
      registry: { ...registryGit, acceptance: acceptanceSummary },
      source: sourceGit,
      files: files.sort((left, right) => compareUtf8(left.label, right.label) || compareUtf8(left.path, right.path)),
      artifactDerivations: artifacts.map(({ component, source: artifactSource, artifact, creationBytecodeJsonPointer, runtimeBytecodeJsonPointer, constructorArgsBytes }) => ({
        component,
        source: artifactSource,
        artifact,
        creationBytecodeJsonPointer,
        runtimeBytecodeJsonPointer,
        constructorArgsBytes
      }))
    },
    runtimeEvidence: {
      state: "NOT_RUN",
      expectedHashesDerivedFromArtifacts: true,
      observedAddresses: [],
      observedCodeHashes: []
    },
    deploymentEvidence: { state: "NOT_PROVIDED", transactionHash: null, receipt: null },
    builderInputSha256: sha256Canonical(bindings),
    unresolvedExternalAuthority: [
      "canonical-registry-head-and-acceptance-authenticity-verification",
      "hermetic-build-and-reviewed-source-closure-verification",
      "onchain-runtime-code-and-infrastructure-verification-at-a-pinned-block",
      "semantic-configuration-and-fee-conformance-verification",
      "admin-authorization-signature-and-current-onchain-gate-state"
    ],
    mapping: {
      adminContract: "current-private-unreleased-launch-authorization-v1-first-freeze",
      deploymentSpec: "Admin DeploymentSpecV1 exact shape",
      launchCall: "Admin LaunchExecutorCallV1 exact shape",
      poolConfigurationV1: "LaunchAuthorizationExecutorV1.PoolConfigurationV1 decoded values",
      evidenceBundleHash: "keccak256(abi.encode(buildEvidenceSha256,configurationEvidenceSha256,feeConformanceEvidenceSha256))"
    },
    networkAccessed: false,
    signingPerformed: false,
    deploymentPerformed: false,
    externalActionsPerformed: [],
    disclaimer: "Deterministic candidate only. Local Git objects, file bytes and artifact bytecode were bound without network or RPC access. This is not runtime evidence, deployment evidence, Admin authorization or a signature."
  };
  return Object.freeze({ ...withoutDigest, bundleSha256: sha256Canonical(withoutDigest) });
}

export function validateLaunchBundleOutput(bundle, { schema } = {}) {
  const findings = schema ? [...validateAgainstSchema(bundle, schema)] : [];
  const add = (code, pathName, message) => findings.push({
    severity: "blocker",
    code,
    path: pathName,
    message,
    remediation: "Regenerate the launch bundle from the exact accepted source, Registry and evidence roots; do not hand-edit derived output."
  });

  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return findings;

  const compatibility = bundle.authorizationCompatibility;
  const acceptanceCompatibility = bundle.provenance?.registry?.acceptance?.compatibilityResult;
  const expectedCompatibility = acceptanceCompatibility === "prototype-ready"
    ? ["CURRENT_PRIVATE_V1_CANDIDATE", "ADMIN_INDEPENDENT_VERIFICATION_AND_AUTHORIZATION_REQUIRED"]
    : acceptanceCompatibility === "architecture-review-required"
      ? ["NOT_COMPATIBLE_WITH_CURRENT_PRIVATE_V1", "REVIEWED_ARCHITECTURE_PATH_REQUIRED_NOT_IMPLEMENTED"]
      : null;
  if (
    expectedCompatibility === null
    || compatibility?.state !== expectedCompatibility[0]
    || compatibility?.unresolvedReason !== expectedCompatibility[1]
  ) add("OUTPUT_AUTHORIZATION_COMPATIBILITY_MISMATCH", "$.authorizationCompatibility", "authorization state and unresolved reason must be the exact pair implied by the accepted compatibility result");

  try {
    const encodedPool = encodeLaunchExecutorPoolConfigurationV1(bundle.poolConfigurationV1).encoded;
    if (bundle.launchCall?.poolConfiguration !== encodedPool) {
      add("OUTPUT_POOL_CONFIGURATION_MISMATCH", "$.launchCall.poolConfiguration", "encoded PoolConfigurationV1 bytes differ from the exact decoded pool configuration");
    }
  } catch (error) {
    add("OUTPUT_POOL_CONFIGURATION_INVALID", "$.poolConfigurationV1", `PoolConfigurationV1 cannot be encoded: ${error.message}`);
  }

  try {
    const expected = {
      artifactSetHash: hashDeploymentArtifactSet(bundle.deploymentSpec),
      callDataHash: keccak256HexBytes(bundle.launchCall.callData, "launchCall.callData"),
      deploymentSpecHash: hashDeploymentSpec(bundle.deploymentSpec),
      evidenceBundleHash: hashLaunchEvidenceBundle(bundle.deploymentSpec),
      hookConfigurationHash: hashExecutorHookConfigurationV1(bundle.launchCall),
      hookConfigurationPayloadHash: keccak256HexBytes(bundle.launchCall.hookConfiguration, "launchCall.hookConfiguration"),
      hookRuntimeCodeHash: bundle.deploymentSpec.launch.hookRuntimeCodeHash,
      launchParametersHash: hashExecutorLaunchParametersV1(bundle.launchCall),
      poolConfigurationHash: hashExecutorPoolConfigurationV1(bundle.launchCall),
      poolConfigurationPayloadHash: keccak256HexBytes(bundle.launchCall.poolConfiguration, "launchCall.poolConfiguration"),
      poolId: hashV4PoolKey(bundle.poolConfigurationV1),
      sourceBindingHash: hashDeploymentSourceBinding(bundle.deploymentSpec),
      targetRuntimeCodeHash: bundle.launchCall.targetRuntimeCodeHash
    };
    for (const [field, value] of Object.entries(expected)) {
      if (bundle.derivedHashes?.[field] !== value) add("OUTPUT_DERIVED_HASH_MISMATCH", `$.derivedHashes.${field}`, `${field} does not match the exact derived value`);
    }
    if (bundle.deploymentSpec.evidenceBundleHash !== expected.evidenceBundleHash) {
      add("OUTPUT_EVIDENCE_BUNDLE_MISMATCH", "$.deploymentSpec.evidenceBundleHash", "evidenceBundleHash does not bind the three exact evidence digests");
    }
    for (const field of ["launchParametersHash", "poolConfigurationHash", "hookConfigurationHash"]) {
      if (bundle.deploymentSpec.launch?.[field] !== expected[field]) add("OUTPUT_DEPLOYMENT_LAUNCH_HASH_MISMATCH", `$.deploymentSpec.launch.${field}`, `${field} differs from the exact launch call`);
    }
  } catch (error) {
    add("OUTPUT_HASH_DERIVATION_INVALID", "$.derivedHashes", `derived hashes cannot be reproduced: ${error.message}`);
  }

  try {
    const { bundleSha256: declaredBundleSha256, ...withoutDigest } = bundle;
    if (declaredBundleSha256 !== sha256Canonical(withoutDigest)) add("OUTPUT_BUNDLE_DIGEST_MISMATCH", "$.bundleSha256", "bundleSha256 does not match the canonical bundle bytes excluding itself");
  } catch (error) {
    add("OUTPUT_BUNDLE_DIGEST_INVALID", "$.bundleSha256", `bundle digest cannot be reproduced: ${error.message}`);
  }

  return findings;
}

export function parseRegistry(value, modelId) {
  const input = exactObject(value, "bindings.registry", [
    "registryCommit", "registryTreeObjectId", "acceptancePath", "acceptanceSha256", "applicationId", "applicationRevision", "packageSha256"
  ]);
  const applicationId = requirePattern(input.applicationId, "bindings.registry.applicationId", APPLICATION_ID, "lowercase kebab-case");
  if (applicationId !== modelId) invalid("APPLICATION_ID_MISMATCH", "Registry application id differs from submission.model.id");
  if (!Number.isInteger(input.applicationRevision) || input.applicationRevision < 1 || input.applicationRevision > 1_000_000) {
    invalid("APPLICATION_REVISION_INVALID", "Registry application revision must be an integer from 1 through 1000000");
  }
  return {
    registryCommit: gitBytes20(input.registryCommit, "bindings.registry.registryCommit"),
    registryTreeObjectId: requirePattern(input.registryTreeObjectId, "bindings.registry.registryTreeObjectId", SHA1, "a lowercase 40-character Git tree id"),
    acceptancePath: requirePattern(input.acceptancePath, "bindings.registry.acceptancePath", ACCEPTANCE_PATH, "a Registry acceptance JSON path"),
    acceptanceSha256: digest32(input.acceptanceSha256, "bindings.registry.acceptanceSha256"),
    applicationId,
    applicationRevision: input.applicationRevision,
    packageSha256: digest32(input.packageSha256, "bindings.registry.packageSha256")
  };
}

export function parseSource(value) {
  const input = exactObject(value, "bindings.source", [
    "numericRepositoryId", "repositoryUri", "revisionObjectId", "treeObjectId", "reviewedSourceClosureHash", "submission", "reviewTarget"
  ]);
  return {
    numericRepositoryId: requirePattern(input.numericRepositoryId, "bindings.source.numericRepositoryId", OPAQUE_DECIMAL, "a positive decimal GitHub repository id"),
    repositoryUri: requirePattern(input.repositoryUri, "bindings.source.repositoryUri", GITHUB_REPOSITORY, "a canonical lowercase GitHub repository URL"),
    revisionObjectId: gitBytes20(input.revisionObjectId, "bindings.source.revisionObjectId"),
    treeObjectId: gitBytes20(input.treeObjectId, "bindings.source.treeObjectId"),
    reviewedSourceClosureHash: digest32(input.reviewedSourceClosureHash, "bindings.source.reviewedSourceClosureHash"),
    submission: parseFileRef(input.submission, "bindings.source.submission", "source"),
    reviewTarget: parseFileRef(input.reviewTarget, "bindings.source.reviewTarget", "source")
  };
}

export function parseBuild(value, roots, files) {
  const input = exactObject(value, "bindings.build", ["compiler", "settings", "dependencyLock", "buildInfo", "abi"]);
  if (typeof input.compiler !== "string" || input.compiler.length === 0 || input.compiler.length > 100) invalid("BUILD_BINDING_INVALID", "bindings.build.compiler is invalid");
  const settings = readBoundFile(parseFileRef(input.settings, "bindings.build.settings", "source"), "build settings", roots, files);
  const dependencyLock = readBoundFile(parseFileRef(input.dependencyLock, "bindings.build.dependencyLock", "source"), "dependency lock", roots, files);
  const buildInfo = readBoundFile(parseFileRef(input.buildInfo, "bindings.build.buildInfo", "evidence"), "build info", roots, files);
  const abi = readBoundFile(parseFileRef(input.abi, "bindings.build.abi", "evidence"), "ABI", roots, files);
  return {
    compiler: input.compiler,
    settingsHash: shaLabelToBytes32(settings.sha256),
    dependencyLockHash: shaLabelToBytes32(dependencyLock.sha256),
    buildInfoSha256: shaLabelToBytes32(buildInfo.sha256),
    abiHash: shaLabelToBytes32(abi.sha256)
  };
}

export function parseArtifacts(value, roots, files) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) invalid("ARTIFACTS_INVALID", "bindings.artifacts must contain 1 through 64 immutable artifacts");
  const artifacts = value.map((entry, index) => {
    const input = exactObject(entry, `bindings.artifacts[${index}]`, [
      "component", "codeMode", "address", "source", "artifact", "creationBytecodeJsonPointer", "runtimeBytecodeJsonPointer", "constructorArgs"
    ]);
    if (input.codeMode !== "immutable") invalid("ARTIFACT_CODE_MODE_UNSUPPORTED", `bindings.artifacts[${index}].codeMode must equal immutable`);
    const component = requirePattern(input.component, `bindings.artifacts[${index}].component`, COMPONENT, "lowercase kebab-case");
    const sourceFile = readBoundFile(parseFileRef(input.source, `bindings.artifacts[${index}].source`, "source"), `artifact ${component} source`, roots, files);
    const artifactFile = readBoundFile(parseFileRef(input.artifact, `bindings.artifacts[${index}].artifact`, "evidence"), `artifact ${component} JSON`, roots, files);
    const artifactJson = parseJson(artifactFile.bytes, `artifact ${component} JSON`);
    const creationPointer = jsonPointer(input.creationBytecodeJsonPointer, `bindings.artifacts[${index}].creationBytecodeJsonPointer`);
    const runtimePointer = jsonPointer(input.runtimeBytecodeJsonPointer, `bindings.artifacts[${index}].runtimeBytecodeJsonPointer`);
    const creationBytecode = normalizeHexBytes(resolveJsonPointer(artifactJson, creationPointer, `artifact ${component} creation bytecode`), `artifact ${component} creation bytecode`, MAX_BOUND_FILE_BYTES);
    const runtimeBytecode = normalizeHexBytes(resolveJsonPointer(artifactJson, runtimePointer, `artifact ${component} runtime bytecode`), `artifact ${component} runtime bytecode`, MAX_BOUND_FILE_BYTES);
    if (runtimeBytecode === "0x") invalid("ARTIFACT_RUNTIME_EMPTY", `artifact ${component} runtime bytecode must not be empty`);
    const constructorArgs = normalizeHexBytes(input.constructorArgs, `bindings.artifacts[${index}].constructorArgs`, MAX_CONFIGURATION_BYTES);
    const initCode = `0x${creationBytecode.slice(2)}${constructorArgs.slice(2)}`;
    return {
      component,
      codeMode: "immutable",
      address: checksumAddress(input.address, { label: `bindings.artifacts[${index}].address` }),
      constructorArgsHash: keccak256HexBytes(constructorArgs, `artifact ${component} constructor arguments`),
      initCodeHash: keccak256HexBytes(initCode, `artifact ${component} init code`),
      runtimeCodeHash: keccak256HexBytes(runtimeBytecode, `artifact ${component} runtime bytecode`),
      source: { root: sourceFile.root, path: sourceFile.path, sha256: sourceFile.sha256 },
      artifact: { root: artifactFile.root, path: artifactFile.path, sha256: artifactFile.sha256 },
      creationBytecodeJsonPointer: creationPointer,
      runtimeBytecodeJsonPointer: runtimePointer,
      constructorArgsBytes: (constructorArgs.length - 2) / 2
    };
  });
  const componentNames = artifacts.map(({ component }) => component);
  if (componentNames.join("\0") !== [...componentNames].sort(compareUtf8).join("\0") || new Set(componentNames).size !== componentNames.length) {
    invalid("ARTIFACTS_NONCANONICAL", "artifact components must be unique and sorted by component name");
  }
  const addresses = artifacts.map(({ address }) => address.toLowerCase());
  if (new Set(addresses).size !== addresses.length) invalid("ARTIFACT_ADDRESS_DUPLICATE", "artifact addresses must be unique");
  return artifacts;
}

export function parseEvidence(value, roots, files) {
  const input = exactObject(value, "bindings.evidence", ["build", "configuration", "feeConformance"]);
  return Object.fromEntries(Object.entries(input).map(([key, fileRef]) => {
    const bound = readBoundFile(parseFileRef(fileRef, `bindings.evidence.${key}`, "evidence"), `${key} evidence`, roots, files);
    return [key, { ...bound, digest32: shaLabelToBytes32(bound.sha256) }];
  }));
}

export function parseInfrastructure(value, chainId) {
  const input = exactObject(value, "bindings.launchInfrastructure", [
    "authorityContract", "launcher", "launchCaller", "nativeValue", "poolManager", "hook", "chainId"
  ]);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || String(chainId) !== input.chainId) {
    invalid("CHAIN_ID_MISMATCH", "bindings.launchInfrastructure.chainId must equal submission.target.chainId as a decimal string");
  }
  const parsed = {
    authorityContract: checksumAddress(input.authorityContract, { label: "bindings.launchInfrastructure.authorityContract" }),
    launcher: checksumAddress(input.launcher, { label: "bindings.launchInfrastructure.launcher" }),
    launchCaller: checksumAddress(input.launchCaller, { label: "bindings.launchInfrastructure.launchCaller" }),
    nativeValue: decimalUint(input.nativeValue, "bindings.launchInfrastructure.nativeValue", UINT256_MAX, true).toString(),
    poolManager: checksumAddress(input.poolManager, { label: "bindings.launchInfrastructure.poolManager" }),
    hook: checksumAddress(input.hook, { label: "bindings.launchInfrastructure.hook" }),
    chainId: input.chainId
  };
  const critical = [parsed.authorityContract, parsed.launcher, parsed.poolManager, parsed.hook].map((address) => address.toLowerCase());
  if (new Set(critical).size !== critical.length) invalid("CRITICAL_ADDRESS_COLLISION", "gate, launcher, PoolManager and hook addresses must be distinct");
  if (parsed.launchCaller.toLowerCase() === PROGRAMMABLE_FEE_RECIPIENT.toLowerCase()) invalid("FEE_RECIPIENT_IS_FEE_ONLY", "the immutable fee recipient cannot be the launch caller");
  return parsed;
}

export function parseExecutorInput(value) {
  const input = exactObject(value, "bindings.executorCall", ["target", "refundRecipient", "callData", "hookConfiguration"]);
  return {
    target: checksumAddress(input.target, { label: "bindings.executorCall.target" }),
    refundRecipient: checksumAddress(input.refundRecipient, { label: "bindings.executorCall.refundRecipient" }),
    callData: normalizeHexBytes(input.callData, "bindings.executorCall.callData", MAX_CALLDATA_BYTES),
    hookConfiguration: normalizeHexBytes(input.hookConfiguration, "bindings.executorCall.hookConfiguration", MAX_CONFIGURATION_BYTES)
  };
}

export function parseAssetAddresses(value, declaredAssets) {
  if (!Array.isArray(value) || value.length !== 2) invalid("POOL_ASSET_BINDINGS_INVALID", "bindings.assetAddresses must contain exactly the two PoolKey assets");
  const declarations = new Map((Array.isArray(declaredAssets) ? declaredAssets : []).map((asset) => [asset?.id, asset]));
  const result = new Map();
  for (const [index, entry] of value.entries()) {
    const input = exactObject(entry, `bindings.assetAddresses[${index}]`, ["assetId", "address"]);
    const assetId = requirePattern(input.assetId, `bindings.assetAddresses[${index}].assetId`, /^[a-z][a-z0-9-]*$/u, "a declared asset id");
    const declaration = declarations.get(assetId);
    if (!declaration) invalid("POOL_ASSET_UNDECLARED", `asset binding ${assetId} does not resolve to submission.assets`);
    if (result.has(assetId)) invalid("POOL_ASSET_BINDING_DUPLICATE", `asset binding ${assetId} is duplicated`);
    const address = checksumAddress(input.address, { allowZero: declaration.origin === "native-eth", label: `bindings.assetAddresses[${index}].address` });
    if (declaration.origin === "native-eth" && BigInt(address) !== 0n) invalid("NATIVE_ASSET_ADDRESS_INVALID", `native asset ${assetId} must resolve to the zero address`);
    if (declaration.origin !== "native-eth" && BigInt(address) === 0n) invalid("ERC20_ASSET_ADDRESS_INVALID", `non-native asset ${assetId} must not resolve to the zero address`);
    if (typeof declaration.address === "string" && declaration.address.toLowerCase() !== address.toLowerCase()) invalid("POOL_ASSET_ADDRESS_MISMATCH", `asset binding ${assetId} differs from its submitted exact address`);
    result.set(assetId, address);
  }
  return result;
}

export function assertAcceptance(acceptance, { registry, source, modelId }) {
  if (acceptance?.schemaVersion !== "2.0.0" || acceptance?.decision !== "accepted-for-registry-promotion") {
    invalid("REGISTRY_ACCEPTANCE_INVALID", "Registry acceptance must be a v2 accepted-for-registry-promotion record");
  }
  assertExactKeys(acceptance, "Registry acceptance", [
    "acceptedAt", "adminReviewReceipt", "application", "conditions", "decision", "githubReview", "githubState",
    "projectRecordPath", "reviewedSourceClosure", "reviewedSourceClosureHash", "schemaVersion", "source"
  ]);
  requireCanonicalTimestamp(acceptance.acceptedAt, "Registry acceptance acceptedAt");
  const application = exactObject(acceptance.application, "Registry acceptance application", [
    "applicationId", "applicationRevision", "baseSha", "headSha", "packageDigest", "pullNumber", "pullRequest"
  ]);
  if (application.applicationId !== modelId || application.applicationRevision !== registry.applicationRevision || digest32(application.packageDigest, "acceptance.application.packageDigest") !== registry.packageSha256) {
    invalid("REGISTRY_ACCEPTANCE_APPLICATION_MISMATCH", "Registry acceptance application identity differs from the exact bundle binding");
  }
  const closure = exactObject(acceptance.reviewedSourceClosure, "Registry acceptance reviewed source closure", ["companions", "primary", "schemaVersion"]);
  if (closure.schemaVersion !== "1.0.0" || !Array.isArray(closure.companions) || closure.companions.length > 8) {
    invalid("REGISTRY_ACCEPTANCE_CLOSURE_INVALID", "Registry acceptance reviewed source closure has an invalid shape");
  }
  const primary = exactObject(closure.primary, "Registry acceptance primary source", ["numericRepositoryId", "repositoryUri", "revisionObjectId", "treeObjectId"]);
  const direct = exactObject(acceptance.source, "Registry acceptance source", ["numericRepositoryId", "repositoryUri", "revisionObjectId", "treeObjectId"]);
  for (const candidate of [primary, direct]) {
    if (!candidate || candidate.numericRepositoryId !== source.numericRepositoryId || candidate.repositoryUri !== source.repositoryUri || candidate.revisionObjectId !== source.revisionObjectId.slice(2) || candidate.treeObjectId !== source.treeObjectId.slice(2)) {
      invalid("REGISTRY_ACCEPTANCE_SOURCE_MISMATCH", "Registry acceptance primary source differs from the exact source binding");
    }
  }
  if (digest32(acceptance.reviewedSourceClosureHash, "acceptance.reviewedSourceClosureHash") !== source.reviewedSourceClosureHash) {
    invalid("REGISTRY_ACCEPTANCE_CLOSURE_MISMATCH", "Registry acceptance reviewed source-closure hash differs from the source binding");
  }
  const receipt = requireObject(acceptance.adminReviewReceipt, "Registry acceptance Admin review receipt");
  if (receipt.action !== "record_review_complete" || receipt.schemaVersion !== 4) {
    invalid("REGISTRY_ACCEPTANCE_REVIEW_INVALID", "Registry acceptance must contain the current hash-bound Admin review receipt v4");
  }
  const compatibilityResult = receipt.snapshot?.compatibilityResult;
  if (!["prototype-ready", "architecture-review-required"].includes(compatibilityResult)) {
    invalid("REGISTRY_ACCEPTANCE_NOT_LAUNCH_ELIGIBLE", "accepted Registry record must retain prototype-ready or architecture-review-required compatibility");
  }
  return {
    schemaVersion: acceptance.schemaVersion,
    decision: acceptance.decision,
    compatibilityResult,
    acceptedAt: acceptance.acceptedAt,
    applicationId: application.applicationId,
    applicationRevision: application.applicationRevision,
    packageSha256: registry.packageSha256,
    reviewedSourceClosureHash: source.reviewedSourceClosureHash
  };
}

export function assertCriticalArtifacts({ artifactByAddress, infrastructure, executorInput, targetComponent }) {
  const roles = {
    authority: [infrastructure.authorityContract, null],
    launcher: [infrastructure.launcher, null],
    poolManager: [infrastructure.poolManager, null],
    hook: [infrastructure.hook, null],
    target: [executorInput.target, targetComponent]
  };
  const result = {};
  for (const [role, [address, component]] of Object.entries(roles)) {
    const artifact = artifactByAddress.get(address.toLowerCase());
    if (!artifact) invalid("REQUIRED_ARTIFACT_MISSING", `${role} address has no bytecode-derived immutable artifact entry`);
    if (component !== null && artifact.component !== component) invalid("TARGET_COMPONENT_MISMATCH", "executor target artifact differs from submission.launchPlan.targetComponent");
    result[role] = artifact;
  }
  return result;
}
