import {
  handleProductionLateMigrationIntakeGetV1,
  handleProductionLateMigrationIntakePostV1,
} from "@/lib/server/late-migration-intake-production-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleProductionLateMigrationIntakeGetV1(request);
}

export function POST(request: Request): Promise<Response> {
  return handleProductionLateMigrationIntakePostV1(request);
}
