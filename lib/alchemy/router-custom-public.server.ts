import "server-only";

import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import type {
  CanonicalTokenExploreEntry,
  ExploreEntry,
} from "../tokens";
import type { CreatorProfile, ExploreReadModel } from "../onchain/types";
import { readAlchemyExploreModel } from "./explore.server";
import { LAUNCH_STAMP_FINALITY_CONFIRMATIONS } from "./launch-stamp.server";
import { suppressRouterBoundCustomProjectDuplicates } from
  "./router-custom-collision";

export const ROUTER_CUSTOM_LAUNCH_SOURCE =
  "canonical-launch-stamp-router" as const;
export const ROUTER_CUSTOM_FINALITY_CONFIRMATIONS = Number(
  LAUNCH_STAMP_FINALITY_CONFIRMATIONS,
);

export type PublicLaunchSourceV1 =
  | "envio-classic-v3"
  | "envio-classic-v3+registry.custom-launched"
  | "envio-classic-v3+canonical-launch-stamp-router"
  | "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router";

type RouterCustomReadOptionsV1 = Readonly<{
  deadlineMs?: number;
  signal?: AbortSignal;
}>;

function abortError() {
  return new DOMException("Router Custom read aborted", "AbortError");
}

async function withinReadBoundary<T>(
  operation: () => Promise<T>,
  options: RouterCustomReadOptionsV1,
): Promise<T> {
  const signals = [options.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (options.deadlineMs !== undefined) {
    const remaining = Math.max(0, options.deadlineMs - Date.now());
    signals.push(AbortSignal.timeout(remaining));
  }
  if (signals.length === 0) return operation();

  const signal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
  if (signal.aborted) throw abortError();

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    operation().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function routerCustomExploreEntriesFromModelV1(
  model: ExploreReadModel,
): readonly CanonicalTokenExploreEntry[] {
  if (model.status !== "ready") {
    throw new Error("Router Custom launch model is not ready");
  }

  return Object.freeze(
    model.tokens
      .filter(
        (token) => token.launchStampProvenance?.kind === "custom-graph",
      )
      .map(canonicalTokenExploreEntryV1),
  );
}

export async function readFinalizedRouterCustomExploreEntriesV1(
  options: RouterCustomReadOptionsV1 = {},
) {
  const model = await withinReadBoundary(readAlchemyExploreModel, options);
  return routerCustomExploreEntriesFromModelV1(model);
}

export function routerCustomEntriesAtOrBeforeBlockV1(
  entries: readonly CanonicalTokenExploreEntry[],
  blockNumber: string,
) {
  const boundary = BigInt(blockNumber);
  return Object.freeze(
    entries.filter((entry) => {
      requireRouterCustomEntryV1(entry);
      return BigInt(entry.launchStampProvenance!.finalizedAtBlockNumber) <= boundary;
    }),
  );
}

function requireRouterCustomEntryV1(entry: CanonicalTokenExploreEntry) {
  if (
    entry.exploreKind !== "token" ||
    entry.launchModel !== "custom-graph" ||
    entry.launchCategoryProvenance.category !== "custom" ||
    entry.launchCategoryProvenance.source !== ROUTER_CUSTOM_LAUNCH_SOURCE ||
    entry.launchStampProvenance?.kind !== "custom-graph"
  ) {
    throw new Error("Router Custom public entry has invalid provenance");
  }
}

export function mergeRouterCustomExploreEntriesV1(
  existing: readonly ExploreEntry[],
  routerEntries: readonly CanonicalTokenExploreEntry[],
) {
  const projects = existing.filter(
    (entry) => entry.exploreKind === "custom-project",
  );
  const retainedProjects = new Set(
    suppressRouterBoundCustomProjectDuplicates(routerEntries, projects)
      .map((project) => project.id),
  );
  const retainedExisting = existing.filter(
    (entry) => entry.exploreKind !== "custom-project" ||
      retainedProjects.has(entry.id),
  );
  const ids = new Set(retainedExisting.map((entry) => entry.id));
  const tokenAddresses = new Set(
    retainedExisting.flatMap((entry) =>
      entry.tokenAddress ? [entry.tokenAddress.toLowerCase()] : [],
    ),
  );
  const additions: CanonicalTokenExploreEntry[] = [];

  for (const entry of routerEntries) {
    requireRouterCustomEntryV1(entry);
    const tokenAddress = entry.tokenAddress.toLowerCase();
    if (ids.has(entry.id) || tokenAddresses.has(tokenAddress)) continue;
    ids.add(entry.id);
    tokenAddresses.add(tokenAddress);
    additions.push(entry);
  }

  return Object.freeze([...retainedExisting, ...additions]);
}

export function publicLaunchSourceV1(input: Readonly<{
  registryCustomCurrent: boolean;
  routerCustomCurrent: boolean;
}>): PublicLaunchSourceV1 {
  if (input.registryCustomCurrent && input.routerCustomCurrent) {
    return "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router";
  }
  if (input.registryCustomCurrent) {
    return "envio-classic-v3+registry.custom-launched";
  }
  if (input.routerCustomCurrent) {
    return "envio-classic-v3+canonical-launch-stamp-router";
  }
  return "envio-classic-v3";
}

export function mergeRouterCustomCreatorProfileV1(
  profile: CreatorProfile,
  account: `0x${string}`,
  routerEntries: readonly CanonicalTokenExploreEntry[],
): CreatorProfile {
  if (profile.status !== "ready" || profile.snapshot?.chainId !== 1) {
    return profile;
  }

  const snapshotBlock = BigInt(profile.snapshot.blockNumber);
  const tokenAddresses = new Set(
    profile.tokens.map((token) => token.tokenAddress.toLowerCase()),
  );
  const additions = routerEntries.filter((entry) => {
    requireRouterCustomEntryV1(entry);
    const stamp = entry.launchStampProvenance!;
    const tokenAddress = entry.tokenAddress.toLowerCase();
    if (
      entry.creatorAddress?.toLowerCase() !== account.toLowerCase() ||
      BigInt(stamp.finalizedAtBlockNumber) > snapshotBlock ||
      tokenAddresses.has(tokenAddress)
    ) {
      return false;
    }
    tokenAddresses.add(tokenAddress);
    return true;
  });

  return additions.length === 0
    ? profile
    : { ...profile, tokens: [...profile.tokens, ...additions] };
}
