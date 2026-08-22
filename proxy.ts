import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { negotiatePageRepresentation } from "@/lib/content-negotiation";

const MARKDOWN_DESTINATIONS = new Map([
  ["/", "/index.md"],
  ["/docs/developers", "/docs/developers.md"],
]);

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

export function proxy(request: NextRequest) {
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
  matcher: ["/", "/docs/developers"],
};
