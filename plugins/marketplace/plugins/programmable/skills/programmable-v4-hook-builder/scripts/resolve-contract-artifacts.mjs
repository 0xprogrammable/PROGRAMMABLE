import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  ACTIVE_CONTRACT_MANIFEST_V1,
  ContractResolutionError,
  RESOLVE_CONTRACT_V1
} from "./resolve-contract-definitions.mjs";
import { validateActiveContractManifestV1 } from "./resolve-contract-validation.mjs";
import { resolveBlob } from "./resolve-contract-github.mjs";
import {
  artifactEvidence,
  compareUtf8,
  deepFreeze,
  sha256,
  treeDiscovery,
  unresolved
} from "./resolve-contract-shared.mjs";

export async function resolveArtifacts({ report, state, target, treeEntries, explicitManifestPath, repositoryBinding }) {
  const entriesByPath = new Map(treeEntries.map((entry) => [entry.path, entry]));
  const manifestCandidates = explicitManifestPath === null
    ? RESOLVE_CONTRACT_V1.manifestCandidates
    : [explicitManifestPath];
  const foundManifests = manifestCandidates.filter((candidate) => entriesByPath.has(candidate));
  report.discovered.manifests = foundManifests.map((path) => treeDiscovery(entriesByPath.get(path)));

  if (foundManifests.length > 1) {
    report.discovered.selectionBasis = "manifest-ambiguous";
    report.unresolved.push(unresolved(
      "MULTIPLE_ACTIVE_CONTRACT_MANIFESTS",
      "More than one active-contract manifest candidate exists on the exact default-branch tree.",
      { paths: foundManifests }
    ));
    return;
  }

  if (foundManifests.length === 1) {
    report.discovered.selectionBasis = "manifest";
    const manifestEntry = entriesByPath.get(foundManifests[0]);
    let manifestBlob;
    try {
      manifestBlob = await resolveBlob(
        state,
        target,
        manifestEntry,
        RESOLVE_CONTRACT_V1.maximumManifestBytes
      );
      const manifestDocument = parseBoundedStrictJsonBytes(manifestBlob.bytes, {
        maxSourceBytes: RESOLVE_CONTRACT_V1.maximumManifestBytes,
        maxDepth: 64,
        maxNodes: 10_000,
        maxNumberCharacters: 128
      });
      const manifest = validateActiveContractManifestV1(manifestDocument, {
        defaultBranch: repositoryBinding.defaultBranch
      });
      report.verified.manifest = {
        path: manifestEntry.path,
        gitObjectId: manifestEntry.objectId,
        byteLength: manifestBlob.bytes.length,
        sha256: sha256(manifestBlob.bytes),
        contractId: manifest.contractId,
        defaultBranch: manifest.defaultBranch
      };
      for (const role of ACTIVE_CONTRACT_MANIFEST_V1.roles) {
        for (const declaration of manifest.artifacts[role]) {
          const entry = entriesByPath.get(declaration.path);
          if (entry === undefined) {
            report.unresolved.push(unresolved(
              "MANIFEST_ARTIFACT_NOT_FOUND",
              `The manifest-selected ${role} artifact is absent from the exact default-branch tree.`,
              { role, path: declaration.path }
            ));
            continue;
          }
          const blob = await resolveBlob(state, target, entry, RESOLVE_CONTRACT_V1.maximumArtifactBytes);
          const actualSha256 = sha256(blob.bytes);
          if (actualSha256 !== declaration.sha256) {
            report.unresolved.push(unresolved(
              "MANIFEST_ARTIFACT_DIGEST_MISMATCH",
              `The manifest-selected ${role} artifact did not match its declared SHA-256 digest.`,
              { role, path: declaration.path, expectedSha256: declaration.sha256, actualSha256 }
            ));
            continue;
          }
          report.verified.artifacts.push(artifactEvidence({
            role,
            entry,
            bytes: blob.bytes,
            selection: "default-branch-manifest",
            expectedSha256: declaration.sha256,
            manifestBound: true
          }));
        }
      }
    } catch (error) {
      if (error instanceof ContractResolutionError && error.kind === "transport") throw error;
      report.unresolved.push(unresolved(
        "ACTIVE_CONTRACT_MANIFEST_INVALID",
        "The exact default-branch active-contract manifest is invalid or cannot be verified."
      ));
    }
    return;
  }

  report.discovered.selectionBasis = "convention-hints";
  if (explicitManifestPath !== null) {
    report.unresolved.push(unresolved(
      "EXPLICIT_MANIFEST_NOT_FOUND",
      "The explicitly selected active-contract manifest path is absent from the exact default-branch tree.",
      { path: explicitManifestPath }
    ));
    return;
  }

  for (const role of ACTIVE_CONTRACT_MANIFEST_V1.roles) {
    const found = RESOLVE_CONTRACT_V1.conventionCandidates[role]
      .filter((candidate) => entriesByPath.has(candidate));
    report.discovered.conventions[role] = found.map((path) => treeDiscovery(entriesByPath.get(path)));
    if (found.length === 0) {
      report.unresolved.push(unresolved(
        "CONVENTION_ARTIFACT_NOT_DISCOVERED",
        `No bounded conventional ${role} artifact was discovered on the exact default-branch tree.`,
        { role }
      ));
      continue;
    }
    const selectedPath = found[0];
    const entry = entriesByPath.get(selectedPath);
    const blob = await resolveBlob(state, target, entry, RESOLVE_CONTRACT_V1.maximumArtifactBytes);
    report.verified.artifacts.push(artifactEvidence({
      role,
      entry,
      bytes: blob.bytes,
      selection: "bounded-convention-hint",
      expectedSha256: null,
      manifestBound: false
    }));
    report.unresolved.push(unresolved(
      "CONVENTION_HINT_NOT_AUTHORITY",
      `The selected ${role} bytes are verified evidence, but their filename does not prove that they are active authority.`,
      { role, selectedPath, alternatePaths: found.slice(1) }
    ));
  }
}

export function createEmptyReport(target, network, manifestPath, timeoutMs) {
  return {
    schemaVersion: RESOLVE_CONTRACT_V1.schemaVersion,
    kind: RESOLVE_CONTRACT_V1.kind,
    outcome: null,
    target: {
      repositoryUri: target.repositoryUri,
      requestedManifestPath: manifestPath
    },
    discovered: {
      repository: null,
      manifests: [],
      conventions: {
        workflow: [],
        validator: [],
        package: [],
        policy: []
      },
      selectionBasis: "none"
    },
    verified: {
      repository: null,
      manifest: null,
      artifacts: []
    },
    unresolved: [],
    authority: {
      githubReviewsUsed: false,
      githubLabelsUsed: false,
      githubApprovalStateUsed: false,
      launchAuthorityInferred: false,
      note: "This command verifies public default-branch bytes only. It does not approve, audit, authorize, deploy, or launch anything."
    },
    transport: {
      mode: network ? "anonymous-public-github" : "offline-plan",
      networkAccessed: false,
      credentialsUsed: false,
      redirectsFollowed: 0,
      timeoutMs,
      requestLimit: RESOLVE_CONTRACT_V1.maximumRequests,
      requestsMade: 0,
      responseByteLimit: RESOLVE_CONTRACT_V1.maximumResponseBytes,
      responseBytesRead: 0,
      failure: null
    }
  };
}

export function finishReport(report, outcome, state = null) {
  report.outcome = outcome;
  report.verified.artifacts.sort((left, right) => {
    const roleOrder = ACTIVE_CONTRACT_MANIFEST_V1.roles.indexOf(left.role)
      - ACTIVE_CONTRACT_MANIFEST_V1.roles.indexOf(right.role);
    return roleOrder || compareUtf8(left.path, right.path);
  });
  report.unresolved.sort((left, right) => compareUtf8(`${left.code}\0${left.role ?? ""}\0${left.path ?? ""}`, `${right.code}\0${right.role ?? ""}\0${right.path ?? ""}`));
  if (state !== null) {
    report.transport.networkAccessed = state.requests > 0;
    report.transport.requestsMade = state.requests;
    report.transport.responseBytesRead = state.responseBytes;
  }
  return deepFreeze(report);
}
