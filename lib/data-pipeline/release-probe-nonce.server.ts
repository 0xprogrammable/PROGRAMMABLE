import "server-only";

import { createHash } from "node:crypto";

import { CircuitBreaker } from "./circuit";
import { loadDataPipelineConfig } from "./config";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import {
  createPostgresExecutor,
  type PostgresExecutor,
} from "./postgres";
import { validatedPostgresConnectionTarget } from "./postgres-connection.server";

const RELEASE_PROBE_ROLE = "programmable_release_probe_nonce";
const RELEASE_PROBE_LOGIN = "programmable_release_probe_nonce_login";
const RELEASE_PROBE_ROUTES = new Set([
  "explore-list",
  "explore-token",
  "explore-chart",
  "creator-profile",
  "classic-v3-profile",
  "launch-lookup",
]);
const RELEASE_PROBE_NONCE_CONSUMER = Symbol.for(
  "programmable.data-pipeline.release-probe-nonce-consumer.v1",
);

type ConsumerRegistry = {
  [RELEASE_PROBE_NONCE_CONSUMER]?: Promise<ReleaseProbeNonceConsumer>;
};

export type ReleaseProbeNonceInput = Readonly<{
  route: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}>;

export type ReleaseProbeNonceConsumer = Readonly<{
  consume(input: ReleaseProbeNonceInput): Promise<boolean>;
  close(): Promise<void>;
}>;

function registry(): ConsumerRegistry {
  return globalThis as typeof globalThis & ConsumerRegistry;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.valueOf());
}

function validateInput(input: ReleaseProbeNonceInput): void {
  if (
    !RELEASE_PROBE_ROUTES.has(input.route) ||
    typeof input.nonce !== "string" ||
    input.nonce.length < 1 ||
    input.nonce.length > 256 ||
    !validDate(input.issuedAt) ||
    !validDate(input.expiresAt) ||
    input.expiresAt.valueOf() <= input.issuedAt.valueOf()
  ) {
    throw invalidInput("postgres", "release-probe-nonce");
  }
}

export function createReleaseProbeNonceConsumer(input: {
  executor: PostgresExecutor;
}): ReleaseProbeNonceConsumer {
  const circuit = new CircuitBreaker({ dependency: "postgres" });
  return Object.freeze({
    async consume(candidate: ReleaseProbeNonceInput): Promise<boolean> {
      validateInput(candidate);
      const digest = createHash("sha256")
        .update(candidate.nonce, "utf8")
        .digest();

      return circuit.execute(async () => {
        try {
          return await input.executor.transaction(async (transaction) => {
            await transaction.query(`set local role ${RELEASE_PROBE_ROLE}`);
            await transaction.query("set local statement_timeout = '1000ms'");
            await transaction.query("set local lock_timeout = '250ms'");
            await transaction.query(
              "set local idle_in_transaction_session_timeout = '2000ms'",
            );
            const identities = await transaction.query<{
              session_user: unknown;
              active_role: unknown;
            }>(
              "select session_user::text as session_user, current_setting('role', true) as active_role",
            );
            if (
              identities.length !== 1 ||
              identities[0]?.session_user !== RELEASE_PROBE_LOGIN ||
              identities[0]?.active_role !== RELEASE_PROBE_ROLE
            ) {
              throw validationError("postgres", "release-probe-role");
            }

            const rows = await transaction.query<{ consumed: unknown }>(
              "select programmable_release_probe_private.consume_release_probe_nonce_v1($1::text, $2::bytea, $3::timestamptz, $4::timestamptz) as consumed",
              [candidate.route, digest, candidate.issuedAt, candidate.expiresAt],
            );
            if (
              rows.length !== 1 ||
              typeof rows[0]?.consumed !== "boolean"
            ) {
              throw validationError("postgres", "release-probe-consume");
            }
            return rows[0].consumed;
          });
        } catch (error) {
          if (error instanceof DataPipelineError) throw error;
          throw dataPipelineError({
            dependency: "postgres",
            code: "query_failed",
            retryable: true,
            countsTowardCircuit: true,
          });
        }
      });
    },
    close: () => input.executor.close(),
  });
}

function constructReleaseProbeNonceConsumer(): ReleaseProbeNonceConsumer {
  const config = loadDataPipelineConfig();
  const connectionString = config.postgres.releaseProbeConnectionString;
  if (!connectionString) {
    throw dataPipelineError({
      dependency: "config",
      code: "invalid_config",
      retryable: false,
      countsTowardCircuit: false,
    });
  }
  const target = validatedPostgresConnectionTarget(connectionString);
  if (!target.isLoopback && !config.postgres.sslCaPem) {
    throw dataPipelineError({
      dependency: "config",
      code: "invalid_config",
      retryable: false,
      countsTowardCircuit: false,
    });
  }
  return createReleaseProbeNonceConsumer({
    executor: createPostgresExecutor({
      connectionString,
      sslCaPem: config.postgres.sslCaPem,
      maxConnections: 1,
      connectTimeoutMs: config.postgres.connectTimeoutMs,
      idleTimeoutMs: config.postgres.idleTimeoutMs,
      allowInsecureLoopback: target.isLoopback,
    }),
  });
}

function getReleaseProbeNonceConsumer(): Promise<ReleaseProbeNonceConsumer> {
  const state = registry();
  const existing = state[RELEASE_PROBE_NONCE_CONSUMER];
  if (existing) return existing;
  const created = Promise.resolve().then(constructReleaseProbeNonceConsumer);
  state[RELEASE_PROBE_NONCE_CONSUMER] = created;
  return created;
}

export async function consumeReleaseProbeNonce(
  input: ReleaseProbeNonceInput,
): Promise<boolean> {
  return (await getReleaseProbeNonceConsumer()).consume(input);
}

/** Test isolation only. Production lifecycle is process-owned. */
export async function resetReleaseProbeNonceConsumerForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw invalidInput("config", "release-probe-consumer-reset");
  }
  const state = registry();
  const existing = state[RELEASE_PROBE_NONCE_CONSUMER];
  delete state[RELEASE_PROBE_NONCE_CONSUMER];
  if (!existing) return;
  const consumer = await existing.catch(() => null);
  if (consumer) await consumer.close();
}
