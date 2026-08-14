import { GET as getToken } from "../tokens/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return getToken();
}
