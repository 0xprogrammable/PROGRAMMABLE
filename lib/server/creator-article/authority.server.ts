import "server-only";

import { getAddress, isAddress } from "viem";

import { readFinalizedRouterCustomExploreEntriesV1 } from
  "../../alchemy/router-custom-public.server";
import { readEnvioClassicV3CatalogV1 } from
  "../../market-data/envio-classic-v3-catalog.server";
import {
  isLaunchStampProvenanceV1,
  type ExploreEntry,
} from "../../tokens";
import type { LaunchPartnerAttributionV1 } from
  "../../launch-partner-attribution";
import { readProductionCustomExploreDirectoryV1 } from
  "../custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../custom-launch/public-readiness";
import type { AuthenticatedWalletPrincipalV1 } from "./wallet-principal.server";

const MAIN_TOKEN = "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";

export type CreatorArticleAuthorityV1 = Readonly<{
  chainId: 1;
  tokenAddress: `0x${string}`;
  creatorAddress: `0x${string}`;
  source:
    | "envio-classic-v3"
    | "registry.custom-launched"
    | "canonical-launch-stamp-router"
    | "official-main-token";
  name: string;
  symbol: string | null;
  imageUrl: string | null;
  partnerAttribution?: LaunchPartnerAttributionV1;
  hasArticle?: boolean;
}>;

export interface CreatorArticleAuthorityReaderV1 {
  read(signal: AbortSignal): Promise<readonly CreatorArticleAuthorityV1[]>;
}

export function createCreatorArticleAuthorityReaderV1(input: Readonly<{
  readClassic(signal: AbortSignal): Promise<readonly ExploreEntry[]>;
  readCustom(signal: AbortSignal): Promise<readonly ExploreEntry[]>;
  readRouter(signal: AbortSignal): Promise<readonly ExploreEntry[]>;
}>): CreatorArticleAuthorityReaderV1 {
  return Object.freeze({
    async read(signal: AbortSignal) {
      const [classic, custom, router] = await Promise.all([
        input.readClassic(signal).catch(() => Object.freeze([])),
        input.readCustom(signal).catch(() => Object.freeze([])),
        input.readRouter(signal).catch(() => Object.freeze([])),
      ]);
      const projects: CreatorArticleAuthorityV1[] = [];
      const seen = new Set<string>();
      const entries = [
        ...classic.map((entry) => Object.freeze({ lane: "classic" as const, entry })),
        ...custom.map((entry) => Object.freeze({ lane: "custom" as const, entry })),
        ...router.map((entry) => Object.freeze({ lane: "router" as const, entry })),
      ];
      for (const { lane, entry } of entries) {
        if (!entry.tokenAddress || !isAddress(entry.tokenAddress)) continue;
        const tokenAddress = getAddress(entry.tokenAddress);
        let creatorAddress: `0x${string}` | null = null;
        let source: CreatorArticleAuthorityV1["source"] | null = null;
        if (lane === "classic" && entry.exploreKind === "token") {
          if (!entry.creatorAddress || !isAddress(entry.creatorAddress)) continue;
          creatorAddress = getAddress(entry.creatorAddress);
          source = tokenAddress.toLowerCase() === MAIN_TOKEN
            ? "official-main-token"
            : entry.launchModel === "classic"
                && entry.launchModelVersion === "classic-v3"
              ? "envio-classic-v3"
              : null;
        } else if (lane === "custom" && entry.exploreKind === "custom-project") {
          if (
            entry.chainId !== "1"
            || entry.launchingWallet.namespace !== "eip155:1"
            || !isAddress(entry.launchingWallet.value)
          ) continue;
          creatorAddress = getAddress(entry.launchingWallet.value);
          source = "registry.custom-launched";
        } else if (
          lane === "router"
          && entry.exploreKind === "token"
          && entry.launchModel === "custom-graph"
          && entry.launchModelVersion === "programmable-launch-stamp-router-v1"
          && entry.launchCategoryProvenance.category === "custom"
          && entry.launchCategoryProvenance.source ===
            "canonical-launch-stamp-router"
          && entry.launchStampProvenance?.kind === "custom-graph"
          && isLaunchStampProvenanceV1(entry.launchStampProvenance, {
            chainId: 1,
            tokenAddress,
            hookAddress: entry.hookAddress,
            poolId: entry.poolId,
          })
        ) {
          creatorAddress = getAddress(entry.launchStampProvenance.launchWallet);
          source = "canonical-launch-stamp-router";
        }
        if (source === null || creatorAddress === null) continue;
        const key = tokenAddress.toLowerCase();
        if (seen.has(key)) throw new TypeError("Creator article token authority is ambiguous");
        seen.add(key);
        projects.push(Object.freeze({
          chainId: 1 as const,
          tokenAddress,
          creatorAddress,
          source,
          name: entry.name,
          symbol: entry.symbol ?? null,
          imageUrl: entry.imageUrl ?? null,
          ...(entry.partnerAttribution
            ? { partnerAttribution: entry.partnerAttribution }
            : {}),
        }));
      }
      return Object.freeze(projects.sort((left, right) =>
        left.tokenAddress.toLowerCase().localeCompare(right.tokenAddress.toLowerCase())));
    },
  });
}

export function createProductionCreatorArticleAuthorityReaderV1():
CreatorArticleAuthorityReaderV1 {
  return createCreatorArticleAuthorityReaderV1({
    async readClassic(signal) {
      const catalog = await readEnvioClassicV3CatalogV1({
        signal,
        deadlineMs: Date.now() + 7_500,
      });
      return catalog.entries;
    },
    async readCustom(signal) {
      if (!isCustomLaunchRegistryPublicReadEnabled()) return Object.freeze([]);
      return readProductionCustomExploreDirectoryV1(signal);
    },
    async readRouter(signal) {
      return readFinalizedRouterCustomExploreEntriesV1({
        signal,
        deadlineMs: Date.now() + 7_500,
      });
    },
  });
}

export async function requireCreatorArticleAuthorityV1(input: Readonly<{
  reader: CreatorArticleAuthorityReaderV1;
  principal: AuthenticatedWalletPrincipalV1;
  tokenAddress: string;
  signal: AbortSignal;
}>): Promise<CreatorArticleAuthorityV1> {
  if (!isAddress(input.tokenAddress)) throw new CreatorArticleAuthorityErrorV1(400, "invalid_token");
  const tokenAddress = getAddress(input.tokenAddress);
  const project = (await input.reader.read(input.signal)).find(
    (candidate) => candidate.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
  );
  if (!project) throw new CreatorArticleAuthorityErrorV1(404, "project_not_found");
  const wallets = new Set(input.principal.wallets.map((wallet) => wallet.toLowerCase()));
  if (!wallets.has(project.creatorAddress.toLowerCase())) {
    throw new CreatorArticleAuthorityErrorV1(403, "creator_wallet_required");
  }
  return project;
}

export async function listCreatorArticleAuthoritiesV1(input: Readonly<{
  reader: CreatorArticleAuthorityReaderV1;
  principal: AuthenticatedWalletPrincipalV1;
  signal: AbortSignal;
}>) {
  const wallets = new Set(input.principal.wallets.map((wallet) => wallet.toLowerCase()));
  return Object.freeze((await input.reader.read(input.signal)).filter(
    (project) => wallets.has(project.creatorAddress.toLowerCase()),
  ));
}

export class CreatorArticleAuthorityErrorV1 extends Error {
  constructor(readonly status: 400 | 403 | 404, readonly code: string) {
    super(code);
    this.name = "CreatorArticleAuthorityErrorV1";
  }
}
