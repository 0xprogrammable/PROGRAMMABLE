import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMarketProjectorDatabaseGateway } from "../../lib/data-pipeline/market-projector-runtime.server";
import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";

type RecordedQuery = Readonly<{
  text: string;
  values: readonly PostgresParameter[];
}>;

class FakeMarketExecutor implements PostgresExecutor {
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
        if (text === "select session_user::text as session_user") {
          return [
            { session_user: this.sessionUser },
          ] as unknown as readonly Row[];
        }
        if (
          text ===
          "select session_user::text as session_user, current_role::text as current_role"
        ) {
          return [
            {
              session_user: this.sessionUser,
              current_role: this.currentRole,
            },
          ] as unknown as readonly Row[];
        }
        return [] as unknown as readonly Row[];
      },
    });
  }
}

describe("market projector Postgres gateway", () => {
  it("authenticates the dedicated login and verifies the narrow capability role", async () => {
    const executor = new FakeMarketExecutor();
    const gateway = createMarketProjectorDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "ok")).resolves.toBe("ok");
    expect(executor.queries.map(({ text }) => text)).toEqual([
      "select session_user::text as session_user",
      "set local role programmable_reconciler",
      "set local statement_timeout = '900ms'",
      "set local lock_timeout = '200ms'",
      "set local idle_in_transaction_session_timeout = '2000ms'",
      "select session_user::text as session_user, current_role::text as current_role",
    ]);
  });

  it.each([
    "postgres",
    "programmable_reconciler_login_admin",
    "supabase_admin",
  ])("fails before SET ROLE for authenticated login %s", async (sessionUser) => {
    const executor = new FakeMarketExecutor(sessionUser);
    const gateway = createMarketProjectorDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "never")).rejects.toMatchObject({
      name: "DataPipelineError",
      dependency: "postgres",
      code: "invalid_input",
      retryable: false,
    });
    expect(executor.queries.map(({ text }) => text)).toEqual([
      "select session_user::text as session_user",
    ]);
  });

  it("fails when SET ROLE does not produce the reconciler capability", async () => {
    const executor = new FakeMarketExecutor(
      "programmable_reconciler_login",
      "programmable_reconciler_login",
    );
    const gateway = createMarketProjectorDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "never")).rejects.toMatchObject({
      name: "DataPipelineError",
      dependency: "postgres",
      code: "invalid_input",
      retryable: false,
    });
    expect(executor.queries.at(-1)?.text).toBe(
      "select session_user::text as session_user, current_role::text as current_role",
    );
  });
});
