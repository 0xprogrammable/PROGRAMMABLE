import "server-only";

import type {
  AuthenticatedCustomLaunchProjectV2,
  DiscoverableLaunchAssetV2,
} from "../../custom-launch/contract-v2";
import type {
  CustomProjectExploreEntry,
  TokenLink,
} from "../../tokens";
import { getProductionWebsiteRegistryCustomPublicReadTargetV1 } from
  "../projection-target/website-target";
import { isCustomLaunchRegistryPublicReadEnabled } from "./public-readiness";
import { withGenesisCanaryRegistryCustomStoreV1 } from
  "./genesis-canary-public-v1";
import type { VerifiedRegistryCustomLaunchPublicV1 } from
  "./registry-public-store-v1";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HASH32 = /^0x[0-9a-fA-F]{64}$/u;

export function customLaunchProjectToExploreEntryV1(
  verified: Readonly<VerifiedRegistryCustomLaunchPublicV1>,
): CustomProjectExploreEntry {
  const project: Readonly<AuthenticatedCustomLaunchProjectV2> =
    verified.record.project;
  const primaryToken = project.discoverableAssets.find(
    (asset) =>
      asset.role === "primary-token"
      && asset.provenance.kind === "launch-produced",
  );
  const metadata = primaryToken?.onchainMetadata?.status === "available"
    ? primaryToken.onchainMetadata
    : null;
  const tokenAddress = primaryTokenAddress(project.chainId, primaryToken);
  const presentation = project.presentation;
  const imageUrl = safeHttpsUrl(presentation?.image?.uri);
  const links = publicExploreLinks(presentation?.links ?? []);
  const assetsById = new Map(project.discoverableAssets.map((asset) => [
    asset.assetId,
    asset,
  ]));
  const markets = project.discoverableMarkets.map((market) => {
    const baseAsset = assetsById.get(market.baseAssetId);
    const quoteAsset = assetsById.get(market.quoteAssetId);
    if (baseAsset === undefined || quoteAsset === undefined) {
      throw new TypeError("Custom market references an unavailable asset");
    }
    const poolId = market.uniswapV4?.poolId;
    return Object.freeze({
      marketId: market.marketId,
      kind: market.kind,
      status: market.status,
      ...(typeof poolId === "string" && HASH32.test(poolId)
        ? { poolId: poolId.toLowerCase() as `0x${string}` }
        : {}),
      baseAsset: publicExploreAsset(baseAsset),
      quoteAsset: publicExploreAsset(quoteAsset),
      ...(market.tradeCapability === undefined
        ? {}
        : { tradeCapability: market.tradeCapability }),
    });
  });

  return Object.freeze({
    exploreKind: "custom-project" as const,
    id: `custom:${project.projectId}`,
    name: metadata?.name ?? project.modelId,
    ...(metadata === null ? {} : { symbol: metadata.symbol }),
    ...(presentation?.description.trim()
      ? { description: presentation.description.trim() }
      : {}),
    ...(imageUrl === null ? {} : { imageUrl }),
    links,
    launchedAt: project.launchedAt,
    finalizedAt: project.finalizedAt,
    chainId: project.chainId,
    modelId: project.modelId,
    customProjectId: project.projectId,
    customLaunchId: project.launchId,
    launchingWallet: project.launchingWallet,
    postLaunchAuthorityInventory: project.postLaunchAuthorityInventory,
    postLaunchAuthorityInventoryHash: project.postLaunchAuthorityInventoryHash,
    markets: Object.freeze(markets),
    ...(tokenAddress === null ? {} : { tokenAddress }),
    ...(metadata === null ? {} : { tokenDecimals: metadata.decimals }),
    launchCategoryProvenance: Object.freeze({
      schemaVersion: "programmable.explore-launch-category-provenance.v1" as const,
      category: "custom" as const,
      source: "registry.custom-launched" as const,
      projectId: project.projectId,
      launchId: project.launchId,
      sourceRecordBindingHash: project.sourceRecordBindingHash,
      finalizedLaunchBindingHash: project.finalizedLaunchBindingHash,
      registryAddress: verified.record.registry.registryAddress,
      registryStartBlock: verified.record.registry.startBlock,
      transactionHash: verified.record.event.transactionHash,
      blockHash: verified.record.event.blockHash,
      blockNumber: verified.record.event.blockNumber,
      transactionIndex: verified.record.event.transactionIndex,
      logIndex: verified.record.event.logIndex,
      configurationHash: verified.record.configurationHash,
    }),
  });
}

function publicExploreAsset(asset: Readonly<DiscoverableLaunchAssetV2>) {
  const metadata = asset.onchainMetadata?.status === "available"
    ? asset.onchainMetadata
    : null;
  return Object.freeze({
    assetId: asset.assetId,
    identity: asset.identity,
    ...(metadata === null
      ? {}
      : {
          name: metadata.name,
          symbol: metadata.symbol,
          decimals: metadata.decimals,
        }),
  });
}

export async function readProductionCustomExploreDirectoryV1(
  signal: AbortSignal,
): Promise<readonly CustomProjectExploreEntry[]> {
  if (!isCustomLaunchRegistryPublicReadEnabled()) return Object.freeze([]);
  const target = getProductionWebsiteRegistryCustomPublicReadTargetV1();
  await target.assertProductionReadiness();
  const records = await withGenesisCanaryRegistryCustomStoreV1(
    target.store,
  )
    .findVerifiedRegistryCustomLaunchesPublic({ signal });
  return Object.freeze(records.map(customLaunchProjectToExploreEntryV1));
}

function primaryTokenAddress(
  chainId: string,
  asset: Readonly<DiscoverableLaunchAssetV2> | undefined,
): `0x${string}` | null {
  if (asset === undefined || !ADDRESS.test(asset.identity.value)) return null;
  if (
    asset.identity.namespace !== `eip155:${chainId}`
    && asset.identity.namespace !== `eip155:${chainId}:erc20`
  ) return null;
  return asset.identity.value.toLowerCase() as `0x${string}`;
}

function safeHttpsUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.hostname !== ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function publicExploreLinks(
  links: readonly Readonly<{ kind: string; uri: string }>[],
): readonly TokenLink[] {
  const supported = new Set<TokenLink["kind"]>(["website", "x", "telegram"]);
  const seen = new Set<TokenLink["kind"]>();
  const result: TokenLink[] = [];
  for (const link of links) {
    if (!supported.has(link.kind as TokenLink["kind"])) continue;
    const kind = link.kind as TokenLink["kind"];
    if (seen.has(kind)) continue;
    const url = safeHttpsUrl(link.uri);
    if (url === null) continue;
    seen.add(kind);
    result.push(Object.freeze({ kind, url }));
  }
  return Object.freeze(result);
}
