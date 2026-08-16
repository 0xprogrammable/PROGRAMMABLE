import { canonicalJson } from "./submission-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import {
  SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
  SOURCE_CLOSURE_MANIFEST_VERSION,
  gitObjectPattern,
  githubRepositoryPattern,
  isObject,
  safeRepositoryPath,
  sha256Pattern
} from "./public-pr-application-v3-shared.mjs";

export function validateSourceClosure(source, policy, security, intent, reviewPackage, add) {
  if (!isObject(source)) return;
  const repositories = [source.primary, ...(Array.isArray(source.companions) ? source.companions : [])];
  const repositoryIdentities = new Set();
  const repositoriesById = new Map();
  for (const [index, repository] of repositories.entries()) {
    const repositoryPath = index === 0 ? "$.source.primary" : `$.source.companions[${index - 1}]`;
    if (!isObject(repository)) continue;
    if (repositoriesById.has(repository.id)) {
      add("blocker", "APPLICATION_SOURCE_REPOSITORY_ID_DUPLICATE", `${repositoryPath}.id`, "Source repository IDs must be unique across primary and companions.", "Assign one stable local repository ID to every exact source closure.", "source-closure-binding");
    }
    const identity = `${repository.numericRepositoryId}:${repository.revisionObjectId}:${repository.treeObjectId}`;
    if (repositoryIdentities.has(identity)) {
      add("blocker", "APPLICATION_SOURCE_REPOSITORY_DUPLICATE", repositoryPath, "The same exact repository revision is declared more than once.", "Keep one source-closure record per repository revision.", "source-closure-binding");
    }
    repositoryIdentities.add(identity);
    if (!githubRepositoryPattern.test(repository.repositoryUri ?? "")) {
      add("blocker", "APPLICATION_SOURCE_REPOSITORY_URI_INVALID", `${repositoryPath}.repositoryUri`, "Source repositories must use one canonical public GitHub repository URI.", "Use https://github.com/<owner>/<repository> without a .git suffix.", "source-closure-binding");
    }
    const sourcePaths = Array.isArray(repository.sourcePaths) ? repository.sourcePaths : [];
    const inlinePaths = new Set(sourcePaths);
    for (const [pathIndex, sourcePath] of sourcePaths.entries()) {
      if (!safeRepositoryPath(sourcePath)) {
        add("blocker", "APPLICATION_SOURCE_PATH_UNSAFE", `${repositoryPath}.sourcePaths[${pathIndex}]`, "Source path is not a safe canonical repository-relative path.", "Use the exact normalized Git path without traversal, .git segments, escapes, controls, or bidi markers.", "source-closure-binding");
      }
    }
    const contractPaths = Array.isArray(repository.contractPaths) ? repository.contractPaths : [];
    for (const [pathIndex, contractPath] of contractPaths.entries()) {
      if (!safeRepositoryPath(contractPath)) {
        add("blocker", "APPLICATION_CONTRACT_PATH_UNSAFE", `${repositoryPath}.contractPaths[${pathIndex}]`, "Contract path is not a safe canonical repository-relative path.", "Use the exact normalized Git path.", "source-closure-binding");
      }
      if (repository.sourceClosureMode === "inline" && !sourcePaths.includes(contractPath)) {
        add("blocker", "APPLICATION_CONTRACT_PATH_OUTSIDE_CLOSURE", `${repositoryPath}.contractPaths[${pathIndex}]`, "An inline contract path is absent from the exact source closure.", "Add it to sourcePaths or use the bound manifest closure.", "source-closure-binding");
      }
    }
    if (repository.sourceClosureMode === "inline") {
      if (sourcePaths.length < 1) {
        add("blocker", "APPLICATION_INLINE_SOURCE_CLOSURE_EMPTY", `${repositoryPath}.sourcePaths`, "Inline source closure requires at least one exact path.", "Declare the exact paths or switch to sourceManifest mode.", "tooling-transport");
      }
      if (sourcePaths.length > 4096) {
        add("blocker", "APPLICATION_INLINE_SOURCE_CLOSURE_LIMIT", `${repositoryPath}.sourcePaths`, "Inline source closure exceeds the review transport cap.", "Use a versioned, content-addressed sourceManifest or split tooling review; the idea remains eligible.", "tooling-transport");
      }
      if (repository.sourceManifest !== null) {
        add("blocker", "APPLICATION_INLINE_SOURCE_MANIFEST_CONFLICT", `${repositoryPath}.sourceManifest`, "Inline mode cannot also claim a manifest closure.", "Set sourceManifest to null or switch sourceClosureMode to manifest.", "source-closure-binding");
      }
    } else if (repository.sourceClosureMode === "manifest") {
      if (sourcePaths.length !== 0) {
        add("blocker", "APPLICATION_MANIFEST_INLINE_PATH_CONFLICT", `${repositoryPath}.sourcePaths`, "Manifest mode uses an empty inline sourcePaths list to avoid ambiguous closure authority.", "Move the full closure into the exact manifest and clear sourcePaths.", "source-closure-binding");
      }
      validateSourceManifestBinding(repository.sourceManifest, repositoryPath, add);
      add("review", "APPLICATION_SOURCE_MANIFEST_EXTERNAL_VERIFICATION_REQUIRED", `${repositoryPath}.sourceManifest`, "The manifest representation preserves arbitrarily large projects, but its exact Git blob, fragments, ordering, and counts still require bounded tooling verification.", "Verify the bound manifest and fragments from the pinned commit; split the review workload if needed without rejecting the idea.", "tooling-split-review");
    } else {
      add("blocker", "APPLICATION_SOURCE_CLOSURE_MODE_INVALID", `${repositoryPath}.sourceClosureMode`, "Source closure must select inline or manifest mode.", "Choose inline for small closures or a content-addressed manifest for arbitrary size.", "tooling-transport");
    }
    repositoriesById.set(repository.id, {
      repository,
      path: repositoryPath,
      inlinePaths,
      manifestBound: repository.sourceClosureMode === "manifest" && isObject(repository.sourceManifest)
    });
  }

  validatePersistedSourceVerificationReports(
    source.verificationReports,
    repositoriesById,
    reviewPackage,
    add
  );

  for (const { owner, field, repositoryRefField, label, findingRoot } of [
    { owner: policy, field: "feePolicySchemaPath", repositoryRefField: "feePolicySchemaRepositoryRef", label: "Fee V2 schema", findingRoot: "policyBindings" },
    { owner: policy, field: "feePolicyInstancePath", repositoryRefField: "feePolicyInstanceRepositoryRef", label: "Fee V2 instance", findingRoot: "policyBindings" },
    { owner: policy, field: "submissionPath", repositoryRefField: "submissionRepositoryRef", label: "submission", findingRoot: "policyBindings" },
    { owner: intent, field: "ideaSourcePath", repositoryRefField: "ideaSourceRepositoryRef", label: "normative idea source", findingRoot: "intentCapture" }
  ]) {
    const boundPath = owner?.[field];
    const repositoryRef = owner?.[repositoryRefField];
    if (boundPath === null && repositoryRef === null) continue;
    const closure = repositoriesById.get(repositoryRef);
    if (!closure) {
      add("blocker", "APPLICATION_ARTIFACT_REPOSITORY_REF_MISSING", `$.${findingRoot}.${repositoryRefField}`, `${label} repositoryRef does not resolve to one declared repository.`, "Bind the artifact to the exact primary or companion repository ID.", "source-closure-binding");
    } else if (typeof boundPath === "string" && !closure.inlinePaths.has(boundPath) && !closure.manifestBound) {
      add("blocker", "APPLICATION_ARTIFACT_PATH_OUTSIDE_SOURCE_CLOSURE", `$.${findingRoot}.${field}`, `${label} path is outside its explicitly referenced source closure.`, "Include the exact path in that repository's inline closure or its bound manifest.", "source-closure-binding");
    }
  }
  for (const [index, record] of (Array.isArray(reviewPackage?.records) ? reviewPackage.records : []).entries()) {
    const recordPath = `$.reviewPackage.records[${index}]`;
    if (record?.source === "application-package") {
      if (record.repositoryRef !== null) {
        add("blocker", "APPLICATION_PACKAGE_RECORD_REPOSITORY_REF_INVALID", `${recordPath}.repositoryRef`, "Application-package records cannot claim a source repository.", "Set repositoryRef to null.", "source-closure-binding");
      }
      continue;
    }
    if (record?.source !== "source-repository") continue;
    const closure = repositoriesById.get(record.repositoryRef);
    if (!closure) {
      add("blocker", "APPLICATION_REVIEW_REPOSITORY_REF_MISSING", `${recordPath}.repositoryRef`, "Source-repository review record does not resolve to one exact repository.", "Set repositoryRef to the declared primary or companion repository ID.", "source-closure-binding");
    } else if (!closure.inlinePaths.has(record.path) && !closure.manifestBound) {
      add("blocker", "APPLICATION_REVIEW_PATH_OUTSIDE_SOURCE_CLOSURE", `${recordPath}.path`, "A review record is outside its explicitly referenced source closure.", "Include the exact path in that repository's inline closure or bound manifest.", "source-closure-binding");
    }
  }
}

function validatePersistedSourceVerificationReports(bindings, repositoriesById, reviewPackage, add) {
  if (!Array.isArray(bindings)) return;
  const seenRepositories = new Set();
  const seenReportPaths = new Set();
  const records = Array.isArray(reviewPackage?.records) ? reviewPackage.records : [];
  for (const [index, binding] of bindings.entries()) {
    if (!isObject(binding)) continue;
    const findingPath = `$.source.verificationReports[${index}]`;
    if (seenRepositories.has(binding.repositoryRef)) {
      add("blocker", "APPLICATION_SOURCE_VERIFICATION_REPOSITORY_DUPLICATE", `${findingPath}.repositoryRef`, "One repository has more than one persisted verification association.", "Keep one exact current report binding per pinned repository closure.", "source-closure-binding");
    }
    seenRepositories.add(binding.repositoryRef);
    if (seenReportPaths.has(binding.reportPath)) {
      add("blocker", "APPLICATION_SOURCE_VERIFICATION_REPORT_PATH_DUPLICATE", `${findingPath}.reportPath`, "Two repository closures cannot share one persisted verification report path.", "Materialize one distinct derived report per exact repository closure.", "source-closure-binding");
    }
    seenReportPaths.add(binding.reportPath);
    const closure = repositoriesById.get(binding.repositoryRef);
    const repository = closure?.repository;
    if (!sourceClosureBindingMatchesRepository(binding, repository) || !sha256Pattern.test(binding.closureSha256 ?? "")) {
      add("blocker", "APPLICATION_SOURCE_VERIFICATION_BINDING_MISMATCH", findingPath, "Persisted verification association does not match one exact inline or manifest repository commit, tree, and closure identity.", "Regenerate the association from the exact pinned source closure.", "source-closure-binding");
    }
    if (binding.result !== "VERIFIED") {
      add("blocker", "APPLICATION_SOURCE_VERIFICATION_RESULT_INVALID", `${findingPath}.result`, "Only a completed VERIFIED result may be persisted as source-assessed evidence.", "Keep hold or split-review reports outside the source-assessed mapping until verification completes.", "source-closure-binding");
    }
    const matches = records.filter((record) => (
      record.kind === "source-closure-verification"
      && record.source === "application-package"
      && record.repositoryRef === null
      && record.path === binding.reportPath
      && record.sha256 === binding.reportSha256
      && record.byteLength === binding.reportByteLength
    ));
    if (matches.length !== 1) {
      add("blocker", "APPLICATION_SOURCE_VERIFICATION_REPORT_RECORD_MISMATCH", findingPath, "Persisted verification association does not resolve to exactly one application-package report record.", "Bind the exact derived report path, hash, and byte length once with repositoryRef null.", "source-closure-binding");
    }
  }
  if (bindings.length > 0) {
    for (const repositoryRef of repositoriesById.keys()) {
      if (!seenRepositories.has(repositoryRef)) {
        add("blocker", "APPLICATION_SOURCE_VERIFICATION_REPOSITORY_MISSING", "$.source.verificationReports", "A derived verification mapping exists but does not cover every declared repository exactly once.", "Persist one exact current report binding for every primary and companion repository.", "source-closure-binding", { repositoryRef });
      }
    }
    for (const repositoryRef of seenRepositories) {
      if (!repositoriesById.has(repositoryRef)) {
        add("blocker", "APPLICATION_SOURCE_VERIFICATION_REPOSITORY_UNKNOWN", "$.source.verificationReports", "A persisted verification mapping references no declared source repository.", "Remove the stale mapping or bind it to the exact declared repository.", "source-closure-binding", { repositoryRef });
      }
    }
  }
}

export function sourceClosureBindingMatchesRepository(binding, repository) {
  if (
    !isObject(binding)
    || !isObject(repository)
    || binding.sourceClosureMode !== repository.sourceClosureMode
    || binding.revisionObjectId !== repository.revisionObjectId
    || binding.treeObjectId !== repository.treeObjectId
  ) return false;
  if (repository.sourceClosureMode === "inline") {
    const sourcePaths = Array.isArray(repository.sourcePaths) ? repository.sourcePaths : [];
    return canonicalJson(binding.sourcePaths) === canonicalJson(sourcePaths)
      && binding.sourcePathsSha256 === sourcePathsSha256(sourcePaths)
      && binding.manifestPath === null
      && binding.manifestSha256 === null
      && binding.manifestByteLength === null;
  }
  return repository.sourceClosureMode === "manifest"
    && isObject(repository.sourceManifest)
    && Array.isArray(binding.sourcePaths)
    && binding.sourcePaths.length === 0
    && binding.sourcePathsSha256 === null
    && binding.manifestPath === repository.sourceManifest.path
    && binding.manifestSha256 === repository.sourceManifest.sha256
    && binding.manifestByteLength === repository.sourceManifest.byteLength;
}

export function sourcePathsSha256(sourcePaths) {
  return sha256Bytes(Buffer.from(`${canonicalJson(sourcePaths)}\n`, "utf8"));
}

function validateSourceManifestBinding(binding, repositoryPath, add) {
  const findingPath = `${repositoryPath}.sourceManifest`;
  if (!isObject(binding)) {
    add("blocker", "APPLICATION_SOURCE_MANIFEST_BINDING_MISSING", findingPath, "Manifest mode requires an exact sourceManifest binding.", "Bind the versioned manifest path, bytes, Git blob, and counts.", "source-closure-binding");
    return;
  }
  if (binding.schemaId !== SOURCE_CLOSURE_MANIFEST_SCHEMA_ID || binding.schemaVersion !== SOURCE_CLOSURE_MANIFEST_VERSION) {
    add("blocker", "APPLICATION_SOURCE_MANIFEST_VERSION_INVALID", findingPath, "The source manifest schema ID or version is not the supported exact contract.", "Use the versioned source-closure-manifest v1 contract.", "source-closure-binding");
  }
  if (!safeRepositoryPath(binding.path) || !sha256Pattern.test(binding.sha256 ?? "") || !gitObjectPattern.test(binding.blobObjectId ?? "")) {
    add("blocker", "APPLICATION_SOURCE_MANIFEST_IDENTITY_INVALID", findingPath, "Manifest path, SHA-256, or Git blob identity is invalid.", "Bind the exact canonical file bytes and committed blob.", "source-closure-binding");
  }
  for (const field of ["byteLength", "entryCount", "fragmentCount"]) {
    if (!Number.isSafeInteger(binding[field]) || binding[field] < 1) {
      add("blocker", "APPLICATION_SOURCE_MANIFEST_COUNT_INVALID", `${findingPath}.${field}`, `${field} must be one positive safe integer.`, "Use exact manifest metadata without precision loss.", "source-closure-binding");
    }
  }
  if (Number.isSafeInteger(binding.fragmentCount) && Number.isSafeInteger(binding.entryCount) && binding.fragmentCount > binding.entryCount) {
    add("blocker", "APPLICATION_SOURCE_MANIFEST_FRAGMENT_COUNT_INVALID", `${findingPath}.fragmentCount`, "A non-empty fragment set cannot contain more fragments than source entries.", "Regenerate non-empty fragments and exact counts.", "source-closure-binding");
  }
}
