import { describe, expect, it, vi } from "vitest";
import { rootCertificates } from "node:tls";

vi.mock("server-only", () => ({}));

import {
  validatedPostgresConnectionString,
  validatedPostgresSslCa,
} from "../../lib/data-pipeline/postgres-connection.server";
import { DataPipelineError } from "../../lib/data-pipeline/errors";
import {
  createPostgresExecutor,
  postgresJson,
} from "../../lib/data-pipeline/postgres";

const TEST_CA = rootCertificates[0]!;

describe("Postgres connection boundary", () => {
  it("requires certificate and hostname verification for every remote database", () => {
    const verified =
      "postgresql://reader:password@db.example:5432/postgres?sslmode=verify-full";
    const encodedCredential =
      "postgresql://reader:p%40ssword@db.example:5432/postgres?sslmode=verify-full";
    const officialPooler =
      "postgres://postgres.project:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full";

    expect(validatedPostgresConnectionString(verified)).toBe(verified);
    expect(validatedPostgresConnectionString(encodedCredential)).toBe(
      encodedCredential,
    );
    expect(validatedPostgresConnectionString(officialPooler)).toBe(
      officialPooler,
    );
    for (const connectionString of [
      "postgresql://reader:password@db.example/postgres",
      "postgresql://reader:password@db.example/postgres?sslmode=require",
      "postgresql://reader:password@db.example/postgres?sslmode=prefer",
      "postgresql://reader:password@db.example/postgres?sslmode=disable",
      "postgresql://reader:password@db.example/postgres?sslmode=verify-full&sslmode=require",
      "postgresql://reader:password@db.example/postgres?sslmode=verify-full&ssl=disable",
      "postgresql://reader:s3cr3t@attacker.example,unused@localhost/postgres",
      "postgresql://reader:s3cr3t@attacker.example%2Clocalhost/postgres",
      "postgresql://reader:s3cr3t@attacker.example@localhost/postgres",
      "postgresql://reader:s3cr3t@localhost\\@attacker.example/postgres",
      "postgresql://reader:s3cr3t@localhost/postgres?sslmode=disable&host=attacker.example",
      "postgresql://reader:s3cr3t@127.000.000.001/postgres",
      "postgresql://reader:s3cr3t@localhost.example/postgres",
      "postgresql://postgres:postgres@[::1]:54322/postgres",
      "postgresql://reader:password@db.example/postgres?sslmode=verify-full",
      "postgresql://reader:password@DB.example:5432/postgres?sslmode=verify-full",
      "postgresql://reader:password@d\u0131.example:5432/postgres?sslmode=verify-full",
    ]) {
      expect(() =>
        validatedPostgresConnectionString(connectionString),
      ).toThrowError(DataPipelineError);
    }
  });

  it("allows an explicit non-TLS connection only for a loopback test database", () => {
    for (const connectionString of [
      "postgresql://postgres:postgres@localhost:54322/postgres",
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
    ]) {
      expect(validatedPostgresConnectionString(connectionString)).toBe(
        connectionString,
      );
    }
  });

  it("rejects malformed credentials and never reflects them in the error", () => {
    const secret = "do-not-reflect-this-password";
    let thrown: unknown;
    try {
      validatedPostgresConnectionString(
        `postgresql://reader:${secret}@db.example/postgres?sslmode=require`,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DataPipelineError);
    expect(String(thrown)).not.toContain(secret);
    expect(JSON.stringify(thrown)).not.toContain(secret);

    for (const connectionString of [
      "postgresql://db.example/postgres?sslmode=verify-full",
      "postgresql://reader:password@/postgres?sslmode=verify-full",
      "postgresql://reader:password@db.example/?sslmode=verify-full",
      "postgresql://reader:password@db.example/postgres?sslmode=verify-full#fragment",
    ]) {
      expect(() =>
        validatedPostgresConnectionString(connectionString),
      ).toThrowError(DataPipelineError);
    }
  });

  it("requires a real CA and pins verified TLS for a remote pooler", async () => {
    const connectionString =
      "postgres://postgres.project:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full";
    const factory = vi.fn((_url: string, options: unknown) =>
      ({
        begin: vi.fn(),
        end: vi.fn(async () => undefined),
        options,
      }) as never,
    );

    expect(() =>
      createPostgresExecutor({ connectionString, postgresFactory: factory }),
    ).toThrowError(DataPipelineError);
    expect(factory).not.toHaveBeenCalled();

    const executor = createPostgresExecutor({
      connectionString,
      sslCaPem: TEST_CA,
      postgresFactory: factory,
    });
    const options = factory.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      ssl: { ca: TEST_CA, rejectUnauthorized: true },
      fetch_types: true,
      connection: {
        application_name: "programmable-read-model",
      },
    });
    expect(options).not.toMatchObject({
      connection: {
        statement_timeout: expect.anything(),
      },
    });
    await executor.close();
  });

  it("binds SQL arrays through the postgres driver array encoder", async () => {
    const encodedArray = Object.freeze({ kind: "driver-array" });
    const array = vi.fn(() => encodedArray);
    const unsafe = vi.fn(async () => []);
    const begin = vi.fn(async (work: (transaction: unknown) => unknown) =>
      work({ unsafe }),
    );
    const factory = vi.fn(() =>
      ({
        array,
        begin,
        end: vi.fn(async () => undefined),
      }) as never,
    );
    const executor = createPostgresExecutor({
      connectionString:
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
      allowInsecureLoopback: true,
      postgresFactory: factory,
    });
    const bytes = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];

    await executor.transaction((transaction) =>
      transaction.query("select $1::bytea[], $2::text", [bytes, "value"]),
    );

    expect(array).toHaveBeenCalledWith(bytes);
    expect(unsafe).toHaveBeenCalledWith(
      "select $1::bytea[], $2::text",
      [encodedArray, "value"],
    );
    await executor.close();
  });

  it("binds JSON arrays through the JSON encoder without double encoding", async () => {
    const encodedJson = Object.freeze({ kind: "driver-json" });
    const json = vi.fn(() => encodedJson);
    const unsafe = vi.fn(async () => []);
    const begin = vi.fn(async (work: (transaction: unknown) => unknown) =>
      work({ unsafe }),
    );
    const factory = vi.fn(() =>
      ({
        array: vi.fn(),
        json,
        begin,
        end: vi.fn(async () => undefined),
      }) as never,
    );
    const executor = createPostgresExecutor({
      connectionString:
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
      allowInsecureLoopback: true,
      postgresFactory: factory,
    });
    const value = [{ orderedTopics: ["0x01", "0x02"] }];

    await executor.transaction((transaction) =>
      transaction.query("select $1::jsonb", [postgresJson(value)]),
    );

    expect(json).toHaveBeenCalledWith(value);
    expect(unsafe).toHaveBeenCalledWith("select $1::jsonb", [encodedJson]);
    await executor.close();
  });

  it("rejects a global TLS bypass even when the connection has its own CA", () => {
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    try {
      expect(() =>
        createPostgresExecutor({
          connectionString:
            "postgres://postgres.project:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
          sslCaPem: TEST_CA,
          postgresFactory: vi.fn(() => ({}) as never),
        }),
      ).toThrowError(DataPipelineError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("requires an explicit opt-in before allowing plaintext loopback", () => {
    const connectionString =
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
    const factory = vi.fn(() =>
      ({ begin: vi.fn(), end: vi.fn(async () => undefined) }) as never,
    );

    expect(() =>
      createPostgresExecutor({ connectionString, postgresFactory: factory }),
    ).toThrowError(DataPipelineError);
    expect(factory).not.toHaveBeenCalled();

    expect(() =>
      createPostgresExecutor({
        connectionString,
        allowInsecureLoopback: true,
        postgresFactory: factory,
      }),
    ).not.toThrow();
  });

  it("validates a CA certificate without accepting keys or arbitrary PEM", () => {
    expect(validatedPostgresSslCa(TEST_CA)).toBe(TEST_CA);
    for (const value of [
      undefined,
      "not-a-certificate",
      "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    ]) {
      expect(() => validatedPostgresSslCa(value)).toThrowError(
        DataPipelineError,
      );
    }
  });
});
