import { handleProductionGenericLaunchReadStageProbeV1 } from
  "@/lib/server/custom-launch/generic-launch-read-production-probe-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

export const POST = handleProductionGenericLaunchReadStageProbeV1;
