import {
  handleProductionWebsiteGitHubAppAuthorizationCallbackV1,
} from "@/lib/server/custom-launch/github-launch-session-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 20;
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleProductionWebsiteGitHubAppAuthorizationCallbackV1(request);
}
