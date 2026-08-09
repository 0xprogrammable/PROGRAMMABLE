import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { discoverManualRouterPendingFinalityV1 } from
  "../lib/server/custom-launch/manual-router-discovery-v1";
import {
  ManualRouterPrivateBlobStoreV1,
  manualRouterApplicantIndexPrefixV1,
  type ManualRouterPrivateBlobBoundaryV1,
} from "../lib/server/custom-launch/manual-router-store-v1";

type ListResult = Readonly<{
  paths: readonly string[];
  cursor: string | null;
  hasMore: boolean;
}>;

function storeWith(input: Readonly<{
  list: ManualRouterPrivateBlobBoundaryV1["list"];
  get?: ManualRouterPrivateBlobBoundaryV1["get"];
}>): ManualRouterPrivateBlobStoreV1 {
  return new ManualRouterPrivateBlobStoreV1({
    get: input.get ?? (async () => ({
      statusCode: 404,
      etag: null,
      body: null,
    })),
    async put() { return { etag: "unused" }; },
    list: input.list,
    isPreconditionFailure() { return false; },
  });
}

describe("manual Applicant private discovery adversarial bounds", () => {
  const prefix = manualRouterApplicantIndexPrefixV1();
  const path = `${prefix}${"1".repeat(64)}.json`;

  it("rejects a repeated or cyclic provider cursor", async () => {
    await expect(discoverManualRouterPendingFinalityV1({
      store: storeWith({
        async list(): Promise<ListResult> {
          return { paths: [], cursor: "same-cursor", hasMore: true };
        },
      }),
    })).rejects.toThrow("cursor repeated");
  });

  it("rejects hasMore/cursor inconsistency", async () => {
    await expect(discoverManualRouterPendingFinalityV1({
      store: storeWith({
        async list(): Promise<ListResult> {
          return { paths: [], cursor: null, hasMore: true };
        },
      }),
    })).rejects.toThrow("private Blob list failed");
  });

  it("rejects a duplicate path across provider pages", async () => {
    let call = 0;
    await expect(discoverManualRouterPendingFinalityV1({
      store: storeWith({
        async list(): Promise<ListResult> {
          call += 1;
          return call === 1
            ? { paths: [path], cursor: "page-2", hasMore: true }
            : { paths: [path], cursor: null, hasMore: false };
        },
      }),
    })).rejects.toThrow("discovery is ambiguous");
  });

  it("rejects out-of-prefix and malformed Applicant paths", async () => {
    for (const invalid of [
      `custom-launch/manual-router/v1/proofs/${"1".repeat(64)}.json`,
      `${prefix}not-a-content-hash.json`,
    ]) {
      await expect(discoverManualRouterPendingFinalityV1({
        store: storeWith({
          async list(): Promise<ListResult> {
            return { paths: [invalid], cursor: null, hasMore: false };
          },
        }),
      })).rejects.toThrow(/escaped its private prefix|invalid path/u);
    }
  });

  it("fails closed when a listed current head disappears", async () => {
    await expect(discoverManualRouterPendingFinalityV1({
      store: storeWith({
        async list(): Promise<ListResult> {
          return { paths: [path], cursor: null, hasMore: false };
        },
      }),
    })).rejects.toThrow("vanished during discovery");
  });

  it("rejects more than 20,000 private Applicant indices before reading heads", async () => {
    let reads = 0;
    const store = storeWith({
      async get() {
        reads += 1;
        return { statusCode: 404, etag: null, body: null };
      },
      async list({ cursor }): Promise<ListResult> {
        const page = cursor === undefined ? 0 : Number(cursor.slice(5));
        const length = page === 20 ? 1 : 1_000;
        const paths = Array.from({ length }, (_, index) => {
          const ordinal = page * 1_000 + index;
          return `${prefix}${ordinal.toString(16).padStart(64, "0")}.json`;
        });
        return page === 20
          ? { paths, cursor: null, hasMore: false }
          : { paths, cursor: `page-${page + 1}`, hasMore: true };
      },
    });
    await expect(discoverManualRouterPendingFinalityV1({ store }))
      .rejects.toThrow("exceeds its bound");
    expect(reads).toBe(0);
  });
});
