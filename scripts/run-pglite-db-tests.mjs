import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(root, "supabase", "migrations");
const testsDirectory = join(root, "supabase", "tests", "database");
const pgTapCompatibilityFile = join(
  root,
  "supabase",
  "tests",
  "pglite",
  "pgtap-compatibility.sql",
);

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const testFiles = (await readdir(testsDirectory))
  .filter((file) => file.endsWith(".test.sql"))
  .sort();
const pgTapCompatibility = await readFile(pgTapCompatibilityFile, "utf8");

if (migrationFiles.length === 0 || testFiles.length === 0) {
  throw new Error("database migrations and pgTAP tests must both be present");
}

let failed = false;
for (const testFile of testFiles) {
  const database = new PGlite();
  try {
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
    `);
    for (const migrationFile of migrationFiles) {
      await database.exec(
        await readFile(join(migrationsDirectory, migrationFile), "utf8"),
      );
    }
    await database.exec(pgTapCompatibility);
    await database.exec(await readFile(join(testsDirectory, testFile), "utf8"));
    console.log(`PASS ${testFile}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${testFile}`);
    console.error(error instanceof Error ? error.message : error);
    if (error && typeof error === "object" && "detail" in error && error.detail) {
      console.error(error.detail);
    }
  } finally {
    await database.close();
  }
  if (failed) break;
}

if (failed) process.exitCode = 1;
