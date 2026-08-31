import {
  handleProductionMainTokenMigrationGaslessTransferPostV1,
} from "@/lib/server/main-token-migration-gasless-transfer-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleProductionMainTokenMigrationGaslessTransferPostV1(request);
}
