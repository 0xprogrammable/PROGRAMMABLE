import { timingSafeEqual } from "node:crypto";

import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  put,
} from "@vercel/blob";
import { PrivyClient } from "@privy-io/node";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

import deepRelease from "../../../../contracts/deployments/mainnet-deep-full-range-v1.json";
import {
  createInitialState,
  createMetrics,
  parseKeeperConfig,
  runKeeperCycle,
  validateState,
} from "../../../../ops/deep-keeper/core.mjs";
import { createPrivyKeeperWallet } from "../../../../ops/deep-keeper/privy-wallet.mjs";
import { evaluateDeepKeeperReleaseGate } from "../../../../ops/deep-keeper/release-gate.mjs";
import {
  acquireDeepKeeperLease,
  releaseDeepKeeperLease,
} from "../../../../ops/deep-keeper/lease.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const STATE_PATH = "ops/deep-keeper/state-v4.json";

type KeeperReleaseBinding = {
  lifecycleEvidence: {
    keeperExecutor?: string | null;
    keeperExecutorRuntimeCodeHash?: string | null;
  };
  keeperPolicy: {
    coordinatorSourceCommitment?: string | null;
  };
};

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!cronSecret || !authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(cronSecret);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

function keeperEnvironment() {
  const rpcA = process.env.ETHEREUM_RPC_URL?.trim();
  const rpcB = process.env.ETHEREUM_RPC_URL_B?.trim();
  const keeperRelease = deepRelease as unknown as KeeperReleaseBinding;
  return {
    ...process.env,
    DEEP_KEEPER_CHAIN_ID: "1",
    DEEP_KEEPER_AUTOMATION_ADDRESS: deepRelease.addresses.automation,
    DEEP_KEEPER_AUTOMATION_RUNTIME_HASH:
      deepRelease.runtimeCodeHashes.automation,
    DEEP_KEEPER_COORDINATOR_ADDRESS:
      keeperRelease.lifecycleEvidence.keeperExecutor ?? "",
    DEEP_KEEPER_COORDINATOR_RUNTIME_HASH:
      keeperRelease.lifecycleEvidence.keeperExecutorRuntimeCodeHash ?? "",
    DEEP_KEEPER_COORDINATOR_SOURCE_COMMITMENT:
      keeperRelease.keeperPolicy.coordinatorSourceCommitment ?? "",
    DEEP_KEEPER_RELEASE_MANIFEST:
      "contracts/deployments/mainnet-deep-full-range-v1.json",
    DEEP_KEEPER_RPC_URLS: rpcA && rpcB ? `${rpcA},${rpcB}` : "",
    DEEP_KEEPER_INTERVAL_MS: "300000",
    DEEP_KEEPER_MAX_BATCH_SIZE: "4",
    DEEP_KEEPER_SCAN_LIMIT: "4",
    DEEP_KEEPER_MAX_GAS: "4500000",
  };
}

function blobToken() {
  const token =
    process.env.OPS_BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Keeper state storage is not configured");
  return token;
}

async function readState(config: ReturnType<typeof parseKeeperConfig>) {
  const token = blobToken();
  let result;
  try {
    result = await get(STATE_PATH, {
      access: "private",
      token,
      useCache: false,
    });
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return createInitialState(config);
    }
    throw error;
  }
  if (!result || !result.stream) {
    return createInitialState(config);
  }
  if (result.statusCode !== 200) {
    throw new Error("Keeper state could not be read");
  }
  const value = JSON.parse(await new Response(result.stream).text());
  return validateState(value, config);
}

async function writeState(state: unknown) {
  await put(STATE_PATH, JSON.stringify(state), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    token: blobToken(),
  });
}

function leaseStore() {
  const token = blobToken();
  return {
    async read(path: string) {
      const result = await get(path, {
        access: "private",
        token,
        useCache: false,
      });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) {
        throw new Error("Keeper lease could not be read");
      }
      return {
        value: await new Response(result.stream).text(),
        etag: result.blob.etag,
      };
    },
    async putIfAbsent(path: string, value: string) {
      try {
        const result = await put(path, value, {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 0,
          token,
        });
        return { etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return null;
        throw error;
      }
    },
    async putIfMatch(path: string, value: string, etag: string) {
      try {
        const result = await put(path, value, {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          ifMatch: etag,
          cacheControlMaxAge: 0,
          token,
        });
        return { etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return null;
        throw error;
      }
    },
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let lease: Awaited<ReturnType<typeof acquireDeepKeeperLease>> = null;
  let leaseStorage: ReturnType<typeof leaseStore> | null = null;
  try {
    const config = parseKeeperConfig(keeperEnvironment());
    const releaseGate = evaluateDeepKeeperReleaseGate(deepRelease, config);
    if (!releaseGate.ready) {
      return NextResponse.json(
        {
          error: "Deep keeper release is not ready",
          reasons: releaseGate.reasons,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    leaseStorage = leaseStore();
    lease = await acquireDeepKeeperLease({
      store: leaseStorage,
      nowMs: Date.now(),
    });
    if (!lease) {
      return NextResponse.json(
        { error: "Deep keeper cycle already in progress" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (
      !appId ||
      !appSecret ||
      !config.privyWalletId ||
      !config.signerAddress
    ) {
      throw new Error("Keeper signing backend is not configured");
    }

    const readers = config.rpcUrls.map((url: string) =>
      createPublicClient({
        chain: mainnet,
        transport: http(url, { retryCount: 2, timeout: 15_000 }),
      }),
    );
    const wallet = createPrivyKeeperWallet({
      client: new PrivyClient({ appId, appSecret }),
      walletId: config.privyWalletId,
      signerAddress: config.signerAddress,
      coordinatorAddress: config.coordinatorAddress,
      chainId: config.chainId,
    });
    const metrics = createMetrics();
    const result = await runKeeperCycle({
      config,
      state: await readState(config),
      metrics,
      readers,
      wallet,
      persistPendingState: writeState,
      nowMs: Date.now(),
    });
    await writeState(result.state);

    return NextResponse.json(
      {
        ok: true,
        outcome: result.outcome,
        confirmedBlock: result.confirmedBlock.number.toString(),
        registryCount:
          result.registryCount === null
            ? null
            : result.registryCount.toString(),
        readyVaults: result.ready.length,
        transactionHash: result.transactionHash ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Deep keeper cycle failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Deep keeper cycle failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (lease && leaseStorage) {
      try {
        const released = await releaseDeepKeeperLease({
          store: leaseStorage,
          lease,
          nowMs: Date.now(),
        });
        if (!released) {
          console.error("Deep keeper lease release lost ownership");
        }
      } catch {
        // A failed release leaves the lease to expire, which is safer than an
        // unguarded delete that could remove a successor's ownership record.
        console.error("Deep keeper lease release failed");
      }
    }
  }
}
