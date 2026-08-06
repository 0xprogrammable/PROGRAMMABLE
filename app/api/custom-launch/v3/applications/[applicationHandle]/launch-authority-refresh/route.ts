import { handleProductionCustomLaunchBridgeV2 } from "@/lib/server/custom-launch/launch-bridge-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ applicationHandle: string }> },
) {
  const { applicationHandle } = await context.params;
  return handleProductionCustomLaunchBridgeV2(request, {
    kind: "launch-authority-refresh",
    applicationHandle,
  });
}
