import "server-only";

import type { ManualRouterApplicantAuthenticatorV1 } from
  "@/lib/server/custom-launch/manual-router-auth-v1";
import {
  assertManualRouterLaneEnabledV1,
  manualRouterErrorResponseV1,
  manualRouterJsonResponseV1,
  readManualRouterStrictJsonRequestV1,
} from "@/lib/server/custom-launch/manual-router-http-v1";
import { getProductionManualRouterWebsiteV1 } from
  "@/lib/server/custom-launch/manual-router-production-v1";
import {
  parseManualRouterApplicantListRequestV1,
  parseManualRouterApplicantResolveRequestV1,
  parseManualRouterApplicantTransactionRequestV1,
} from "@/lib/server/custom-launch/manual-router-requests-v1";
import type { ManualRouterWebsiteServiceV1 } from
  "@/lib/server/custom-launch/manual-router-service-v1";
import type { ManualRouterFinalityServiceV1 } from
  "@/lib/server/custom-launch/manual-router-finality-v1";
import type { ManualRouterRouteAcceptanceServiceV1 } from
  "@/lib/server/custom-launch/manual-router-acceptance-v1";

export type ManualRouterWebsiteRouteKindV1 =
  | "signed-artifacts"
  | "reissue-state"
  | "submissions"
  | "resolve"
  | "report-transaction"
  | "finality"
  | "route-acceptance";

export async function handleProductionManualRouterWebsiteRouteV1(
  request: Request,
  kind: ManualRouterWebsiteRouteKindV1,
): Promise<Response> {
  try {
    // Keep the lane genuinely default-off: do not construct RPC, Blob, or
    // Privy clients before the explicit production flag is enabled.
    assertManualRouterLaneEnabledV1();
    const production = getProductionManualRouterWebsiteV1();
    return handleManualRouterWebsiteRouteV1(request, kind, {
      authenticator: production.authenticator,
      finalityService: production.finalityService,
      routeAcceptanceService: production.routeAcceptanceService,
      service: production.service,
    });
  } catch (error) {
    return manualRouterErrorResponseV1(error);
  }
}

export async function handleManualRouterWebsiteRouteV1(
  request: Request,
  kind: ManualRouterWebsiteRouteKindV1,
  dependencies: Readonly<{
    authenticator: ManualRouterApplicantAuthenticatorV1;
    finalityService: ManualRouterFinalityServiceV1;
    routeAcceptanceService: ManualRouterRouteAcceptanceServiceV1;
    service: ManualRouterWebsiteServiceV1;
  }>,
): Promise<Response> {
  try {
    assertManualRouterLaneEnabledV1();
    const body = await readManualRouterStrictJsonRequestV1(request);
    if (kind === "route-acceptance") {
      const principal = await dependencies.authenticator.authenticateGithub(
        request,
      );
      return manualRouterJsonResponseV1(200,
        await dependencies.routeAcceptanceService.handle({
          request: body,
          principal,
        }));
    }
    if (kind === "signed-artifacts") {
      return manualRouterJsonResponseV1(
        201,
        await dependencies.service.publishSignedArtifact(body),
      );
    }
    if (kind === "reissue-state") {
      const result = await dependencies.service.resolveOperatorReissueState(body);
      return manualRouterJsonResponseV1(
        result.disposition === "stale" ? 409 : 200,
        result,
      );
    }
    if (kind === "submissions") {
      const parsed = parseManualRouterApplicantListRequestV1(body);
      const principal = await dependencies.authenticator.authenticate(
        request,
        parsed.launchWallet,
      );
      return manualRouterJsonResponseV1(200,
        await dependencies.service.listApplicantSubmissions({
          githubUserId: principal.githubUserId,
          launchWallet: principal.linkedLaunchWallet,
        }));
    }
    if (kind === "resolve") {
      const parsed = parseManualRouterApplicantResolveRequestV1(body);
      const principal = await dependencies.authenticator.authenticate(
        request,
        parsed.launchWallet,
      );
      return manualRouterJsonResponseV1(200,
        await dependencies.service.resolveApplicantSubmission({
          githubUserId: principal.githubUserId,
          launchWallet: principal.linkedLaunchWallet,
          subjectHash: parsed.subjectHash,
        }));
    }
    const parsed = parseManualRouterApplicantTransactionRequestV1(
      body,
      kind === "finality" ? "finality" : "report",
    );
    const principal = await dependencies.authenticator.authenticate(
      request,
      parsed.launchWallet,
    );
    const selector = {
        githubUserId: principal.githubUserId,
        launchWallet: principal.linkedLaunchWallet,
        subjectHash: parsed.subjectHash,
        descriptorHash: parsed.descriptorHash,
        preparationHash: parsed.preparationHash,
        transactionHash: parsed.transactionHash,
    } as const;
    return manualRouterJsonResponseV1(200,
      kind === "finality"
        ? await dependencies.finalityService.finalizeApplicantTransaction(selector)
        : await dependencies.service.reportApplicantTransaction(selector));
  } catch (error) {
    return manualRouterErrorResponseV1(error);
  }
}
