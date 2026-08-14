import {
  handleProductionApprovalV3ProjectionTargetV1,
} from "@/lib/server/projection-target/approval-v3-target";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export const GET = handleProductionApprovalV3ProjectionTargetV1;
export const PUT = handleProductionApprovalV3ProjectionTargetV1;
export const POST = handleProductionApprovalV3ProjectionTargetV1;
export const PATCH = handleProductionApprovalV3ProjectionTargetV1;
export const DELETE = handleProductionApprovalV3ProjectionTargetV1;
export const HEAD = handleProductionApprovalV3ProjectionTargetV1;
export const OPTIONS = handleProductionApprovalV3ProjectionTargetV1;
