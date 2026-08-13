import { handleProductionGenericLaunchDetailV1 } from
  "@/lib/server/custom-launch/generic-launch-read-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ recordHash: string }> },
) {
  const { recordHash } = await context.params;
  return handleProductionGenericLaunchDetailV1(request, recordHash);
}
