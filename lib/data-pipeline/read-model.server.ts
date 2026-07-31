import "server-only";

import { CircuitBreaker } from "./circuit";
import { INDEXED_ROUTE_FLAG_NAMES, loadDataPipelineConfig } from "./config";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
} from "./errors";
import {
  createPostgresExecutor,
  createPostgresReadModel,
  establishPostgresApiReaderRole,
  type PostgresExecutor,
  type PostgresTransaction,
} from "./postgres";
import { validatedPostgresConnectionTarget } from "./postgres-connection.server";

type BaseServerReadModel = ReturnType<typeof createPostgresReadModel>;

export type ServerReadModel = BaseServerReadModel & {
  /**
   * Runs all readiness, payload, evidence, and version reads in one immutable
   * database snapshot. Do not call ordinary read-model methods inside `work`.
   */
  repeatableReadSnapshot<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
};

const READ_MODEL_SINGLETON = Symbol.for(
  "programmable.data-pipeline.server-read-model.v1",
);
const REQUIRED_READ_MODEL_SINGLETON = Symbol.for(
  "programmable.data-pipeline.server-read-model.required.v1",
);

type SymbolRegistry = {
  [key: symbol]: Promise<ServerReadModel | null> | undefined;
};

function registry(): SymbolRegistry {
  return globalThis as typeof globalThis & SymbolRegistry;
}

function requiresReadModel(
  config: ReturnType<typeof loadDataPipelineConfig>,
): boolean {
  return (
    config.flags.INDEXED_READ_SHADOW_COMPARE_ENABLED ||
    INDEXED_ROUTE_FLAG_NAMES.some((name) => config.flags[name])
  );
}

function createServerReadModel(executor: PostgresExecutor): ServerReadModel {
  const circuit = new CircuitBreaker({ dependency: "postgres" });
  const readModel = createPostgresReadModel({ executor, circuit });

  return Object.freeze({
    ...readModel,
    async repeatableReadSnapshot<T>(
      work: (transaction: PostgresTransaction) => Promise<T>,
    ): Promise<T> {
      return circuit.execute(async () => {
        try {
          return await executor.transaction(async (transaction) => {
            // PostgreSQL requires transaction characteristics before any read.
            await transaction.query(
              "set transaction isolation level repeatable read, read only",
            );
            await establishPostgresApiReaderRole(transaction);
            await transaction.query("set local statement_timeout = '1000ms'");
            await transaction.query("set local lock_timeout = '250ms'");
            await transaction.query(
              "set local idle_in_transaction_session_timeout = '2000ms'",
            );
            return work(transaction);
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
  });
}

function constructServerReadModel(required: boolean): ServerReadModel | null {
  const config = loadDataPipelineConfig();
  if (!required && !requiresReadModel(config)) return null;

  const connectionString = config.postgres.connectionString;
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

  const executor = createPostgresExecutor({
    connectionString,
    sslCaPem: config.postgres.sslCaPem,
    maxConnections: config.postgres.maxConnections,
    connectTimeoutMs: config.postgres.connectTimeoutMs,
    idleTimeoutMs: config.postgres.idleTimeoutMs,
    allowInsecureLoopback: target.isLoopback,
  });
  return createServerReadModel(executor);
}

/**
 * Returns the one process-wide read model. The promise itself is shared so
 * concurrent cold-start requests cannot create competing Postgres pools.
 */
export function getServerReadModel(
  options: Readonly<{ required?: boolean }> = {},
): Promise<ServerReadModel | null> {
  const state = registry();
  if (options.required) {
    const required = state[REQUIRED_READ_MODEL_SINGLETON];
    if (required) return required;
    const ordinary = state[READ_MODEL_SINGLETON];
    const created = Promise.resolve(ordinary)
      .then((existing) => existing ?? constructServerReadModel(true));
    state[REQUIRED_READ_MODEL_SINGLETON] = created;
    state[READ_MODEL_SINGLETON] = created;
    return created;
  }
  const existing = state[READ_MODEL_SINGLETON];
  if (existing) return existing;

  const created = Promise.resolve().then(() => constructServerReadModel(false));
  state[READ_MODEL_SINGLETON] = created;
  return created;
}

/** Test isolation only. Production lifecycle is owned by the server process. */
export async function resetServerReadModelForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw invalidInput("config", "read-model-reset");
  }

  const state = registry();
  const existing = state[READ_MODEL_SINGLETON];
  const required = state[REQUIRED_READ_MODEL_SINGLETON];
  delete state[READ_MODEL_SINGLETON];
  delete state[REQUIRED_READ_MODEL_SINGLETON];
  if (!existing && !required) return;

  const model = await (required ?? existing)!.catch(() => null);
  if (model) await model.close();
}
