import {
  getProductionClassicV4CanaryAuthorizationHandlerV1,
} from "@/lib/server/custom-launch/classic-v4-canary-authorization-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

async function handle(request: Request) {
  return getProductionClassicV4CanaryAuthorizationHandlerV1()(request);
}

export const DELETE = handle;
export const GET = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const PATCH = handle;
export const POST = handle;
export const PUT = handle;
