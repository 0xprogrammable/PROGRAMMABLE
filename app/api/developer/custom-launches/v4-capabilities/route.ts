import { getProductionDeveloperLaunchHistoryBridgeV1 } from
  "@/lib/server/custom-launch/launch-history-bridge-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export async function GET(request: Request) {
  return getProductionDeveloperLaunchHistoryBridgeV1().getV4Capabilities(request);
}
