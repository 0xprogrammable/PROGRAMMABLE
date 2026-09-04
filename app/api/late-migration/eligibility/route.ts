import { handleLateMigrationEligibilityGetV1 } from "@/lib/server/late-migration-eligibility-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 5;
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleLateMigrationEligibilityGetV1(request);
}
