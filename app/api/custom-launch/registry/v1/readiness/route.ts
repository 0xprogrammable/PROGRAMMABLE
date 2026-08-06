import { handleProductionCustomRegistryReadinessV1 } from
  "@/lib/server/custom-launch/registry-manifest-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleProductionCustomRegistryReadinessV1(request);
}
