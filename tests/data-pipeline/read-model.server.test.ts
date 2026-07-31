import { rootCertificates } from "node:tls";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const postgresMocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  query: vi.fn(),
  transaction: vi.fn(),
  createPostgresExecutor: vi.fn(),
  createPostgresReadModel: vi.fn(),
}));

vi.mock("../../lib/data-pipeline/postgres", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/data-pipeline/postgres")>();
  return {
    ...actual,
    createPostgresExecutor: postgresMocks.createPostgresExecutor,
    createPostgresReadModel: postgresMocks.createPostgresReadModel,
  };
});

import { DataPipelineError } from "../../lib/data-pipeline/errors";
import {
  getServerReadModel,
  resetServerReadModelForTests,
} from "../../lib/data-pipeline/read-model.server";

const REMOTE_DATABASE_URL = [
  "postgres://postgres.project:",
  "test-only",
  "@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
].join("");

const FLAG_NAMES = [
  "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED",
  "INDEXED_LAUNCH_LOOKUP_ENABLED",
  "INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED",
  "INDEXED_READ_SHADOW_COMPARE_ENABLED",
] as const;

function clearReadModelEnvironment() {
  for (const name of FLAG_NAMES) vi.stubEnv(name, "false");
  vi.stubEnv("PROGRAMMABLE_API_READER_DATABASE_URL", "");
  vi.stubEnv("PROGRAMMABLE_POSTGRES_SSL_CA_PEM", "");
}

function enableRemoteReadModel() {
  vi.stubEnv("INDEXED_EXPLORE_LIST_READS_ENABLED", "true");
  vi.stubEnv("PROGRAMMABLE_API_READER_DATABASE_URL", REMOTE_DATABASE_URL);
  vi.stubEnv("PROGRAMMABLE_POSTGRES_SSL_CA_PEM", rootCertificates[0]!);
}

describe("server read-model singleton", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    clearReadModelEnvironment();
    await resetServerReadModelForTests();
    postgresMocks.close.mockClear();
    postgresMocks.createPostgresExecutor.mockReset();
    postgresMocks.createPostgresReadModel.mockReset();
    postgresMocks.query.mockReset();
    postgresMocks.transaction.mockReset();
    postgresMocks.query.mockImplementation(async (text: string) => {
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_api_reader_login" }];
      }
      if (
        text ===
        "select session_user::text as session_user, current_role::text as current_role"
      ) {
        return [
          {
            session_user: "programmable_api_reader_login",
            current_role: "programmable_api_reader",
          },
        ];
      }
      return [];
    });
    postgresMocks.transaction.mockImplementation(
      async (
        work: (transaction: {
          query: typeof postgresMocks.query;
        }) => Promise<unknown>,
      ) => work({ query: postgresMocks.query }),
    );
    postgresMocks.createPostgresExecutor.mockReturnValue({
      transaction: postgresMocks.transaction,
      close: postgresMocks.close,
    });
    postgresMocks.createPostgresReadModel.mockReturnValue({
      close: postgresMocks.close,
    });
  });

  it("does not construct a database client when every indexed route and shadow mode are off", async () => {
    await expect(getServerReadModel()).resolves.toBeNull();
    expect(postgresMocks.createPostgresExecutor).not.toHaveBeenCalled();
    expect(postgresMocks.createPostgresReadModel).not.toHaveBeenCalled();
  });

  it("fails closed without credentials when an indexed route requires Postgres", async () => {
    vi.stubEnv("INDEXED_EXPLORE_LIST_READS_ENABLED", "true");

    const result = getServerReadModel();
    await expect(result).rejects.toMatchObject({
      dependency: "config",
      code: "invalid_config",
    } satisfies Partial<DataPipelineError>);
    expect(postgresMocks.createPostgresExecutor).not.toHaveBeenCalled();
  });

  it("fails closed without credentials when shadow comparison requires Postgres", async () => {
    vi.stubEnv("INDEXED_READ_SHADOW_COMPARE_ENABLED", "true");

    await expect(getServerReadModel()).rejects.toBeInstanceOf(
      DataPipelineError,
    );
    expect(postgresMocks.createPostgresExecutor).not.toHaveBeenCalled();
  });

  it("constructs the private reader for an authenticated probe while route flags stay off", async () => {
    await expect(getServerReadModel()).resolves.toBeNull();
    vi.stubEnv("PROGRAMMABLE_API_READER_DATABASE_URL", REMOTE_DATABASE_URL);
    vi.stubEnv("PROGRAMMABLE_POSTGRES_SSL_CA_PEM", rootCertificates[0]!);

    const model = await getServerReadModel({ required: true });

    expect(model).not.toBeNull();
    expect(postgresMocks.createPostgresExecutor).toHaveBeenCalledTimes(1);
    expect(postgresMocks.createPostgresReadModel).toHaveBeenCalledTimes(1);
  });

  it("shares one global promise and one bounded pool across concurrent callers", async () => {
    enableRemoteReadModel();

    const processOn = vi.spyOn(process, "on");
    try {
      const first = getServerReadModel();
      const second = getServerReadModel();

      expect(first).toBe(second);
      const [firstModel, secondModel] = await Promise.all([first, second]);
      expect(firstModel).toBe(secondModel);
      expect(postgresMocks.createPostgresExecutor).toHaveBeenCalledTimes(1);
      expect(postgresMocks.createPostgresReadModel).toHaveBeenCalledTimes(1);
      expect(postgresMocks.createPostgresExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: REMOTE_DATABASE_URL,
          sslCaPem: rootCertificates[0],
          maxConnections: 2,
          connectTimeoutMs: 1_000,
          idleTimeoutMs: 5_000,
        }),
      );
      expect(processOn).not.toHaveBeenCalled();
    } finally {
      processOn.mockRestore();
    }
  });

  it("runs route reads inside one explicit repeatable-read, read-only transaction", async () => {
    enableRemoteReadModel();
    const model = await getServerReadModel();
    if (!model) throw new Error("expected read model");

    const result = await model.repeatableReadSnapshot(async (transaction) => {
      await transaction.query("select 'payload'::text as value");
      return "complete";
    });

    expect(result).toBe("complete");
    expect(postgresMocks.transaction).toHaveBeenCalledTimes(1);
    expect(postgresMocks.query.mock.calls.map((call) => call[0])).toEqual([
      "set transaction isolation level repeatable read, read only",
      "select session_user::text as session_user",
      "set local role programmable_api_reader",
      "select session_user::text as session_user, current_role::text as current_role",
      "set local statement_timeout = '1000ms'",
      "set local lock_timeout = '250ms'",
      "set local idle_in_transaction_session_timeout = '2000ms'",
      "select 'payload'::text as value",
    ]);
  });

  it.each([
    "postgres",
    "service_role",
    "programmable_projector_login",
    "arbitrary_reader_member",
  ])(
    "rejects the %s login even if it could assume the reader capability",
    async (sessionUser) => {
      enableRemoteReadModel();
      postgresMocks.query.mockImplementation(async (text: string) => {
        if (text === "select session_user::text as session_user") {
          return [{ session_user: sessionUser }];
        }
        if (
          text ===
          "select session_user::text as session_user, current_role::text as current_role"
        ) {
          return [
            {
              session_user: sessionUser,
              current_role: "programmable_api_reader",
            },
          ];
        }
        return [];
      });

      const model = await getServerReadModel();
      if (!model) throw new Error("expected read model");

      await expect(
        model.repeatableReadSnapshot(async () => "unreachable"),
      ).rejects.toMatchObject({
        dependency: "postgres",
        code: "validation_failed",
        safeMetadata: { operation: "runtime-login-role" },
      });
      expect(postgresMocks.query).not.toHaveBeenCalledWith(
        "set local role programmable_api_reader",
      );
    },
  );

  it("keeps readiness and payload on the same snapshot when committed state changes between reads", async () => {
    enableRemoteReadModel();
    let committedParity = "current";
    let snapshotParity: string | undefined;
    postgresMocks.query.mockImplementation(async (text: string) => {
      if (
        text === "set transaction isolation level repeatable read, read only"
      ) {
        snapshotParity = committedParity;
        return [];
      }
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_api_reader_login" }];
      }
      if (
        text ===
        "select session_user::text as session_user, current_role::text as current_role"
      ) {
        return [
          {
            session_user: "programmable_api_reader_login",
            current_role: "programmable_api_reader",
          },
        ];
      }
      if (text === "select parity") return [{ parity: snapshotParity }];
      return [];
    });
    const model = await getServerReadModel();
    if (!model) throw new Error("expected read model");

    const observed = await model.repeatableReadSnapshot(async (transaction) => {
      const readiness = await transaction.query<{ parity: string }>(
        "select parity",
      );
      committedParity = "mismatch";
      const payloadVersion = await transaction.query<{ parity: string }>(
        "select parity",
      );
      return [readiness[0]?.parity, payloadVersion[0]?.parity];
    });

    expect(observed).toEqual(["current", "current"]);
    expect(committedParity).toBe("mismatch");
    expect(postgresMocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected construction promise sticky until the test-only reset", async () => {
    enableRemoteReadModel();
    postgresMocks.createPostgresExecutor.mockImplementationOnce(() => {
      throw new Error("synthetic construction failure");
    });

    const first = getServerReadModel();
    const second = getServerReadModel();
    expect(first).toBe(second);
    await expect(first).rejects.toThrow("synthetic construction failure");
    await expect(second).rejects.toThrow("synthetic construction failure");
    expect(postgresMocks.createPostgresExecutor).toHaveBeenCalledTimes(1);

    await resetServerReadModelForTests();
    await expect(getServerReadModel()).resolves.not.toBeNull();
    expect(postgresMocks.createPostgresExecutor).toHaveBeenCalledTimes(2);
  });

  it("closes the shared pool only through the test-only reset", async () => {
    enableRemoteReadModel();
    await getServerReadModel();

    await resetServerReadModelForTests();
    expect(postgresMocks.close).toHaveBeenCalledTimes(1);

    await resetServerReadModelForTests();
    expect(postgresMocks.close).toHaveBeenCalledTimes(1);
  });

  it("rejects reset access outside the test runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(resetServerReadModelForTests()).rejects.toBeInstanceOf(
      DataPipelineError,
    );
  });
});
