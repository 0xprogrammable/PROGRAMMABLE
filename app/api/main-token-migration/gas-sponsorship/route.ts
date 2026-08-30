import {
  handleProductionMainTokenMigrationGasSponsorGetV1,
  handleProductionMainTokenMigrationGasSponsorPostV1,
} from "@/lib/server/main-token-migration-gas-sponsor-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleProductionMainTokenMigrationGasSponsorGetV1(request);
}

export function POST(request: Request): Promise<Response> {
  return handleProductionMainTokenMigrationGasSponsorPostV1(request);
}
