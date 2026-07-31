import "server-only";

import { DataPipelineError } from "./errors";
import type {
  PostgresExecutor,
  PostgresTransaction,
} from "./postgres";

const PROJECTOR_LOGIN_ROLE = "programmable_projector_login";
const PROJECTOR_CAPABILITY_ROLE = "programmable_projector";

export type ProjectorSqlStateScope =
  | "batch"
  | "candidate-local"
  | "dynamic-parent"
  | "gateway";

export type ProjectorSqlDisposition =
  | "retry-serialization"
  | "transient-no-candidate-penalty"
  | "fatal-gateway-membership"
  | "fatal-codec-or-caller"
  | "immutable-replay-conflict"
  | "quarantine-candidate"
  | "abort-batch-invariant"
  | "defer-dynamic-parent"
  | "fatal-integrity"
  | "idempotence-reread"
  | "fatal-unknown";

export type ProjectorSqlClassification = Readonly<{
  sqlState: string | null;
  disposition: ProjectorSqlDisposition;
  retryable: boolean;
}>;

function canonicalSqlState(value: unknown): string | null {
  return typeof value === "string" && /^[0-9A-Z]{5}$/u.test(value)
    ? value
    : null;
}

export function classifyProjectorSqlState(input: {
  sqlState: unknown;
  scope: ProjectorSqlStateScope;
}): ProjectorSqlClassification {
  const sqlState = canonicalSqlState(input.sqlState);
  if (sqlState === "40001" || sqlState === "40P01") {
    return Object.freeze({
      sqlState,
      disposition: "retry-serialization",
      retryable: true,
    });
  }
  if (
    sqlState === "55P03" ||
    sqlState === "57014" ||
    sqlState === "57P01" ||
    sqlState?.startsWith("08")
  ) {
    return Object.freeze({
      sqlState,
      disposition: "transient-no-candidate-penalty",
      retryable: true,
    });
  }
  if (sqlState === "42501" || input.scope === "gateway") {
    return Object.freeze({
      sqlState,
      disposition: "fatal-gateway-membership",
      retryable: false,
    });
  }
  if (sqlState === "22023" || sqlState === "22P02" || sqlState === "22003") {
    return Object.freeze({
      sqlState,
      disposition: "fatal-codec-or-caller",
      retryable: false,
    });
  }
  if (sqlState === "23505") {
    return Object.freeze({
      sqlState,
      disposition: "immutable-replay-conflict",
      retryable: false,
    });
  }
  if (sqlState === "23514") {
    return Object.freeze({
      sqlState,
      disposition:
        input.scope === "candidate-local"
          ? "quarantine-candidate"
          : "abort-batch-invariant",
      retryable: false,
    });
  }
  if (sqlState === "23503") {
    return Object.freeze({
      sqlState,
      disposition:
        input.scope === "dynamic-parent"
          ? "defer-dynamic-parent"
          : "fatal-integrity",
      retryable: input.scope === "dynamic-parent",
    });
  }
  if (sqlState === "55000") {
    return Object.freeze({
      sqlState,
      disposition: "idempotence-reread",
      retryable: true,
    });
  }
  return Object.freeze({
    sqlState,
    disposition: "fatal-unknown",
    retryable: false,
  });
}

function sqlStateFromUnknown(error: unknown): unknown {
  if (error === null || typeof error !== "object") return null;
  return Reflect.get(error, "code");
}

export class ProjectorDatabaseError extends Error {
  readonly sqlState: string | null;
  readonly disposition: ProjectorSqlDisposition;
  readonly retryable: boolean;

  constructor(classification: ProjectorSqlClassification) {
    super("Projector database operation failed");
    this.name = "ProjectorDatabaseError";
    this.sqlState = classification.sqlState;
    this.disposition = classification.disposition;
    this.retryable = classification.retryable;
  }

  static fromUnknown(
    error: unknown,
    scope: ProjectorSqlStateScope,
  ): ProjectorDatabaseError {
    if (error instanceof ProjectorDatabaseError) return error;
    return new ProjectorDatabaseError(
      classifyProjectorSqlState({
        sqlState: sqlStateFromUnknown(error),
        scope,
      }),
    );
  }

  toJSON() {
    return {
      name: this.name,
      sqlState: this.sqlState,
      disposition: this.disposition,
      retryable: this.retryable,
    };
  }
}

function gatewayIdentityFailure(): ProjectorDatabaseError {
  return new ProjectorDatabaseError(
    classifyProjectorSqlState({ sqlState: null, scope: "gateway" }),
  );
}

async function assertGatewayLogin(
  transaction: PostgresTransaction,
): Promise<void> {
  const rows = await transaction.query<{ session_user: unknown }>(
    "select session_user::text as session_user",
  );
  if (
    rows.length !== 1 ||
    rows[0]?.session_user !== PROJECTOR_LOGIN_ROLE
  ) {
    throw gatewayIdentityFailure();
  }
}

async function assumeAndVerifyCapabilityRole(
  transaction: PostgresTransaction,
): Promise<void> {
  await transaction.query("set local role programmable_projector");
  await transaction.query("set local statement_timeout = '1000ms'");
  await transaction.query("set local lock_timeout = '250ms'");
  await transaction.query(
    "set local idle_in_transaction_session_timeout = '2000ms'",
  );
  const rows = await transaction.query<{
    session_user: unknown;
    current_role: unknown;
  }>(
    "select session_user::text as session_user, current_role::text as current_role",
  );
  if (
    rows.length !== 1 ||
    rows[0]?.session_user !== PROJECTOR_LOGIN_ROLE ||
    rows[0]?.current_role !== PROJECTOR_CAPABILITY_ROLE
  ) {
    throw gatewayIdentityFailure();
  }
}

export function createProjectorDatabaseGateway(input: {
  executor: PostgresExecutor;
}) {
  return Object.freeze({
    async transaction<T>(
      work: (transaction: PostgresTransaction) => Promise<T>,
      scope: ProjectorSqlStateScope = "batch",
    ): Promise<T> {
      try {
        return await input.executor.transaction(async (transaction) => {
          await assertGatewayLogin(transaction);
          await assumeAndVerifyCapabilityRole(transaction);
          return work(transaction);
        });
      } catch (error) {
        if (error instanceof DataPipelineError) throw error;
        throw ProjectorDatabaseError.fromUnknown(error, scope);
      }
    },
  });
}
