import { getProductionDeveloperLaunchHistoryBridgeV1 } from
  "@/lib/server/custom-launch/launch-history-bridge-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<Readonly<{ launchId: string }>> }>,
) {
  const { launchId } = await context.params;
  return getProductionDeveloperLaunchHistoryBridgeV1()
    .submitV4SubmissionHint(request, launchId);
}
