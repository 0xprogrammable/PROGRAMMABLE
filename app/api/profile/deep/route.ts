import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function closedDeepProfileResponse() {
  return NextResponse.json(
    {
      code: "deep_profile_closed",
      error: "The Deep profile endpoint is not available",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function GET() {
  return closedDeepProfileResponse();
}

export function POST() {
  return closedDeepProfileResponse();
}
