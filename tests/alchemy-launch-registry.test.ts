import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";

vi.mock("server-only", () => ({}));

const blobMocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@vercel/blob", () => blobMocks);

import {
  validateAlchemyLaunchRegistryEnvelope,
  writeAlchemyLaunchRegistry,
  type AlchemyLaunchRegistry,
} from "../lib/alchemy/launch-registry.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 100n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/test-key-1234",
  rpcUrlSecondary: null,
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

function token(input: Readonly<{ address?: `0x${string}`; block?: string; log?: number }> = {}): LauncherToken {
  const address = input.address ??
    "0x4444444444444444444444444444444444444444";
  return {
    id: `1:${address.toLowerCase()}`,
    name: "Newest",
    symbol: "NEW",
    tokenAddress: address,
    hookAddress: "0x5555555555555555555555555555555555555555",
    poolId: `0x${"66".repeat(32)}`,
    launchBlockNumber: input.block ?? "120",
    launchTransactionHash: `0x${"77".repeat(32)}`,
    launchLogIndex: input.log ?? 4,
    launchedAt: "2026-08-04T00:00:00.000Z",
    totalSwapFeeBps: 100,
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    liquidityPath: "meme",
  };
}

function envelope(tokens: readonly LauncherToken[] = [token()]) {
  const payload: AlchemyLaunchRegistry = {
    generatedAt: "2026-08-04T00:01:00.000Z",
    repositoryCommit: "a".repeat(40),
    chainId: 1,
    cursor: {
      blockNumber: "130",
      blockHash: `0x${"88".repeat(32)}`,
    },
    tokens,
  };
  return {
    schemaVersion: "programmable-alchemy-launch-registry-v1",
    contentHash: keccak256(toBytes(JSON.stringify(payload))),
    payload,
  };
}

describe("Alchemy incremental launch registry", () => {
  beforeEach(() => {
    process.env.OPS_BLOB_READ_WRITE_TOKEN = "blob-test-token";
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    blobMocks.get.mockReset();
    blobMocks.put.mockReset();
    blobMocks.put.mockResolvedValue({ etag: "next-etag" });
  });

  afterEach(() => {
    delete process.env.OPS_BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("accepts a content-addressed registry with exact launch provenance", () => {
    expect(
      validateAlchemyLaunchRegistryEnvelope(envelope(), deployment),
    ).toMatchObject({
      chainId: 1,
      cursor: { blockNumber: "130" },
      tokens: [{ name: "Newest", launchBlockNumber: "120" }],
    });
  });

  it("rejects a token beyond the committed cursor", () => {
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(
        envelope([token({ block: "131" })]),
        deployment,
      )
    ).toThrow("invalid token");
  });

  it("rejects duplicate launch provenance", () => {
    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(
        envelope([
          token(),
          token({
            address: "0x9999999999999999999999999999999999999999",
          }),
        ]),
        deployment,
      )
    ).toThrow("duplicate provenance");
  });

  it("rejects payload mutation after the content commitment", () => {
    const candidate = envelope();
    candidate.payload.tokens[0]!.name = "Mutated";

    expect(() =>
      validateAlchemyLaunchRegistryEnvelope(candidate, deployment)
    ).toThrow("content hash is invalid");
  });

  it("creates atomically, then updates only through an exact ETag", async () => {
    const registry = envelope().payload;

    await writeAlchemyLaunchRegistry(deployment, registry, null);
    expect(blobMocks.put).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        allowOverwrite: false,
      }),
    );
    expect(blobMocks.put.mock.calls.at(-1)?.[2]).not.toHaveProperty("ifMatch");

    await writeAlchemyLaunchRegistry(deployment, registry, "exact-etag");
    expect(blobMocks.put).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        allowOverwrite: true,
        ifMatch: "exact-etag",
      }),
    );
  });

  it("reports a retryable conflict when another writer wins initial creation", async () => {
    blobMocks.put.mockRejectedValueOnce(new Error("pathname already exists"));
    blobMocks.get.mockResolvedValueOnce({ statusCode: 200 });

    await expect(
      writeAlchemyLaunchRegistry(deployment, envelope().payload, null),
    ).rejects.toMatchObject({
      name: "AlchemyLaunchRegistryCreateConflictError",
    });
  });
});
