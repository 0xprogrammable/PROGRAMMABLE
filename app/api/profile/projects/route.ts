import { getProductionCreatorArticleApiHandlersV1 } from
  "@/lib/server/creator-article/api.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return getProductionCreatorArticleApiHandlersV1().listProjects(request);
}
