import { handleProductionCustomLaunchBridgeV2 } from "@/lib/server/custom-launch/launch-bridge-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleProductionCustomLaunchBridgeV2(request, { kind: "application-list" });
}
