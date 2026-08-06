export const REVIEW_AUTHORITY_MODES_V1 = [
  "manual_review",
  "autonomous_ai",
] as const;

export type ReviewAuthorityModeV1 = typeof REVIEW_AUTHORITY_MODES_V1[number];

export function isReviewAuthorityModeV1(value: unknown): value is ReviewAuthorityModeV1 {
  return typeof value === "string"
    && (REVIEW_AUTHORITY_MODES_V1 as readonly string[]).includes(value);
}

export function exactReviewAuthorityModeV1(value: unknown): ReviewAuthorityModeV1 {
  if (!isReviewAuthorityModeV1(value)) {
    throw new TypeError("Review authority mode is invalid");
  }
  return value;
}
