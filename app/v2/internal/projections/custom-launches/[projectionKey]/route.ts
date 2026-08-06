import {
  handleProductionWebsiteProjectionTargetRequestV1,
} from "@/lib/server/projection-target/website-target";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export const GET = handleProductionWebsiteProjectionTargetRequestV1;
export const PUT = handleProductionWebsiteProjectionTargetRequestV1;
export const POST = handleProductionWebsiteProjectionTargetRequestV1;
export const PATCH = handleProductionWebsiteProjectionTargetRequestV1;
export const DELETE = handleProductionWebsiteProjectionTargetRequestV1;
export const HEAD = handleProductionWebsiteProjectionTargetRequestV1;
export const OPTIONS = handleProductionWebsiteProjectionTargetRequestV1;
