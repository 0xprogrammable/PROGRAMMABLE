import { handleProductionCustomLaunchProjectReadV2 } from "@/lib/server/custom-launch/project-read-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  return handleProductionCustomLaunchProjectReadV2(request, projectId);
}
