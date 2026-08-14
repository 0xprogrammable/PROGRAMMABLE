import { handleProductionGenericLaunchFeedV2 } from
  "@/lib/server/custom-launch/generic-launch-production-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export const GET = handleProductionGenericLaunchFeedV2;
