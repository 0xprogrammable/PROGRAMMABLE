import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET as getApiIndex } from "../app/api/route";
import { GET as getUnknownApi } from "../app/api/[...path]/route";
import { GET as getDeveloperMarkdown } from "../app/docs/developers.md/route";
import { GET as getHomeMarkdown } from "../app/index.md/route";
import { GET as getOpenApi } from "../app/openapi.json/route";
import {
  programmableHomeMarkdown,
  programmableLlmsIndex,
} from "../lib/developer-docs-content";
import { negotiatePageRepresentation } from "../lib/content-negotiation";
import { programmablePublicOpenApi } from "../lib/public-openapi";
import {
  programmableSiteStructuredData,
  serializeStructuredData,
} from "../lib/site-structured-data";
import { proxy } from "../proxy";

const ORIGIN = "https://programmable.market";
const CUSTOM_LAUNCH_API_ORIGIN = "https://api.programmable.market";

describe("agent-readable public surface", () => {
  it("makes llms.txt product-first and states the exact public identity boundary", () => {
    expect(programmableLlmsIndex).toMatch(/^# Programmable\n/u);
    expect(programmableLlmsIndex).toContain("## When to use Programmable");
    expect(programmableLlmsIndex).toContain(
      "https://programmable.market/openapi.json",
    );
    expect(programmableLlmsIndex).toContain(
      "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
    );
    expect(programmableLlmsIndex).toContain(
      "Finalized Router records can surface as provenance-only Custom entries after 64 confirmations.",
    );
    expect(programmableLlmsIndex).toContain(
      "every Stock family, and Custom launches without a verified Registry record or finalized Router stamp",
    );
    expect(programmableLlmsIndex).not.toMatch(
      /^# Programmable Launch Stamp Router$/mu,
    );
    expect(programmableHomeMarkdown).toContain("## Machine-readable resources");
    expect(programmableHomeMarkdown).toContain("explicit user confirmation");
  });

  it("publishes a small OpenAPI 3.1 contract with unique operation IDs", async () => {
    expect(programmablePublicOpenApi.openapi).toBe("3.1.0");
    expect(programmablePublicOpenApi.servers).toEqual([
      { url: ORIGIN, description: "Programmable production" },
    ]);
    expect(Object.keys(programmablePublicOpenApi.paths).sort()).toEqual([
      "/api",
      "/api/custom-launch/registry/v2/manifest",
      "/api/custom-launch/registry/v2/readiness",
      "/api/explore",
      "/api/explore/token",
      "/openapi.json",
      "/v1/custom-launches",
      "/v1/custom-launches/{launchId}",
    ]);

    const operations = Object.values(programmablePublicOpenApi.paths).flatMap(
      (path) => Object.values(path),
    );
    const operationIds = operations.map((operation) => operation.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(
      operations.every((operation) =>
        operation.description || operation.summary
      ),
    ).toBe(true);
    const readOnlyPaths = [
      "/api",
      "/api/custom-launch/registry/v2/manifest",
      "/api/custom-launch/registry/v2/readiness",
      "/api/explore",
      "/api/explore/token",
      "/openapi.json",
    ] as const;
    for (const path of readOnlyPaths) {
      const operation = Object.values(programmablePublicOpenApi.paths[path])[0];
      expect(operation?.security).toEqual([]);
    }

    const customLaunchCollection =
      programmablePublicOpenApi.paths["/v1/custom-launches"];
    const listCustomLaunches = customLaunchCollection.get;
    const createCustomLaunch = customLaunchCollection.post;
    const getCustomLaunch =
      programmablePublicOpenApi.paths["/v1/custom-launches/{launchId}"].get;
    for (const operation of [
      listCustomLaunches,
      createCustomLaunch,
      getCustomLaunch,
    ]) {
      expect(operation.servers).toEqual([
        {
          url: CUSTOM_LAUNCH_API_ORIGIN,
          description: "Programmable Custom Launch API",
        },
      ]);
      expect(operation.security).toEqual([{ CustomLaunchApiKey: [] }]);
    }
    expect(
      programmablePublicOpenApi.components.securitySchemes.CustomLaunchApiKey,
    ).toMatchObject({ type: "http", scheme: "bearer" });

    const response = getOpenApi();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual(programmablePublicOpenApi);
  });

  it("keeps V1 reads live and exposes only the explicit V1 write fence", () => {
    const prohibitedSegments = new Set([
      "claim",
      "profile",
      "trade",
      "wallet",
    ]);
    expect(
      Object.keys(programmablePublicOpenApi.paths).every((path) =>
        path.split("/").every((segment) => !prohibitedSegments.has(segment))
      ),
    ).toBe(true);
    expect(programmablePublicOpenApi["x-programmable-boundary"].actions).toContain(
      "API keys never sign, broadcast",
    );
    expect(
      Object.keys(programmablePublicOpenApi.paths["/v1/custom-launches"]),
    ).toEqual(["get", "post"]);
    expect(
      programmablePublicOpenApi.paths["/v1/custom-launches"].post,
    ).toMatchObject({
      deprecated: true,
      summary: "V1 launch creation is read-only",
    });
    expect(Object.keys(
      programmablePublicOpenApi.paths["/v1/custom-launches"].post.responses,
    )).toEqual(["401", "403", "409"]);
    expect(
      programmablePublicOpenApi.paths["/v1/custom-launches"].get.description,
    ).toContain("pending rows receive bounded best-effort chain reconciliation");
    expect(
      programmablePublicOpenApi.paths["/v1/custom-launches"].get.description,
    ).toContain("output is always null");
    expect(
      Object.keys(
        programmablePublicOpenApi.paths["/v1/custom-launches/{launchId}"],
      ),
    ).toEqual(["get"]);
    expect(programmablePublicOpenApi["x-programmable-api-scopes"]).toMatchObject({
      "custom-launch:create": { state: "v1-write-fenced-v3-live" },
      "fees:claim": { state: "reserved-disabled" },
      "buybacks:manage": { state: "reserved-disabled" },
    });
  });

  it("publishes typed and unambiguous Custom launch lifecycle identifiers", () => {
    const schemas = programmablePublicOpenApi.components.schemas;
    expect(schemas.CustomLaunchCreateRequest.required).not.toContain(
      "verificationBundle",
    );
    expect(schemas.CustomLaunchCreateRequest.properties.verificationBundle)
      .toMatchObject({
        $ref: "#/components/schemas/ExactSourceVerificationBundleV1",
      });
    expect(schemas.CustomLaunchResource.required).toEqual(
      expect.arrayContaining([
        "launchId",
        "requestId",
        "onchainLaunchId",
        "status",
        "output",
      ]),
    );
    expect(schemas.CustomLaunchResource.required).not.toContain(
      "sourceVerification",
    );
    expect(schemas.CustomLaunchResource.properties.sourceVerification)
      .toMatchObject({
        oneOf: expect.arrayContaining([
          { $ref: "#/components/schemas/SourceVerificationStatusV1" },
          { type: "null" },
        ]),
      });
    expect(schemas.CustomLaunchOutput.oneOf).toEqual([
      { $ref: "#/components/schemas/CustomLaunchPreparedOutput" },
      { $ref: "#/components/schemas/CustomLaunchAuthorizedOutput" },
    ]);
    expect(
      schemas.CustomLaunchOnchainEvidence.properties.requiredConfirmationDepth,
    ).toEqual({ const: "64" });
    expect(programmablePublicOpenApi["x-programmable-boundary"].market).toContain(
      "not active liquidity or tradability",
    );

    const standaloneSource = readFileSync(
      new URL("../public/openapi/custom-launch-v1.json", import.meta.url),
      "utf8",
    );
    expect(() => JSON.parse(standaloneSource)).not.toThrow();
    const standalone = JSON.parse(standaloneSource);
    expect(
      standalone.components.schemas.CustomLaunchCreateRequestV1.required,
    ).not.toContain("verificationBundle");
    expect(
      standalone.components.schemas.CustomLaunchResourceV1.required,
    ).not.toContain("sourceVerification");
    expect(standaloneSource).toContain('"code": "CUSTOM_LAUNCH_V1_READ_ONLY"');
    expect(Object.keys(
      standalone.paths["/v1/custom-launches"].post.responses,
    )).toEqual(["401", "403", "409"]);
    expect(standaloneSource).not.toContain("IDEMPOTENCY_KEY_REUSED");
  });

  it("returns a discoverable API index and structured JSON for unknown API paths", async () => {
    const indexResponse = getApiIndex();
    expect(indexResponse.status).toBe(200);
    await expect(indexResponse.json()).resolves.toMatchObject({
      schemaVersion: "programmable.public-api-index.v1",
      status: "ready",
      openapi: `${ORIGIN}/openapi.json`,
      scope: { access: "unauthenticated-read-only" },
    });

    const missingResponse = getUnknownApi(
      new Request(`${ORIGIN}/api/not-a-real-route`),
    );
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.headers.get("content-type")).toContain(
      "application/json",
    );
    await expect(missingResponse.json()).resolves.toMatchObject({
      schemaVersion: "programmable.api-error.v1",
      status: "error",
      error: {
        code: "api_route_not_found",
        message: "No public Programmable API route matches /api/not-a-real-route.",
      },
    });
  });

  it("negotiates Markdown by quality while preserving HTML and RSC requests", () => {
    expect(negotiatePageRepresentation(null)).toBe("html");
    expect(negotiatePageRepresentation("*/*")).toBe("html");
    expect(negotiatePageRepresentation("text/*")).toBe("html");
    expect(negotiatePageRepresentation("text/markdown")).toBe("markdown");
    expect(
      negotiatePageRepresentation(
        "text/html;q=0.4, text/markdown;q=0.9",
      ),
    ).toBe("markdown");
    expect(
      negotiatePageRepresentation(
        "text/html;q=0.9, text/markdown;q=0.4",
      ),
    ).toBe("html");
    expect(negotiatePageRepresentation("text/x-component")).toBe("html");
    expect(negotiatePageRepresentation("application/json")).toBe(
      "not-acceptable",
    );
  });

  it("serves direct Markdown requests and varies both representations on Accept", async () => {
    const markdownResponse = proxy(
      new NextRequest(`${ORIGIN}/`, {
        headers: { Accept: "text/markdown" },
      }),
    );
    expect(markdownResponse.status).toBe(200);
    expect(markdownResponse.headers.get("content-type")).toContain(
      "text/markdown",
    );
    expect(markdownResponse.headers.get("vary")).toBe("Accept");
    expect(markdownResponse.headers.get("x-middleware-rewrite")).toBeNull();
    expect((await markdownResponse.text()).startsWith("# Programmable")).toBe(
      true,
    );

    const htmlResponse = proxy(
      new NextRequest(`${ORIGIN}/`, {
        headers: { Accept: "text/html" },
      }),
    );
    expect(htmlResponse.headers.get("vary")).toContain("Accept");
    expect(htmlResponse.headers.get("x-middleware-next")).toBe("1");

    const unacceptableResponse = proxy(
      new NextRequest(`${ORIGIN}/`, {
        headers: { Accept: "application/json" },
      }),
    );
    expect(unacceptableResponse.status).toBe(406);
    expect(unacceptableResponse.headers.get("vary")).toBe("Accept");
  });

  it("keeps Accept and the Next RSC keys in the public CDN variation", () => {
    const config = JSON.parse(
      readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
    ) as {
      headers: Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
      }>;
    };
    const root = config.headers.find(({ source }) => source === "/");
    const vary = root?.headers.find(({ key }) => key === "Vary")?.value ?? "";
    expect(vary.split(/,\s*/u)).toEqual(
      expect.arrayContaining([
        "Accept",
        "Accept-Encoding",
        "RSC",
        "Next-Router-State-Tree",
        "Next-Router-Prefetch",
        "Next-Router-Segment-Prefetch",
      ]),
    );
  });

  it("serves compact Markdown documents with canonical HTML alternates", async () => {
    for (const response of [getHomeMarkdown(), getDeveloperMarkdown()]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/markdown");
      expect(response.headers.get("vary")).toBe("Accept");
      expect(response.headers.get("link")).toContain('rel="canonical"');
      expect((await response.text()).startsWith("# ")).toBe(true);
    }
  });

  it("publishes truthful JSON-LD without fabricated contact or offer data", () => {
    const graph = programmableSiteStructuredData["@graph"];
    expect(graph.map((entry) => entry["@type"])).toEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
    ]);
    const serialized = serializeStructuredData(programmableSiteStructuredData);
    expect(serialized).toContain('"@context":"https://schema.org"');
    expect(serialized).not.toContain('"address"');
    expect(serialized).not.toContain('"contactPoint"');
    expect(serialized).not.toContain('"offers"');
    expect(serializeStructuredData({ value: "</script>" })).toBe(
      '{"value":"\\u003c/script>"}',
    );
  });
});
