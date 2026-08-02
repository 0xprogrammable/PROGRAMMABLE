import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { CircuitBreaker } from "./circuit";
import {
  canonicalBytes32,
  hexToBytes,
  parseNonnegativeIntegerText,
  type HexBytes32,
} from "./codecs";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import {
  createPostgresExecutor,
  type PostgresExecutor,
  type PostgresTransaction,
} from "./postgres";
import {
  validatedPostgresConnectionTarget,
  validatedPostgresSslCa,
} from "./postgres-connection.server";
import type {
  QuickNodeStreamBlockHint,
  QuickNodeStreamWake,
} from "./quicknode-stream-wake.server";

const RUNTIME_LOGIN_ROLE = "programmable_projector_runtime_login";
const RUNTIME_CAPABILITY_ROLE = "programmable_projector_runtime";
const RETRY_DELAY_MS = 2_000;
const MAXIMUM_SLA_RETRY_WAIT_MS = 2_000;
const MAXIMUM_SLA_DRAIN_ATTEMPTS = 4;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const CONFIGURED_QUEUE = Symbol.for(
  "programmable.data-pipeline.quicknode-wake-queue.v1",
);

type Environment = Readonly<Record<string, string | undefined>>;
type QueueRegistry = {
  [CONFIGURED_QUEUE]?: Promise<QuickNodeWakeQueue>;
};

export type QuickNodeWakeEnqueueResult = Readonly<{
  wakeId: string;
  deliveryReceiptId: string;
  blockNumberHint: string;
  enqueued: boolean;
  state: "pending" | "processing" | "completed";
  requestReceivedAt: string;
  databaseReceivedAt: string;
  persistedAt: string;
  payloadSha256: HexBytes32;
  queueRowCountBefore: 0 | 1;
  queueRowCountAfter: 1;
}>;

export type QuickNodeWakeDeploymentBinding = Readonly<{
  repositoryCommit: string;
  deploymentId: string;
  deploymentOrigin: string;
  projectId: string;
}>;

export type QuickNodeWakeAcknowledgement = Readonly<{
  deliveryReceiptId: string;
  wakeId: string;
  status: 202;
  cacheControl: "no-store";
  acknowledgedAt: string;
}>;

export type QuickNodeWakeClaim = Readonly<{
  wakeId: string;
  deliveryReceiptId: string | null;
  blockNumberHint: string;
  hint: QuickNodeStreamBlockHint;
  payload: string;
  leaseGeneration: string;
  leaseExpiresAt: string;
  attemptCount: number;
  workerId: string;
  leaseTokenDigest: HexBytes32;
}>;

export type QuickNodeWakeRetrySchedule = Readonly<{
  availableAt: string;
  deadlineAt: string;
}>;

export type DurableWakeJobPorts = Readonly<{
  firstStage(job: QuickNodeWakeClaim): Promise<void>;
  canonicalCatchUp(job: QuickNodeWakeClaim): Promise<void>;
}>;

export type QuickNodeWakeQueue = Readonly<{
  enqueue(
    wake: QuickNodeStreamWake,
    deployment: QuickNodeWakeDeploymentBinding,
  ): Promise<QuickNodeWakeEnqueueResult>;
  acknowledge(
    receipt: QuickNodeWakeEnqueueResult,
  ): Promise<QuickNodeWakeAcknowledgement>;
  consumeRealBlockSlaProviderRetryOnce(
    deliveryReceiptId: string,
    wakeId: string,
  ): Promise<boolean>;
  claim(): Promise<QuickNodeWakeClaim | null>;
  complete(claim: QuickNodeWakeClaim): Promise<boolean>;
  retry(claim: QuickNodeWakeClaim, delayMs?: number): Promise<boolean>;
  retrySchedule(wakeId: string): Promise<QuickNodeWakeRetrySchedule | null>;
  close(): Promise<void>;
}>;

function registry(): QueueRegistry {
  return globalThis as typeof globalThis & QueueRegistry;
}

function invalidQueue(): never {
  throw invalidInput("postgres", "quicknode-wake-queue");
}

function databaseError(): DataPipelineError {
  return dataPipelineError({
    dependency: "postgres",
    code: "query_failed",
    retryable: true,
    countsTowardCircuit: true,
  });
}

function identifier(value: unknown): string {
  try {
    return parseNonnegativeIntegerText(
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch {
    return invalidQueue();
  }
}

function positiveIdentifier(value: unknown): string {
  const parsed = identifier(value);
  if (parsed === "0") return invalidQueue();
  return parsed;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (date === null || !Number.isFinite(date.valueOf())) return invalidQueue();
  return date.toISOString();
}

function attemptCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 32) {
    return invalidQueue();
  }
  return parsed;
}

function binaryCount(value: unknown): 0 | 1 {
  const parsed = typeof value === "number" ? value : Number(value);
  if ((parsed !== 0 && parsed !== 1) || !Number.isSafeInteger(parsed)) {
    return invalidQueue();
  }
  return parsed;
}

function deploymentBinding(
  value: QuickNodeWakeDeploymentBinding,
): QuickNodeWakeDeploymentBinding {
  if (
    !/^[0-9a-f]{40}$/u.test(value.repositoryCommit) ||
    value.repositoryCommit === "0".repeat(40) ||
    !/^dpl_[A-Za-z0-9]{20,128}$/u.test(value.deploymentId) ||
    !/^https:\/\/[a-z0-9.-]+\.vercel\.app$/u.test(value.deploymentOrigin) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value.projectId)
  ) {
    return invalidQueue();
  }
  return Object.freeze({ ...value });
}

function issuedAt(timestampSeconds: string): Date {
  if (!/^(?:0|[1-9]\d{0,11})$/u.test(timestampSeconds)) {
    return invalidQueue();
  }
  const seconds = Number(timestampSeconds);
  const date = new Date(seconds * 1_000);
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(date.valueOf())) {
    return invalidQueue();
  }
  return date;
}

function payloadText(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 2 ||
    Buffer.byteLength(value, "utf8") > 128 * 1024
  ) {
    return invalidQueue();
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return invalidQueue();
  } catch {
    return invalidQueue();
  }
  return value;
}

function canonicalHint(value: unknown): QuickNodeStreamBlockHint {
  if (
    value === null ||
    typeof value !== "object" ||
    Reflect.get(value, "chainId") !== 1 ||
    typeof Reflect.get(value, "blockNumber") !== "string" ||
    typeof Reflect.get(value, "streamId") !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(
      Reflect.get(value, "streamId") as string,
    ) ||
    !Array.isArray(Reflect.get(value, "reorgedBlockNumbers"))
  ) {
    return invalidQueue();
  }
  const blockNumber = identifier(Reflect.get(value, "blockNumber"));
  const reorged = Reflect.get(value, "reorgedBlockNumbers") as unknown[];
  if (reorged.length > 64) return invalidQueue();
  const reorgedBlockNumbers = reorged.map(identifier);
  if (new Set(reorgedBlockNumbers).size !== reorgedBlockNumbers.length) {
    return invalidQueue();
  }
  return Object.freeze({
    chainId: 1 as const,
    blockNumber,
    streamId: Reflect.get(value, "streamId") as string,
    reorgedBlockNumbers: Object.freeze(reorgedBlockNumbers),
  });
}

function hintText(value: unknown): Readonly<{
  hint: QuickNodeStreamBlockHint;
  text: string;
}> {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return invalidQueue();
    }
  }
  const hint = canonicalHint(candidate);
  const text = JSON.stringify(hint);
  if (Buffer.byteLength(text, "utf8") < 32 || Buffer.byteLength(text, "utf8") > 8_192) {
    return invalidQueue();
  }
  return Object.freeze({ hint, text });
}

async function assumeRuntimeRole(
  transaction: PostgresTransaction,
): Promise<void> {
  const loginRows = await transaction.query<{ session_user: unknown }>(
    "select session_user::text as session_user",
  );
  if (
    loginRows.length !== 1 ||
    loginRows[0]?.session_user !== RUNTIME_LOGIN_ROLE
  ) {
    throw validationError("postgres", "quicknode-wake-login");
  }
  await transaction.query("set local role programmable_projector_runtime");
  await transaction.query("set local statement_timeout = '1000ms'");
  await transaction.query("set local lock_timeout = '250ms'");
  await transaction.query(
    "set local idle_in_transaction_session_timeout = '2000ms'",
  );
  const identityRows = await transaction.query<{
    session_user: unknown;
    current_role: unknown;
    configured_role: unknown;
  }>(
    "select session_user::text as session_user, current_role::text as current_role, current_setting('role', true)::text as configured_role",
  );
  if (
    identityRows.length !== 1 ||
    identityRows[0]?.session_user !== RUNTIME_LOGIN_ROLE ||
    identityRows[0]?.current_role !== RUNTIME_CAPABILITY_ROLE ||
    identityRows[0]?.configured_role !== RUNTIME_CAPABILITY_ROLE
  ) {
    throw validationError("postgres", "quicknode-wake-role");
  }
}

function tokenDigest(): HexBytes32 {
  return canonicalBytes32(
    `0x${createHash("sha256").update(randomBytes(32)).digest("hex")}`,
  );
}

export function createQuickNodeWakeQueue(input: Readonly<{
  executor: PostgresExecutor;
  uuid?: () => string;
  tokenDigest?: () => HexBytes32;
}>): QuickNodeWakeQueue {
  const circuit = new CircuitBreaker({ dependency: "postgres" });
  const uuid = input.uuid ?? randomUUID;
  const createTokenDigest = input.tokenDigest ?? tokenDigest;

  async function execute<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return circuit.execute(async () => {
      try {
        return await input.executor.transaction(async (transaction) => {
          await assumeRuntimeRole(transaction);
          return operation(transaction);
        });
      } catch (error) {
        if (error instanceof DataPipelineError) throw error;
        throw databaseError();
      }
    });
  }

  return Object.freeze({
    async enqueue(
      wake: QuickNodeStreamWake,
      deploymentValue: QuickNodeWakeDeploymentBinding,
    ): Promise<QuickNodeWakeEnqueueResult> {
      if (wake.kind !== "work") return invalidQueue();
      const nonceDigest = canonicalBytes32(wake.nonceDigest);
      const serializedHint = hintText(wake.hint);
      const blockNumberHint = serializedHint.hint.blockNumber;
      const signedAt = issuedAt(wake.timestamp);
      const requestReceivedAt = timestamp(wake.requestReceivedAt);
      const deployment = deploymentBinding(deploymentValue);
      const payload = payloadText(wake.payload);
      if (Buffer.byteLength(payload, "utf8") !== wake.payloadBytes) {
        return invalidQueue();
      }
      const payloadDigest = createHash("sha256")
        .update(payload, "utf8")
        .digest();
      if (nonceDigest === ZERO_BYTES32) return invalidQueue();

      return execute(async (transaction) => {
        const rows = await transaction.query<{
          accepted: unknown;
          wake_id: unknown;
          enqueued: unknown;
          block_number_hint: unknown;
          job_state: unknown;
          delivery_receipt_id: unknown;
          handler_received_at: unknown;
          database_received_at: unknown;
          job_persisted_at: unknown;
          queue_row_count_before: unknown;
          queue_row_count_after: unknown;
        }>(
          `select * from programmable_wake_private.enqueue_quicknode_wake_v2(
             $1::bytea, $2::bigint, $3::text, $4::timestamptz, $5::text,
             $6::bytea, $7::timestamptz, $8::text, $9::text, $10::text,
             $11::text, $12::text
           )`,
          [
            hexToBytes(nonceDigest),
            blockNumberHint,
            serializedHint.text,
            signedAt,
            payload,
            payloadDigest,
            new Date(requestReceivedAt),
            serializedHint.hint.streamId,
            deployment.repositoryCommit,
            deployment.deploymentId,
            deployment.deploymentOrigin,
            deployment.projectId,
          ],
        );
        const row = rows[0];
        if (
          rows.length !== 1 ||
          typeof row?.accepted !== "boolean" ||
          typeof row.enqueued !== "boolean" ||
          (row.job_state !== "pending" &&
            row.job_state !== "processing" &&
            row.job_state !== "completed" &&
            row.job_state !== "capacity")
        ) {
          return invalidQueue();
        }
        if (!row.accepted || row.job_state === "capacity") {
          throw dataPipelineError({
            dependency: "postgres",
            code: "dependency_unavailable",
            retryable: true,
            countsTowardCircuit: false,
          });
        }
        return Object.freeze({
          wakeId: positiveIdentifier(row.wake_id),
          deliveryReceiptId: positiveIdentifier(row.delivery_receipt_id),
          blockNumberHint: identifier(row.block_number_hint),
          enqueued: row.enqueued,
          state: row.job_state,
          requestReceivedAt: timestamp(row.handler_received_at),
          databaseReceivedAt: timestamp(row.database_received_at),
          persistedAt: timestamp(row.job_persisted_at),
          payloadSha256: canonicalBytes32(
            `0x${Buffer.from(payloadDigest).toString("hex")}`,
          ),
          queueRowCountBefore: binaryCount(
            row.queue_row_count_before,
          ),
          queueRowCountAfter: (() => {
            if (
              binaryCount(
                row.queue_row_count_after,
              ) !== 1
            ) return invalidQueue();
            return 1 as const;
          })(),
        });
      });
    },

    async acknowledge(
      receipt: QuickNodeWakeEnqueueResult,
    ): Promise<QuickNodeWakeAcknowledgement> {
      return execute(async (transaction) => {
        const rows = await transaction.query<{
          delivery_receipt_id: unknown;
          wake_id: unknown;
          response_status: unknown;
          response_cache_control: unknown;
          acknowledged_at: unknown;
        }>(
          "select * from programmable_wake_private.acknowledge_quicknode_wake_v2($1::bigint, $2::bigint)",
          [
            positiveIdentifier(receipt.deliveryReceiptId),
            positiveIdentifier(receipt.wakeId),
          ],
        );
        const row = rows[0];
        if (
          rows.length !== 1 ||
          positiveIdentifier(row?.delivery_receipt_id) !==
            receipt.deliveryReceiptId ||
          positiveIdentifier(row.wake_id) !== receipt.wakeId ||
          Number(row.response_status) !== 202 ||
          row.response_cache_control !== "no-store"
        ) {
          return invalidQueue();
        }
        return Object.freeze({
          deliveryReceiptId: receipt.deliveryReceiptId,
          wakeId: receipt.wakeId,
          status: 202 as const,
          cacheControl: "no-store" as const,
          acknowledgedAt: timestamp(row.acknowledged_at),
        });
      });
    },

    async consumeRealBlockSlaProviderRetryOnce(
      deliveryReceiptId: string,
      wakeId: string,
    ): Promise<boolean> {
      return execute(async (transaction) => {
        const rows = await transaction.query<{ consumed: unknown }>(
          "select programmable_wake_private.consume_real_block_sla_provider_retry_once_v1($1::bigint, $2::bigint) as consumed",
          [
            positiveIdentifier(deliveryReceiptId),
            positiveIdentifier(wakeId),
          ],
        );
        if (rows.length !== 1 || typeof rows[0]?.consumed !== "boolean") {
          return invalidQueue();
        }
        return rows[0].consumed;
      });
    },

    async claim(): Promise<QuickNodeWakeClaim | null> {
      const workerId = `quicknode-wake-${uuid()}`;
      if (!/^quicknode-wake-[0-9a-f-]{36}$/u.test(workerId)) {
        return invalidQueue();
      }
      const leaseTokenDigest = canonicalBytes32(createTokenDigest());
      if (leaseTokenDigest === ZERO_BYTES32) return invalidQueue();

      return execute(async (transaction) => {
        const rows = await transaction.query<{
          wake_id: unknown;
          block_number_hint: unknown;
          block_hint: unknown;
          payload: unknown;
          lease_generation: unknown;
          lease_expires_at: unknown;
          attempt_count: unknown;
        }>(
          "select * from programmable_wake_private.claim_quicknode_wake_v1($1::text, $2::bytea)",
          [workerId, hexToBytes(leaseTokenDigest)],
        );
        if (rows.length === 0) return null;
        if (rows.length !== 1) return invalidQueue();
        const row = rows[0]!;
        const storedHint = hintText(row.block_hint);
        if (storedHint.hint.blockNumber !== identifier(row.block_number_hint)) {
          return invalidQueue();
        }
        const wakeId = positiveIdentifier(row.wake_id);
        const receiptRows = await transaction.query<{ delivery_receipt_id: unknown }>(
          "select programmable_wake_private.get_real_block_sla_delivery_receipt_v1($1::bigint) as delivery_receipt_id",
          [wakeId],
        );
        if (receiptRows.length !== 1) return invalidQueue();
        const rawDeliveryReceiptId = receiptRows[0]?.delivery_receipt_id;
        const deliveryReceiptId = rawDeliveryReceiptId === null
          ? null
          : positiveIdentifier(rawDeliveryReceiptId);
        return Object.freeze({
          wakeId,
          deliveryReceiptId,
          blockNumberHint: storedHint.hint.blockNumber,
          hint: storedHint.hint,
          payload: payloadText(row.payload),
          leaseGeneration: positiveIdentifier(row.lease_generation),
          leaseExpiresAt: timestamp(row.lease_expires_at),
          attemptCount: attemptCount(row.attempt_count),
          workerId,
          leaseTokenDigest,
        });
      });
    },

    async complete(claim: QuickNodeWakeClaim): Promise<boolean> {
      return execute(async (transaction) => {
        const rows = await transaction.query<{ completed: unknown }>(
          "select programmable_wake_private.complete_quicknode_wake_v1($1::bigint, $2::bigint, $3::text, $4::bytea) as completed",
          [
            positiveIdentifier(claim.wakeId),
            positiveIdentifier(claim.leaseGeneration),
            claim.workerId,
            hexToBytes(canonicalBytes32(claim.leaseTokenDigest)),
          ],
        );
        if (rows.length !== 1 || typeof rows[0]?.completed !== "boolean") {
          return invalidQueue();
        }
        return rows[0].completed;
      });
    },

    async retry(
      claim: QuickNodeWakeClaim,
      delayMs = RETRY_DELAY_MS,
    ): Promise<boolean> {
      if (
        !Number.isSafeInteger(delayMs) ||
        delayMs < 0 ||
        delayMs > 60_000
      ) {
        return invalidQueue();
      }
      return execute(async (transaction) => {
        const rows = await transaction.query<{ retried: unknown }>(
          "select programmable_wake_private.retry_quicknode_wake_v1($1::bigint, $2::bigint, $3::text, $4::bytea, $5::integer) as retried",
          [
            positiveIdentifier(claim.wakeId),
            positiveIdentifier(claim.leaseGeneration),
            claim.workerId,
            hexToBytes(canonicalBytes32(claim.leaseTokenDigest)),
            delayMs,
          ],
        );
        if (rows.length !== 1 || typeof rows[0]?.retried !== "boolean") {
          return invalidQueue();
        }
        return rows[0].retried;
      });
    },

    async retrySchedule(wakeId: string): Promise<QuickNodeWakeRetrySchedule | null> {
      return execute(async (transaction) => {
        const rows = await transaction.query<{
          available_at: unknown;
          deadline_at: unknown;
        }>(
          "select * from programmable_wake_private.get_real_block_sla_retry_schedule_v1($1::bigint)",
          [positiveIdentifier(wakeId)],
        );
        if (rows.length === 0) return null;
        if (rows.length !== 1) return invalidQueue();
        const availableAt = timestamp(rows[0]?.available_at);
        const deadlineAt = timestamp(rows[0]?.deadline_at);
        if (new Date(availableAt).valueOf() >= new Date(deadlineAt).valueOf()) {
          return invalidQueue();
        }
        return Object.freeze({ availableAt, deadlineAt });
      });
    },

    close: () => input.executor.close(),
  });
}

export async function processDurableWakeJob(
  job: QuickNodeWakeClaim,
  ports: DurableWakeJobPorts,
): Promise<void> {
  await ports.firstStage(job);
  await ports.canonicalCatchUp(job);
}

function configuredQueue(
  env: Environment = process.env,
): QuickNodeWakeQueue {
  const connectionString = env.PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL;
  const sslCaPem = env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM;
  if (!connectionString) {
    throw dataPipelineError({
      dependency: "config",
      code: "invalid_config",
      retryable: false,
      countsTowardCircuit: false,
    });
  }
  const target = validatedPostgresConnectionTarget(connectionString);
  const validatedCa = target.isLoopback
    ? undefined
    : validatedPostgresSslCa(sslCaPem);
  return createQuickNodeWakeQueue({
    executor: createPostgresExecutor({
      connectionString,
      sslCaPem: validatedCa,
      allowInsecureLoopback: target.isLoopback,
      maxConnections: 1,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 60_000,
    }),
  });
}

async function getConfiguredQueue(): Promise<QuickNodeWakeQueue> {
  const state = registry();
  const existing = state[CONFIGURED_QUEUE];
  if (existing) return existing;
  const created = Promise.resolve().then(() => configuredQueue());
  state[CONFIGURED_QUEUE] = created;
  return created;
}

export async function enqueueConfiguredQuickNodeWake(
  wake: QuickNodeStreamWake,
  deployment: QuickNodeWakeDeploymentBinding,
): Promise<QuickNodeWakeEnqueueResult> {
  return (await getConfiguredQueue()).enqueue(wake, deployment);
}

export async function acknowledgeConfiguredQuickNodeWake(
  receipt: QuickNodeWakeEnqueueResult,
): Promise<QuickNodeWakeAcknowledgement> {
  return (await getConfiguredQueue()).acknowledge(receipt);
}

export async function consumeConfiguredRealBlockSlaProviderRetryOnce(
  receipt: Pick<QuickNodeWakeEnqueueResult, "deliveryReceiptId" | "wakeId">,
): Promise<boolean> {
  return (await getConfiguredQueue()).consumeRealBlockSlaProviderRetryOnce(
    receipt.deliveryReceiptId,
    receipt.wakeId,
  );
}

type QuickNodeWakeDrainClock = Readonly<{
  now(): number;
  sleep(delayMs: number): Promise<void>;
}>;

const SYSTEM_DRAIN_CLOCK: QuickNodeWakeDrainClock = Object.freeze({
  now: () => Date.now(),
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
});

export async function drainQuickNodeWakeQueue(
  queue: Pick<
    QuickNodeWakeQueue,
    "claim" | "complete" | "retry" | "retrySchedule"
  >,
  work: (claim: QuickNodeWakeClaim) => Promise<void>,
  clock: QuickNodeWakeDrainClock = SYSTEM_DRAIN_CLOCK,
): Promise<"idle" | "completed" | "retry-scheduled"> {
  let slaAttemptCount = 0;
  let slaDeadlineAt: number | null = null;
  while (true) {
    if (slaDeadlineAt !== null && clock.now() >= slaDeadlineAt) {
      return "retry-scheduled";
    }
    const claim = await queue.claim();
    if (claim === null) return "idle";
    try {
      await work(claim);
      if (!(await queue.complete(claim))) {
        throw validationError("postgres", "quicknode-wake-completion-fence");
      }
      return "completed";
    } catch (error) {
      const retried = await queue.retry(claim).catch(() => false);
      if (!retried) throw error;
      if (
        claim.deliveryReceiptId === null ||
        ++slaAttemptCount >= MAXIMUM_SLA_DRAIN_ATTEMPTS
      ) return "retry-scheduled";
      const schedule = await queue.retrySchedule(claim.wakeId);
      if (schedule === null) return "retry-scheduled";
      const now = clock.now();
      const availableAt = new Date(schedule.availableAt).valueOf();
      const deadlineAt = new Date(schedule.deadlineAt).valueOf();
      const waitMs = Math.max(0, availableAt - now);
      const paddedWaitMs = Math.min(
        MAXIMUM_SLA_RETRY_WAIT_MS,
        waitMs + 25,
      );
      if (
        !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(availableAt) ||
        !Number.isSafeInteger(deadlineAt) ||
        availableAt >= deadlineAt ||
        now >= deadlineAt ||
        waitMs > MAXIMUM_SLA_RETRY_WAIT_MS ||
        availableAt + 25 >= deadlineAt ||
        paddedWaitMs >= deadlineAt - now
      ) return "retry-scheduled";
      slaDeadlineAt = deadlineAt;
      await clock.sleep(paddedWaitMs);
    }
  }
}

export async function processNextConfiguredQuickNodeWake(
  work: (claim: QuickNodeWakeClaim) => Promise<void>,
): Promise<"idle" | "completed" | "retry-scheduled"> {
  return drainQuickNodeWakeQueue(await getConfiguredQueue(), work);
}

/** Test isolation only. Production lifecycle is process-owned. */
export async function resetQuickNodeWakeQueueForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test") return invalidQueue();
  const state = registry();
  const existing = state[CONFIGURED_QUEUE];
  delete state[CONFIGURED_QUEUE];
  if (!existing) return;
  const queue = await existing.catch(() => null);
  if (queue) await queue.close();
}
