import {
  handleProductionCustomLaunchDeploymentReadinessV1,
} from "@/lib/server/custom-launch/deployment-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 20;
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleProductionCustomLaunchDeploymentReadinessV1(request);
}
