import "server-only";

export const PREDICTION_V2_PROVIDER_ROUTE_READINESS_SCHEMA =
  "programmable.prediction-v2-provider-route-readiness.v2" as const;

type PredictionV2ProviderRouteControlAttestationsV2 = Readonly<{
  sharedDiscoveryBudget: `sha256:${string}` | null;
  sharedImageTransformBudget: `sha256:${string}` | null;
  edgePerClientLimit: `sha256:${string}` | null;
}>;

export type PredictionV2ProviderRouteReadinessV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_PROVIDER_ROUTE_READINESS_SCHEMA;
  productionReady: boolean;
  controlAttestations: PredictionV2ProviderRouteControlAttestationsV2;
}>;

const PROVEN_READINESS = new WeakSet<object>();

function createReleaseDarkReadiness(): PredictionV2ProviderRouteReadinessV2 {
  const readiness = Object.freeze({
    schemaVersion: PREDICTION_V2_PROVIDER_ROUTE_READINESS_SCHEMA,
    productionReady: false,
    controlAttestations: Object.freeze({
      sharedDiscoveryBudget: null,
      sharedImageTransformBudget: null,
      edgePerClientLimit: null,
    }),
  });
  PROVEN_READINESS.add(readiness);
  return readiness;
}

const PRODUCTION_READINESS = createReleaseDarkReadiness();

/**
 * Public provider routes remain dark until one reviewed server-only change
 * injects all three shared control attestations. Environment variables and
 * request-supplied readiness claims are intentionally not accepted here.
 */
export function getPredictionV2ProviderRouteReadinessV2():
  PredictionV2ProviderRouteReadinessV2 {
  return PRODUCTION_READINESS;
}

/**
 * Structural copies cannot authorize provider work. A future ready state must
 * be created and branded inside this module after the shared controls exist.
 */
export function assertPredictionV2ProviderRouteReadinessV2(
  value: unknown,
): asserts value is PredictionV2ProviderRouteReadinessV2 {
  if (
    typeof value !== "object" || value === null ||
    !PROVEN_READINESS.has(value)
  ) {
    throw new Error("Invalid Prediction V2 provider route readiness");
  }
}
