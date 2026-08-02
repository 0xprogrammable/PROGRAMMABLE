import "server-only";

import {
  canonicalBytes32,
  parseNonnegativeIntegerText,
  type HexBytes32,
} from "./codecs";
import { invalidInput } from "./errors";

export const CACHE_POLICIES = Object.freeze({
  public: Object.freeze({
    visibility: "public" as const,
    cacheControl: "public, s-maxage=2, stale-while-revalidate=2",
  }),
  private: Object.freeze({
    visibility: "private" as const,
    cacheControl: "private, no-store",
  }),
});

export type ReadKind =
  | "explore-list"
  | "token-detail"
  | "chart"
  | "public-indexer"
  | "account-rewards"
  | "claimability"
  | "launch-confirmation"
  | "transaction-adjacent";

export function cachePolicyForRead(kind: ReadKind) {
  switch (kind) {
    case "explore-list":
    case "token-detail":
    case "chart":
    case "public-indexer":
      return CACHE_POLICIES.public;
    default:
      return CACHE_POLICIES.private;
  }
}
export type ReadProvenance = {
  source: "indexed" | "blob" | "rpc";
  projectionBlock?: string;
  projectionHash?: HexBytes32;
  projectionLag?: number;
  reconciledAt?: string;
  releaseVersion?: string;
};

export function provenanceHeaders(
  provenance: ReadProvenance,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {
    "X-Programmable-Read-Source": provenance.source,
  };
  if (provenance.projectionBlock !== undefined) {
    headers["X-Programmable-Projection-Block"] =
      parseNonnegativeIntegerText(provenance.projectionBlock);
  }
  if (provenance.projectionHash !== undefined) {
    headers["X-Programmable-Projection-Hash"] = canonicalBytes32(
      provenance.projectionHash,
    );
  }
  if (provenance.projectionLag !== undefined) {
    if (
      !Number.isSafeInteger(provenance.projectionLag) ||
      provenance.projectionLag < 0 ||
      provenance.projectionLag > 1_000_000
    ) {
      throw invalidInput("config", "projection-lag");
    }
    headers["X-Programmable-Projection-Lag"] = String(
      provenance.projectionLag,
    );
  }
  if (provenance.reconciledAt !== undefined) {
    const date = new Date(provenance.reconciledAt);
    if (
      Number.isNaN(date.valueOf()) ||
      date.toISOString() !== provenance.reconciledAt
    ) {
      throw invalidInput("config", "reconciled-at");
    }
    headers["X-Programmable-Reconciled-At"] = provenance.reconciledAt;
  }
  if (provenance.releaseVersion !== undefined) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(provenance.releaseVersion) ||
      provenance.releaseVersion.length > 64
    ) {
      throw invalidInput("config", "release-version");
    }
    headers["X-Programmable-Release-Version"] = provenance.releaseVersion;
  }
  return Object.freeze(headers);
}
