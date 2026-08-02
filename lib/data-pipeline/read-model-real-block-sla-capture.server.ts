import "server-only";

import { createHash, createHmac } from "node:crypto";

import {
  addressFromBytea,
  hexToBytes,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import { invalidInput, validationError } from "./errors";
import {
  createPostgresExecutor,
  type PostgresExecutor,
  type PostgresTransaction,
} from "./postgres";
import {
  validatedPostgresConnectionTarget,
  validatedPostgresSslCa,
} from "./postgres-connection.server";
import type { QuickNodeWakeDeploymentBinding } from "./quicknode-wake-queue.server";

const RUNTIME_LOGIN_ROLE = "programmable_projector_runtime_login";
const RUNTIME_ROLE = "programmable_projector_runtime";
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_CAPTURE_DEADLINE_MS = 9_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHALLENGE = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const STREAM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

type Environment = Readonly<Record<string, string | undefined>>;
type JsonRecord = Record<string, unknown>;

export type RealBlockSlaCaptureTarget = Readonly<{
  deliveryReceiptId: string;
  databaseReceivedAt: string;
  optimisticMarketStateId: string;
  tokenAddress: HexAddress;
  deployment: QuickNodeWakeDeploymentBinding;
}>;

export type RealBlockSlaCaptureStageState =
  | Readonly<{ state: "needs-ingest" }>
  | Readonly<{
      state: "needs-capture";
      target: RealBlockSlaCaptureTarget;
    }>
  | Readonly<{ state: "complete" }>;

export type RealBlockSlaCaptureStore = Readonly<{
  stageState(deliveryReceiptId: string): Promise<RealBlockSlaCaptureStageState>;
  target(deliveryReceiptId: string): Promise<RealBlockSlaCaptureTarget>;
  targetForArm(armId: string): Promise<RealBlockSlaCaptureTarget>;
  recordPair(input: Readonly<{
    target: RealBlockSlaCaptureTarget;
    token: Readonly<{
      status: number;
      cacheControl: string;
      body: Uint8Array;
    }>;
    chart: Readonly<{
      status: number;
      cacheControl: string;
      body: Uint8Array;
    }>;
  }>): Promise<void>;
  export(deliveryReceiptId: string, challengeSha256: HexBytes32): Promise<JsonRecord>;
  close(): Promise<void>;
}>;

function fail(): never {
  throw invalidInput("postgres", "real-block-sla-capture");
}

function positiveIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/u.test(value)) {
    return fail();
  }
  return value;
}

function exactUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return fail();
  return value;
}

function exactTimestamp(value: unknown): string {
  if (typeof value !== "string") return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return fail();
  return parsed.toISOString();
}

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail();
  }
  return value as JsonRecord;
}

function captureTarget(
  deliveryReceiptId: string,
  row: Readonly<{
    optimistic_market_state_id: unknown;
    token_address: unknown;
    deployment_origin: unknown;
    repository_commit: unknown;
    deployment_id: unknown;
    project_id: unknown;
    database_received_at: unknown;
  }>,
): RealBlockSlaCaptureTarget {
  if (typeof row.deployment_origin !== "string") return fail();
  const origin = new URL(row.deployment_origin);
  if (origin.origin !== row.deployment_origin) return fail();
  const deployment = loadVercelWakeDeploymentBinding({
    VERCEL_GIT_COMMIT_SHA:
      typeof row.repository_commit === "string" ? row.repository_commit : undefined,
    VERCEL_DEPLOYMENT_ID:
      typeof row.deployment_id === "string" ? row.deployment_id : undefined,
    VERCEL_PROJECT_ID:
      typeof row.project_id === "string" ? row.project_id : undefined,
    VERCEL_URL: origin.host,
  });
  return Object.freeze({
    deliveryReceiptId,
    databaseReceivedAt: exactTimestamp(row.database_received_at),
    optimisticMarketStateId: exactUuid(row.optimistic_market_state_id),
    tokenAddress: addressFromBytea(row.token_address),
    deployment,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = record(value);
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function loadVercelWakeDeploymentBinding(
  env: Environment = process.env,
): QuickNodeWakeDeploymentBinding {
  const repositoryCommit = env.VERCEL_GIT_COMMIT_SHA;
  const deploymentId = env.VERCEL_DEPLOYMENT_ID;
  const projectId = env.VERCEL_PROJECT_ID;
  const deploymentHost = env.VERCEL_URL;
  if (
    typeof repositoryCommit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(repositoryCommit) ||
    repositoryCommit === "0".repeat(40) ||
    typeof deploymentId !== "string" ||
    !/^dpl_[A-Za-z0-9]{20,128}$/u.test(deploymentId) ||
    typeof projectId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(projectId) ||
    typeof deploymentHost !== "string" ||
    !/^[a-z0-9.-]+\.vercel\.app$/u.test(deploymentHost)
  ) {
    return fail();
  }
  return Object.freeze({
    repositoryCommit,
    deploymentId,
    projectId,
    deploymentOrigin: `https://${deploymentHost}`,
  });
}

async function assumeRuntimeRole(transaction: PostgresTransaction) {
  const login = await transaction.query<{ session_user: unknown }>(
    "select session_user::text as session_user",
  );
  if (login.length !== 1 || login[0]?.session_user !== RUNTIME_LOGIN_ROLE) {
    throw validationError("postgres", "real-block-sla-capture-login");
  }
  await transaction.query("set local role programmable_projector_runtime");
  await transaction.query("set local statement_timeout = '2000ms'");
  await transaction.query("set local lock_timeout = '250ms'");
  const role = await transaction.query<{
    session_user: unknown;
    current_role: unknown;
  }>("select session_user::text as session_user, current_role::text as current_role");
  if (
    role.length !== 1 ||
    role[0]?.session_user !== RUNTIME_LOGIN_ROLE ||
    role[0]?.current_role !== RUNTIME_ROLE
  ) {
    throw validationError("postgres", "real-block-sla-capture-role");
  }
}

export function createRealBlockSlaCaptureStore(input: Readonly<{
  executor: PostgresExecutor;
}>): RealBlockSlaCaptureStore {
  async function transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return input.executor.transaction(async (database) => {
      await assumeRuntimeRole(database);
      return work(database);
    });
  }

  return Object.freeze({
    async stageState(deliveryReceiptId) {
      const receiptId = positiveIdentifier(deliveryReceiptId);
      return transaction(async (database) => {
        const rows = await database.query<{
          stage_state: unknown;
          optimistic_market_state_id: unknown;
          token_address: unknown;
          deployment_origin: unknown;
          repository_commit: unknown;
          deployment_id: unknown;
          project_id: unknown;
          database_received_at: unknown;
        }>(
          "select * from programmable_wake_private.get_real_block_sla_capture_stage_v1($1::bigint)",
          [receiptId],
        );
        if (rows.length !== 1) return fail();
        const row = rows[0]!;
        if (row.stage_state === "needs-ingest") {
          return Object.freeze({ state: "needs-ingest" as const });
        }
        if (row.stage_state === "complete") {
          return Object.freeze({ state: "complete" as const });
        }
        if (row.stage_state !== "needs-capture") return fail();
        return Object.freeze({
          state: "needs-capture" as const,
          target: captureTarget(receiptId, row),
        });
      });
    },

    async target(deliveryReceiptId) {
      const receiptId = positiveIdentifier(deliveryReceiptId);
      return transaction(async (database) => {
        const rows = await database.query<{
          optimistic_market_state_id: unknown;
          token_address: unknown;
          deployment_origin: unknown;
          repository_commit: unknown;
          deployment_id: unknown;
          project_id: unknown;
          database_received_at: unknown;
        }>(
          "select * from programmable_wake_private.get_real_block_sla_capture_target_v1($1::bigint)",
          [receiptId],
        );
        const row = rows[0];
        if (rows.length !== 1 || !row) return fail();
        return captureTarget(receiptId, row);
      });
    },

    async targetForArm(armId) {
      const exactArmId = exactUuid(armId);
      return transaction(async (database) => {
        const rows = await database.query<{
          delivery_receipt_id: unknown;
          optimistic_market_state_id: unknown;
          token_address: unknown;
          deployment_origin: unknown;
          repository_commit: unknown;
          deployment_id: unknown;
          project_id: unknown;
          database_received_at: unknown;
        }>(
          "select * from programmable_wake_private.get_real_block_sla_capture_target_for_arm_v1($1::uuid)",
          [exactArmId],
        );
        const row = rows[0];
        if (rows.length !== 1 || !row) return fail();
        return captureTarget(positiveIdentifier(row.delivery_receipt_id), row);
      });
    },

    async recordPair(observation) {
      if (
        observation.token.status !== 200 ||
        observation.token.cacheControl !== "no-store" ||
        observation.token.body.byteLength < 2 ||
        observation.token.body.byteLength > MAXIMUM_RESPONSE_BYTES ||
        observation.chart.status !== 200 ||
        observation.chart.cacheControl !== "no-store" ||
        observation.chart.body.byteLength < 2 ||
        observation.chart.body.byteLength > MAXIMUM_RESPONSE_BYTES
      ) return fail();
      await transaction(async (database) => {
        const rows = await database.query<{ recorded: unknown }>(
          `select programmable_wake_private.record_real_block_sla_api_observation_pair_v1(
             $1::bigint, $2::uuid,
             $3::smallint, $4::text, $5::bytea,
             $6::smallint, $7::text, $8::bytea
           ) as recorded`,
          [
            positiveIdentifier(observation.target.deliveryReceiptId),
            exactUuid(observation.target.optimisticMarketStateId),
            200,
            "no-store",
            observation.token.body,
            200,
            "no-store",
            observation.chart.body,
          ],
        );
        if (rows.length !== 1 || rows[0]?.recorded !== true) return fail();
      });
    },

    async export(deliveryReceiptId, challengeSha256) {
      return transaction(async (database) => {
        const rows = await database.query<{ evidence: unknown }>(
          "select programmable_wake_private.create_real_block_sla_export_v1($1::bigint, $2::bytea) as evidence",
          [positiveIdentifier(deliveryReceiptId), hexToBytes(challengeSha256)],
        );
        return record(rows[0]?.evidence);
      });
    },

    close: () => input.executor.close(),
  });
}

export function createConfiguredRealBlockSlaCaptureStore(
  env: Environment = process.env,
): RealBlockSlaCaptureStore {
  const connectionString = env.PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL;
  if (!connectionString) return fail();
  const target = validatedPostgresConnectionTarget(connectionString);
  return createRealBlockSlaCaptureStore({
    executor: createPostgresExecutor({
      connectionString,
      sslCaPem: target.isLoopback
        ? undefined
        : validatedPostgresSslCa(env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM),
      allowInsecureLoopback: target.isLoopback,
      maxConnections: 1,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 10_000,
    }),
  });
}

export async function armConfiguredRealBlockSlaProviderRetryOnce(input: Readonly<{
  streamId: string;
  env?: Environment;
}>): Promise<string> {
  const env = input.env ?? process.env;
  if (
    env.PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE !== "true" ||
    !STREAM_ID.test(input.streamId)
  ) return fail();
  const deployment = loadVercelWakeDeploymentBinding(env);
  const connectionString = env.PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL;
  if (!connectionString) return fail();
  const target = validatedPostgresConnectionTarget(connectionString);
  const executor = createPostgresExecutor({
    connectionString,
    sslCaPem: target.isLoopback
      ? undefined
      : validatedPostgresSslCa(env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM),
    allowInsecureLoopback: target.isLoopback,
    maxConnections: 1,
    connectTimeoutMs: 2_000,
    idleTimeoutMs: 10_000,
  });
  try {
    return await armRealBlockSlaProviderRetryOnce({
      executor,
      deployment,
      streamId: input.streamId,
    });
  } finally {
    await executor.close();
  }
}

export async function armRealBlockSlaProviderRetryOnce(input: Readonly<{
  executor: PostgresExecutor;
  deployment: QuickNodeWakeDeploymentBinding;
  streamId: string;
}>): Promise<string> {
  if (!STREAM_ID.test(input.streamId)) return fail();
  const deployment = loadVercelWakeDeploymentBinding({
    VERCEL_GIT_COMMIT_SHA: input.deployment.repositoryCommit,
    VERCEL_DEPLOYMENT_ID: input.deployment.deploymentId,
    VERCEL_PROJECT_ID: input.deployment.projectId,
    VERCEL_URL: new URL(input.deployment.deploymentOrigin).host,
  });
  if (deployment.deploymentOrigin !== input.deployment.deploymentOrigin) return fail();
  return input.executor.transaction(async (database) => {
    await assumeRuntimeRole(database);
    const rows = await database.query<{ arm_id: unknown }>(
      `select programmable_wake_private.arm_real_block_sla_provider_retry_once_v1(
         $1::text, $2::text, $3::text, $4::text, $5::text
       ) as arm_id`,
      [
        deployment.repositoryCommit,
        deployment.deploymentId,
        deployment.deploymentOrigin,
        deployment.projectId,
        input.streamId,
      ],
    );
    if (rows.length !== 1) return fail();
    return exactUuid(rows[0]?.arm_id);
  });
}

async function boundedResponseBody(response: Response): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > MAXIMUM_RESPONSE_BYTES) return fail();
  if (!response.body) return fail();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel();
      return fail();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function exactMarketBinder(
  body: Uint8Array,
  target: RealBlockSlaCaptureTarget,
): Readonly<{
  releaseVersion: "classic-v2" | "classic-v3";
  reorgGeneration: string;
  evidenceCommitment: HexBytes32;
}> {
  const parsed = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
  const overlay = record(parsed.optimisticOverlay);
  if (overlay.active !== true || !Array.isArray(overlay.applied)) return fail();
  const matching = overlay.applied.filter((candidate) => {
    const row = record(candidate);
    return row.kind === "market" &&
      row.optimisticMarketStateId === target.optimisticMarketStateId &&
      typeof row.tokenAddress === "string" &&
      row.tokenAddress.toLowerCase() === target.tokenAddress.toLowerCase();
  });
  if (matching.length !== 1) return fail();
  const binder = record(matching[0]);
  if (
    binder.releaseVersion !== "classic-v2" &&
    binder.releaseVersion !== "classic-v3"
  ) return fail();
  if (
    typeof binder.reorgGeneration !== "string" ||
    !/^(?:0|[1-9][0-9]{0,18})$/u.test(binder.reorgGeneration)
  ) return fail();
  if (
    typeof binder.evidenceCommitment !== "string" ||
    !/^0x(?!0{64}$)[0-9a-f]{64}$/u.test(binder.evidenceCommitment)
  ) return fail();
  return Object.freeze({
    releaseVersion: binder.releaseVersion,
    reorgGeneration: binder.reorgGeneration,
    evidenceCommitment: binder.evidenceCommitment as HexBytes32,
  });
}

function assertDeployment(
  target: RealBlockSlaCaptureTarget,
  expected: QuickNodeWakeDeploymentBinding,
) {
  if (
    target.deployment.repositoryCommit !== expected.repositoryCommit ||
    target.deployment.deploymentId !== expected.deploymentId ||
    target.deployment.deploymentOrigin !== expected.deploymentOrigin ||
    target.deployment.projectId !== expected.projectId
  ) return fail();
}

function automationBypassSecret(env: Environment): string {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (
    typeof secret !== "string" ||
    Buffer.byteLength(secret, "utf8") < 16 ||
    Buffer.byteLength(secret, "utf8") > 1_024 ||
    /[\r\n]/u.test(secret)
  ) return fail();
  return secret;
}

/** Runs inside the wake worker immediately after its DB bundle receipt. */
export async function captureRealBlockSlaPublicObservations(input: Readonly<{
  deliveryReceiptId: string;
  env?: Environment;
  fetch?: typeof fetch;
  store?: RealBlockSlaCaptureStore;
  target?: RealBlockSlaCaptureTarget;
  hardDeadlineMs?: number;
}>): Promise<void> {
  const env = input.env ?? process.env;
  const expectedDeployment = loadVercelWakeDeploymentBinding(env);
  const bypassSecret = automationBypassSecret(env);
  const hardDeadlineMs = input.hardDeadlineMs ?? DEFAULT_CAPTURE_DEADLINE_MS;
  if (
    !Number.isSafeInteger(hardDeadlineMs) ||
    hardDeadlineMs < 1 ||
    hardDeadlineMs > DEFAULT_CAPTURE_DEADLINE_MS
  ) return fail();
  const store = input.store ?? createConfiguredRealBlockSlaCaptureStore(env);
  const ownsStore = input.store === undefined;
  try {
    const receiptId = positiveIdentifier(input.deliveryReceiptId);
    const target = input.target ?? await store.target(receiptId);
    if (target.deliveryReceiptId !== receiptId) return fail();
    assertDeployment(target, expectedDeployment);
    const remainingMs = Math.min(
      hardDeadlineMs,
      new Date(target.databaseReceivedAt).valueOf() + 10_000 - Date.now() - 250,
    );
    if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) return fail();
    const signal = AbortSignal.timeout(remainingMs);
    const address = target.tokenAddress.toLowerCase();
    const requests = [
      Object.freeze({
        surface: "explore-token" as const,
        url: `${target.deployment.deploymentOrigin}/api/explore/token?address=${address}`,
      }),
      Object.freeze({
        surface: "classic-chart" as const,
        url: `${target.deployment.deploymentOrigin}/api/explore/token/chart?address=${address}&range=1h`,
      }),
    ];
    const fetcher = input.fetch ?? fetch;
    const captures = await Promise.all(requests.map(async (request) => {
      const response = await fetcher(request.url, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal,
        headers: {
          accept: "application/json",
          "x-vercel-protection-bypass": bypassSecret,
        },
      });
      const cacheControl = response.headers.get("cache-control")
        ?.split(",").map((value) => value.trim().toLowerCase());
      if (response.status !== 200 || !cacheControl?.includes("no-store")) return fail();
      const body = await boundedResponseBody(response);
      const binder = exactMarketBinder(body, target);
      return Object.freeze({ request, body, binder });
    }));
    if (
      captures[0]!.binder.releaseVersion !== captures[1]!.binder.releaseVersion ||
      captures[0]!.binder.reorgGeneration !== captures[1]!.binder.reorgGeneration ||
      captures[0]!.binder.evidenceCommitment !== captures[1]!.binder.evidenceCommitment
    ) return fail();
    const token = captures.find((capture) => capture.request.surface === "explore-token");
    const chart = captures.find((capture) => capture.request.surface === "classic-chart");
    if (!token || !chart) return fail();
    await store.recordPair({
      target,
      token: Object.freeze({
        status: 200,
        cacheControl: "no-store",
        body: token.body,
      }),
      chart: Object.freeze({
        status: 200,
        cacheControl: "no-store",
        body: chart.body,
      }),
    });
  } finally {
    if (ownsStore) await store.close();
  }
}

/** Export-only operator path; it never performs or replaces observations. */
export async function captureRealBlockSla(input: Readonly<{
  armId: string;
  challenge: string;
  env?: Environment;
  store?: RealBlockSlaCaptureStore;
}>): Promise<JsonRecord> {
  if (!CHALLENGE.test(input.challenge)) return fail();
  const env = input.env ?? process.env;
  const expectedDeployment = loadVercelWakeDeploymentBinding(env);
  const store = input.store ?? createConfiguredRealBlockSlaCaptureStore(env);
  const ownsStore = input.store === undefined;
  try {
    const target = await store.targetForArm(exactUuid(input.armId));
    assertDeployment(target, expectedDeployment);
    const challengeSha256 = `0x${createHash("sha256")
      .update(input.challenge, "utf8").digest("hex")}` as HexBytes32;
    const exported = await store.export(target.deliveryReceiptId, challengeSha256);
    const receiptSha256 = exported.receiptSha256;
    const probeToken = env.PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN;
    if (
      exported.kind !== "programmable-real-block-sla-db-attestation" ||
      exported.schemaVersion !== 2 ||
      typeof receiptSha256 !== "string" ||
      !/^0x[0-9a-f]{64}$/u.test(receiptSha256) ||
      typeof probeToken !== "string" ||
      Buffer.byteLength(probeToken, "utf8") < 32
    ) return fail();
    return Object.freeze({
      ...exported,
      challenge: input.challenge,
      attestationHmacSha256: `0x${createHmac("sha256", probeToken)
        .update(`${canonicalJson(exported)}:${input.challenge}`, "utf8")
        .digest("hex")}`,
    });
  } finally {
    if (ownsStore) await store.close();
  }
}
