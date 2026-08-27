import { getProductionPartnerAdminBridgeV1 } from
  "@/lib/server/custom-launch/partner-admin-bridge-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
export const runtime = "nodejs";

type RouteContext = Readonly<{
  params: Promise<Readonly<{ partnerId: string; rootKeyId: string }>>;
}>;

export async function DELETE(request: Request, context: RouteContext) {
  const { partnerId, rootKeyId } = await context.params;
  return getProductionPartnerAdminBridgeV1().revokeRootKey(
    request,
    partnerId,
    rootKeyId,
  );
}
