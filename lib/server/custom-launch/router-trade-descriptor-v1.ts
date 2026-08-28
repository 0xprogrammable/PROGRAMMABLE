import "server-only";

import {
  resolveRouterTradeAdapterV1 as resolveReviewedRouterTradeAdapterV1,
  type RouterTradeAdapterV1,
} from "../../custom-launch/router-trade-adapters-v1";
import type {
  CanonicalTokenExploreEntry,
  LaunchStampProvenanceV1,
} from "../../tokens";
import type { RouterCustomIdentitySnapshotV1 } from
  "../../alchemy/router-custom-public.server";
import type {
  FinalizedTradeAdapterDescriptorV1,
  FinalizedTradeAdapterRuntimeTargetV1,
} from "./finalized-trade-adapter-descriptor-v1";
import {
  ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1,
  ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1,
  type RouterCustomMetadataOverlayBindingV1,
  type RouterCustomMetadataOverlayV1,
} from "./finalized-custom-launch-metadata-feed-v1";
import { canonicalSha256 } from "../projection-target/hashing";

type SnapshotWithOptionalTradeMetadataV1 = RouterCustomIdentitySnapshotV1 &
  Readonly<{ metadataOverlay?: RouterCustomMetadataOverlayV1 }>;

function sameHex(left: unknown, right: unknown) {
  return typeof left === "string" && typeof right === "string"
    && left.toLowerCase() === right.toLowerCase();
}

function exactRuntimeTargetsV1(
  stamp: LaunchStampProvenanceV1,
  targets: readonly FinalizedTradeAdapterRuntimeTargetV1[],
) {
  const components = stamp.components.filter(
    ({ scope }) => scope === "exclusive",
  );
  if (components.length !== targets.length) return false;
  return targets.every((target) => {
    const matches = components.filter((component) =>
      component.kind === target.kind
      && sameHex(component.address, target.identity.value)
      && sameHex(component.runtimeCodeHash, target.runtimeCodeKeccak256)
      && component.exclusiveProof !== null
      && sameHex(component.exclusiveProof.launchId, stamp.launchId)
      && sameHex(component.exclusiveProof.stampHash, stamp.stampHash));
    return matches.length === 1;
  });
}

function bindingMatchesEntryV1(
  binding: RouterCustomMetadataOverlayBindingV1,
  entry: CanonicalTokenExploreEntry,
) {
  const stamp = entry.launchStampProvenance;
  return stamp?.kind === "custom-graph"
    && sameHex(binding.routerLaunchId, stamp.launchId)
    && sameHex(binding.router, stamp.routerAddress)
    && sameHex(binding.token, entry.tokenAddress)
    && sameHex(binding.hook, entry.hookAddress)
    && sameHex(binding.poolManager, stamp.poolManagerAddress)
    && sameHex(binding.poolId, entry.poolId);
}

function descriptorMatchesEntryV1(
  descriptor: FinalizedTradeAdapterDescriptorV1,
  entry: CanonicalTokenExploreEntry,
) {
  const stamp = entry.launchStampProvenance;
  const capability = descriptor.market.tradeCapability;
  if (
    stamp?.kind !== "custom-graph"
    || descriptor.status !== "verified"
    || descriptor.market.status !== "active"
    || descriptor.market.verification.status !== "verified"
    || descriptor.market.uniswapV4 === null
    || !sameHex(descriptor.baseAsset.identity.value, entry.tokenAddress)
    || descriptor.baseAsset.name !== entry.name
    || descriptor.baseAsset.symbol !== entry.symbol
    || descriptor.baseAsset.decimals !== entry.tokenDecimals
    || !sameHex(descriptor.market.uniswapV4.poolId, stamp.poolId)
    || !sameHex(
      descriptor.market.uniswapV4.poolManager.value,
      stamp.poolManagerAddress,
    )
    || !sameHex(capability.poolKey.poolId, stamp.poolId)
    || !sameHex(capability.poolKey.currency0.value, stamp.poolKey.currency0)
    || !sameHex(capability.poolKey.currency1.value, stamp.poolKey.currency1)
    || capability.poolKey.feeRaw !== String(stamp.poolKey.fee)
    || capability.poolKey.tickSpacing !== String(stamp.poolKey.tickSpacing)
    || !sameHex(capability.poolKey.hooks.value, stamp.poolKey.hooks)
    || !sameHex(stamp.poolKey.hooks, entry.hookAddress)
    || !exactRuntimeTargetsV1(stamp, descriptor.runtimeTargets)
  ) return false;
  return true;
}

function descriptorBindingForEntryV1(
  entry: CanonicalTokenExploreEntry,
  snapshot: SnapshotWithOptionalTradeMetadataV1 | null,
) {
  const overlay = snapshot?.metadataOverlay;
  if (
    !overlay
    || overlay.schemaVersion !== ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1
    || overlay.source !== ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1
    || overlay.routerIdentityCommitment !== snapshot.identityCommitment
    || overlay.metadataCommitment !== canonicalSha256(
      ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1,
      {
        source: overlay.source,
        generatedAt: overlay.generatedAt,
        routerIdentityCommitment: overlay.routerIdentityCommitment,
        appliedBindings: overlay.appliedBindings,
      },
    )
  ) return null;
  const matches = overlay.appliedBindings.filter((binding) =>
    binding.tradeAdapterDescriptor !== undefined
    && bindingMatchesEntryV1(binding, entry)
    && descriptorMatchesEntryV1(binding.tradeAdapterDescriptor, entry));
  return matches.length === 1 ? matches[0]! : null;
}

function descriptorAdapterV1(
  entry: CanonicalTokenExploreEntry,
  snapshot: SnapshotWithOptionalTradeMetadataV1 | null,
): RouterTradeAdapterV1 | null {
  const binding = descriptorBindingForEntryV1(entry, snapshot);
  const descriptor = binding?.tradeAdapterDescriptor;
  const stamp = entry.launchStampProvenance;
  if (!descriptor || stamp?.kind !== "custom-graph") return null;
  const tokenTarget = descriptor.runtimeTargets.find(
    ({ kind }) => kind === "token",
  );
  const hookTarget = descriptor.runtimeTargets.find(
    ({ kind }) => kind === "hook",
  );
  if (!tokenTarget || !hookTarget) return null;

  const project = Object.freeze({
    customProjectId: descriptor.projectId,
    markets: Object.freeze([Object.freeze({
      marketId: descriptor.market.marketId,
      kind: descriptor.market.kind,
      status: "active" as const,
      poolId: entry.poolId,
      baseAsset: descriptor.baseAsset,
      quoteAsset: descriptor.quoteAsset,
      tradeCapability: descriptor.market.tradeCapability,
    })]),
  });
  return Object.freeze({
    adapterId: descriptor.adapterId,
    projectId: descriptor.projectId,
    chainId: "1" as const,
    chainProfileId: descriptor.chainProfileId,
    chainProfileHash: descriptor.chainProfileHash,
    launchId: stamp.launchId,
    stampHash: stamp.stampHash,
    tokenAddress: entry.tokenAddress,
    tokenRuntimeCodeKeccak256: tokenTarget.runtimeCodeKeccak256,
    tokenRuntimeCodeSha256: tokenTarget.runtimeCodeSha256,
    hookAddress: entry.hookAddress,
    hookRuntimeCodeKeccak256: hookTarget.runtimeCodeKeccak256,
    hookRuntimeCodeSha256: hookTarget.runtimeCodeSha256,
    runtimeTargets: Object.freeze(descriptor.runtimeTargets.map((target) =>
      Object.freeze({
        label: target.targetId,
        address: target.identity.value,
        runtimeCodeKeccak256: target.runtimeCodeKeccak256,
        runtimeCodeSha256: target.runtimeCodeSha256,
      }))),
    sourceEvidence: null,
    executionEvidence: null,
    market: descriptor.market,
    project,
  });
}

export function resolveServerBoundRouterTradeAdapterV1(
  entry: CanonicalTokenExploreEntry,
  snapshot: SnapshotWithOptionalTradeMetadataV1 | null,
): RouterTradeAdapterV1 | null {
  return resolveReviewedRouterTradeAdapterV1(entry)
    ?? descriptorAdapterV1(entry, snapshot);
}

export function routerTradeProjectForServerBoundEntryV1(
  entry: CanonicalTokenExploreEntry,
  snapshot: SnapshotWithOptionalTradeMetadataV1 | null,
) {
  return resolveServerBoundRouterTradeAdapterV1(entry, snapshot)?.project
    ?? null;
}

export function findServerBoundRouterTradeAdapterV1(
  snapshot: SnapshotWithOptionalTradeMetadataV1,
  input: Readonly<{ projectId: string }>,
) {
  const matches = snapshot.entries.flatMap((entry) => {
    const adapter = resolveServerBoundRouterTradeAdapterV1(entry, snapshot);
    return adapter !== null
        && adapter.projectId === input.projectId
      ? [adapter]
      : [];
  });
  return matches.length === 1 ? matches[0]! : null;
}
