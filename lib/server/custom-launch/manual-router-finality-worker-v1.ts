import "server-only";

import { discoverManualRouterPendingFinalityV1 } from
  "@/lib/server/custom-launch/manual-router-discovery-v1";
import type { ManualRouterFinalityServiceV1 } from
  "@/lib/server/custom-launch/manual-router-finality-v1";
import {
  resolveManualRouterFinalityPolicyV1,
  type ManualRouterFinalityPolicyV1,
} from "@/lib/server/custom-launch/manual-router-finality-policy-v1";
import { getProductionManualRouterWebsiteV1 } from
  "@/lib/server/custom-launch/manual-router-production-v1";
import { ManualRouterServiceErrorV1 } from
  "@/lib/server/custom-launch/manual-router-service-v1";
import type { ManualRouterPrivateBlobStoreV1 } from
  "@/lib/server/custom-launch/manual-router-store-v1";

export type ManualRouterFinalityWorkerResultV1 = Readonly<{
  schemaVersion: "programmable.manual-router-finality-worker-result.v1";
  status: "disabled" | "completed";
  discovered: number;
  processed: number;
  finalized: number;
  reverted: number;
  dropped: number;
  pending: number;
}>;

export async function runConfiguredManualRouterFinalityWorkerV1(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ManualRouterFinalityWorkerResultV1> {
  if (
    env.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED === undefined
    || env.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED === "false"
  ) return disabledResult();
  if (env.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED !== "true") {
    throw new TypeError("manual Router finality invalidRuntimeConfig");
  }
  const policy = resolveManualRouterFinalityPolicyV1(env);
  if (policy.status === "disabled") {
    throw new TypeError("manual Router finality activation changed during resolution");
  }
  const production = getProductionManualRouterWebsiteV1();
  return runManualRouterFinalityWorkerV1({
    store: production.store,
    finalityService: production.finalityService,
    policy,
  });
}

export async function runManualRouterFinalityWorkerV1(input: Readonly<{
  store: ManualRouterPrivateBlobStoreV1;
  finalityService: ManualRouterFinalityServiceV1;
  policy: Extract<ManualRouterFinalityPolicyV1, { status: "enabled" }>;
}>): Promise<ManualRouterFinalityWorkerResultV1> {
  const discovered = await discoverManualRouterPendingFinalityV1({
    store: input.store,
  });
  const candidates = discovered.slice(0, input.policy.maximumCandidates);
  const counts = { finalized: 0, reverted: 0, dropped: 0, pending: 0 };
  const failures: unknown[] = [];
  for (let offset = 0; offset < candidates.length; offset += input.policy.concurrency) {
    const batch = candidates.slice(offset, offset + input.policy.concurrency);
    const settled = await Promise.allSettled(batch.map(({ pointer }) =>
      input.finalityService.finalizeDiscoveredPointer({ pointer })));
    for (const result of settled) {
      if (result.status === "fulfilled") {
        const disposition = result.value.disposition;
        if (
          disposition === "finalized"
          || disposition === "reverted"
          || disposition === "dropped"
        ) counts[disposition] += 1;
        else failures.push(new TypeError("manual Router finality disposition is invalid"));
      } else if (
        result.reason instanceof ManualRouterServiceErrorV1
        && result.reason.code === "transaction_not_finalized"
      ) counts.pending += 1;
      else failures.push(result.reason);
    }
  }
  if (failures.length > 0) {
    throw new TypeError("manual Router scheduled finality failed closed");
  }
  return Object.freeze({
    schemaVersion: "programmable.manual-router-finality-worker-result.v1",
    status: "completed",
    discovered: discovered.length,
    processed: candidates.length,
    ...counts,
  });
}

function disabledResult(): ManualRouterFinalityWorkerResultV1 {
  return Object.freeze({
    schemaVersion: "programmable.manual-router-finality-worker-result.v1",
    status: "disabled",
    discovered: 0,
    processed: 0,
    finalized: 0,
    reverted: 0,
    dropped: 0,
    pending: 0,
  });
}
