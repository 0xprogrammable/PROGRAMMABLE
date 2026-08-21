import { getProductionCreatorArticleApiHandlersV1 } from
  "@/lib/server/creator-article/api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ address: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { address } = await context.params;
  return getProductionCreatorArticleApiHandlersV1().article(request, address);
}

export async function PUT(request: Request, context: RouteContext) {
  const { address } = await context.params;
  return getProductionCreatorArticleApiHandlersV1().article(request, address);
}
