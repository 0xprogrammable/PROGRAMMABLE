import "server-only";

import {
  ManualRouterFinalityServiceV1,
} from "@/lib/server/custom-launch/manual-router-finality-v1";
import { ManualRouterRouteAcceptanceServiceV1 } from
  "@/lib/server/custom-launch/manual-router-acceptance-v1";
import { createProductionManualRouterRouteAcceptanceAuthorityV1 } from
  "@/lib/server/custom-launch/manual-router-acceptance-authority-v1";
import {
  createManualRouterApplicantAuthenticatorV1,
  type ManualRouterApplicantAuthenticatorV1,
} from "@/lib/server/custom-launch/manual-router-auth-v1";
import {
  createProductionManualRouterAuthorityV1,
  type ProductionManualRouterAuthorityV1,
} from "@/lib/server/custom-launch/manual-router-authority-v1";
import { assertManualRouterProductionConfigurationV1 } from
  "@/lib/server/custom-launch/manual-router-config-v1";
import { ManualRouterWebsiteServiceV1 } from
  "@/lib/server/custom-launch/manual-router-service-v1";
import { createProductionManualRouterPrivateBlobStoreV1 } from
  "@/lib/server/custom-launch/manual-router-store-v1";
import type { ManualRouterPrivateBlobStoreV1 } from
  "@/lib/server/custom-launch/manual-router-store-v1";

export type ProductionManualRouterWebsiteV1 = Readonly<{
  authority: ProductionManualRouterAuthorityV1;
  authenticator: ManualRouterApplicantAuthenticatorV1;
  service: ManualRouterWebsiteServiceV1;
  finalityService: ManualRouterFinalityServiceV1;
  routeAcceptanceService: ManualRouterRouteAcceptanceServiceV1;
  store: ManualRouterPrivateBlobStoreV1;
}>;

let production: ProductionManualRouterWebsiteV1 | null = null;

export function getProductionManualRouterWebsiteV1():
ProductionManualRouterWebsiteV1 {
  if (production !== null) return production;
  assertManualRouterProductionConfigurationV1();
  const authority = createProductionManualRouterAuthorityV1();
  const store = createProductionManualRouterPrivateBlobStoreV1();
  const service = new ManualRouterWebsiteServiceV1({
    authority: authority.website,
    store,
  });
  production = Object.freeze({
    authority,
    authenticator: createManualRouterApplicantAuthenticatorV1(),
    service,
    finalityService: new ManualRouterFinalityServiceV1({
      authority: authority.finalityAuthority,
      website: service,
      store,
    }),
    routeAcceptanceService: new ManualRouterRouteAcceptanceServiceV1({
      authority: createProductionManualRouterRouteAcceptanceAuthorityV1(),
      store,
    }),
    store,
  });
  return production;
}
