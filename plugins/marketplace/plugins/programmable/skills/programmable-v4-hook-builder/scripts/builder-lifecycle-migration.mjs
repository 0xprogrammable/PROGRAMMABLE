import crypto from "node:crypto";
import {
  BUILDER_LIFECYCLE_SCHEMA_VERSION,
  PROTECTED_MIGRATION_SEGMENTS,
  SHA256_PATTERN,
  BuilderLifecycleError,
  assertExactKeys,
  assertPlainObject,
  cloneJson,
  compareSemver,
  compareText,
  deepEqual,
  digestCanonical,
  escapePointer,
  invalid,
  isJsonPointer,
  isPlainObject,
  parseSemver,
  requireText
} from "./builder-lifecycle-shared.mjs";

export function migrationDryRun({ currentDocument, proposal, verifiedUpdate }) {
  assertPlainObject(currentDocument, "current document");
  validateMigrationProposal(proposal);
  assertPlainObject(verifiedUpdate, "verified update");
  assertPlainObject(verifiedUpdate.payload, "verified update payload");
  if (proposal.expectedCurrentSha256 !== digestCanonical(currentDocument)) {
    throw new BuilderLifecycleError("MIGRATION_SOURCE_MISMATCH", "migration proposal does not bind the exact current document");
  }
  if (currentDocument.standardVersion !== proposal.fromStandard) {
    throw new BuilderLifecycleError("MIGRATION_STANDARD_MISMATCH", "migration source standard does not match the current document");
  }
  if (proposal.toStandard !== verifiedUpdate.payload.standards.submission) {
    throw new BuilderLifecycleError("MIGRATION_TARGET_UNAUTHENTICATED", "migration target does not match the authenticated update");
  }
  const fromVersion = parseSemver(proposal.fromStandard, "migration fromStandard");
  const toVersion = parseSemver(proposal.toStandard, "migration toStandard");
  if (compareSemver(toVersion, fromVersion) < 0) {
    throw new BuilderLifecycleError("MIGRATION_DOWNGRADE_REJECTED", "migration target is older than the current standard");
  }

  const reasonsByPath = new Map();
  const duplicateReasonPaths = [];
  for (const entry of proposal.changeReasons) {
    if (reasonsByPath.has(entry.path)) duplicateReasonPaths.push(entry.path);
    else reasonsByPath.set(entry.path, entry.reason);
  }
  const changes = diffValues(currentDocument, proposal.proposedDocument);
  const unexplainedPaths = changes.filter((entry) => !reasonsByPath.has(entry.path)).map((entry) => entry.path);
  const staleReasonPaths = [...reasonsByPath.keys()].filter((entry) => !changes.some((change) => change.path === entry));
  const annotated = changes.map((entry) => {
    const protectedClasses = classifyProtectedPath(entry.path);
    return {
      ...entry,
      reason: reasonsByPath.get(entry.path) ?? null,
      protectedClasses
    };
  });
  const confirmations = [];
  for (const entry of annotated) {
    for (const protectedClass of entry.protectedClasses) {
      confirmations.push({
        id: `confirm-${protectedClass}-${confirmationDigest(entry.path)}`,
        path: entry.path,
        kind: protectedClass,
        required: true,
        statement: `Confirm the explicit ${protectedClass} change at ${entry.path}; it is never migrated silently.`
      });
    }
  }
  if (fromVersion.major !== toVersion.major) {
    confirmations.push({
      id: "confirm-major-standard-migration",
      path: "/standardVersion",
      kind: "major-standard",
      required: true,
      statement: `Confirm migration from standard ${proposal.fromStandard} to incompatible standard ${proposal.toStandard}.`
    });
  }
  const uniqueConfirmations = uniqueSorted(confirmations, (entry) => `${entry.kind}\u0000${entry.path}`);
  const ambiguous = unexplainedPaths.length > 0 || duplicateReasonPaths.length > 0 || staleReasonPaths.length > 0;

  return {
    kind: "builder-migration-dry-run",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    status: ambiguous ? "blocked-ambiguous" : uniqueConfirmations.length > 0 ? "confirmation-required" : "review-ready",
    source: {
      standardVersion: proposal.fromStandard,
      documentSha256: proposal.expectedCurrentSha256
    },
    target: {
      standardVersion: proposal.toStandard,
      proposedDocumentSha256: digestCanonical(proposal.proposedDocument),
      authenticatedReleaseVersion: verifiedUpdate.payload.releaseVersion,
      authenticatedReleaseSequence: verifiedUpdate.payload.releaseSequence
    },
    changes: annotated,
    ambiguity: {
      unexplainedPaths: unexplainedPaths.sort(compareText),
      duplicateReasonPaths: [...new Set(duplicateReasonPaths)].sort(compareText),
      staleReasonPaths: staleReasonPaths.sort(compareText)
    },
    confirmations: uniqueConfirmations,
    protectedChangeSummary: Object.fromEntries(
      Object.keys(PROTECTED_MIGRATION_SEGMENTS).map((key) => [key, annotated.filter((entry) => entry.protectedClasses.includes(key)).length])
    ),
    dryRun: true,
    writePerformed: false,
    historicalDocumentPreserved: true,
    historicalStandardPreserved: true,
    autoApplyAllowed: false,
    networkAccessed: false,
    externalActionsPerformed: [],
    nextAction: ambiguous
      ? "Resolve every unexplained, duplicate, or stale migration reason and rerun the dry-run."
      : uniqueConfirmations.length > 0
        ? "Review the complete diff and collect every named confirmation in a separate owner-controlled step."
        : "Review the complete diff; applying it remains a separate explicit step."
  };
}

export function validateMigrationProposal(proposal) {
  assertPlainObject(proposal, "migration proposal");
  assertExactKeys(proposal, ["schemaVersion", "fromStandard", "toStandard", "expectedCurrentSha256", "proposedDocument", "changeReasons"], "migration proposal");
  if (proposal.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("MIGRATION_PROPOSAL_INVALID", "unsupported migration proposal schema");
  parseSemver(proposal.fromStandard, "migration fromStandard");
  parseSemver(proposal.toStandard, "migration toStandard");
  if (!SHA256_PATTERN.test(proposal.expectedCurrentSha256 ?? "")) invalid("MIGRATION_PROPOSAL_INVALID", "migration current digest is invalid");
  assertPlainObject(proposal.proposedDocument, "migration proposed document");
  if (proposal.proposedDocument.standardVersion !== proposal.toStandard) invalid("MIGRATION_PROPOSAL_INVALID", "proposed document standard does not match migration target");
  if (!Array.isArray(proposal.changeReasons) || proposal.changeReasons.length > 4096) invalid("MIGRATION_PROPOSAL_INVALID", "migration change reasons are invalid");
  for (const entry of proposal.changeReasons) {
    assertPlainObject(entry, "migration change reason");
    assertExactKeys(entry, ["path", "reason"], "migration change reason");
    if (!isJsonPointer(entry.path)) invalid("MIGRATION_PROPOSAL_INVALID", "migration reason path must be a canonical JSON pointer");
    requireText(entry.reason, "migration change reason");
  }
}

export function diffValues(left, right, path = "") {
  if (deepEqual(left, right)) return [];
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compareText);
    return keys.flatMap((key) => diffValues(left[key], right[key], `${path}/${escapePointer(key)}`));
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    const changes = [];
    for (let index = 0; index < length; index += 1) changes.push(...diffValues(left[index], right[index], `${path}/${index}`));
    return changes;
  }
  return [{
    path: path || "",
    operation: left === undefined ? "add" : right === undefined ? "remove" : "replace",
    before: left === undefined ? null : cloneJson(left),
    after: right === undefined ? null : cloneJson(right)
  }];
}

export function classifyProtectedPath(pointer) {
  const segments = pointer.split("/").slice(1).map((entry) => entry
    .replace(/~1/gu, "/")
    .replace(/~0/gu, "~")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, ""));
  return Object.entries(PROTECTED_MIGRATION_SEGMENTS)
    .filter(([name, names]) => segments.some((segment) => names.has(segment) || protectedSegmentMatch(name, segment)))
    .map(([name]) => name)
    .sort(compareText);
}

export function confirmationDigest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

export function uniqueSorted(values, identity) {
  const map = new Map();
  for (const value of values) map.set(identity(value), value);
  return [...map.values()].sort((left, right) => compareText(identity(left), identity(right)));
}

export function protectedSegmentMatch(kind, segment) {
  const fragments = {
    economics: ["economic", "fee", "rate", "tax"],
    wallet: ["wallet", "recipient", "beneficiary", "owner"],
    authority: ["authority", "role", "permission", "admin", "controller", "upgrade", "pause"],
    risk: ["risk", "threat", "severity"],
    evidence: ["evidence", "receipt", "proof", "finding", "report"]
  }[kind];
  return fragments.some((fragment) => segment.includes(fragment));
}
