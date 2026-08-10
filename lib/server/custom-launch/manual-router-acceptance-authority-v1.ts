import "server-only";

import { getActiveManualRouterProductionBindingV2 } from
  "@/lib/custom-launch/manual-router-bindings-v2";
import type { ManualRouterRouteAcceptanceAuthorityV1 } from
  "@/lib/server/custom-launch/manual-router-acceptance-v1";
import { ManualRouterServiceErrorV1 } from
  "@/lib/server/custom-launch/manual-router-service-v1";

/**
 * Production stays fail-closed until the final portable Authority acceptance
 * bundle, Golden hashes and exact claim are vendored together. This boundary
 * exists now so enabling Router V2 cannot accidentally fall back to a client
 * supplied claim or to the legacy V1 authority.
 */
export function createProductionManualRouterRouteAcceptanceAuthorityV1():
ManualRouterRouteAcceptanceAuthorityV1 {
  return Object.freeze({
    async resolveFrozenClaim(
      { claimSha256 }: Parameters<
        ManualRouterRouteAcceptanceAuthorityV1["resolveFrozenClaim"]
      >[0],
    ) {
      let expectedClaimSha256: string;
      try {
        expectedClaimSha256 = getActiveManualRouterProductionBindingV2()
          .acceptanceClaimSha256;
      } catch {
        throw capabilityDisabled();
      }
      if (claimSha256 !== expectedClaimSha256) throw notCurrent();
      throw notCurrent();
    },
    async createDurableAcceptance() {
      throw notCurrent();
    },
  });
}

function notCurrent(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(
    503,
    "route_acceptance_not_current",
    false,
  );
}

function capabilityDisabled(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(
    503,
    "route_capability_disabled",
    false,
  );
}
