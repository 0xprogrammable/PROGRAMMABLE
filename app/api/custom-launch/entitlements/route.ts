import {
  handleProductionAuthenticatedWebsiteEntitlementReadV1,
} from "@/lib/server/projection-target/github-entitlement";
import { isCustomLaunchPublicEnabled } from "@/lib/server/custom-launch/public-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  if (!isCustomLaunchPublicEnabled()) {
    return Promise.resolve(new Response(JSON.stringify({
      schemaVersion: "programmable.custom-launch-website-error.v2",
      code: "custom_launch_not_public",
      message: "custom_launch_not_public",
    }), {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    }));
  }
  return handleProductionAuthenticatedWebsiteEntitlementReadV1(request);
}
