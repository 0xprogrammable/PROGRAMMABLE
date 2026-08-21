import { getProductionCreatorArticleMediaUploadHandlerV1 } from
  "@/lib/server/creator-article/media-api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(
  request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;
  return getProductionCreatorArticleMediaUploadHandlerV1()(request, address);
}
