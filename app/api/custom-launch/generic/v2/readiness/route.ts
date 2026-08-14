import { handleProductionGenericLaunchReadinessV2 } from
  "@/lib/server/custom-launch/generic-launch-production-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
export const runtime = "nodejs";

export const GET = handleProductionGenericLaunchReadinessV2;
