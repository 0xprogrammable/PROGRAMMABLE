import {
  createReleasedExactShardsSuccessorPublicReadHandlersV1,
} from "@/lib/server/custom-launch/exact-shards-successor-release-v1";
import type {
  ExactShardsPublicRecordV1,
  ExactShardsSuccessorPublicReadStoreV1,
} from "@/lib/server/custom-launch/exact-shards-successor-projection-v1";

const failClosedUnconfiguredStore: ExactShardsSuccessorPublicReadStoreV1 =
  Object.freeze({
    sourceLane: "registry.exact-shards-v2" as const,
    async findByWebsiteProjectId(): Promise<ExactShardsPublicRecordV1 | null> {
      throw new TypeError("ExactShards successor store is not configured");
    },
    async findPublic(): Promise<readonly ExactShardsPublicRecordV1[]> {
      throw new TypeError("ExactShards successor store is not configured");
    },
  });

const handlers = createReleasedExactShardsSuccessorPublicReadHandlersV1(
  failClosedUnconfiguredStore,
);

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<Readonly<{ projectId: string }>> }>,
): Promise<Response> {
  const { projectId } = await context.params;
  return handlers.detail(request, projectId);
}
