import { createPredictionV2DirectoryRouteHandler } from
  "../_shared/http-v2";
import { getPredictionV2PublicReleaseV2 } from
  "@/lib/prediction-v2/public-release-v2.server";

export const dynamic = "force-dynamic";
export const maxDuration = 20;
export const runtime = "nodejs";

const handler = createPredictionV2DirectoryRouteHandler({
  getRelease: getPredictionV2PublicReleaseV2,
  async loadRuntime(release) {
    const configured = await import("../_shared/runtime-v2.server");
    return configured.getPredictionV2RouteRuntimeV2(release);
  },
});

export function GET(request: Request) {
  return handler(request);
}
