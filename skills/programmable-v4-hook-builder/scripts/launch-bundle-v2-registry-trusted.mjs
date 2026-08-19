import { canonicalJson } from "./submission-core.mjs";
import {
  isFreshRegistryAcceptanceV3TrustedReview,
  REGISTRY_ACCEPTANCE_V3_GITHUB_VERIFIER
} from "./registry-acceptance-v3-github-core.mjs";
import { validateRegistryAcceptanceV3CurrentMain } from "./launch-bundle-v2-registry-current-main.mjs";
import { validateRegistryAcceptanceV3ReviewProjection } from "./launch-bundle-v2-registry-review-projection.mjs";
import {
  assertRegistryAcceptanceV3BoundedJson,
  projectRegistryAcceptanceV3ImmutableReviewAuthority,
  registryAcceptanceV3ReviewFailure,
  validRegistryAcceptanceV3Timestamp
} from "./launch-bundle-v2-registry-review-shared.mjs";
import {
  SHA256_PATTERN,
  addConflict,
  exact,
  isObject,
  sha256Utf8
} from "./launch-bundle-v2-shared.mjs";

export function analyzeRegistryAcceptanceV3TrustedReview({
  acceptanceBinding,
  application,
  applicationBinding,
  conflicts,
  registryAcceptance,
  registryTracker,
  trustedReviewVerification
}) {
  const runtimePath = "$runtime.trustedReviewVerification";
  if (!isObject(trustedReviewVerification)) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_REQUIRED",
      runtimePath,
      "Registry acceptance v3 requires a fresh independently authenticated review projection supplied by the protected runtime."
    );
    return;
  }
  if (!isFreshRegistryAcceptanceV3TrustedReview(trustedReviewVerification)) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_UNAUTHENTICATED",
      runtimePath,
      "Registry acceptance v3 requires a fresh process-local receipt from the Builder read-only GitHub and raw-Git verifier; caller-constructed JSON is never authority."
    );
    return;
  }

  try {
    assertRegistryAcceptanceV3BoundedJson(trustedReviewVerification);
    if (
      !hasExactKeys(trustedReviewVerification, [
        "authority",
        "projection",
        "projectionSha256",
        "registryMain",
        "result",
        "schemaVersion",
        "verifiedAt"
      ])
      || trustedReviewVerification.result !== "VERIFIED"
      || trustedReviewVerification.schemaVersion !== "1.0.0"
      || !SHA256_PATTERN.test(trustedReviewVerification.projectionSha256 ?? "")
      || !validRegistryAcceptanceV3Timestamp(trustedReviewVerification.verifiedAt)
    ) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_INVALID",
        runtimePath,
        "Trusted Registry review verification has an unsupported or stale envelope."
      );
    }

    const authority = trustedReviewVerification.authority;
    if (
      !isObject(authority)
      || !hasExactKeys(authority, ["attestedProjectionSha256", "evidenceSha256", "kind", "verifier"])
      || authority.kind !== "trusted-github-review-and-raw-git-replay"
      || !SHA256_PATTERN.test(authority.attestedProjectionSha256 ?? "")
      || !SHA256_PATTERN.test(authority.evidenceSha256 ?? "")
      || authority.verifier !== REGISTRY_ACCEPTANCE_V3_GITHUB_VERIFIER
    ) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_AUTHORITY_INVALID",
        `${runtimePath}.authority`,
        "Trusted Registry review verification lacks one closed external authority descriptor."
      );
    }

    const projection = validateRegistryAcceptanceV3ReviewProjection({
      application,
      applicationBinding,
      projection: trustedReviewVerification.projection,
      runtimePath
    });
    const registryMain = validateRegistryAcceptanceV3CurrentMain({
      acceptanceBinding,
      application,
      projection,
      registryAcceptance,
      registryMain: trustedReviewVerification.registryMain,
      runtimePath
    });
    const projectionCanonical = canonicalJson(projection);
    const projectionSha256 = sha256Utf8(projectionCanonical);
    if (trustedReviewVerification.projectionSha256 !== projectionSha256) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_DIGEST_MISMATCH",
        `${runtimePath}.projectionSha256`,
        "Trusted Registry review projection digest does not match its exact canonical projection."
      );
    }
    if (authority.attestedProjectionSha256 !== projectionSha256) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_AUTHORITY_INVALID",
        `${runtimePath}.authority.attestedProjectionSha256`,
        "Trusted Registry review authority does not attest the exact review and raw-Git package projection."
      );
    }
    const expectedAuthorityEvidenceSha256 = sha256Utf8(canonicalJson({
      apiOrigin: "https://api.github.com",
      projection,
      registryMain,
      verifiedAt: trustedReviewVerification.verifiedAt,
      verifier: REGISTRY_ACCEPTANCE_V3_GITHUB_VERIFIER
    }));
    if (authority.evidenceSha256 !== expectedAuthorityEvidenceSha256) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_AUTHORITY_INVALID",
        `${runtimePath}.authority.evidenceSha256`,
        "Trusted Registry review authority digest does not bind the exact verifier, timestamp and projection."
      );
    }

    const storedReviewCanonical = canonicalJson(registryAcceptance.reviewEvidence ?? null);
    const storedReviewSha256 = sha256Utf8(storedReviewCanonical);
    if (registryAcceptance.reviewEvidenceSha256 !== storedReviewSha256) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_REVIEW_EVIDENCE_DIGEST_MISMATCH",
        "$.artifacts.registryAcceptance.content#/reviewEvidenceSha256",
        "Stored Registry review evidence digest does not match its exact canonical projection."
      );
    }
    const storedProjection = validateRegistryAcceptanceV3ReviewProjection({
      application,
      applicationBinding,
      projection: registryAcceptance.reviewEvidence,
      runtimePath: "$.artifacts.registryAcceptance.content#/reviewEvidence"
    });
    if (canonicalJson(projectRegistryAcceptanceV3ImmutableReviewAuthority(projection))
      !== canonicalJson(projectRegistryAcceptanceV3ImmutableReviewAuthority(storedProjection))) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_MISMATCH",
        "$.artifacts.registryAcceptance.content#/reviewEvidence",
        "Stored Registry review evidence differs from the fresh independently authenticated projection on immutable IDs, Git objects, package digests, review body, lifecycle, or timestamps."
      );
    }

    const submittedAt = projection.review.submittedAt;
    const mergedAt = projection.pullRequest.merge.mergedAt;
    if (
      Date.parse(trustedReviewVerification.verifiedAt) < Date.parse(submittedAt)
      || Date.parse(trustedReviewVerification.verifiedAt) < Date.parse(mergedAt)
    ) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_INVALID",
        `${runtimePath}.verifiedAt`,
        "Trusted Registry review verification cannot predate the selected review or merged Application PR."
      );
    }
    if (
      !validRegistryAcceptanceV3Timestamp(registryAcceptance.decidedAt)
      || Date.parse(registryAcceptance.decidedAt) < Date.parse(submittedAt)
      || Date.parse(registryAcceptance.decidedAt) < Date.parse(mergedAt)
      || Date.parse(trustedReviewVerification.verifiedAt) < Date.parse(registryAcceptance.decidedAt)
    ) {
      registryAcceptanceV3ReviewFailure(
        "REGISTRY_ACCEPTANCE_DECISION_PRECEDES_REVIEW",
        "$.artifacts.registryAcceptance.content#/decidedAt",
        "Registry acceptance decision must follow the exact approved owner review and merged Application PR, and the fresh verification cannot predate that decision."
      );
    }
  } catch (error) {
    addConflict(
      conflicts,
      registryTracker,
      typeof error?.code === "string" ? error.code : "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_INVALID",
      typeof error?.path === "string" ? error.path : runtimePath,
      error instanceof Error ? error.message : "Trusted Registry review verification is invalid."
    );
  }
}
