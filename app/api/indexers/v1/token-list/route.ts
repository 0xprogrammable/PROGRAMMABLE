import { NextResponse } from "next/server";

import {
  RETIRED_INDEXER_HEADERS,
  RETIRED_INDEXER_RESPONSE,
} from "../response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(RETIRED_INDEXER_RESPONSE, {
    status: 410,
    headers: RETIRED_INDEXER_HEADERS,
  });
}
