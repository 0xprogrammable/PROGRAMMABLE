import { handleProductionManualRouterWebsiteRouteV1 } from
  "@/lib/server/custom-launch/manual-router-routes-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleProductionManualRouterWebsiteRouteV1(request, "resolve");
}
