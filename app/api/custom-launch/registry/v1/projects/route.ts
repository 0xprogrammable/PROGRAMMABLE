import { handleProductionRegistryCustomLaunchFeedV1 } from
  "@/lib/server/custom-launch/registry-public-read-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export const GET = handleProductionRegistryCustomLaunchFeedV1;
