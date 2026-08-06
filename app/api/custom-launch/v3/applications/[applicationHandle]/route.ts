import { handleProductionCustomLaunchBridgeV2 } from "@/lib/server/custom-launch/launch-bridge-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationHandle: string }> },
) {
  const { applicationHandle } = await context.params;
  return handleProductionCustomLaunchBridgeV2(request, {
    kind: "application-status",
    applicationHandle,
  });
}
