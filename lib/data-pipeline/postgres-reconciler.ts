import "server-only";

import { DataPipelineError } from "./errors";
import type {
  PostgresExecutor,
  PostgresTransaction,
} from "./postgres";

const RECONCILER_LOGIN_ROLE = "programmable_reconciler_login";
const RECONCILER_CAPABILITY_ROLE = "programmable_reconciler";

export type ReconcilerSqlDisposition =
  | "retry-serialization"
  | "retry-transient"
  | "fatal-gateway-membership"
  | "fatal-codec-or-caller"
  | "immutable-replay-conflict"
  | "stale-checkpoint"
  | "fatal-integrity"
  | "fatal-unknown";

export type ReconcilerSqlClassification = Readonly<{
  sqlState: string | null;
  disposition: ReconcilerSqlDisposition;
  retryable: boolean;
}>;

function canonicalSqlState(value: unknown): string | null {
  return typeof value === "string" && /^[0-9A-Z]{5}$/u.test(value)
    ? value
    : null;
}

export function classifyReconcilerSqlState(
  sqlStateInput: unknown,
): ReconcilerSqlClassification {
  const sqlState = canonicalSqlState(sqlStateInput);
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
      disposition: "retry-transient",
      retryable: true,
    });
  }
  if (sqlState === "42501") {
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
  if (sqlState === "55000") {
    return Object.freeze({
      sqlState,
      disposition: "stale-checkpoint",
      retryable: true,
    });
  }
  if (sqlState?.startsWith("23")) {
    return Object.freeze({
      sqlState,
      disposition: "fatal-integrity",
      retryable: false,
    });
  }
  return Object.freeze({
    sqlState,
    disposition: "fatal-unknown",
    retryable: false,
  });
}

function sqlStateFromUnknown(error: unknown): unknown {
  return error !== null && typeof error === "object"
    ? Reflect.get(error, "code")
    : null;
}

export class ReconcilerDatabaseError extends Error {
  readonly sqlState: string | null;
  readonly disposition: ReconcilerSqlDisposition;
  readonly retryable: boolean;

  constructor(classification: ReconcilerSqlClassification) {
    super("Reconciler database operation failed");
    this.name = "ReconcilerDatabaseError";
    this.sqlState = classification.sqlState;
    this.disposition = classification.disposition;
    this.retryable = classification.retryable;
  }

  static fromUnknown(error: unknown): ReconcilerDatabaseError {
    if (error instanceof ReconcilerDatabaseError) return error;
    return new ReconcilerDatabaseError(
      classifyReconcilerSqlState(sqlStateFromUnknown(error)),
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

function gatewayIdentityFailure(): ReconcilerDatabaseError {
  return new ReconcilerDatabaseError(
    Object.freeze({
      sqlState: null,
      disposition: "fatal-gateway-membership",
      retryable: false,
    }),
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
    rows[0]?.session_user !== RECONCILER_LOGIN_ROLE
  ) {
    throw gatewayIdentityFailure();
  }
}

async function assumeAndVerifyCapabilityRole(
  transaction: PostgresTransaction,
): Promise<void> {
  await transaction.query("set local role programmable_reconciler");
  await transaction.query("set local statement_timeout = '3000ms'");
  await transaction.query("set local lock_timeout = '500ms'");
  await transaction.query(
    "set local idle_in_transaction_session_timeout = '5000ms'",
  );
  const rows = await transaction.query<{
    session_user: unknown;
    current_role: unknown;
  }>(
    "select session_user::text as session_user, current_role::text as current_role",
  );
  if (
    rows.length !== 1 ||
    rows[0]?.session_user !== RECONCILER_LOGIN_ROLE ||
    rows[0]?.current_role !== RECONCILER_CAPABILITY_ROLE
  ) {
    throw gatewayIdentityFailure();
  }
}

export function createReconcilerDatabaseGateway(input: {
  executor: PostgresExecutor;
}) {
  return Object.freeze({
    async transaction<T>(
      work: (transaction: PostgresTransaction) => Promise<T>,
    ): Promise<T> {
      try {
        return await input.executor.transaction(async (transaction) => {
          await assertGatewayLogin(transaction);
          await assumeAndVerifyCapabilityRole(transaction);
          return work(transaction);
        });
      } catch (error) {
        if (error instanceof DataPipelineError) throw error;
        throw ReconcilerDatabaseError.fromUnknown(error);
      }
    },
  });
}
