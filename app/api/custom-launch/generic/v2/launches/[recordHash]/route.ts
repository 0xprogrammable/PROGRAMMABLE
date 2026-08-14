import { handleProductionGenericLaunchDetailV2 } from
  "@/lib/server/custom-launch/generic-launch-production-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ recordHash: string }> },
) {
  const { recordHash } = await context.params;
  return handleProductionGenericLaunchDetailV2(request, recordHash);
}
