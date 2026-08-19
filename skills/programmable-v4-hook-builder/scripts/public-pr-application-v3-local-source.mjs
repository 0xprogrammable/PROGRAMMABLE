import crypto from "node:crypto";
import {
  matchGitlinkCompanions,
  parseGitLfsPointer,
  resolveRawGitSymlinks,
  summarizeDependencyPointers,
  verifyStreamedGitLfsObject
} from "./dependency-pointer-core.mjs";
import { verifyRawGitCommitTreeIntegrity } from "./raw-git-integrity-core.mjs";
import {
  GIT_LFS_POINTER_INSPECTION_BYTES,
  SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
  addFindingCopy,
  classifyPublicPrApplicationV3RawGitFailure,
  classifyPublicPrApplicationV3SourceManifestFailure,
  compareUtf8,
  createFindingAdder,
  finalizeReport,
  gitObjectPattern,
  isObject
} from "./public-pr-application-v3-shared.mjs";
import {
  validateSourceClosureManifestV1,
  verifyBoundSourceClosureManifestV1
} from "./public-pr-application-v3-source-contract.mjs";
import {
  CanonicalSourceEntryJsonlParser,
  GitCatFileBatch,
  addResourceLimitFinding,
  assertBeforeDeadline,
  assertMaterializedLfsParentsStable,
  gitBlobObjectHash,
  gitTreeEntriesForPaths,
  inspectMaterializedLfsPath,
  normalizeRequiredSourceEntries,
  positiveLimit,
  readRecursiveGitTreeEntries,
  requireReadOnlyGitDirectory,
  resourceLimitFailure,
  runGitTextReadOnly,
  safeIntegerSum,
  verifyExactCommittedTreeClosure
} from "./public-pr-application-v3-source-git.mjs";

/**
 * Read-only local verification for an arbitrary-size source closure. Candidate code is never
 * loaded or executed: every root, fragment, and source entry is read from raw Git objects at the
 * exact pinned commit. Fragment JSONL and source blobs are streamed with bounded buffers.
 */
export async function verifyLocalSourceClosureManifestV1({
  repositoryRoot,
  repository,
  manifest,
  requiredPaths = repository?.contractPaths ?? [],
  requiredEntries = (repository?.contractPaths ?? []).map((repositoryPath) => ({
    path: repositoryPath,
    roleIds: ["contract"]
  })),
  applicationRepositories = [repository].filter(Boolean),
  verifiedRepositoryRefs = [],
  limits = {}
}) {
  const findings = [];
  const seen = new Set();
  const add = createFindingAdder(findings, seen);
  const baseReport = validateSourceClosureManifestV1(manifest);
  for (const finding of baseReport.findings) addFindingCopy(add, finding);

  const stats = {
    fragmentsVerified: 0,
    entriesVerified: 0,
    sourceBytesVerified: 0,
    fragmentBytesVerified: 0,
    symlinkEntries: 0,
    treeEntriesObserved: 0,
    metadataEntriesExcluded: 0,
    gitlinkEntries: 0,
    lfsPointerEntries: 0,
    lfsTargetBytesVerified: 0
  };
  const dependencyPointers = [];
  const finish = () => localSourceManifestReport(findings, stats, { repository, manifest, dependencyPointers });
  const maxRootManifestBytes = positiveLimit(limits.maxRootManifestBytes, 64 * 1024 * 1024);
  const maxJsonLineBytes = positiveLimit(limits.maxJsonLineBytes, 2 * 1024 * 1024);
  const entryBatchSize = positiveLimit(limits.entryBatchSize, 256, 1024);
  const maxEntries = positiveLimit(limits.maxEntries, 1_000_000, 10_000_000);
  const maxFragments = positiveLimit(limits.maxFragments, 100_000, 1_000_000);
  const maxSourceBlobBytes = positiveLimit(limits.maxSourceBlobBytes, 512 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const maxTotalSourceBytes = positiveLimit(limits.maxTotalSourceBytes, 16 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const maxTotalFragmentBytes = positiveLimit(limits.maxTotalFragmentBytes, 2 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const maxTreeEntries = positiveLimit(limits.maxTreeEntries, 1_100_001, 11_000_001);
  const maxTreeListingBytes = positiveLimit(limits.maxTreeListingBytes, 512 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const maxTreeRecordBytes = positiveLimit(limits.maxTreeRecordBytes, 16 * 1024, 16 * 1024 * 1024);
  const maxSymlinkTargetBytes = positiveLimit(limits.maxSymlinkTargetBytes, 16 * 1024, 16 * 1024 * 1024);
  const maxMaterializedLfsBytes = positiveLimit(
    limits.maxMaterializedLfsBytes,
    16 * 1024 * 1024 * 1024,
    Number.MAX_SAFE_INTEGER
  );
  const maxWallTimeMs = positiveLimit(limits.maxWallTimeMs, 15 * 60 * 1000, 60 * 60 * 1000);
  const deadlineAt = Date.now() + maxWallTimeMs;
  const materializedLfsBudget = { maximumBytes: maxMaterializedLfsBytes, consumedBytes: 0 };
  const rawGitIntegrityLimits = isObject(limits.rawGitIntegrityLimits)
    ? limits.rawGitIntegrityLimits
    : {};

  let repositoryDirectory = null;
  let fragmentCat = null;
  let entryCat = null;
  try {
    repositoryDirectory = requireReadOnlyGitDirectory(repositoryRoot);
    if (!isObject(repository) || repository.sourceClosureMode !== "manifest" || !isObject(repository.sourceManifest)) {
      add("blocker", "SOURCE_MANIFEST_BINDING_MISSING", "$.sourceManifest", "Local verification requires one exact manifest-mode repository binding.", "Bind the root manifest before reading local Git objects.", "source-closure-binding");
      return finish();
    }
    if (!gitObjectPattern.test(repository.revisionObjectId ?? "") || !gitObjectPattern.test(repository.treeObjectId ?? "")) {
      add("blocker", "SOURCE_MANIFEST_GIT_REVISION_INVALID", "$.repository", "Repository commit or tree binding is invalid.", "Use exact full Git object IDs.", "source-closure-binding");
      return finish();
    }
    try {
      verifyRawGitCommitTreeIntegrity({
        repositoryRoot: repositoryDirectory,
        revisionObjectId: repository.revisionObjectId,
        treeObjectId: repository.treeObjectId,
        deadlineAt,
        limits: rawGitIntegrityLimits
      });
    } catch (error) {
      const failure = classifyPublicPrApplicationV3RawGitFailure(error);
      if (failure.disposition === "split-review") {
        addResourceLimitFinding(
          add,
          "$.repository",
          "Raw Git commit/tree verification exceeded this run's bounded resource or wall-time budget.",
          { integrityCode: failure.integrityCode }
        );
      } else if (failure.disposition === "availability") {
        add(
          "blocker",
          "SOURCE_MANIFEST_RAW_GIT_OBJECTS_UNAVAILABLE",
          "$.repository",
          "The selected local Git object store could not provide every exact pinned commit and tree object.",
          "Retry with a complete object store for the same pinned revision; absence here is an availability hold, not evidence that the source is invalid.",
          "tooling-transport",
          { integrityCode: failure.integrityCode, objectAvailability: "UNAVAILABLE" }
        );
      } else {
        add(
          "blocker",
          "SOURCE_MANIFEST_RAW_GIT_INTEGRITY_INVALID",
          "$.repository",
          "The pinned raw commit, root tree, or recursive tree object failed exact Git identity verification.",
          "Use an intact local Git object database and replay the verifier over the exact commit and every recursive tree object.",
          "source-closure-binding",
          { integrityCode: failure.integrityCode }
        );
      }
      return finish();
    }
    if (manifest.entryCount > maxEntries || manifest.fragmentCount > maxFragments) {
      addResourceLimitFinding(add, "$.entryCount", "The declared source closure exceeds this verifier run's entry or fragment budget.");
      return finish();
    }
    const declaredFragmentBytes = safeIntegerSum(manifest.fragments.map(({ byteLength }) => byteLength));
    if (declaredFragmentBytes === null || declaredFragmentBytes > maxTotalFragmentBytes) {
      addResourceLimitFinding(add, "$.fragments", "The declared fragment bytes exceed this verifier run's bounded transport budget.");
      return finish();
    }
    assertBeforeDeadline(deadlineAt);
    const observedTree = runGitTextReadOnly(repositoryDirectory, [
      "rev-parse",
      "--verify",
      `${repository.revisionObjectId}^{tree}`
    ], deadlineAt);
    if (observedTree !== repository.treeObjectId) {
      add("blocker", "SOURCE_MANIFEST_TREE_BINDING_MISMATCH", "$.repository.treeObjectId", "Pinned commit does not resolve to the declared tree.", "Use the exact commit/tree pair without rewriting history.", "source-closure-binding");
      return finish();
    }

    const rootBinding = repository.sourceManifest;
    if (rootBinding.byteLength > maxRootManifestBytes) {
      add("blocker", "SOURCE_MANIFEST_ROOT_RESOURCE_LIMIT", "$.sourceManifest.byteLength", "Root manifest exceeds the bounded local parser budget.", "Split the root into more fragments or raise an explicitly reviewed local budget; the product idea remains eligible.", "tooling-split-review");
      return finish();
    }
    const [rootTreeEntry] = gitTreeEntriesForPaths(
      repositoryDirectory,
      repository.revisionObjectId,
      [rootBinding.path],
      deadlineAt
    );
    if (
      !rootTreeEntry
      || rootTreeEntry.path !== rootBinding.path
      || rootTreeEntry.type !== "blob"
      || !["100644", "100755"].includes(rootTreeEntry.mode)
    ) {
      add("blocker", "SOURCE_MANIFEST_ROOT_GIT_ENTRY_MISSING", "$.sourceManifest.path", "Root manifest path is not one exact blob at the pinned commit.", "Commit the exact root manifest at its declared path.", "source-closure-binding");
      return finish();
    }
    if (rootTreeEntry.objectId !== rootBinding.blobObjectId) {
      add("blocker", "SOURCE_MANIFEST_ROOT_BLOB_MISMATCH", "$.sourceManifest.blobObjectId", "Root manifest Git blob differs from its application binding.", "Bind the exact raw Git blob object.", "source-closure-binding");
      return finish();
    }

    fragmentCat = new GitCatFileBatch(repositoryDirectory, { deadlineAt });
    entryCat = new GitCatFileBatch(repositoryDirectory, { deadlineAt });
    const rootChunks = [];
    const rootObject = await fragmentCat.readBlob(rootBinding.blobObjectId, async (chunk) => {
      rootChunks.push(Buffer.from(chunk));
    }, { maxBytes: maxRootManifestBytes });
    if (rootObject.size !== rootBinding.byteLength) {
      add("blocker", "SOURCE_MANIFEST_ROOT_SIZE_MISMATCH", "$.sourceManifest.byteLength", "Root manifest blob size differs from its binding.", "Bind the exact root bytes.", "source-closure-binding");
    }
    const rootBytes = Buffer.concat(rootChunks);
    for (const finding of verifyBoundSourceClosureManifestV1({
      repository,
      manifest,
      bytes: rootBytes,
      observedBlobObjectId: rootTreeEntry.objectId
    }).findings) addFindingCopy(add, finding);
    if (findings.some(({ severity }) => severity === "blocker")) {
      return finish();
    }

    const committedTreeEntries = await readRecursiveGitTreeEntries({
      repositoryRoot: repositoryDirectory,
      commit: repository.revisionObjectId,
      deadlineAt,
      maxEntries: maxTreeEntries,
      maxListingBytes: maxTreeListingBytes,
      maxRecordBytes: maxTreeRecordBytes
    });
    stats.treeEntriesObserved = committedTreeEntries.length;

    const closureHash = crypto.createHash("sha256");
    const requiredEntryMap = normalizeRequiredSourceEntries(requiredEntries, requiredPaths);
    const requiredPathSet = new Set(requiredEntryMap.keys());
    const observedRequiredPaths = new Set();
    const manifestEntriesByPath = new Map();
    const symlinkBytesByPath = new Map();
    const globalState = {
      previousPath: null,
      totalEntries: 0,
      batch: []
    };
    const flushEntryBatch = async () => {
      if (globalState.batch.length === 0) return;
      assertBeforeDeadline(deadlineAt);
      const treeEntries = gitTreeEntriesForPaths(
        repositoryDirectory,
        repository.revisionObjectId,
        globalState.batch.map(({ entry }) => entry.path),
        deadlineAt
      );
      const treeByPath = new Map(treeEntries.map((entry) => [entry.path, entry]));
      for (const { entry, instancePath } of globalState.batch) {
        const treeEntry = treeByPath.get(entry.path);
        if (!treeEntry) {
          add("blocker", "SOURCE_MANIFEST_ENTRY_GIT_PATH_MISSING", `${instancePath}.path`, "Manifest entry path is absent from the pinned Git commit.", "Regenerate the closure from the exact pinned tree.", "source-closure-binding");
          continue;
        }
        if (treeEntry.type !== "blob" || treeEntry.mode !== entry.gitMode || treeEntry.objectId !== entry.blobObjectId) {
          add("blocker", "SOURCE_MANIFEST_ENTRY_GIT_IDENTITY_MISMATCH", instancePath, "Entry mode, object type, or blob ID differs from the pinned Git tree.", "Bind the exact raw Git tree entry.", "source-closure-binding");
          continue;
        }
        const blobHash = crypto.createHash("sha256");
        const blobObjectHash = gitBlobObjectHash(entry.byteLength);
        let observedBytes = 0;
        const pointerChunks = [];
        let pointerCaptureBytes = 0;
        const symlinkChunks = [];
        let symlinkCaptureBytes = 0;
        let symlinkCaptureExceeded = false;
        const blob = await entryCat.readBlob(entry.blobObjectId, async (chunk) => {
          observedBytes += chunk.length;
          blobHash.update(chunk);
          blobObjectHash.update(chunk);
          if (pointerCaptureBytes <= GIT_LFS_POINTER_INSPECTION_BYTES) {
            const remaining = GIT_LFS_POINTER_INSPECTION_BYTES + 1 - pointerCaptureBytes;
            if (remaining > 0) {
              const captured = Buffer.from(chunk.subarray(0, remaining));
              pointerChunks.push(captured);
              pointerCaptureBytes += captured.length;
            }
          }
          if (entry.gitMode === "120000") {
            const remaining = maxSymlinkTargetBytes + 1 - symlinkCaptureBytes;
            if (remaining > 0) {
              const captured = Buffer.from(chunk.subarray(0, remaining));
              symlinkChunks.push(captured);
              symlinkCaptureBytes += captured.length;
            }
            if (symlinkCaptureBytes > maxSymlinkTargetBytes || observedBytes > maxSymlinkTargetBytes) {
              symlinkCaptureExceeded = true;
            }
          }
        }, { maxBytes: maxSourceBlobBytes });
        const nextObservedSourceBytes = stats.sourceBytesVerified + observedBytes;
        if (!Number.isSafeInteger(nextObservedSourceBytes) || nextObservedSourceBytes > maxTotalSourceBytes) {
          throw resourceLimitFailure("observed source closure bytes exceed this verifier run's aggregate budget");
        }
        stats.sourceBytesVerified = nextObservedSourceBytes;
        if (blob.size !== entry.byteLength || observedBytes !== entry.byteLength) {
          add("blocker", "SOURCE_MANIFEST_ENTRY_SIZE_MISMATCH", `${instancePath}.byteLength`, "Entry byte length differs from the raw Git blob.", "Regenerate the source entry from raw Git object bytes.", "source-closure-binding");
        }
        const observedSha256 = `sha256:${blobHash.digest("hex")}`;
        if (observedSha256 !== entry.sha256) {
          add("blocker", "SOURCE_MANIFEST_ENTRY_SHA256_MISMATCH", `${instancePath}.sha256`, "Entry SHA-256 differs from the raw Git blob.", "Bind the exact raw Git blob SHA-256.", "source-closure-binding");
        }
        if (blobObjectHash.digest("hex") !== entry.blobObjectId) {
          add("blocker", "SOURCE_MANIFEST_GIT_OBJECT_HASH_MISMATCH", `${instancePath}.blobObjectId`, "Raw source bytes do not hash to the Git blob identity returned for the pinned tree.", "Repair the local object database or alternate and rerun against intact raw Git objects.", "source-closure-binding");
        }
        const pointerBytes = Buffer.concat(pointerChunks, pointerCaptureBytes);
        const parsedLfsPointer = entry.gitMode === "120000"
          ? { kind: "ordinary" }
          : parseGitLfsPointer(pointerBytes);
        if (parsedLfsPointer.kind === "git-lfs") {
          stats.lfsPointerEntries += 1;
          let resolution = "UNRESOLVED";
          let resolutionReason = parsedLfsPointer.parseState === "VALID"
            ? "LFS_MATERIALIZED_PATH_UNAVAILABLE"
            : "LFS_POINTER_MALFORMED";
          if (parsedLfsPointer.parseState === "VALID") {
            try {
              const materialized = inspectMaterializedLfsPath(repositoryDirectory, entry.path);
              const verifiedTarget = verifyStreamedGitLfsObject({
                filePath: materialized.filePath,
                pointer: parsedLfsPointer,
                aggregateBudget: materializedLfsBudget,
                deadlineAt
              });
              assertMaterializedLfsParentsStable(materialized);
              materializedLfsBudget.consumedBytes = verifiedTarget.aggregateConsumedBytes;
              stats.lfsTargetBytesVerified = verifiedTarget.aggregateConsumedBytes;
              resolution = "TARGET_VERIFIED";
              resolutionReason = null;
            } catch (error) {
              resolutionReason = typeof error?.code === "string"
                ? error.code
                : "LFS_MATERIALIZED_VERIFICATION_FAILED";
            }
          }
          dependencyPointers.push({
            repositoryRef: repository.id,
            path: entry.path,
            pointerType: "git-lfs",
            pointerIdentity: `git-blob:${entry.blobObjectId}`,
            targetIdentity: parsedLfsPointer.parseState === "VALID"
              ? `git-lfs:${parsedLfsPointer.oidSha256}:${parsedLfsPointer.size}`
              : null,
            resolution,
            criticalityInput: {
              roleIds: entry.roleIds,
              required: requiredPathSet.has(entry.path)
            }
          });
          if (resolution === "UNRESOLVED") {
            add(
              "review",
              parsedLfsPointer.parseState === "VALID"
                ? "SOURCE_MANIFEST_GIT_LFS_DEPENDENCY_REQUIRED"
                : "SOURCE_MANIFEST_GIT_LFS_POINTER_AMBIGUOUS",
              instancePath,
              parsedLfsPointer.parseState === "VALID"
                ? "The exact blob is a Git LFS pointer whose materialized target was not independently verified."
                : "The exact blob begins as a Git LFS pointer but is malformed or unsupported.",
              "Provide the exact materialized regular file under the mapped source root and rerun bounded stable-descriptor verification; never treat pointer bytes as the source payload.",
              "dependency-target",
              { reasonCode: resolutionReason }
            );
          } else {
            add(
              "review",
              "SOURCE_MANIFEST_GIT_LFS_TARGET_LOCAL_STABLE_BYTES_ONLY",
              instancePath,
              "The materialized target bytes matched the committed LFS pointer through one stable local descriptor, but public availability and independent reproducibility were not verified.",
              "For launch readiness, replace the pointer with a normal Git blob or provide a versioned content-bound independent public availability and reproducibility proof.",
              "dependency-target",
              {
                verificationScope: "LOCAL_STABLE_BYTES_ONLY",
                networkAccessed: false,
                availabilityVerified: false,
                reproducibilityVerified: false
              }
            );
          }
        }
        if (entry.gitMode === "120000") {
          stats.symlinkEntries += 1;
          symlinkBytesByPath.set(entry.path, symlinkCaptureExceeded
            ? {
                targetSha256: entry.sha256,
                unavailableReason: "TARGET_BYTES_LIMIT"
              }
            : { bytes: Buffer.concat(symlinkChunks, symlinkCaptureBytes) });
        }
        if (requiredPathSet.has(entry.path)) {
          observedRequiredPaths.add(entry.path);
          const expectedRoleIds = requiredEntryMap.get(entry.path);
          for (const roleId of expectedRoleIds) {
            if (!entry.roleIds.includes(roleId)) {
              add("blocker", "SOURCE_MANIFEST_REQUIRED_ROLE_MISSING", `${instancePath}.roleIds`, `Required path ${entry.path} is missing role ${roleId}.`, "Regenerate the closure with every required path classified by its exact expected role.", "source-closure-binding");
            }
          }
        }
        stats.entriesVerified += 1;
      }
      globalState.batch = [];
    };

    for (const [fragmentIndex, fragment] of manifest.fragments.entries()) {
      assertBeforeDeadline(deadlineAt);
      const fragmentPath = `$.fragments[${fragmentIndex}]`;
      const [fragmentTreeEntry] = gitTreeEntriesForPaths(
        repositoryDirectory,
        repository.revisionObjectId,
        [fragment.path],
        deadlineAt
      );
      if (
        !fragmentTreeEntry
        || fragmentTreeEntry.path !== fragment.path
        || fragmentTreeEntry.type !== "blob"
        || !["100644", "100755"].includes(fragmentTreeEntry.mode)
      ) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_GIT_ENTRY_INVALID", `${fragmentPath}.path`, "Fragment is not one regular blob at the pinned commit.", "Commit the exact canonical JSONL fragment as a regular file.", "source-closure-binding");
        continue;
      }
      if (fragmentTreeEntry.objectId !== fragment.blobObjectId) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_BLOB_MISMATCH", `${fragmentPath}.blobObjectId`, "Fragment Git blob differs from its root binding.", "Regenerate the root manifest from the exact committed fragment blob.", "source-closure-binding");
        continue;
      }

      const fragmentHash = crypto.createHash("sha256");
      const fragmentObjectHash = gitBlobObjectHash(fragment.byteLength);
      const parser = new CanonicalSourceEntryJsonlParser({
        maxJsonLineBytes,
        fragmentPath,
        onEntry: async (entry, entryIndex, instancePath) => {
          if (globalState.previousPath !== null && compareUtf8(globalState.previousPath, entry.path) >= 0) {
            add("blocker", "SOURCE_MANIFEST_ENTRY_ORDER_INVALID", `${instancePath}.path`, "Source entry paths must be globally unique and strictly UTF-8 bytewise ascending.", "Regenerate fragments from one sorted, duplicate-free logical closure.", "source-closure-binding");
          }
          globalState.previousPath = entry.path;
          globalState.totalEntries += 1;
          if (globalState.totalEntries > maxEntries) {
            throw resourceLimitFailure("source closure entry count exceeds this verifier run's budget");
          }
          if (entry.byteLength > maxSourceBlobBytes) {
            throw resourceLimitFailure("one source blob exceeds this verifier run's per-blob budget");
          }
          const nextDeclaredSourceBytes = stats.sourceBytesVerified + globalState.batch.reduce(
            (total, queued) => total + queued.entry.byteLength,
            0
          ) + entry.byteLength;
          if (!Number.isSafeInteger(nextDeclaredSourceBytes) || nextDeclaredSourceBytes > maxTotalSourceBytes) {
            throw resourceLimitFailure("source closure bytes exceed this verifier run's aggregate budget");
          }
          manifestEntriesByPath.set(entry.path, {
            mode: entry.gitMode,
            objectId: entry.blobObjectId,
            sha256: entry.sha256,
            roleIds: entry.roleIds,
            instancePath
          });
          globalState.batch.push({ entry, instancePath });
          if (globalState.batch.length >= entryBatchSize) await flushEntryBatch();
          return { entryIndex };
        },
        add
      });
      let fragmentBytes = 0;
      const blob = await fragmentCat.readBlob(fragment.blobObjectId, async (chunk) => {
        fragmentBytes += chunk.length;
        fragmentHash.update(chunk);
        fragmentObjectHash.update(chunk);
        closureHash.update(chunk);
        await parser.consume(chunk);
      }, { maxBytes: maxTotalFragmentBytes - stats.fragmentBytesVerified });
      await parser.finish();
      await flushEntryBatch();
      stats.fragmentBytesVerified += fragmentBytes;
      if (blob.size !== fragment.byteLength || fragmentBytes !== fragment.byteLength) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_SIZE_MISMATCH", `${fragmentPath}.byteLength`, "Fragment byte length differs from the raw Git blob.", "Bind the exact canonical JSONL bytes.", "source-closure-binding");
      }
      const observedFragmentSha256 = `sha256:${fragmentHash.digest("hex")}`;
      if (observedFragmentSha256 !== fragment.sha256) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_SHA256_MISMATCH", `${fragmentPath}.sha256`, "Fragment SHA-256 differs from the raw Git blob.", "Regenerate the root fragment binding.", "source-closure-binding");
      }
      if (fragmentObjectHash.digest("hex") !== fragment.blobObjectId) {
        add("blocker", "SOURCE_MANIFEST_GIT_OBJECT_HASH_MISMATCH", `${fragmentPath}.blobObjectId`, "Raw fragment bytes do not hash to the Git blob identity returned for the pinned tree.", "Repair the local object database or alternate and rerun against intact raw Git objects.", "source-closure-binding");
      }
      if (parser.entryCount !== fragment.entryCount) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_ENTRY_COUNT_MISMATCH", `${fragmentPath}.entryCount`, "Fragment entry count differs from its root binding.", "Bind the exact number of canonical JSONL entries.", "source-closure-binding");
      }
      if (parser.firstPath !== fragment.firstPath || parser.lastPath !== fragment.lastPath) {
        add("blocker", "SOURCE_MANIFEST_FRAGMENT_RANGE_BINDING_MISMATCH", fragmentPath, "Fragment firstPath or lastPath differs from its exact entries.", "Regenerate the fragment range binding from canonical entry order.", "source-closure-binding");
      }
      stats.fragmentsVerified += 1;
    }
    await flushEntryBatch();
    const observedClosureSha256 = `sha256:${closureHash.digest("hex")}`;
    if (observedClosureSha256 !== manifest.closureSha256) {
      add("blocker", "SOURCE_MANIFEST_CLOSURE_SHA256_MISMATCH", "$.closureSha256", "Closure SHA-256 differs from the exact concatenated fragment bytes.", "Hash the raw fragment blobs in contiguous sequence order.", "source-closure-binding");
    }
    if (globalState.totalEntries !== manifest.entryCount) {
      add("blocker", "SOURCE_MANIFEST_TOTAL_ENTRY_COUNT_MISMATCH", "$.entryCount", "Root entry count differs from the exact parsed fragment entry set.", "Regenerate root counts from every exact fragment.", "source-closure-binding");
    }
    for (const requiredPath of requiredPathSet) {
      if (!observedRequiredPaths.has(requiredPath)) {
        add("blocker", "SOURCE_MANIFEST_REQUIRED_PATH_MISSING", "$.entries", `Required repository path ${requiredPath} is absent from the verified closure.`, "Include every contract and explicitly required artifact path in the manifest entry set.", "source-closure-binding");
      }
    }
    verifyExactCommittedTreeClosure({
      committedTreeEntries,
      manifestEntriesByPath,
      metadataPaths: new Set([rootBinding.path, ...manifest.fragments.map(({ path: fragmentPath }) => fragmentPath)]),
      add,
      stats
    });

    const symlinkTreeEntries = committedTreeEntries.map((treeEntry) => {
      if (treeEntry.mode !== "120000") return treeEntry;
      const captured = symlinkBytesByPath.get(treeEntry.path);
      const declared = manifestEntriesByPath.get(treeEntry.path);
      return {
        ...treeEntry,
        ...(captured ?? {
          targetSha256: declared?.sha256 ?? `sha256:${"0".repeat(64)}`,
          unavailableReason: "TARGET_BYTES_UNAVAILABLE"
        })
      };
    });
    for (const resolved of resolveRawGitSymlinks({ entries: symlinkTreeEntries })) {
      const declared = manifestEntriesByPath.get(resolved.path);
      dependencyPointers.push({
        repositoryRef: repository.id,
        path: resolved.path,
        pointerType: "symlink",
        pointerIdentity: resolved.pointerIdentity,
        targetIdentity: resolved.terminalIdentity ?? null,
        resolution: resolved.resolution,
        criticalityInput: {
          roleIds: declared?.roleIds ?? [],
          required: requiredPathSet.has(resolved.path)
        }
      });
      if (resolved.resolution === "UNRESOLVED") {
        add(
          "review",
          "SOURCE_MANIFEST_SYMLINK_TARGET_UNRESOLVED",
          declared?.instancePath ?? `$.repository.tree[${JSON.stringify(resolved.path)}]`,
          "The exact symlink blob is closed, but its target does not resolve to one verified internal raw-Git tree identity.",
          "Correct or independently bind the dependency target before launch; do not follow worktree or filesystem links.",
          "dependency-target",
          { reasonCode: resolved.reasonCode }
        );
      }
    }

    const gitlinkResults = matchGitlinkCompanions({
      gitlinks: committedTreeEntries
        .filter(({ mode }) => mode === "160000")
        .map(({ path: repositoryPath, objectId }) => ({
          repositoryRef: repository.id,
          path: repositoryPath,
          objectId
        })),
      repositories: applicationRepositories,
      verifiedRepositoryRefs
    });
    for (const resolved of gitlinkResults) {
      dependencyPointers.push({
        repositoryRef: repository.id,
        path: resolved.path,
        pointerType: "gitlink",
        pointerIdentity: resolved.pointerIdentity,
        targetIdentity: resolved.terminalIdentity ?? null,
        resolution: resolved.resolution,
        criticalityInput: {}
      });
      if (resolved.resolution === "UNRESOLVED") {
        add(
          "review",
          "SOURCE_MANIFEST_GITLINK_COMPANION_REQUIRED",
          `$.repository.tree[${JSON.stringify(resolved.path)}]`,
          "The exact parent-tree Gitlink is closed, but it does not resolve to one independently verified companion repository closure.",
          "Declare and verify exactly one companion repository at the Gitlink commit before launch.",
          "dependency-target",
          { reasonCode: resolved.reasonCode, objectId: resolved.pointerIdentity.slice("git-commit:".length) }
        );
      }
    }
  } catch (error) {
    const failure = classifyPublicPrApplicationV3SourceManifestFailure(error);
    if (failure.disposition === "split-review") {
      addResourceLimitFinding(add, "$", error.message, { integrityCode: failure.integrityCode });
    } else if (failure.disposition === "availability") {
      add(
        "blocker",
        "SOURCE_MANIFEST_RAW_GIT_OBJECTS_UNAVAILABLE",
        "$",
        "The selected local Git object store or bounded Git reader could not provide every exact manifest, fragment, tree, and source blob.",
        "Retry with the same pinned revision in a complete readable object store; local absence or tool transport failure is not evidence of source corruption.",
        "tooling-transport",
        { integrityCode: failure.integrityCode, objectAvailability: "UNAVAILABLE" }
      );
    } else {
      add("blocker", "SOURCE_MANIFEST_LOCAL_VERIFICATION_FAILED", "$", "Local Git source-closure verification failed closed.", "Use an intact local Git object database at the pinned commit and retry without executing candidate code.", "source-closure-binding", {
        errorCode: failure.integrityCode
      });
    }
  } finally {
    await Promise.allSettled([
      fragmentCat?.close(),
      entryCat?.close()
    ].filter(Boolean));
  }
  return finish();
}

function localSourceManifestReport(findings, stats, { repository, manifest, dependencyPointers }) {
  const sourceBinding = {
    repositoryRef: repository?.id ?? null,
    revisionObjectId: repository?.revisionObjectId ?? null,
    treeObjectId: repository?.treeObjectId ?? null,
    sourceClosureMode: repository?.sourceClosureMode ?? null,
    manifestPath: repository?.sourceManifest?.path ?? null,
    manifestSha256: repository?.sourceManifest?.sha256 ?? null,
    manifestByteLength: repository?.sourceManifest?.byteLength ?? null,
    closureSha256: manifest?.closureSha256 ?? null
  };
  const pointerSummary = summarizeDependencyPointers(dependencyPointers ?? []);
  const { canonicalRecords: _canonicalRecords, ...dependencyPointerCoverage } = pointerSummary;
  const report = finalizeReport("local-source-closure-manifest-v1-verification", findings, {
    schemaId: SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    approvalGranted: false,
    readOnly: true,
    networkAccessed: false,
    candidateCodeExecuted: false,
    sourceBinding,
    dependencyPointerCoverage,
    stats
  });
  const sourceClosureVerified = report.counts.blocker === 0;
  const splitReviewRequired = report.findings.some(({ classification }) => classification === "tooling-split-review");
  const integrationPending = report.findings.some(({ code, classification }) => (
    code === "SOURCE_MANIFEST_RAW_GIT_OBJECTS_UNAVAILABLE"
    && classification === "tooling-transport"
  ));
  return {
    ...report,
    status: splitReviewRequired
      ? "HOLD_SPLIT_REVIEW"
      : integrationPending
        ? "INTEGRATION_PENDING"
        : report.counts.blocker > 0
          ? "INVALID"
          : sourceClosureVerified
            ? "VERIFIED"
            : "REVIEW_REQUIRED",
    sourceClosureVerified,
    splitReviewRequired,
    integrationPending
  };
}
