import "server-only";

import { keccak256, toBytes } from "viem";

import {
  canonicalizeFingerprintJson,
  type CanonicalJsonValue,
} from "./canonical-fingerprint";
import { canonicalBytes32, type HexBytes32 } from "./codecs";
import { invalidInput, validationError } from "./errors";
import type { ReconcilerPreParityContract } from "./reconciler-preparity";

export const RECONCILER_CORPUS_PARTITION_SIZE = 128;
export const RECONCILER_CORPUS_MAXIMUM_TOTAL_COUNT = 10_000;
export const RECONCILER_CORPUS_PARTITION_VERSION =
  "reconciler-corpus-partition-v1";
export const RECONCILER_ENTITLEMENT_PARTITION_VERSION =
  "reconciler-entitlement-partition-v1";

export type ReconcilerCorpusIdentity = Readonly<{
  tokenAddress: string;
  poolId: HexBytes32;
  launchTransactionHash: HexBytes32;
  launchBlockNumber: string;
  launchTransactionIndex: number;
  launchLogIndex: number;
}>;

export type ReconcilerCorpusPage = Readonly<{
  version: typeof RECONCILER_CORPUS_PARTITION_VERSION;
  manifestCommitment: HexBytes32;
  pageCommitment: HexBytes32;
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  startIndex: number;
  endIndexExclusive: number;
  continuation: HexBytes32 | null;
  identities: readonly ReconcilerCorpusIdentity[];
}>;

export type ReconcilerCorpusManifest = Readonly<{
  version: typeof RECONCILER_CORPUS_PARTITION_VERSION;
  manifestCommitment: HexBytes32;
  pageSize: number;
  totalCount: number;
  pageCount: number;
  pages: readonly ReconcilerCorpusPage[];
}>;

function commitment(domain: string, value: CanonicalJsonValue): HexBytes32 {
  return keccak256(toBytes(
    `programmable:${domain}:v1\0${canonicalizeFingerprintJson(value)}`,
  ));
}

function canonicalIdentity(
  value: ReconcilerCorpusIdentity,
  operation: string,
): ReconcilerCorpusIdentity {
  if (
    !/^0x[0-9a-f]{40}$/u.test(value.tokenAddress) ||
    !/^(0|[1-9][0-9]*)$/u.test(value.launchBlockNumber) ||
    !Number.isSafeInteger(value.launchTransactionIndex) ||
    value.launchTransactionIndex < 0 ||
    !Number.isSafeInteger(value.launchLogIndex) ||
    value.launchLogIndex < 0
  ) {
    throw validationError("config", operation);
  }
  return Object.freeze({
    tokenAddress: value.tokenAddress,
    poolId: canonicalBytes32(value.poolId),
    launchTransactionHash: canonicalBytes32(value.launchTransactionHash),
    launchBlockNumber: value.launchBlockNumber,
    launchTransactionIndex: value.launchTransactionIndex,
    launchLogIndex: value.launchLogIndex,
  });
}

function identityJson(value: ReconcilerCorpusIdentity): CanonicalJsonValue {
  return {
    tokenAddress: value.tokenAddress,
    poolId: value.poolId,
    launchTransactionHash: value.launchTransactionHash,
    launchBlockNumber: value.launchBlockNumber,
    launchTransactionIndex: value.launchTransactionIndex,
    launchLogIndex: value.launchLogIndex,
  };
}

function projectedLaunchKeys(
  currentEntities: CanonicalJsonValue,
): ReadonlySet<string> {
  if (!Array.isArray(currentEntities)) {
    throw validationError("config", "reconciler-corpus-current-entities");
  }
  const keys = new Set<string>();
  for (const entity of currentEntities) {
    if (entity === null || Array.isArray(entity) || typeof entity !== "object") {
      throw validationError("config", "reconciler-corpus-current-entity");
    }
    if (entity.entityKind !== "launch") continue;
    if (
      typeof entity.entityKey !== "string" ||
      !/^0x[0-9a-f]{40}$/u.test(entity.entityKey) ||
      keys.has(entity.entityKey)
    ) {
      throw validationError("config", "reconciler-corpus-current-launch");
    }
    keys.add(entity.entityKey);
  }
  return keys;
}

function continuationCommitment(
  manifestCommitment: HexBytes32,
  nextPageIndex: number,
): HexBytes32 {
  return commitment("reconciler-corpus-continuation", {
    manifestCommitment,
    nextPageIndex,
  });
}

function pageCommitment(input: Readonly<{
  manifestCommitment: HexBytes32;
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  startIndex: number;
  endIndexExclusive: number;
  continuation: HexBytes32 | null;
  identities: readonly ReconcilerCorpusIdentity[];
}>): HexBytes32 {
  return commitment("reconciler-corpus-page", {
    manifestCommitment: input.manifestCommitment,
    pageIndex: input.pageIndex,
    pageCount: input.pageCount,
    pageSize: input.pageSize,
    totalCount: input.totalCount,
    startIndex: input.startIndex,
    endIndexExclusive: input.endIndexExclusive,
    continuation: input.continuation,
    identities: input.identities.map(identityJson),
  });
}

export function createReconcilerCorpusManifest(input: Readonly<{
  contract: ReconcilerPreParityContract;
  identities: readonly ReconcilerCorpusIdentity[];
  pageSize?: number;
}>): ReconcilerCorpusManifest {
  const pageSize = input.pageSize ?? RECONCILER_CORPUS_PARTITION_SIZE;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > RECONCILER_CORPUS_PARTITION_SIZE
  ) {
    throw invalidInput("config", "reconciler-corpus-page-size");
  }
  if (
    !Array.isArray(input.identities) ||
    input.identities.length < 1 ||
    input.identities.length > RECONCILER_CORPUS_MAXIMUM_TOTAL_COUNT
  ) {
    throw validationError("config", "reconciler-corpus-cardinality");
  }
  const identities = Object.freeze(input.identities.map((identity) =>
    canonicalIdentity(identity, "reconciler-corpus-identity")
  ));
  const uniqueTokens = new Set(identities.map(({ tokenAddress }) => tokenAddress));
  const uniquePools = new Set(identities.map(({ poolId }) => poolId));
  const projectedLaunches = projectedLaunchKeys(input.contract.currentEntities);
  if (
    uniqueTokens.size !== identities.length ||
    uniquePools.size !== identities.length ||
    projectedLaunches.size !== identities.length ||
    [...uniqueTokens].some((tokenAddress) => !projectedLaunches.has(tokenAddress))
  ) {
    throw validationError("config", "reconciler-corpus-cardinality");
  }

  const pageCount = Math.ceil(identities.length / pageSize);
  const manifestCommitment = commitment("reconciler-corpus-manifest", {
    version: RECONCILER_CORPUS_PARTITION_VERSION,
    chainId: input.contract.chainId,
    releaseId: input.contract.releaseId,
    modelId: input.contract.modelId,
    sourceGroup: input.contract.sourceGroup,
    projectorVersion: input.contract.projectorVersion,
    epochId: input.contract.epochId,
    pointerGeneration: input.contract.pointerGeneration,
    checkpointId: input.contract.checkpointId,
    checkpointGeneration: input.contract.checkpointGeneration,
    reorgGeneration: input.contract.reorgGeneration,
    checkpointBlockNumber: input.contract.checkpointBlockNumber,
    checkpointBlockHash: input.contract.checkpointBlockHash,
    routeKeys: [...input.contract.routeKeys],
    routeContract: input.contract.routeContract,
    projectionContract: input.contract.projectionContract,
    currentEntities: input.contract.currentEntities,
    pageSize,
    totalCount: identities.length,
    pageCount,
    orderedLaunches: identities.map(identityJson),
  });
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const startIndex = pageIndex * pageSize;
    const endIndexExclusive = Math.min(startIndex + pageSize, identities.length);
    const pageIdentities = Object.freeze(
      identities.slice(startIndex, endIndexExclusive),
    );
    const continuation = pageIndex + 1 < pageCount
      ? continuationCommitment(manifestCommitment, pageIndex + 1)
      : null;
    return Object.freeze({
      version: RECONCILER_CORPUS_PARTITION_VERSION,
      manifestCommitment,
      pageCommitment: pageCommitment({
        manifestCommitment,
        pageIndex,
        pageCount,
        pageSize,
        totalCount: identities.length,
        startIndex,
        endIndexExclusive,
        continuation,
        identities: pageIdentities,
      }),
      pageIndex,
      pageCount,
      pageSize,
      totalCount: identities.length,
      startIndex,
      endIndexExclusive,
      continuation,
      identities: pageIdentities,
    } satisfies ReconcilerCorpusPage);
  });
  return Object.freeze({
    version: RECONCILER_CORPUS_PARTITION_VERSION,
    manifestCommitment,
    pageSize,
    totalCount: identities.length,
    pageCount,
    pages: Object.freeze(pages),
  });
}

export function assembleReconcilerCorpusPages(
  manifest: ReconcilerCorpusManifest,
  pages: readonly ReconcilerCorpusPage[],
): readonly ReconcilerCorpusIdentity[] {
  if (
    pages.length !== manifest.pageCount ||
    manifest.pages.length !== manifest.pageCount
  ) {
    throw validationError("config", "reconciler-corpus-page-cardinality");
  }
  const assembled: ReconcilerCorpusIdentity[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    const expected = manifest.pages[pageIndex]!;
    if (
      page.version !== RECONCILER_CORPUS_PARTITION_VERSION ||
      page.manifestCommitment !== manifest.manifestCommitment ||
      page.pageCommitment !== expected.pageCommitment ||
      page.pageIndex !== pageIndex ||
      page.pageCount !== manifest.pageCount ||
      page.pageSize !== manifest.pageSize ||
      page.totalCount !== manifest.totalCount ||
      page.startIndex !== expected.startIndex ||
      page.endIndexExclusive !== expected.endIndexExclusive ||
      page.continuation !== expected.continuation ||
      canonicalizeFingerprintJson(page.identities.map(identityJson)) !==
        canonicalizeFingerprintJson(expected.identities.map(identityJson))
    ) {
      throw validationError("config", "reconciler-corpus-page-binding");
    }
    assembled.push(...page.identities);
  }
  if (assembled.length !== manifest.totalCount) {
    throw validationError("config", "reconciler-corpus-page-completeness");
  }
  return Object.freeze(assembled);
}

export type ReconcilerEntitlementIdentity = Readonly<{
  tokenAddress: string;
  vaultAddress: string;
  account: string;
}>;

export type ReconcilerEntitlementPage = Readonly<{
  version: typeof RECONCILER_ENTITLEMENT_PARTITION_VERSION;
  manifestCommitment: HexBytes32;
  pageCommitment: HexBytes32;
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  startIndex: number;
  endIndexExclusive: number;
  continuation: HexBytes32 | null;
  identities: readonly ReconcilerEntitlementIdentity[];
}>;

export type ReconcilerEntitlementManifest = Readonly<{
  version: typeof RECONCILER_ENTITLEMENT_PARTITION_VERSION;
  manifestCommitment: HexBytes32;
  parentManifestCommitment: HexBytes32;
  parentPageCommitment: HexBytes32;
  pageSize: number;
  totalCount: number;
  pageCount: number;
  pages: readonly ReconcilerEntitlementPage[];
}>;

function canonicalEntitlementIdentity(
  value: ReconcilerEntitlementIdentity,
): ReconcilerEntitlementIdentity {
  if (
    !/^0x[0-9a-f]{40}$/u.test(value.tokenAddress) ||
    !/^0x[0-9a-f]{40}$/u.test(value.vaultAddress) ||
    !/^0x[0-9a-f]{40}$/u.test(value.account)
  ) {
    throw validationError("config", "reconciler-entitlement-identity");
  }
  return Object.freeze({
    tokenAddress: value.tokenAddress,
    vaultAddress: value.vaultAddress,
    account: value.account,
  });
}

function entitlementIdentityJson(
  value: ReconcilerEntitlementIdentity,
): CanonicalJsonValue {
  return {
    tokenAddress: value.tokenAddress,
    vaultAddress: value.vaultAddress,
    account: value.account,
  };
}

export function createReconcilerEntitlementManifest(input: Readonly<{
  contract: ReconcilerPreParityContract;
  parentPage: ReconcilerCorpusPage;
  identities: readonly ReconcilerEntitlementIdentity[];
  pageSize?: number;
}>): ReconcilerEntitlementManifest {
  const pageSize = input.pageSize ?? RECONCILER_CORPUS_PARTITION_SIZE;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > RECONCILER_CORPUS_PARTITION_SIZE ||
    !Array.isArray(input.identities) ||
    input.identities.length < 1 ||
    input.identities.length > RECONCILER_CORPUS_MAXIMUM_TOTAL_COUNT
  ) {
    throw invalidInput("config", "reconciler-entitlement-page-size");
  }
  const identities = Object.freeze(input.identities.map(
    canonicalEntitlementIdentity,
  ));
  const unique = new Set(
    identities.map(({ vaultAddress, account }) => `${vaultAddress}:${account}`),
  );
  const parentTokens = new Set(
    input.parentPage.identities.map(({ tokenAddress }) => tokenAddress),
  );
  if (
    unique.size !== identities.length ||
    identities.some(({ tokenAddress }) => !parentTokens.has(tokenAddress))
  ) {
    throw validationError("config", "reconciler-entitlement-cardinality");
  }
  const parentManifestCommitment = canonicalBytes32(
    input.parentPage.manifestCommitment,
  );
  const parentPageCommitment = canonicalBytes32(
    input.parentPage.pageCommitment,
  );
  const pageCount = Math.ceil(identities.length / pageSize);
  const manifestCommitment = commitment("reconciler-entitlement-manifest", {
    version: RECONCILER_ENTITLEMENT_PARTITION_VERSION,
    chainId: input.contract.chainId,
    releaseId: input.contract.releaseId,
    modelId: input.contract.modelId,
    epochId: input.contract.epochId,
    checkpointId: input.contract.checkpointId,
    checkpointGeneration: input.contract.checkpointGeneration,
    reorgGeneration: input.contract.reorgGeneration,
    checkpointBlockNumber: input.contract.checkpointBlockNumber,
    checkpointBlockHash: input.contract.checkpointBlockHash,
    parentManifestCommitment,
    parentPageCommitment,
    pageSize,
    totalCount: identities.length,
    pageCount,
    orderedEntitlements: identities.map(entitlementIdentityJson),
  });
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const startIndex = pageIndex * pageSize;
    const endIndexExclusive = Math.min(startIndex + pageSize, identities.length);
    const pageIdentities = Object.freeze(
      identities.slice(startIndex, endIndexExclusive),
    );
    const continuation = pageIndex + 1 < pageCount
      ? commitment("reconciler-entitlement-continuation", {
        manifestCommitment,
        nextPageIndex: pageIndex + 1,
      })
      : null;
    const pageCommitmentValue = commitment("reconciler-entitlement-page", {
      manifestCommitment,
      pageIndex,
      pageCount,
      pageSize,
      totalCount: identities.length,
      startIndex,
      endIndexExclusive,
      continuation,
      identities: pageIdentities.map(entitlementIdentityJson),
    });
    return Object.freeze({
      version: RECONCILER_ENTITLEMENT_PARTITION_VERSION,
      manifestCommitment,
      pageCommitment: pageCommitmentValue,
      pageIndex,
      pageCount,
      pageSize,
      totalCount: identities.length,
      startIndex,
      endIndexExclusive,
      continuation,
      identities: pageIdentities,
    } satisfies ReconcilerEntitlementPage);
  });
  return Object.freeze({
    version: RECONCILER_ENTITLEMENT_PARTITION_VERSION,
    manifestCommitment,
    parentManifestCommitment,
    parentPageCommitment,
    pageSize,
    totalCount: identities.length,
    pageCount,
    pages: Object.freeze(pages),
  });
}

export function assembleReconcilerEntitlementPages(
  manifest: ReconcilerEntitlementManifest,
  pages: readonly ReconcilerEntitlementPage[],
): readonly ReconcilerEntitlementIdentity[] {
  if (
    pages.length !== manifest.pageCount ||
    manifest.pages.length !== manifest.pageCount
  ) {
    throw validationError("config", "reconciler-entitlement-page-cardinality");
  }
  const assembled: ReconcilerEntitlementIdentity[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    const expected = manifest.pages[pageIndex]!;
    if (
      page.version !== RECONCILER_ENTITLEMENT_PARTITION_VERSION ||
      page.manifestCommitment !== manifest.manifestCommitment ||
      page.pageCommitment !== expected.pageCommitment ||
      page.pageIndex !== pageIndex ||
      page.pageCount !== manifest.pageCount ||
      page.pageSize !== manifest.pageSize ||
      page.totalCount !== manifest.totalCount ||
      page.startIndex !== expected.startIndex ||
      page.endIndexExclusive !== expected.endIndexExclusive ||
      page.continuation !== expected.continuation ||
      canonicalizeFingerprintJson(page.identities.map(entitlementIdentityJson)) !==
        canonicalizeFingerprintJson(expected.identities.map(
          entitlementIdentityJson,
        ))
    ) {
      throw validationError("config", "reconciler-entitlement-page-binding");
    }
    assembled.push(...page.identities);
  }
  if (assembled.length !== manifest.totalCount) {
    throw validationError("config", "reconciler-entitlement-page-completeness");
  }
  return Object.freeze(assembled);
}
