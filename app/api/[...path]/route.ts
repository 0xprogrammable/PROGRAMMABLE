const API_NOT_FOUND_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  Link: '<https://programmable.market/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
} as const;

function apiNotFound(request: Request) {
  return Response.json(
    {
      schemaVersion: "programmable.api-error.v1",
      status: "error",
      error: {
        code: "api_route_not_found",
        message: `No public Programmable API route matches ${new URL(request.url).pathname}.`,
        resolution:
          "Read https://programmable.market/openapi.json or https://programmable.market/llms.txt and use a documented read-only endpoint.",
      },
    },
    { status: 404, headers: API_NOT_FOUND_HEADERS },
  );
}

export const GET = apiNotFound;
export const POST = apiNotFound;
export const PUT = apiNotFound;
export const PATCH = apiNotFound;
export const DELETE = apiNotFound;
export const OPTIONS = apiNotFound;
