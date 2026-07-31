import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validatedPostgresConnectionString } from "../../lib/data-pipeline/postgres-connection.server";
import { DataPipelineError } from "../../lib/data-pipeline/errors";

describe("Postgres connection boundary", () => {
  it("requires certificate and hostname verification for every remote database", () => {
    const verified =
      "postgresql://reader:password@db.example/postgres?sslmode=verify-full";
    const encodedCredential =
      "postgresql://reader:p%40ssword@db.example/postgres?sslmode=verify-full";

    expect(validatedPostgresConnectionString(verified)).toBe(verified);
    expect(validatedPostgresConnectionString(encodedCredential)).toBe(
      encodedCredential,
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
      "postgres://reader:password@db.example/postgres?sslmode=verify-full",
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
});
