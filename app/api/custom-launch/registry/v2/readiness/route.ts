import { handleProductionCustomRegistryReadinessV2 } from
  "@/lib/server/custom-launch/registry-manifest-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleProductionCustomRegistryReadinessV2(request);
}
