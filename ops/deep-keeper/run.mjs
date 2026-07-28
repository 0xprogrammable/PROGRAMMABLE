#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { mainnet } from "viem/chains";
import { PrivyClient } from "@privy-io/node";

import {
  createInitialState,
  createMetrics,
  DeepKeeperError,
  parseKeeperConfig,
  renderPrometheusMetrics,
  runKeeperCycle,
  validateState,
} from "./core.mjs";
import { createPrivyKeeperWallet } from "./privy-wallet.mjs";
import { evaluateDeepKeeperReleaseGate } from "./release-gate.mjs";

function serialize(value) {
  return JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function emit(type, severity, payload = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    type,
    severity,
    ...payload,
  };
  const stream = severity === "error" ? process.stderr : process.stdout;
  stream.write(`${serialize(record)}\n`);
}

function redactOperationalError(value) {
  return String(value ?? "Unknown keeper failure").replace(
    /https?:\/\/[^\s)"']+/gi,
    "[redacted-rpc-url]",
  );
}

async function loadState(config) {
  const path = resolve(config.stateFile);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return validateState(parsed, config);
  } catch (error) {
    if (error?.code === "ENOENT") return createInitialState(config);
    throw error;
  }
}

async function persistState(config, state) {
  const destination = resolve(config.stateFile);
  const temporary = `${destination}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, destination);
}

async function loadReleaseGate(config) {
  const manifestPath = resolve(config.releaseManifest);
  let release;
  try {
    release = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new DeepKeeperError(
      "RELEASE_MANIFEST_INVALID",
      "The Deep release manifest could not be read",
      {
        manifestPath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  const gate = evaluateDeepKeeperReleaseGate(release, config);
  if (config.enabled && !gate.ready) {
    throw new DeepKeeperError(
      "RELEASE_NOT_READY",
      "Transaction submission is blocked by the Deep release manifest",
      { reasons: gate.reasons },
    );
  }
  return gate;
}

function createClients(config) {
  const readers = config.rpcUrls.map((url) =>
    createPublicClient({
      chain: mainnet,
      transport: http(url, {
        retryCount: 2,
        timeout: 15_000,
      }),
    }),
  );
  let wallet = null;
  if (config.enabled && config.privyWalletId) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret) {
      throw new DeepKeeperError(
        "INVALID_CONFIG",
        "Privy credentials are required for the configured signing backend",
      );
    }
    wallet = createPrivyKeeperWallet({
      client: new PrivyClient({ appId, appSecret }),
      walletId: config.privyWalletId,
      signerAddress: config.signerAddress,
      coordinatorAddress: config.coordinatorAddress,
      chainId: config.chainId,
    });
  } else if (config.enabled) {
    wallet = createWalletClient({
      account: config.signerAddress,
      chain: mainnet,
      transport: http(config.signerRpcUrl, {
        retryCount: 0,
        timeout: 30_000,
      }),
    });
  }
  return { readers, wallet };
}

function healthDocument(runtime, metrics, config) {
  const now = Date.now();
  const staleAfterMs = config.intervalMs * 3;
  const fresh =
    runtime.lastCycleFinishedAtMs !== 0 &&
    now - runtime.lastCycleFinishedAtMs <= staleAfterMs;
  return {
    status: fresh && !runtime.inCycle ? "ok" : "degraded",
    enabled: config.enabled,
    chainId: config.chainId,
    coordinator: config.coordinatorAddress,
    signer: config.signerAddress,
    inCycle: runtime.inCycle,
    lastOutcome: runtime.lastOutcome,
    lastCycleStartedAt: runtime.lastCycleStartedAtMs
      ? new Date(runtime.lastCycleStartedAtMs).toISOString()
      : null,
    lastCycleFinishedAt: runtime.lastCycleFinishedAtMs
      ? new Date(runtime.lastCycleFinishedAtMs).toISOString()
      : null,
    lastError: runtime.lastError,
    consecutiveFailures: runtime.consecutiveFailures,
    checkpoint: runtime.state?.checkpoint ?? null,
    pendingTransaction: runtime.state?.pendingTransaction?.hash ?? null,
    releaseReady: runtime.releaseGate.ready,
    releaseVersion: runtime.releaseGate.releaseVersion,
    releaseStartBlock: runtime.releaseGate.startBlock,
    vaultSubsidyCapWei: config.vaultSubsidyCapWei.toString(),
    vaultSubsidyEntries: Object.keys(
      runtime.state?.vaultSubsidies ?? {},
    ).length,
    metrics,
  };
}

function startHealthServer(runtime, metrics, config) {
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.url === "/metrics") {
      response.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(renderPrometheusMetrics(metrics, runtime, config));
      return;
    }
    const health = healthDocument(runtime, metrics, config);
    if (request.url === "/healthz") {
      const status = health.status === "ok" ? 200 : 503;
      response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`${JSON.stringify(health)}\n`);
      return;
    }
    if (request.url === "/readyz") {
      const ready =
        health.status === "ok" &&
        health.lastError === null &&
        (!config.enabled || Boolean(config.signerAddress));
      response.writeHead(ready ? 200 : 503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        `${JSON.stringify({
          ready,
          enabled: config.enabled,
          lastOutcome: runtime.lastOutcome,
        })}\n`,
      );
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(config.healthPort, config.healthHost, () => {
    emit("health_server_started", "info", {
      host: config.healthHost,
      port: config.healthPort,
    });
  });
  return server;
}

async function main() {
  const config = parseKeeperConfig(process.env);
  const releaseGate = await loadReleaseGate(config);
  if (process.argv.includes("--check-config")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          valid: true,
          enabled: config.enabled,
          chainId: config.chainId,
          coordinator: config.coordinatorAddress,
          signer: config.signerAddress,
          intervalMs: config.intervalMs,
          scanLimit: config.scanLimit,
          maxBatchSize: config.maxBatchSize,
          maxGas: config.maxGas.toString(),
          vaultSubsidyCapWei: config.vaultSubsidyCapWei.toString(),
          stateFile: config.stateFile,
          releaseManifest: config.releaseManifest,
          releaseReady: releaseGate.ready,
          releaseGateReasons: releaseGate.reasons,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const once = process.argv.includes("--once");
  const metrics = createMetrics();
  const runtime = {
    state: await loadState(config),
    releaseGate,
    inCycle: false,
    lastOutcome: "starting",
    lastCycleStartedAtMs: 0,
    lastCycleFinishedAtMs: 0,
    lastError: null,
    consecutiveFailures: 0,
  };
  const { readers, wallet } = createClients(config);
  const server = once ? null : startHealthServer(runtime, metrics, config);
  let stopping = false;

  const stop = () => {
    stopping = true;
    server?.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  emit("keeper_started", "info", {
    enabled: config.enabled,
    chainId: config.chainId,
    coordinator: config.coordinatorAddress,
    signer: config.signerAddress,
    intervalMs: config.intervalMs,
    releaseReady: releaseGate.ready,
    releaseVersion: releaseGate.releaseVersion,
  });

  do {
    runtime.inCycle = true;
    runtime.lastCycleStartedAtMs = Date.now();
    try {
      const result = await runKeeperCycle({
        config,
        state: runtime.state,
        metrics,
        readers,
        wallet,
        persistPendingState: (pendingState) =>
          persistState(config, pendingState),
        nowMs: runtime.lastCycleStartedAtMs,
      });
      runtime.state = result.state;
      runtime.lastOutcome = result.outcome;
      runtime.lastError = null;
      runtime.consecutiveFailures = 0;
      await persistState(config, runtime.state);
      emit("keeper_cycle", "info", {
        outcome: result.outcome,
        confirmedBlock: result.confirmedBlock.number,
        registryCount: result.registryCount,
        readyVaults: result.ready.length,
        transactionHash: result.transactionHash ?? null,
      });
    } catch (error) {
      runtime.lastOutcome = "failed-closed";
      runtime.lastError = {
        code: error?.code ?? "UNEXPECTED_ERROR",
        message: redactOperationalError(
          error instanceof Error ? error.message : error,
        ),
      };
      runtime.consecutiveFailures += 1;
      emit("keeper_cycle_failed", "error", runtime.lastError);
      if (once) process.exitCode = 1;
    } finally {
      runtime.inCycle = false;
      runtime.lastCycleFinishedAtMs = Date.now();
    }
    if (once || stopping) break;
    await new Promise((resolvePromise) => {
      const timer = setTimeout(resolvePromise, config.intervalMs);
      timer.unref();
    });
  } while (!stopping);
}

const scriptPath = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    emit("keeper_fatal", "error", {
      code: error?.code ?? "UNEXPECTED_ERROR",
      message: redactOperationalError(
        error instanceof Error ? error.message : error,
      ),
    });
    process.exitCode = 1;
  });
}
