import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PREDICTION_V2_PROVIDER_ROUTE_READINESS_SCHEMA,
  assertPredictionV2ProviderRouteReadinessV2,
  getPredictionV2ProviderRouteReadinessV2,
} from
  "../lib/market-data/prediction-v2-provider-route-readiness.server";

describe("Prediction V2 provider-route readiness", () => {
  it("keeps every distributed provider control release-dark", () => {
    const readiness = getPredictionV2ProviderRouteReadinessV2();

    expect(readiness).toEqual({
      schemaVersion: PREDICTION_V2_PROVIDER_ROUTE_READINESS_SCHEMA,
      productionReady: false,
      controlAttestations: {
        sharedDiscoveryBudget: null,
        sharedImageTransformBudget: null,
        edgePerClientLimit: null,
      },
    });
    expect(Object.isFrozen(readiness)).toBe(true);
    expect(Object.isFrozen(readiness.controlAttestations)).toBe(true);
    expect(() => assertPredictionV2ProviderRouteReadinessV2(readiness))
      .not.toThrow();
  });

  it("rejects structural copies and caller-declared ready states", () => {
    const branded = getPredictionV2ProviderRouteReadinessV2();
    const structuralCopy = {
      ...branded,
      controlAttestations: { ...branded.controlAttestations },
    };
    const callerDeclaredReady = {
      ...structuralCopy,
      productionReady: true,
      controlAttestations: {
        sharedDiscoveryBudget: `sha256:${"11".repeat(32)}`,
        sharedImageTransformBudget: `sha256:${"22".repeat(32)}`,
        edgePerClientLimit: `sha256:${"33".repeat(32)}`,
      },
    };

    expect(() => assertPredictionV2ProviderRouteReadinessV2(structuralCopy))
      .toThrow("Invalid Prediction V2 provider route readiness");
    expect(() => assertPredictionV2ProviderRouteReadinessV2(
      callerDeclaredReady,
    )).toThrow("Invalid Prediction V2 provider route readiness");
  });
});
