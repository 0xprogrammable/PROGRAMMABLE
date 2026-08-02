import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import {
  ProjectorDatabaseError,
  classifyProjectorSqlState,
  createProjectorDatabaseGateway,
  projectionProviderBindingCommitmentV1,
} from "../../lib/data-pipeline/postgres-projector";

type RecordedQuery = {
  text: string;
  values: readonly PostgresParameter[];
};

class FakeExecutor implements PostgresExecutor {
  readonly queries: RecordedQuery[] = [];
  readonly close = vi.fn(async () => undefined);

  constructor(
    private readonly sessionUser = "programmable_projector_login",
    private readonly currentRole = "programmable_projector",
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

describe("projector Postgres gateway", () => {
  it("verifies the login identity before assuming the capability role", async () => {
    const executor = new FakeExecutor();
    const gateway = createProjectorDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "ok")).resolves.toBe("ok");

    expect(executor.queries.map(({ text }) => text)).toEqual([
      "select session_user::text as session_user",
      "set local role programmable_projector",
      "set local statement_timeout = '1000ms'",
      "set local lock_timeout = '250ms'",
      "set local idle_in_transaction_session_timeout = '2000ms'",
      "select session_user::text as session_user, current_role::text as current_role",
    ]);
  });

  it("fails before SET ROLE when the gateway authenticated a different login", async () => {
    const executor = new FakeExecutor("postgres");
    const gateway = createProjectorDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "never")).rejects.toMatchObject({
      name: "ProjectorDatabaseError",
      disposition: "fatal-gateway-membership",
      retryable: false,
    });
    expect(executor.queries).toHaveLength(1);
    expect(executor.queries[0]!.text).toBe(
      "select session_user::text as session_user",
    );
  });

  it("rejects a changed session identity or missing capability role", async () => {
    const executor = new FakeExecutor(
      "programmable_projector_login",
      "programmable_projector_login",
    );
    const gateway = createProjectorDatabaseGateway({ executor });

    await expect(gateway.transaction(async () => "never")).rejects.toMatchObject({
      disposition: "fatal-gateway-membership",
    });
  });
});

describe("projector SQLSTATE policy", () => {
  it.each([
    ["40001", "retry-serialization", true],
    ["40P01", "retry-serialization", true],
    ["55P03", "transient-no-candidate-penalty", true],
    ["57014", "transient-no-candidate-penalty", true],
    ["08006", "transient-no-candidate-penalty", true],
    ["57P01", "transient-no-candidate-penalty", true],
    ["42501", "fatal-gateway-membership", false],
    ["22023", "fatal-codec-or-caller", false],
    ["22P02", "fatal-codec-or-caller", false],
    ["22003", "fatal-codec-or-caller", false],
    ["23505", "immutable-replay-conflict", false],
    ["55000", "idempotence-reread", true],
  ] as const)("maps %s without relying on provider messages", (sqlState, disposition, retryable) => {
    expect(classifyProjectorSqlState({ sqlState, scope: "batch" })).toEqual({
      sqlState,
      disposition,
      retryable,
    });
  });

  it("quarantines only candidate-local check violations", () => {
    expect(
      classifyProjectorSqlState({ sqlState: "23514", scope: "candidate-local" }),
    ).toMatchObject({ disposition: "quarantine-candidate" });
    expect(
      classifyProjectorSqlState({ sqlState: "23514", scope: "batch" }),
    ).toMatchObject({ disposition: "abort-batch-invariant" });
  });

  it("defers an FK violation only for an expected dynamic parent", () => {
    expect(
      classifyProjectorSqlState({ sqlState: "23503", scope: "dynamic-parent" }),
    ).toMatchObject({ disposition: "defer-dynamic-parent", retryable: true });
    expect(
      classifyProjectorSqlState({ sqlState: "23503", scope: "batch" }),
    ).toMatchObject({ disposition: "fatal-integrity", retryable: false });
  });

  it("never exposes a database message or secret through its public error", () => {
    const secret = "postgres://projector:secret@example.invalid/db";
    const error = ProjectorDatabaseError.fromUnknown(
      { code: "40001", message: secret, detail: secret },
      "batch",
    );

    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error).toMatchObject({
      sqlState: "40001",
      disposition: "retry-serialization",
      retryable: true,
    });
  });
});

describe("projection provider binding commitment", () => {
  it("matches PostgreSQL uuid, integer, timestamp and SHA-256 encoding", () => {
    expect(projectionProviderBindingCommitmentV1({
      publicationId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      promotionMode: "exact_incremental",
      executionEvidenceId: "33333333-3333-4333-8333-333333333333",
      executionFingerprint: `0x${"11".repeat(32)}`,
      rewardEvidence: [{
        evidenceId: "44444444-4444-4444-8444-444444444444",
        fingerprint: `0x${"22".repeat(32)}`,
      }],
      boundAt: "2026-08-02T00:10:50.427Z",
    })).toBe(
      "0xee251437622bcfd0f66145fb4c6893a42a7bb4a572001fb409279cae2cdefd84",
    );
  });

  it("rejects malformed runtime inputs before building a commitment", () => {
    expect(() => projectionProviderBindingCommitmentV1({
      publicationId: "not-a-uuid",
      runId: "22222222-2222-4222-8222-222222222222",
      promotionMode: "exact_incremental",
      executionEvidenceId: "33333333-3333-4333-8333-333333333333",
      executionFingerprint: `0x${"11".repeat(32)}`,
      rewardEvidence: [],
      boundAt: "2026-08-02T00:10:50.427Z",
    })).toThrow(ProjectorDatabaseError);
  });
});
