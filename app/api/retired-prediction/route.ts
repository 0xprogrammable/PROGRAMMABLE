import { NextResponse } from "next/server";

function retiredPredictionResponse(): NextResponse {
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

export const GET = retiredPredictionResponse;
export const HEAD = retiredPredictionResponse;
export const POST = retiredPredictionResponse;
export const PUT = retiredPredictionResponse;
export const PATCH = retiredPredictionResponse;
export const DELETE = retiredPredictionResponse;
export const OPTIONS = retiredPredictionResponse;
