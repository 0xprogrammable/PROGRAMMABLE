import { handleProductionActivationWebsiteReadbackV4 } from
  "@/lib/server/custom-launch/activation-readback-v4";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleProductionActivationWebsiteReadbackV4(request);
}
