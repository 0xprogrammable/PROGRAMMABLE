import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { negotiatePageRepresentation } from "@/lib/content-negotiation";
import { buildProgrammableHomeMarkdown } from "@/lib/developer-docs-content";

const MARKDOWN_DESTINATIONS = new Map([
  ["/docs/developers", "/docs/developers.md"],
]);

function isRetiredPredictionPage(pathname: string): boolean {
  return pathname === "/markets" ||
    pathname.startsWith("/markets/") ||
    pathname === "/docs/tokens/prediction-markets" ||
    pathname === "/docs/models/prediction-markets";
}

function isRetiredPredictionApi(pathname: string): boolean {
  return pathname === "/api/prediction" ||
    pathname.startsWith("/api/prediction/");
}

function retiredPredictionApiResponse(): NextResponse {
  return NextResponse.json(
    {
      schemaVersion: "programmable.api-error.v1",
      status: "error",
      error: {
        code: "api_route_not_found",
        message: "No public Programmable API route matches this path.",
      },
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

function withAcceptVariation(response: NextResponse): NextResponse {
  const values = new Set(
    (response.headers.get("Vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  values.add("Accept");
  response.headers.set("Vary", [...values].join(", "));
  return response;
}

function homeMarkdownResponse(): NextResponse {
  return new NextResponse(buildProgrammableHomeMarkdown(), {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "text/markdown; charset=utf-8",
      Link: '<https://programmable.market/>; rel="canonical"; type="text/html"',
      Vary: "Accept",
    },
  });
}

export function proxy(request: NextRequest) {
  if (isRetiredPredictionApi(request.nextUrl.pathname)) {
    return retiredPredictionApiResponse();
  }
  if (isRetiredPredictionPage(request.nextUrl.pathname)) {
    const destination = request.nextUrl.pathname.startsWith("/docs/")
      ? "/docs/tokens"
      : "/explore";
    return NextResponse.redirect(new URL(destination, request.url), 307);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return withAcceptVariation(NextResponse.next());
  }

  const representation = negotiatePageRepresentation(
    request.headers.get("Accept"),
  );
  if (representation === "not-acceptable") {
    return new NextResponse(
      "Not acceptable. Request text/html or text/markdown.",
      {
        status: 406,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          Vary: "Accept",
        },
      },
    );
  }
  if (representation === "markdown") {
    if (request.nextUrl.pathname === "/") {
      return homeMarkdownResponse();
    }
    const destination = MARKDOWN_DESTINATIONS.get(request.nextUrl.pathname);
    if (destination !== undefined) {
      return withAcceptVariation(
        NextResponse.rewrite(new URL(destination, request.url)),
      );
    }
  }
  return withAcceptVariation(NextResponse.next());
}

export const config = {
  matcher: [
    "/",
    "/docs/developers",
    "/markets/:path*",
    "/docs/tokens/prediction-markets",
    "/docs/models/prediction-markets",
    "/api/prediction/:path*",
  ],
};
