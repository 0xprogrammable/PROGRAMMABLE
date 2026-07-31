import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPostgresExecutor,
  createPostgresReadModel,
  type PostgresExecutor,
} from "../../lib/data-pipeline/postgres";

const configuredDatabaseUrl = process.env.PROGRAMMABLE_TEST_DATABASE_URL;
const UINT256_MAX =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const TOKEN = "0x1111111111111111111111111111111111111111";
const TRANSACTION_HASH = `0x${"22".repeat(32)}`;

function requireLocalDatabaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PROGRAMMABLE_TEST_DATABASE_URL must be a PostgreSQL URL");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    parsed.protocol !== "postgresql:" ||
    !localHosts.has(parsed.hostname) ||
    parsed.username.length === 0 ||
    parsed.pathname.length <= 1
  ) {
    throw new Error(
      "PROGRAMMABLE_TEST_DATABASE_URL must target a loopback PostgreSQL database",
    );
  }
  return parsed.toString();
}

const localDatabaseUrl = configuredDatabaseUrl
  ? requireLocalDatabaseUrl(configuredDatabaseUrl)
  : undefined;

function repositoryMigrationVersions(): string[] {
  return readdirSync(
    new URL("../../supabase/migrations/", import.meta.url),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name.slice(0, entry.name.indexOf("_")))
    .sort();
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} was not initialized`);
  return value;
}

function runtimeConnectionString(adminUrl: string, role: string, password: string) {
  const parsed = new URL(adminUrl);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

async function expectPostgresErrorCode(
  operation: Promise<unknown>,
  expectedCode: string,
) {
  try {
    await operation;
  } catch (error) {
    expect(error).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`expected PostgreSQL error ${expectedCode}`);
}

describe.skipIf(!localDatabaseUrl)(
  "Postgres adapter against the migrated local schema",
  () => {
    let admin: ReturnType<typeof postgres> | undefined;
    let executor: PostgresExecutor | undefined;
    let readModel: ReturnType<typeof createPostgresReadModel> | undefined;
    const roleName = `programmable_adapter_${process.pid}_${randomBytes(4).toString("hex")}`;
    const rolePassword = randomBytes(24).toString("hex");

    beforeAll(async () => {
      const adminUrl = required(localDatabaseUrl, "local database URL");
      admin = postgres(adminUrl, {
        prepare: false,
        max: 1,
        connect_timeout: 3,
        idle_timeout: 5,
      });

      const expectedMigrations = repositoryMigrationVersions();
      const migrationRows = (await admin.unsafe(
        `select version::text as version
         from supabase_migrations.schema_migrations
         where version = any($1::text[])
         order by version`,
        [expectedMigrations],
      )) as unknown as { version: string }[];
      if (
        expectedMigrations.length === 0 ||
        migrationRows.map(({ version }) => version).join(",") !==
          expectedMigrations.join(",")
      ) {
        throw new Error(
          "PROGRAMMABLE_TEST_DATABASE_URL does not contain every repository migration",
        );
      }

      // Both values are generated from strict lowercase alphanumeric alphabets.
      // Keeping this role-DDL outside the adapter avoids granting DDL to runtime code.
      await admin.unsafe(
        `create role "${roleName}" login noinherit password '${rolePassword}'`,
      );
      await admin.unsafe(
        `grant programmable_api_reader to "${roleName}"`,
      );

      executor = createPostgresExecutor({
        connectionString: runtimeConnectionString(
          adminUrl,
          roleName,
          rolePassword,
        ),
        maxConnections: 1,
        connectTimeoutMs: 3_000,
        idleTimeoutMs: 5_000,
      });
      readModel = createPostgresReadModel({ executor });
    }, 30_000);

    afterAll(async () => {
      if (executor) await executor.close();
      if (!admin) return;
      await admin.unsafe(
        `select pg_catalog.pg_terminate_backend(pid)
         from pg_catalog.pg_stat_activity
         where usename = $1 and pid <> pg_catalog.pg_backend_pid()`,
        [roleName],
      );
      await admin.unsafe(`drop role if exists "${roleName}"`);
      await admin.end({ timeout: 5 });
    }, 30_000);

    it("uses postgres 3.4.7 against every checked-in migration and approved read object", async () => {
      const packageMetadata = JSON.parse(
        readFileSync(
          new URL("../../node_modules/postgres/package.json", import.meta.url),
          "utf8",
        ),
      ) as { version?: unknown };
      expect(packageMetadata.version).toBe("3.4.7");

      const rows = (await required(admin, "admin connection").unsafe(
        `select
           pg_catalog.to_regnamespace('programmable_private')::text as schema_name,
           pg_catalog.to_regrole('programmable_api_reader')::text as reader_role,
           pg_catalog.to_regclass('programmable_private.v_recent_launches')::text as launch_view,
           pg_catalog.to_regprocedure(
             'programmable_private.api_recent_launches(integer)'
           )::text as recent_function,
           pg_catalog.to_regprocedure(
             'programmable_private.api_launch_by_token(bigint,bytea)'
           )::text as token_function`,
      )) as unknown as Record<string, unknown>[];
      expect(rows).toEqual([
        {
          schema_name: "programmable_private",
          reader_role: "programmable_api_reader",
          launch_view: "programmable_private.v_recent_launches",
          recent_function:
            "programmable_private.api_recent_launches(integer)",
          token_function:
            "programmable_private.api_launch_by_token(bigint,bytea)",
        },
      ]);
    });

    it("sets the task login to programmable_api_reader only inside its transaction", async () => {
      const rows = await required(executor, "runtime executor").transaction(
        async (transaction) => {
          const before = await transaction.query<{
            session_user: unknown;
            current_role: unknown;
          }>(
            "select session_user::text as session_user, current_role::text as current_role",
          );
          await transaction.query("set local role programmable_api_reader");
          const after = await transaction.query<{
            session_user: unknown;
            current_role: unknown;
          }>(
            "select session_user::text as session_user, current_role::text as current_role",
          );
          return { before, after };
        },
      );

      expect(rows.before).toEqual([
        { session_user: roleName, current_role: roleName },
      ]);
      expect(rows.after).toEqual([
        {
          session_user: roleName,
          current_role: "programmable_api_reader",
        },
      ]);
    });

    it("reads every approved adapter function and view through the runtime role", async () => {
      const model = required(readModel, "Postgres read model");

      await expect(model.recentLaunches({ limit: 1 })).resolves.toEqual(
        expect.any(Array),
      );
      await expect(
        model.launchByToken({ chainId: "1", token: TOKEN }),
      ).resolves.toSatisfy((value) => value === null || value.token === TOKEN);
      await expect(
        model.publicProfile({
          chainId: "1",
          account: TOKEN,
          limit: 1,
          offset: 0,
        }),
      ).resolves.toMatchObject({
        launches: expect.any(Array),
        rewards: expect.any(Array),
      });
      await expect(
        model.classicVaultHistory({ chainId: "1", vault: TOKEN, limit: 1 }),
      ).resolves.toEqual(expect.any(Array));
      await expect(
        model.stockPairedVaultHistory({
          chainId: "1",
          vault: TOKEN,
          limit: 1,
        }),
      ).resolves.toEqual(expect.any(Array));
      await expect(
        model.launchLookup({
          chainId: "1",
          transactionHash: TRANSACTION_HASH,
          limit: 1,
        }),
      ).resolves.toEqual(expect.any(Array));
      await expect(model.health()).resolves.toMatchObject({
        checkpoints: expect.any(Array),
        parity: {
          matchingRecords: expect.any(String),
          mismatchingRecords: expect.any(String),
        },
        circuits: expect.any(Array),
      });
    });

    it("binds parameters and decodes bytea, OID, bigint, and uint256 numeric values losslessly", async () => {
      const rawBytes = Uint8Array.from([0, 1, 127, 128, 254, 255]);
      const beyondSafeInteger = "9007199254740993";
      const opaqueText = "'); delete from programmable_private.release_epochs; --";
      const rows = await required(executor, "runtime executor").transaction(
        async (transaction) => {
          await transaction.query("set local role programmable_api_reader");
          return transaction.query<Record<string, unknown>>(
            `select
               $1::bytea as raw_bytes,
               $2::bigint as bigint_value,
               $3::numeric(78,0) as uint256_value,
               $4::text as opaque_text,
               'bytea'::pg_catalog.regtype::pg_catalog.oid::integer as bytea_oid,
               'bigint'::pg_catalog.regtype::pg_catalog.oid::integer as bigint_oid,
               'numeric'::pg_catalog.regtype::pg_catalog.oid::integer as numeric_oid`,
            [rawBytes, beyondSafeInteger, UINT256_MAX, opaqueText],
          );
        },
      );

      expect(rows).toHaveLength(1);
      expect(Array.from(rows[0]!.raw_bytes as Uint8Array)).toEqual([
        0, 1, 127, 128, 254, 255,
      ]);
      expect(rows[0]).toMatchObject({
        bigint_value: beyondSafeInteger,
        uint256_value: UINT256_MAX,
        opaque_text: opaqueText,
        bytea_oid: 17,
        bigint_oid: 20,
        numeric_oid: 1700,
      });
    });

    it("rejects direct base-table reads for the API reader", async () => {
      await expectPostgresErrorCode(
        required(executor, "runtime executor").transaction(
          async (transaction) => {
            await transaction.query("set local role programmable_api_reader");
            await transaction.query(
              "select * from programmable_private.release_epochs limit 1",
            );
          },
        ),
        "42501",
      );
    });

    it("rejects writes for the API reader", async () => {
      await expectPostgresErrorCode(
        required(executor, "runtime executor").transaction(
          async (transaction) => {
            await transaction.query("set local role programmable_api_reader");
            await transaction.query(
              "delete from programmable_private.release_epochs where false",
            );
          },
        ),
        "42501",
      );
    });
  },
);
