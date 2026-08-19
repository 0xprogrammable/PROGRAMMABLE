import { performance } from "node:perf_hooks";
import { createGitHubPublicFetchTransportV1 } from "./github-public-source-core.mjs";
import {
  ACTIVE_CONTRACT_MANIFEST_V1,
  RESOLVE_CONTRACT_V1
} from "./resolve-contract-definitions.mjs";
import {
  normalizeContractRepositoryV1,
  validateActiveContractManifestV1
} from "./resolve-contract-validation.mjs";
import {
  requestJson,
  resolveDefaultBranchHead,
  validateRecursiveTree,
  validateRepositoryMetadata
} from "./resolve-contract-github.mjs";
import {
  createEmptyReport,
  finishReport,
  resolveArtifacts
} from "./resolve-contract-artifacts.mjs";
import {
  apiPrefix,
  normalizeFailure,
  unresolved
} from "./resolve-contract-shared.mjs";

export {
  ACTIVE_CONTRACT_MANIFEST_V1,
  RESOLVE_CONTRACT_V1,
  normalizeContractRepositoryV1,
  validateActiveContractManifestV1
};

export async function resolveActiveContractV1({
  repository,
  network = false,
  manifestPath = null,
  timeoutMs = RESOLVE_CONTRACT_V1.defaultTimeoutMs,
  transport = undefined
}) {
  const target = normalizeContractRepositoryV1(repository);
  const explicitManifestPath = manifestPath === null
    ? null
    : normalizeRemotePath(manifestPath, "manifestPath");
  if (
    typeof network !== "boolean"
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < RESOLVE_CONTRACT_V1.minimumTimeoutMs
    || timeoutMs > RESOLVE_CONTRACT_V1.maximumTimeoutMs
    || (transport !== undefined && typeof transport !== "function")
  ) {
    throw new TypeError("resolve-contract options are outside the supported bounds");
  }

  const report = createEmptyReport(target, network, explicitManifestPath, timeoutMs);
  if (!network) {
    report.unresolved.push(unresolved(
      "NETWORK_MODE_NOT_ENABLED",
      "Default-branch objects were not requested; rerun with explicit network mode to resolve public GitHub evidence."
    ));
    return finishReport(report, "network-disabled");
  }

  let effectiveTransport;
  try {
    effectiveTransport = transport ?? createGitHubPublicFetchTransportV1();
  } catch {
    report.transport.failure = failure(
      "TOOLING_UNAVAILABLE",
      "The anonymous public GitHub transport is unavailable.",
      { kind: "tooling" }
    );
    return finishReport(report, "transport-failed");
  }
  const state = {
    deadline: performance.now() + timeoutMs,
    requests: 0,
    responseBytes: 0,
    transport: effectiveTransport
  };

  try {
    const metadata = await requestJson(state, `${apiPrefix(target)}`, "repository", RESOLVE_CONTRACT_V1.maximumJsonResponseBytes);
    const repositoryBinding = validateRepositoryMetadata(metadata, target);
    const firstHead = await resolveDefaultBranchHead(state, target, repositoryBinding.defaultBranch);
    const tree = await requestJson(
      state,
      `${apiPrefix(target)}/git/trees/${firstHead.treeObjectId}?recursive=1`,
      "tree",
      RESOLVE_CONTRACT_V1.maximumTreeResponseBytes
    );
    const treeEntries = validateRecursiveTree(tree, firstHead.treeObjectId);

    report.discovered.repository = {
      ...repositoryBinding,
      revisionObjectId: firstHead.revisionObjectId,
      treeObjectId: firstHead.treeObjectId
    };
    report.verified.repository = {
      numericRepositoryId: repositoryBinding.numericRepositoryId,
      repositoryUri: target.repositoryUri,
      defaultBranch: repositoryBinding.defaultBranch,
      revisionObjectId: firstHead.revisionObjectId,
      treeObjectId: firstHead.treeObjectId,
      commitUrl: `${target.repositoryUri}/commit/${firstHead.revisionObjectId}`,
      stableDuringResolution: false
    };

    await resolveArtifacts({ report, state, target, treeEntries, explicitManifestPath, repositoryBinding });

    const finalMetadata = await requestJson(
      state,
      `${apiPrefix(target)}`,
      "repository",
      RESOLVE_CONTRACT_V1.maximumJsonResponseBytes
    );
    const finalRepositoryBinding = validateRepositoryMetadata(finalMetadata, target);
    const finalHead = await resolveDefaultBranchHead(state, target, finalRepositoryBinding.defaultBranch);
    const stable = finalRepositoryBinding.numericRepositoryId === repositoryBinding.numericRepositoryId
      && finalRepositoryBinding.defaultBranch === repositoryBinding.defaultBranch
      && finalHead.revisionObjectId === firstHead.revisionObjectId
      && finalHead.treeObjectId === firstHead.treeObjectId;
    report.verified.repository.stableDuringResolution = stable;
    if (!stable) {
      report.unresolved.push(unresolved(
        "DEFAULT_BRANCH_MOVED_DURING_RESOLUTION",
        "The default branch changed while its contract evidence was being resolved.",
        {
          firstRevisionObjectId: firstHead.revisionObjectId,
          finalRevisionObjectId: finalHead.revisionObjectId,
          firstDefaultBranch: repositoryBinding.defaultBranch,
          finalDefaultBranch: finalRepositoryBinding.defaultBranch
        }
      ));
    }

    const conventionRolesComplete = ACTIVE_CONTRACT_MANIFEST_V1.roles.every((role) => (
      report.verified.artifacts.some((artifact) => artifact.role === role)
    ));

    const outcome = !stable
      ? "unresolved"
      : report.discovered.selectionBasis === "manifest"
        ? report.unresolved.length === 0 ? "manifest-bound" : "unresolved"
        : conventionRolesComplete
          ? "convention-evidence-only"
          : "unresolved";
    return finishReport(report, outcome, state);
  } catch (error) {
    report.transport.failure = normalizeFailure(error);
    return finishReport(report, "transport-failed", state);
  }
}
