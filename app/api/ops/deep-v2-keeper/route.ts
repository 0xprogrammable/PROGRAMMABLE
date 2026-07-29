import "server-only";

import { PrivyClient } from "@privy-io/node";
import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  put,
} from "@vercel/blob";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

import {
  handleDeepV2KeeperRequest,
  type DeepV2CycleResult,
  type DeepV2KeeperExecution,
} from "./handler";
import { createMetrics } from "../../../../ops/deep-keeper/core.mjs";
import { createPrivyKeeperWallet } from "../../../../ops/deep-keeper/privy-wallet.mjs";
import {
  parseDeepV2KeeperConfig,
  type DeepV2KeeperConfig,
} from "../../../../ops/deep-keeper-v2/config.mjs";
import {
  createDeepV2BoundaryState,
  runDeepV2KeeperBoundary,
  validateDeepV2BoundaryState,
  type DeepV2BoundaryCycleResult,
} from "../../../../ops/deep-keeper-v2/core.mjs";
import {
  acquireDeepV2KeeperLease,
  assertDeepV2KeeperLease,
  releaseDeepV2KeeperLease,
  type DeepV2KeeperLease,
  type DeepV2KeeperLeaseStore,
} from "../../../../ops/deep-keeper-v2/lease.mjs";
import { evaluateDeepV2KeeperReleaseGate } from "../../../../ops/deep-keeper-v2/release-gate.mjs";
import reviewedReleaseBinding from "../../../../ops/deep-keeper-v2/reviewed-release-binding.json";
import { createDeepV2StateWriter } from "../../../../ops/deep-keeper-v2/state.mjs";
import deepV2ReleaseManifest from "../../../../contracts/deployments/mainnet-deep-full-range-v2.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

async function loadDeepV2Release() {
  return deepV2ReleaseManifest as unknown;
}

function blobToken() {
  const token =
    process.env.OPS_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("Deep V2 keeper state storage is not configured");
  }
  return token;
}

function createControlStore(): DeepV2KeeperLeaseStore {
  const token = blobToken();
  return {
    async read(path) {
      let result;
      try {
        result = await get(path, {
          access: "private",
          token,
          useCache: false,
        });
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) {
        throw new Error("Deep V2 keeper control state could not be read");
      }
      return {
        value: await new Response(result.stream).text(),
        etag: result.blob.etag,
      };
    },
    async putIfAbsent(path, value) {
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
    async putIfMatch(path, value, etag) {
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

function signerEnvironment(config: DeepV2KeeperConfig) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (
    !config.enabled ||
    !appId ||
    !appSecret ||
    !config.privyWalletId ||
    !config.signerAddress
  ) {
    throw new Error("Deep V2 keeper signing backend is not configured");
  }
  return {
    appId,
    appSecret,
    walletId: config.privyWalletId,
    signerAddress: config.signerAddress,
  };
}

async function executeEligibleCycle(
  _release: unknown,
  configValue: unknown,
): Promise<DeepV2KeeperExecution> {
  const config = configValue as DeepV2KeeperConfig;
  const signer = signerEnvironment(config);
  const store = createControlStore();
  let lease: DeepV2KeeperLease | null = null;

  try {
    const acquiredAtMs = Date.now();
    lease = await acquireDeepV2KeeperLease({
      store,
      nowMs: acquiredAtMs,
    });
    if (!lease) return { kind: "busy" };

    const assertLease = (ownedLease: DeepV2KeeperLease) =>
      assertDeepV2KeeperLease({
        store,
        lease: ownedLease,
        nowMs: Date.now(),
      });
    const stateWriter = createDeepV2StateWriter({
      store,
      lease,
      assertLease,
      now: Date.now,
    });
    const boundaryState =
      lease.boundaryState === null ||
      lease.boundaryState === undefined
        ? createDeepV2BoundaryState(config)
        : validateDeepV2BoundaryState(
            lease.boundaryState as ReturnType<
              typeof createDeepV2BoundaryState
            >,
            config,
          );

    const readers = config.rpcUrls.map((url) =>
      createPublicClient({
        chain: mainnet,
        transport: http(url, {
          retryCount: 2,
          timeout: 15_000,
        }),
      }),
    );
    const wallet = createPrivyKeeperWallet({
      client: new PrivyClient({
        appId: signer.appId,
        appSecret: signer.appSecret,
      }),
      walletId: signer.walletId,
      signerAddress: signer.signerAddress,
      coordinatorAddress: config.coordinatorAddress,
      chainId: config.chainId,
    });
    const result: DeepV2BoundaryCycleResult =
      await runDeepV2KeeperBoundary({
        config,
        boundaryState,
        lease,
        assertLease,
        persistBoundaryState: (state) =>
          stateWriter.write(
            state as typeof state & { fencingGeneration: number },
          ),
        readers,
        wallet,
        metrics: createMetrics(),
        nowMs: Date.now(),
      });

    return {
      kind: "completed",
      result: result as unknown as DeepV2CycleResult,
    };
  } finally {
    if (lease) {
      try {
        const released = await releaseDeepV2KeeperLease({
          store,
          lease,
          nowMs: Date.now(),
        });
        if (!released) {
          console.error(
            "Deep V2 keeper lease release lost ownership",
          );
        }
      } catch {
        console.error("Deep V2 keeper lease release failed");
      }
    }
  }
}

export async function GET(request: Request) {
  return handleDeepV2KeeperRequest(request, {
    cronSecret: process.env.CRON_SECRET,
    loadRelease: loadDeepV2Release,
    parseConfig: () => parseDeepV2KeeperConfig(process.env),
    evaluateReleaseGate: (release, config) =>
      evaluateDeepV2KeeperReleaseGate(
        release,
        config as DeepV2KeeperConfig,
        reviewedReleaseBinding,
      ),
    executeEligibleCycle,
    logFailure(errorName) {
      console.error("Deep V2 keeper cycle failed", { errorName });
    },
  });
}
