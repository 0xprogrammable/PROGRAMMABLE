import { handleProductionRegistryCustomLaunchDetailV1 } from
  "@/lib/server/custom-launch/registry-public-read-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  return handleProductionRegistryCustomLaunchDetailV1(request, projectId);
}
