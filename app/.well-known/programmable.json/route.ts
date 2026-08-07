import { handleProductionProgrammableWellKnownV1 } from
  "@/lib/server/custom-launch/well-known-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleProductionProgrammableWellKnownV1(request);
}
