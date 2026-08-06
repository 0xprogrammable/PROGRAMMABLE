import { handleProductionCustomRegistryManifestV1 } from
  "@/lib/server/custom-launch/registry-manifest-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleProductionCustomRegistryManifestV1(request);
}
