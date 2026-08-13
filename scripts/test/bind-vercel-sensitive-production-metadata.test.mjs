import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = join(
  process.cwd(),
  "scripts/bind-vercel-sensitive-production-metadata.mjs",
);
const projectId = "prj_Programmable123";
const sentinel = "plain-value-must-never-be-persisted-or-logged";

function runBinder(metadata, outputFile) {
  return spawnSync(
    process.execPath,
    [
      script,
      "--output-file",
      outputFile,
      "--vercel-project-id",
      projectId,
    ],
    {
      encoding: "utf8",
      input: JSON.stringify(metadata),
    },
  );
}

function roleEntry(key, type, value) {
  return {
    id: `id-${key}`,
    key,
    type,
    target: ["production"],
    createdAt: 1_786_580_000_000,
    value,
  };
}

test("streams value-bearing Vercel CLI JSON into value-free role metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "programmable-vercel-metadata-"));
  const outputFile = join(directory, "bound.json");
  const roles = [
    roleEntry("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER", "plain", `${sentinel}-drpc`),
    roleEntry("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL", "sensitive", undefined),
    roleEntry("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT", "plain", `${sentinel}-primary`),
    roleEntry("PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER", "plain", `${sentinel}-quicknode`),
    roleEntry("PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL", "sensitive", undefined),
    roleEntry("PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT", "plain", `${sentinel}-secondary`),
  ];

  const result = runBinder({ envs: roles }, outputFile);
  assert.equal(result.status, 0, result.stderr);
  const output = await readFile(outputFile, "utf8");
  assert.doesNotMatch(`${result.stdout}${result.stderr}${output}`, new RegExp(sentinel, "u"));
  assert.equal((await stat(outputFile)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(output), {
    schemaVersion: "programmable.vercel-sensitive-production-metadata.v1",
    vercelProjectId: projectId,
    target: "production",
    envs: roles.map(({ key, type, target }) => ({ key, type, target })),
  });
});

test("rejects unexpected CLI schema without persisting or logging values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "programmable-vercel-metadata-"));
  const outputFile = join(directory, "bound.json");
  const result = runBinder({
    envs: [roleEntry("INVALID KEY", "plain", sentinel)],
  }, outputFile);

  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(sentinel, "u"));
  await assert.rejects(readFile(outputFile, "utf8"), { code: "ENOENT" });
});

test("rejects unexpected root fields instead of silently changing the bound schema", async () => {
  const directory = await mkdtemp(join(tmpdir(), "programmable-vercel-metadata-"));
  const outputFile = join(directory, "bound.json");
  const result = runBinder({ envs: [], value: sentinel }, outputFile);

  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(sentinel, "u"));
  await assert.rejects(readFile(outputFile, "utf8"), { code: "ENOENT" });
});
