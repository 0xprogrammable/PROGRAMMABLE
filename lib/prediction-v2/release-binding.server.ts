import "server-only";

import releaseBindingJson from "../../config/prediction-v2-release-binding.v1.json";

export const PREDICTION_V2_RELEASE_VERSION = "prediction-v2" as const;

const DISABLED_RELEASE_BINDING_KEYS = Object.freeze([
  "schemaVersion",
  "releaseVersion",
  "status",
] as const);

/**
 * V1 is deliberately a disabled-only schema. A future activation must use a
 * separately reviewed schema with a pinned attestation trust root; adding
 * deployment fields to this document can never enable Prediction V2.
 */
export type PredictionV2ReleaseBinding = Readonly<{
  schemaVersion: 1;
  releaseVersion: typeof PREDICTION_V2_RELEASE_VERSION;
  status: "disabled";
}>;

function invalidReleaseBinding(): never {
  throw new Error("Invalid Prediction V2 release binding");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
) {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return false;
  const actualKeys = (ownKeys as string[]).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

export function parsePredictionV2ReleaseBinding(
  value: unknown,
): PredictionV2ReleaseBinding {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, DISABLED_RELEASE_BINDING_KEYS) ||
    value.schemaVersion !== 1 ||
    value.releaseVersion !== PREDICTION_V2_RELEASE_VERSION ||
    value.status !== "disabled"
  ) {
    return invalidReleaseBinding();
  }

  return Object.freeze({
    schemaVersion: 1,
    releaseVersion: PREDICTION_V2_RELEASE_VERSION,
    status: "disabled",
  });
}

let cachedReleaseBinding: PredictionV2ReleaseBinding | undefined;

export function getPredictionV2ReleaseBinding(): PredictionV2ReleaseBinding {
  cachedReleaseBinding ??= parsePredictionV2ReleaseBinding(releaseBindingJson);
  return cachedReleaseBinding;
}
