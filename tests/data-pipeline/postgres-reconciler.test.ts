import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import {
  ReconcilerDatabaseError,
  classifyReconcilerSqlState,
  createReconcilerDatabaseGateway,
} from "../../lib/data-pipeline/postgres-reconciler";

type RecordedQuery = {
  text: string;
  values: readonly PostgresParameter[];
};

class FakeExecutor implements PostgresExecutor {
  readonly queries: RecordedQuery[] = [];
  readonly close = vi.fn(async () => undefined);

  constructor(
    private readonly sessionUser = "programmable_reconciler_login",
    private readonly currentRole = "programmable_reconciler",
  ) {}

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        this.queries.push({ text, values });
        if (/select session_user::text as session_user$/iu.test(text.trim())) {
          return [{ session_user: this.sessionUser }] as unknown as Row[];
        }
        if (/current_role::text as current_role/iu.test(text)) {
          return [
            {
              session_user: this.sessionUser,
              current_role: this.currentRole,
            },
          ] as unknown as Row[];
        }
        return [] as unknown as Row[];
      },
    });
  }
}

describe("reconciler Postgres gateway", () => {
  it("authenticates the dedicated login before assuming the narrow capability role", async () => {
    const executor = new FakeExecutor();
    const gateway = createReconcilerDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "ok")).resolves.toBe("ok");
    expect(executor.queries.map(({ text }) => text)).toEqual([
      "select session_user::text as session_user",
      "set local role programmable_reconciler",
      "set local statement_timeout = '3000ms'",
      "set local lock_timeout = '500ms'",
      "set local idle_in_transaction_session_timeout = '5000ms'",
      "select session_user::text as session_user, current_role::text as current_role",
    ]);
  });

  it("fails before SET ROLE for any other authenticated login", async () => {
    const executor = new FakeExecutor("postgres");
    const gateway = createReconcilerDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "never")).rejects.toMatchObject({
      name: "ReconcilerDatabaseError",
      disposition: "fatal-gateway-membership",
      retryable: false,
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("fails when SET ROLE did not produce the reconciler capability", async () => {
    const executor = new FakeExecutor(
      "programmable_reconciler_login",
      "programmable_reconciler_login",
    );
    const gateway = createReconcilerDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "never")).rejects.toMatchObject({
      disposition: "fatal-gateway-membership",
    });
  });
});

describe("reconciler SQLSTATE policy", () => {
  it.each([
    ["40001", "retry-serialization", true],
    ["40P01", "retry-serialization", true],
    ["55P03", "retry-transient", true],
    ["57014", "retry-transient", true],
    ["08006", "retry-transient", true],
    ["42501", "fatal-gateway-membership", false],
    ["22023", "fatal-codec-or-caller", false],
    ["23505", "immutable-replay-conflict", false],
    ["23514", "fatal-integrity", false],
    ["55000", "stale-checkpoint", true],
  ] as const)("maps %s to %s", (sqlState, disposition, retryable) => {
    expect(classifyReconcilerSqlState(sqlState)).toEqual({
      sqlState,
      disposition,
      retryable,
    });
  });

  it("never exposes database text, credentials or query details", () => {
    const secret = "postgres://reconciler:secret@example.invalid/database";
    const error = ReconcilerDatabaseError.fromUnknown({
      code: "40001",
      message: secret,
      detail: secret,
      query: `select '${secret}'`,
    });

    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error).toMatchObject({
      disposition: "retry-serialization",
      retryable: true,
    });
  });
});
