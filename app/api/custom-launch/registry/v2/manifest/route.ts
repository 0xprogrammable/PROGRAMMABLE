import { handleProductionCustomRegistryManifestV2 } from
  "@/lib/server/custom-launch/registry-manifest-v2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleProductionCustomRegistryManifestV2(request);
}
