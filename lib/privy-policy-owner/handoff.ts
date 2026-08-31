import {
  digestPrivyOwnerUserV4,
  parsePrivyPolicyAppUserSignatureV4,
  PRIVY_POLICY_APP_USER_SIGNATURE_VERSION_V4,
  serializePrivyOwnerArtifactV4,
  validatePrivyPolicyAppUserRequestV4,
} from "./wire";

/** Reviewed whole-policy request bodies. These pins are not imported from a file. */
export const REVIEWED_PRIVY_POLICY_BINDINGS = Object.freeze({
  appId: "cms0vmhok003f0cl93ou53auq",
  policyId: "sf86euttztysqlocsx2url2y",
  ownerId: "wtlwv5eybvh4mmj3xdqof9vw",
  conditionSetId: "urs76jlku0tb9bitkc4lxb7d",
});

export const REVIEWED_PRIVY_POLICY_BODY_SHA256 = Object.freeze({
  reconcile: "sha256:e2bac07a38ee5bc0ad6e106e4b9598bc4018be56152e8ca9c06ef4bd1db36232",
  rollback: "sha256:106bb02ae31a19ba5ffab6a3582a02e46cd8a1be27c1ee99a5139faca282276c",
});

export type PrivyPolicyOwnerOperation = keyof typeof REVIEWED_PRIVY_POLICY_BODY_SHA256;
export type PrivyPolicyOwnerReview = Awaited<ReturnType<typeof reviewPrivyPolicyOwnerRequest>>;
export type PrivyPolicyOwnerSession = Readonly<{
  ready: boolean;
  authenticated: boolean;
  userId: string | null;
}>;

export async function reviewPrivyPolicyOwnerRequest(input: Readonly<{
  text: string;
  operation: PrivyPolicyOwnerOperation;
  userId: string;
  nowMilliseconds: number;
}>) {
  if (input.operation !== "reconcile" && input.operation !== "rollback") {
    throw new Error("OWNER_HANDOFF_OPERATION_INVALID");
  }
  return validatePrivyPolicyAppUserRequestV4({
    text: input.text,
    nowMilliseconds: input.nowMilliseconds,
    expected: {
      bindings: REVIEWED_PRIVY_POLICY_BINDINGS,
      operation: input.operation,
      requestBodySha256: REVIEWED_PRIVY_POLICY_BODY_SHA256[input.operation],
      ownerUserSha256: await digestPrivyOwnerUserV4(input.userId),
    },
  });
}

function requireSameSession(
  readSession: () => PrivyPolicyOwnerSession,
  expectedUserId?: string,
): string {
  const session = readSession();
  if (!session.ready || !session.authenticated || !session.userId
    || (expectedUserId !== undefined && session.userId !== expectedUserId)) {
    throw new Error("OWNER_HANDOFF_SESSION_CHANGED");
  }
  return session.userId;
}

function requireUnexpired(review: PrivyPolicyOwnerReview, nowMilliseconds: number) {
  if (!Number.isSafeInteger(nowMilliseconds)
    || nowMilliseconds < Date.parse(review.artifact.createdAt)
    || nowMilliseconds >= Date.parse(review.artifact.expiresAt)) {
    throw new Error("OWNER_HANDOFF_REQUEST_EXPIRED_OR_CLOCK_INVALID");
  }
}

/** Accepts only the pinned policy artifact, never arbitrary bytes or SDK requests. */
export async function signReviewedPrivyPolicyOwnerRequest(input: Readonly<{
  text: string;
  operation: PrivyPolicyOwnerOperation;
  reviewedRequestArtifactSha256: string;
  readSession: () => PrivyPolicyOwnerSession;
  signAuthorization: (bytes: Uint8Array) => Promise<{ signature: string }>;
  now?: () => number;
}>): Promise<string> {
  const now = input.now ?? Date.now;
  const userId = requireSameSession(input.readSession);
  const review = await reviewPrivyPolicyOwnerRequest({
    text: input.text,
    operation: input.operation,
    userId,
    nowMilliseconds: now(),
  });
  requireSameSession(input.readSession, userId);
  requireUnexpired(review, now());
  if (review.requestArtifactSha256 !== input.reviewedRequestArtifactSha256) {
    throw new Error("OWNER_HANDOFF_REVIEW_CHANGED");
  }
  // SDK consumes the original RFC 8785 bytes. No reformatting or re-expiry.
  const result = await input.signAuthorization(review.requestBytes);
  requireSameSession(input.readSession, userId);
  requireUnexpired(review, now());
  const artifact = serializePrivyOwnerArtifactV4({
    schemaVersion: PRIVY_POLICY_APP_USER_SIGNATURE_VERSION_V4,
    requestArtifactSha256: review.requestArtifactSha256,
    requestSha256: review.artifact.requestSha256,
    authorizationSignature: result.signature,
  });
  parsePrivyPolicyAppUserSignatureV4(artifact, {
    requestArtifactSha256: review.requestArtifactSha256,
    requestSha256: review.artifact.requestSha256,
  });
  return artifact;
}

/** Never render raw SDK errors, which may contain request or session details. */
export function privyPolicyOwnerErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "OWNER_HANDOFF_REQUEST_EXPIRED_OR_CLOCK_INVALID") {
    return "This request expired or your clock differs. Ask the operator for a fresh 30 second request.";
  }
  if (code === "OWNER_HANDOFF_SESSION_CHANGED") {
    return "Your owner session changed. Sign in again and import a fresh request.";
  }
  if (code === "OWNER_HANDOFF_BINDING_MISMATCH") {
    return "This file does not match the selected operation, reviewed policy, or signed in owner. Check with the operator.";
  }
  if (code.startsWith("OWNER_HANDOFF_")) {
    return "This file could not be verified. Use the unmodified request from the operator.";
  }
  return "The request could not be signed. Check your owner session and ask the operator for a fresh request.";
}
