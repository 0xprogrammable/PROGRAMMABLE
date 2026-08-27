import { getProductionPartnerAdminBridgeV1 } from
  "@/lib/server/custom-launch/partner-admin-bridge-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
export const runtime = "nodejs";

export async function GET(request: Request) {
  return getProductionPartnerAdminBridgeV1().list(request);
}

export async function POST(request: Request) {
  return getProductionPartnerAdminBridgeV1().create(request);
}
