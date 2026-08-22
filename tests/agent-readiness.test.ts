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
      "Router records are provenance evidence and identity-mapping details, not a public category.",
    );
    expect(programmableLlmsIndex).toContain(
      "every Stock family, and unverified Custom launches",
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
    expect(
      operations.every((operation) => operation.security.length === 0),
    ).toBe(true);

    const response = getOpenApi();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual(programmablePublicOpenApi);
  });

  it("keeps signing and write actions outside the documented path set", () => {
    const prohibitedSegments = new Set([
      "claim",
      "launch",
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
      "No launch, trade, claim",
    );
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

  it("rewrites direct Markdown requests and varies both representations on Accept", () => {
    const markdownResponse = proxy(
      new NextRequest(`${ORIGIN}/`, {
        headers: { Accept: "text/markdown" },
      }),
    );
    expect(markdownResponse.status).toBe(200);
    expect(markdownResponse.headers.get("vary")).toContain("Accept");
    expect(markdownResponse.headers.get("x-middleware-rewrite")).toBe(
      `${ORIGIN}/index.md`,
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
