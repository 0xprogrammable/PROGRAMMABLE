import { handleProductionCustomLaunchDirectoryReadV1 } from "@/lib/server/custom-launch/project-read-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export const GET = handleProductionCustomLaunchDirectoryReadV1;
