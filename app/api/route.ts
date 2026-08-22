const API_INDEX = {
  schemaVersion: "programmable.public-api-index.v1",
  status: "ready",
  openapi: "https://programmable.market/openapi.json",
  documentation: "https://programmable.market/docs/developers",
  llms: "https://programmable.market/llms.txt",
  scope: {
    access: "unauthenticated-read-only",
    actionsExcluded: [
      "launch",
      "trade",
      "claim",
      "profile-write",
      "wallet-signing",
    ],
    identityPolicy:
      "Verified identity remains separate from optional market enrichment.",
  },
} as const;

export const dynamic = "force-static";

export function GET() {
  return Response.json(API_INDEX, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      Link: '<https://programmable.market/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
    },
  });
}
