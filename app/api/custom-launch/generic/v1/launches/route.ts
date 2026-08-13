import { handleProductionGenericLaunchFeedV1 } from
  "@/lib/server/custom-launch/generic-launch-read-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export const GET = handleProductionGenericLaunchFeedV1;
