import { programmablePublicOpenApi } from "@/lib/public-openapi";

export const dynamic = "force-static";

export function GET() {
  return Response.json(programmablePublicOpenApi, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      Link: '<https://programmable.market/docs/developers>; rel="describedby"',
    },
  });
}
